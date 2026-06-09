import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { writeWorkerInboxNotification } from './messaging/unifiedWorkerNotifications';
import { getPushProvider } from './messaging/pushProviderFactory';
import { sendWorkerMessageInternal } from './twilio';
import { shouldSendNotification } from './utils/notificationSettings';
import { markLifecycleEventIfFirst } from './messaging/lifecycleDedupe';
import { buildWorkerAssignmentUrl } from './utils/workerUrls';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import {
  resolveShiftReminderProfile,
  ALL_SHIFT_REMINDER_TYPES,
  type ShiftReminderType,
  type ShiftReminderStep,
} from './cadence/shiftReminderProfile';
import {
  fetchShiftPayloadExtras,
  resolveShiftIdFromAssignment,
  type ShiftPayloadExtras,
} from './cadence/enrichShiftPayload';
import {
  buildCadenceMessage,
  isCadenceReminderType,
  type CadenceMessagePayload,
} from './cadence/cadenceMessages';
import { notifyRecruitersOnWorkerEvent } from './messaging/notifyRecruitersOnWorkerEvent';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REMINDER_SUBCOLLECTION = 'scheduled_notifications';
const REMINDER_KIND = 'worker_shift_reminder';
const REMINDER_VERSION = 1;
const MAX_ATTEMPTS = 3;
const CLAIM_TTL_MS = 5 * 60 * 1000;

// Early-morning floor (worker local time) for long-lead reminders. T-2h
// and longer-lead steps that would otherwise fire before this hour get
// pushed to it — Danny's managers were getting 5–7 AM "starts in X hours"
// pings that wake up a worker hours before they need to leave. The
// shorter cadence steps (T-15m, T-0h, post-start no-shows) bypass the
// floor because they're tied to imminent arrival and the wake-up itself
// is the point. We also cap the deferral at T-15m so even a 6 AM shift
// where T-2h would naturally fire at 4 AM doesn't get pushed to 8 AM
// (which would be 2 hours after the worker was supposed to clock in).
const REMINDER_EARLY_MORNING_FLOOR_LOCAL_HOUR = 8;
const REMINDER_FLOOR_LATEST_OFFSET_MIN_BEFORE_START = 15; // T-15m cap

/**
 * Return the minute-of-day (0..1439) for `ms` rendered in `timezone`.
 * Used by `applyEarlyMorningFloor` to decide whether a scheduled time
 * lands inside the worker's local pre-dawn window.
 */
function getLocalMinutesSinceMidnight(ms: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms));
    const hStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const mStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (h === 24) h = 0; // some locales render midnight as "24"
    return h * 60 + m;
  } catch (err) {
    logger.warn('[worker_shift_reminders] tz_minute_extract_fallback', {
      timezone,
      err: (err as Error)?.message || String(err),
    });
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  }
}

/**
 * If `scheduledForMs` falls before the early-morning floor in the
 * worker's local timezone AND the reminder's lead time is long enough
 * to safely defer (offsetHours >= 2), push it forward to the floor.
 *
 * Capped at `start - REMINDER_FLOOR_LATEST_OFFSET_MIN_BEFORE_START`
 * so we never push the reminder to fire after the shift has started
 * (or so close that the worker has no useful prep time).
 */
function applyEarlyMorningFloor(
  scheduledForMs: number,
  shiftStartMs: number,
  offsetHours: number,
  timezone: string,
): { scheduledForMs: number; deferred: boolean; deferredReason?: string } {
  // Short-lead steps (T-15m, T-0h, post-start) always send when scheduled —
  // they're the imminent-arrival pings whose value IS waking the worker.
  if (offsetHours < 2) return { scheduledForMs, deferred: false };

  const localMinutes = getLocalMinutesSinceMidnight(scheduledForMs, timezone);
  const floorMinutes = REMINDER_EARLY_MORNING_FLOOR_LOCAL_HOUR * 60;
  if (localMinutes >= floorMinutes) return { scheduledForMs, deferred: false };

  const liftMs = (floorMinutes - localMinutes) * 60 * 1000;
  let deferredMs = scheduledForMs + liftMs;
  // Cap: never push the reminder past the shift's own T-15m gate.
  const latestAllowedMs =
    shiftStartMs - REMINDER_FLOOR_LATEST_OFFSET_MIN_BEFORE_START * 60 * 1000;
  let cappedAtTMinus15 = false;
  if (deferredMs > latestAllowedMs) {
    deferredMs = latestAllowedMs;
    cappedAtTMinus15 = true;
  }
  // If the cap brings the deferred time back before/at the original time,
  // the floor would be a no-op or backwards move — keep the original.
  if (deferredMs <= scheduledForMs) return { scheduledForMs, deferred: false };

  return {
    scheduledForMs: deferredMs,
    deferred: true,
    deferredReason: cappedAtTMinus15
      ? 'early_morning_floor_capped_at_t_minus_15m'
      : `early_morning_floor_${REMINDER_EARLY_MORNING_FLOOR_LOCAL_HOUR}am_local`,
  };
}
// Deterministic retry delay for non-terminal retry path.
const RETRY_BACKOFF_MS = 2 * 60 * 1000;
const DISPATCH_BATCH_LIMIT = 200;
const LEGACY_REMINDER_TYPES: ReminderType[] = ['shift_reminder_24h', 'shift_reminder_4h'];

type ReminderType =
  | ShiftReminderType
  // Legacy values kept for backward-compatible reads during rollout.
  | 'shift_reminder_24h'
  | 'shift_reminder_4h';
type ReminderStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

function isTerminalReminderStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return s === 'sent' || s === 'failed' || s === 'cancelled';
}

const HOURS_BY_TYPE: Record<ReminderType, number> = {
  assignment_reminder_24h: 24,
  assignment_reminder_23h_escalate: 23,
  assignment_reminder_22h_final: 22,
  assignment_reminder_2h: 2,
  assignment_reminder_2h_instructions: 2,
  assignment_reminder_15m_clockin: 0.25,
  assignment_checkin_0h: 0,
  // Negative = after start (30m past start).
  assignment_noshow_check: -0.5,
  shift_reminder_24h: 24,
  shift_reminder_4h: 4,
};

const DOC_ID_BY_TYPE: Record<ReminderType, string> = {
  assignment_reminder_24h: 'assignment_reminder_24h',
  assignment_reminder_23h_escalate: 'assignment_reminder_23h_escalate',
  assignment_reminder_22h_final: 'assignment_reminder_22h_final',
  assignment_reminder_2h: 'assignment_reminder_2h',
  assignment_reminder_2h_instructions: 'assignment_reminder_2h_instructions',
  assignment_reminder_15m_clockin: 'assignment_reminder_15m_clockin',
  assignment_checkin_0h: 'assignment_checkin_0h',
  assignment_noshow_check: 'assignment_noshow_check',
  shift_reminder_24h: 'shift_reminder_24h',
  shift_reminder_4h: 'shift_reminder_4h',
};

/**
 * Canonical set — previously hardcoded to [24h, 2h]. Now resolved at runtime
 * by resolveShiftReminderProfile() so CORT-style tenants can opt in to the
 * extended cadence (24h, 2h_instructions, 15m_clockin, 0h_checkin).
 *
 * Kept exported as ALL_SHIFT_REMINDER_TYPES (from ./cadence/shiftReminderProfile)
 * for the cleanup paths that still need to know every possible type string.
 */
void ALL_SHIFT_REMINDER_TYPES;

type ReminderPayload = {
  jobTitle: string;
  companyName: string;
  locationName: string;
  locationAddress?: string;
  startTime: admin.firestore.Timestamp;
  endTime?: admin.firestore.Timestamp;
  timezone?: string;
  // Shift-level extras (optional). Populated when assignment.shiftId resolves
  // to a readable shift doc. Consumed by the cadence message builders.
  clockInUrl?: string;
  shiftTitle?: string;
  shiftDescription?: string;
  emailIntro?: string;
  shiftId?: string;
  jobOrderId?: string;
};

type ReminderDoc = {
  type: 'worker_shift_reminder';
  reminderType: ReminderType;
  workerId: string;
  tenantId: string;
  assignmentId: string;
  deepLink: string;
  scheduledFor: admin.firestore.Timestamp;
  status: ReminderStatus;
  channels: { push: boolean; sms: boolean; inbox: boolean };
  payload: ReminderPayload;
  resolvedTimezone: string;
  assignmentStatusSnapshot: string;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  sentAt?: admin.firestore.Timestamp | admin.firestore.FieldValue;
  cancelledAt?: admin.firestore.Timestamp | admin.firestore.FieldValue;
  claimedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue;
  claimedBy?: string;
  claimExpiresAt?: admin.firestore.Timestamp | admin.firestore.FieldValue;
  cancelReason?: string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string;
  version: number;
  lastError?: string;
  lock?: {
    claimedAt?: admin.firestore.Timestamp;
    claimedBy?: string;
    expiresAt?: admin.firestore.Timestamp;
  };
  delivery?: {
    inbox?: { attemptedAt?: admin.firestore.Timestamp; success?: boolean; error?: string };
    push?: { attemptedAt?: admin.firestore.Timestamp; success?: boolean; error?: string };
    sms?: { attemptedAt?: admin.firestore.Timestamp; success?: boolean; error?: string };
  };
};

function isProductionProject(): boolean {
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG || '').toLowerCase();
  return projectId.includes('hrx1-d3beb') || projectId.includes('prod') || projectId.includes('production');
}

async function getDebugOverrideMinutes(tenantId: string): Promise<number[] | null> {
  if (isProductionProject()) return null;
  try {
    const snap = await db.doc(`tenants/${tenantId}/messagingConfig/reminderOverrides`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    if (data?.enabled !== true) return null;
    const minutes = Array.isArray(data?.shortIntervalsMinutes)
      ? data.shortIntervalsMinutes
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v > 0 && v <= 24 * 60)
      : [];
    if (minutes.length === 0) return null;
    // Profile may have up to N steps (CORT: 4). Return up to 8 to leave headroom.
    return minutes.slice(0, 8);
  } catch {
    return null;
  }
}

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown): string {
  return normalize(value).toLowerCase();
}

function isConfirmedStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return s === 'confirmed' || s === 'active';
}

function isCancelLikeStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return ['cancelled', 'canceled', 'declined', 'withdrawn', 'reassigned', 'worker-cancelled', 'worker_cancelled'].includes(s);
}

function toTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return admin.firestore.Timestamp.fromDate(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }
  if (typeof value === 'object' && value !== null) {
    const maybe = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toDate === 'function') {
      const d = maybe.toDate();
      return Number.isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
    }
    if (typeof maybe.seconds === 'number') {
      try {
        return new admin.firestore.Timestamp(maybe.seconds, maybe.nanoseconds ?? 0);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function combineDateAndTimeToTimestamp(dateValue: unknown, timeValue: unknown): admin.firestore.Timestamp | null {
  // TODO(timezone-hardening): replace this UTC merge helper with a dedicated
  // timezone-aware wall-clock conversion utility that takes (date, time, timezone)
  // to correctly handle DST transitions and local scheduling semantics.
  const dateTs = toTimestamp(dateValue);
  if (!dateTs) return null;
  if (typeof timeValue !== 'string') return dateTs;
  const m = timeValue.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return dateTs;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  const d = dateTs.toDate();
  const merged = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm, 0, 0));
  return admin.firestore.Timestamp.fromDate(merged);
}

function resolveAssignmentStart(assignment: Record<string, unknown>): admin.firestore.Timestamp | null {
  return (
    toTimestamp(assignment.startDateTime) ||
    combineDateAndTimeToTimestamp(assignment.startDate, assignment.startTime) ||
    toTimestamp(assignment.startDate) ||
    null
  );
}

function resolveAssignmentEnd(assignment: Record<string, unknown>): admin.firestore.Timestamp | null {
  return (
    toTimestamp(assignment.endDateTime) ||
    combineDateAndTimeToTimestamp(assignment.endDate || assignment.startDate, assignment.endTime) ||
    toTimestamp(assignment.endDate) ||
    null
  );
}

function resolveLocationAddress(assignment: Record<string, unknown>): string {
  const address = assignment.worksiteAddress || assignment.locationAddress;
  if (typeof address === 'string') return address;
  if (address && typeof address === 'object') {
    const row = address as Record<string, unknown>;
    return [row.street, row.city, row.state, row.zipCode || row.zip]
      .map((x) => normalize(x))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function resolveTimezone(assignment: Record<string, unknown>, tenantData: Record<string, unknown> | null): string {
  return (
    normalize(
      assignment.timezone ||
      assignment.timeZone ||
      assignment.worksiteTimezone ||
      assignment.locationTimezone ||
      tenantData?.timezone ||
      tenantData?.timeZone
    ) || 'UTC'
  );
}

function buildPayload(
  assignment: Record<string, unknown>,
  startTime: admin.firestore.Timestamp,
  endTime: admin.firestore.Timestamp | null,
  timezone: string,
  shiftExtras?: ShiftPayloadExtras,
): ReminderPayload {
  const payload: ReminderPayload = {
    jobTitle: normalize(assignment.jobTitle || assignment.jobOrderName || assignment.title) || 'Shift',
    companyName: normalize(assignment.companyName) || 'C1 Staffing',
    locationName: normalize(assignment.locationName || assignment.location || assignment.worksiteName) || 'Worksite',
    startTime,
    timezone,
  };
  const locationAddress = resolveLocationAddress(assignment);
  if (locationAddress) payload.locationAddress = locationAddress;
  if (endTime) payload.endTime = endTime;
  if (shiftExtras) {
    if (shiftExtras.clockInUrl) payload.clockInUrl = shiftExtras.clockInUrl;
    if (shiftExtras.shiftTitle) payload.shiftTitle = shiftExtras.shiftTitle;
    if (shiftExtras.shiftDescription) payload.shiftDescription = shiftExtras.shiftDescription;
    if (shiftExtras.emailIntro) payload.emailIntro = shiftExtras.emailIntro;
    if (shiftExtras.shiftId) payload.shiftId = shiftExtras.shiftId;
    if (shiftExtras.jobOrderId) payload.jobOrderId = shiftExtras.jobOrderId;
  }
  return payload;
}

function formatStartInTimezone(start: admin.firestore.Timestamp, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(start.toDate());
  } catch {
    return start.toDate().toISOString();
  }
}

function shouldResync(before: Record<string, unknown> | null, after: Record<string, unknown>): boolean {
  if (!before) return true;
  const materialFields = [
    'status',
    'userId',
    'candidateId',
    'startDateTime',
    'startDate',
    'startTime',
    'endDateTime',
    'endDate',
    'endTime',
    'timezone',
    'timeZone',
    'worksiteTimezone',
    'locationTimezone',
    'jobTitle',
    'companyName',
    'locationName',
    'location',
    'worksiteName',
    'worksiteAddress',
    'locationAddress',
  ];
  return materialFields.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

async function cancelNonTerminalReminders(tenantId: string, assignmentId: string, reason: string): Promise<void> {
  const snap = await db
    .collection(`tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}`)
    .where('type', '==', REMINDER_KIND)
    .get();
  if (snap.empty) return;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  for (const docSnap of snap.docs) {
    const status = normalizeStatus(docSnap.get('status'));
    if (status === 'sent' || status === 'cancelled') continue;
    batch.set(docSnap.ref, {
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
      cancelReason: reason,
      lastError: reason,
      claimedAt: admin.firestore.FieldValue.delete(),
      claimedBy: admin.firestore.FieldValue.delete(),
      claimExpiresAt: admin.firestore.FieldValue.delete(),
      lock: admin.firestore.FieldValue.delete(),
    }, { merge: true });
  }
  await batch.commit();
}

async function cleanupLegacyReminderDocsForAssignment(
  tenantId: string,
  assignmentId: string,
  reason = 'legacy_type_migrated_to_canonical',
): Promise<number> {
  const subcollectionRef = db.collection(`tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}`);
  const snap = await subcollectionRef.where('type', '==', REMINDER_KIND).get();
  if (snap.empty) return 0;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  let cleaned = 0;
  for (const docSnap of snap.docs) {
    const reminderType = normalize(docSnap.get('reminderType')) as ReminderType;
    if (!LEGACY_REMINDER_TYPES.includes(reminderType)) continue;
    const status = normalizeStatus(docSnap.get('status'));
    if (status === 'sent' || status === 'failed' || status === 'cancelled') continue;

    batch.set(
      docSnap.ref,
      {
        status: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        cancelReason: reason,
        lastError: reason,
        migratedToCanonical: true,
        claimedAt: admin.firestore.FieldValue.delete(),
        claimedBy: admin.firestore.FieldValue.delete(),
        claimExpiresAt: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
    cleaned += 1;
  }
  if (cleaned > 0) await batch.commit();
  return cleaned;
}

async function upsertReminderDocs(tenantId: string, assignmentId: string, assignment: Record<string, unknown>): Promise<void> {
  const workerId = normalize(assignment.userId || assignment.candidateId);
  if (!workerId) {
    logger.warn('[worker_shift_reminders] skip, missing workerId', { tenantId, assignmentId });
    return;
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenantData = tenantSnap.exists ? tenantSnap.data() as Record<string, unknown> : null;
  const start = resolveAssignmentStart(assignment);
  if (!start) {
    logger.warn('[worker_shift_reminders] skip, missing assignment start', { tenantId, assignmentId });
    await cancelNonTerminalReminders(tenantId, assignmentId, 'missing_assignment_start');
    return;
  }
  const end = resolveAssignmentEnd(assignment);
  const resolvedTimezone = resolveTimezone(assignment, tenantData);

  // Enrich with shift-level fields (clockInUrl, shiftDescription, emailIntro)
  // before building the payload so new cadence message types have what they
  // need. Fail-open: payload simply lacks the extras if the shift is missing.
  const shiftId = resolveShiftIdFromAssignment(assignment);
  const jobOrderId = normalize(assignment.jobOrderId);
  const shiftExtras = shiftId && jobOrderId
    ? await fetchShiftPayloadExtras({ tenantId, jobOrderId, shiftId })
    : undefined;

  const payload = buildPayload(assignment, start, end, resolvedTimezone, shiftExtras);
  const assignmentStatusSnapshot = normalizeStatus(assignment.status) || 'confirmed';
  const deepLink = `/c1/workers/assignments/${assignmentId}`;
  const nowMs = Date.now();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Resolve which profile applies (default two-step vs CORT extended cadence).
  const profile = await resolveShiftReminderProfile({ tenantId, assignment });

  const debugOverrideMinutes = await getDebugOverrideMinutes(tenantId);
  const scheduleMode = debugOverrideMinutes ? 'debug_short' : 'production_default';

  // Map debug override minutes positionally onto profile steps so QA can
  // compress long cadences (e.g. CORT's 4 steps) into minute-scale testing.
  const effectiveSteps: ShiftReminderStep[] = profile.steps.map((step, index) => {
    const overrideMinutes = debugOverrideMinutes?.[index];
    if (overrideMinutes != null && Number.isFinite(overrideMinutes) && overrideMinutes > 0) {
      return { type: step.type, offsetHours: overrideMinutes / 60 };
    }
    return step;
  });

  const writes: Promise<unknown>[] = [];

  // Cancel any non-terminal reminder doc whose type is NOT in the active
  // profile. Guards against duplicate sends when a tenant switches profile
  // from `default` to `cort_gig` (or vice versa) between reminder sync runs.
  const activeTypes = new Set<string>(effectiveSteps.map((s) => DOC_ID_BY_TYPE[s.type as ReminderType]));
  try {
    const existingRemindersSnap = await db
      .collection(`tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}`)
      .where('type', '==', REMINDER_KIND)
      .get();
    for (const docSnap of existingRemindersSnap.docs) {
      if (activeTypes.has(docSnap.id)) continue;
      const status = normalizeStatus(docSnap.get('status'));
      if (status === 'sent' || status === 'cancelled') continue;
      writes.push(
        docSnap.ref.set(
          {
            status: 'cancelled',
            cancelledAt: now,
            updatedAt: now,
            cancelReason: `profile_changed_to_${profile.id}`,
            lastError: `profile_changed_to_${profile.id}`,
            claimedAt: admin.firestore.FieldValue.delete(),
            claimedBy: admin.firestore.FieldValue.delete(),
            claimExpiresAt: admin.firestore.FieldValue.delete(),
            lock: admin.firestore.FieldValue.delete(),
          },
          { merge: true },
        ),
      );
    }
  } catch (err) {
    logger.warn('[worker_shift_reminders] profile_reconcile_failed', {
      tenantId,
      assignmentId,
      error: (err as Error)?.message || String(err),
    });
  }

  for (const step of effectiveSteps) {
    const reminderType = step.type as ReminderType;
    const offsetHours = step.offsetHours;
    const rawScheduledForMs = start.toMillis() - offsetHours * 60 * 60 * 1000;
    // Debug-override runs deliberately use minute-scale offsets that should
    // fire NOW for QA — never apply the 8 AM local floor in that mode.
    const floorResult =
      scheduleMode === 'production_default'
        ? applyEarlyMorningFloor(rawScheduledForMs, start.toMillis(), offsetHours, resolvedTimezone)
        : { scheduledForMs: rawScheduledForMs, deferred: false };
    const scheduledForMs = floorResult.scheduledForMs;
    const isPast = scheduledForMs <= nowMs;
    const status: ReminderStatus = isPast ? 'cancelled' : 'pending';
    const docRef = db.doc(
      `tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}/${DOC_ID_BY_TYPE[reminderType]}`,
    );

    const existingSnap = await docRef.get();
    const existingStatus = existingSnap.exists ? normalizeStatus(existingSnap.get('status')) : '';
    if (isTerminalReminderStatus(existingStatus)) {
      // Preserve terminal states so reminders never re-enter send flow after sent/failed/cancelled.
      // Keep metadata current for visibility/debuggability.
      writes.push(
        docRef.set(
          {
            workerId,
            tenantId,
            assignmentId,
            deepLink,
            payload,
            resolvedTimezone,
            assignmentStatusSnapshot,
            updatedAt: now,
          },
          { merge: true },
        ),
      );
      continue;
    }

    const data: Record<string, unknown> = {
      type: REMINDER_KIND,
      reminderType,
      workerId,
      tenantId,
      assignmentId,
      deepLink,
      scheduledFor: admin.firestore.Timestamp.fromMillis(scheduledForMs),
      status,
      channels: { inbox: true, push: true, sms: true },
      payload,
      resolvedTimezone,
      scheduleMode,
      scheduledOffsetMinutes: Math.round(offsetHours * 60),
      reminderProfile: profile.id,
      // Stamp early-morning-floor deferral (or delete the field when the
      // raw time was used) so we can spot in Firestore which reminders
      // had their natural T-N fire-time lifted forward into business hours.
      floorDeferred: floorResult.deferred,
      floorDeferredReason: floorResult.deferred
        ? floorResult.deferredReason
        : admin.firestore.FieldValue.delete(),
      rawScheduledForMs: floorResult.deferred
        ? rawScheduledForMs
        : admin.firestore.FieldValue.delete(),
      assignmentStatusSnapshot,
      createdAt: now,
      updatedAt: now,
      dedupeKey: `${assignmentId}_${reminderType}`,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      version: REMINDER_VERSION,
      lock: admin.firestore.FieldValue.delete(),
      lastError: isPast ? 'skipped_past_schedule' : admin.firestore.FieldValue.delete(),
      sentAt: admin.firestore.FieldValue.delete(),
      cancelledAt: isPast ? now : admin.firestore.FieldValue.delete(),
      cancelReason: isPast ? 'skipped_past_schedule' : admin.firestore.FieldValue.delete(),
      claimedAt: admin.firestore.FieldValue.delete(),
      claimedBy: admin.firestore.FieldValue.delete(),
      claimExpiresAt: admin.firestore.FieldValue.delete(),
      delivery: admin.firestore.FieldValue.delete(),
    };
    writes.push(docRef.set(data, { merge: true }));
  }

  writes.push(
    db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
      {
        scheduledNotificationSyncAt: now,
        scheduledNotificationVersion: REMINDER_VERSION,
      },
      { merge: true },
    ),
  );

  // Seed confirmation state for cort_gig profile. We only seed when absent or
  // still pending — never stomp on a prior `confirmed` / `cancelled` from the
  // worker's own reply. This lets the inbound reply handler (see
  // cadence/cadenceReplyHandler.ts) flip state and the dispatcher suppress
  // escalations accordingly.
  if (profile.id === 'cort_gig') {
    const cort = (assignment.cortConfirmation as Record<string, unknown> | undefined) || {};
    const currentState = normalizeStatus(cort.state);
    if (currentState !== 'confirmed' && currentState !== 'cancelled') {
      writes.push(
        db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
          {
            cortConfirmation: {
              state: 'pending',
              profileId: 'cort_gig',
              updatedAt: now,
            },
          },
          { merge: true },
        ),
      );
    }
  }

  await Promise.all(writes);
}

function toE164(value: unknown): string {
  const raw = normalize(value);
  return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : '';
}

async function getEnabledPushTokens(workerId: string): Promise<string[]> {
  const snap = await db.collection(`users/${workerId}/pushTokens`).where('enabled', '==', true).get();
  return snap.docs
    .map((d) => {
      const row = d.data() as Record<string, unknown>;
      return typeof row.token === 'string' ? row.token.trim() : '';
    })
    .filter(Boolean);
}

function buildReminderMessage(
  reminderType: ReminderType,
  payload: ReminderPayload,
  assignmentId: string,
  reminderProfile?: string,
) {
  const startLabel = formatStartInTimezone(payload.startTime, payload.timezone);
  const assignmentUrl = buildWorkerAssignmentUrl(assignmentId);
  const isCortProfile = reminderProfile === 'cort_gig';

  // Cadence-specific types (T-2h_instructions, T-15m_clockin, T+0_checkin) get
  // their bodies from the cadenceMessages module, which knows how to use the
  // shift-level extras (clockInUrl, shiftDescription).
  if (isCadenceReminderType(reminderType)) {
    const cadencePayload: CadenceMessagePayload = {
      jobTitle: payload.jobTitle,
      companyName: payload.companyName,
      locationName: payload.locationName,
      locationAddress: payload.locationAddress,
      startTime: payload.startTime,
      endTime: payload.endTime,
      timezone: payload.timezone,
      clockInUrl: payload.clockInUrl,
      shiftTitle: payload.shiftTitle,
      shiftDescription: payload.shiftDescription,
      emailIntro: payload.emailIntro,
      shiftId: payload.shiftId,
      jobOrderId: payload.jobOrderId,
    };
    return buildCadenceMessage(reminderType, cadencePayload);
  }

  // Escalation reminders — only scheduled under cort_gig profile. Progressive
  // tone: 23h is a friendly nudge, 22h is "last call" before we reassign.
  if (reminderType === 'assignment_reminder_23h_escalate') {
    return {
      title: 'Please confirm your shift',
      body: `Please confirm your ${payload.jobTitle} shift at ${startLabel}.`,
      sms: `C1 Staffing: We still need a response for your ${payload.jobTitle} shift at ${startLabel}. Reply YES to confirm or CANCEL to decline.`,
    };
  }
  if (reminderType === 'assignment_reminder_22h_final') {
    return {
      title: 'Last call — confirm your shift',
      body: `Last call: please confirm ${payload.jobTitle} at ${startLabel}.`,
      sms: `C1 Staffing: Last reminder for ${payload.jobTitle} at ${startLabel}. Reply YES to keep the shift or CANCEL — otherwise we may need to reassign it.`,
    };
  }

  if (reminderType === 'assignment_reminder_24h' || reminderType === 'shift_reminder_24h') {
    if (isCortProfile) {
      return {
        title: 'Confirm your shift tomorrow',
        body: `${payload.jobTitle} tomorrow at ${startLabel}. Reply YES to confirm.`,
        sms: `C1 Staffing: You're scheduled for ${payload.jobTitle} tomorrow at ${startLabel} at ${payload.locationName}. Reply YES to confirm or CANCEL to decline.`,
      };
    }
    return {
      title: 'Shift Reminder',
      body: `You’re confirmed for ${payload.jobTitle} tomorrow at ${startLabel}.`,
      sms: `C1 Staffing reminder: You’re confirmed for ${payload.jobTitle} tomorrow at ${startLabel} at ${payload.locationName}. View details: ${assignmentUrl}`,
    };
  }
  return {
    title: 'Your shift starts soon',
    body: `${payload.jobTitle} starts at ${startLabel} at ${payload.locationName}.`,
    sms: `C1 Staffing reminder: Your shift for ${payload.jobTitle} starts at ${startLabel} at ${payload.locationName}. View details: ${assignmentUrl}`,
  };
}

/**
 * Collapse every reminder type (including legacy + new cadence types) into a
 * canonical bucket we can use as messageTypeId on outbound SMS/push. Each new
 * cadence type keeps its own id so downstream observability can distinguish
 * 2h_instructions vs 15m_clockin vs 0h_checkin.
 */
function toCanonicalReminderType(
  reminderType: ReminderType,
):
  | 'assignment_reminder_24h'
  | 'assignment_reminder_2h'
  | 'assignment_reminder_2h_instructions'
  | 'assignment_reminder_15m_clockin'
  | 'assignment_checkin_0h'
  | 'assignment_noshow_check'
  | 'assignment_reminder_23h_escalate'
  | 'assignment_reminder_22h_final' {
  if (reminderType === 'assignment_reminder_24h' || reminderType === 'shift_reminder_24h') {
    return 'assignment_reminder_24h';
  }
  if (reminderType === 'assignment_reminder_2h_instructions') return 'assignment_reminder_2h_instructions';
  if (reminderType === 'assignment_reminder_15m_clockin') return 'assignment_reminder_15m_clockin';
  if (reminderType === 'assignment_checkin_0h') return 'assignment_checkin_0h';
  if (reminderType === 'assignment_noshow_check') return 'assignment_noshow_check';
  if (reminderType === 'assignment_reminder_23h_escalate') return 'assignment_reminder_23h_escalate';
  if (reminderType === 'assignment_reminder_22h_final') return 'assignment_reminder_22h_final';
  return 'assignment_reminder_2h';
}

async function dispatchOneReminder(docSnap: admin.firestore.QueryDocumentSnapshot): Promise<void> {
  const nowTs = admin.firestore.Timestamp.now();
  const lockExpiresAt = admin.firestore.Timestamp.fromMillis(nowTs.toMillis() + CLAIM_TTL_MS);

  const claimed = await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(docSnap.ref);
    if (!freshSnap.exists) return false;
    const fresh = freshSnap.data() as ReminderDoc;
    if (fresh.type !== REMINDER_KIND) return false;
    if (fresh.status !== 'pending') return false;
    const maxAttempts = Number(fresh.maxAttempts || MAX_ATTEMPTS);
    if ((fresh.attempts || 0) >= maxAttempts) return false;
    if (fresh.scheduledFor.toMillis() > Date.now()) return false;

    tx.update(docSnap.ref, {
      status: 'processing',
      attempts: admin.firestore.FieldValue.increment(1),
      claimedAt: nowTs,
      claimedBy: 'dispatchScheduledWorkerReminders',
      claimExpiresAt: lockExpiresAt,
      lock: {
        claimedAt: nowTs,
        claimedBy: 'dispatchScheduledWorkerReminders',
        expiresAt: lockExpiresAt,
      },
      updatedAt: nowTs,
    });
    return true;
  });
  if (!claimed) return;

  const claimedSnap = await docSnap.ref.get();
  if (!claimedSnap.exists) return;
  const reminder = claimedSnap.data() as ReminderDoc;
  const maxAttempts = Number(reminder.maxAttempts || MAX_ATTEMPTS);
  const canonicalReminderType = toCanonicalReminderType(reminder.reminderType);
  const reminderProfileId = normalize((reminder as unknown as Record<string, unknown>).reminderProfile);
  const message = buildReminderMessage(reminder.reminderType, reminder.payload, reminder.assignmentId, reminderProfileId);
  const delivery: NonNullable<ReminderDoc['delivery']> = {};
  let inboxSuccess = false;
  let pushSuccess = false;
  let smsSuccess = false;
  let pushAvailable = false;
  let smsAvailable = false;
  let lastError = '';

  // Re-check assignment state at send-time to prevent stale reminders.
  const assignmentSnap = await db.doc(`tenants/${reminder.tenantId}/assignments/${reminder.assignmentId}`).get();
  if (!assignmentSnap.exists) {
    logger.info('[worker_shift_reminders] reminder suppressed', {
      reason: 'assignment_missing',
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      reminderType: canonicalReminderType,
      scheduledTime: reminder.scheduledFor.toDate().toISOString(),
      actualSendTime: new Date().toISOString(),
    });
    await docSnap.ref.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelReason: 'assignment_missing',
      lastError: 'assignment_missing',
      lock: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  const assignmentData = assignmentSnap.data() as Record<string, unknown>;
  const assignmentStatus = normalizeStatus(assignmentData.status);
  const assignmentStart = resolveAssignmentStart(assignmentData);

  // Most reminders are pre-shift and must be suppressed once the shift has
  // started. The exceptions are:
  //   - T+0 check-in (scheduled AT start — "start is now" is the fire cond.)
  //   - T+30 no-show check (scheduled AFTER start by design — Phase 2B)
  // We still guard against wildly-stale reminders by requiring the scheduled
  // time to be within a bounded grace window from start.
  const CHECKIN_STALE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h for check-in
  const NOSHOW_STALE_WINDOW_MS = 6 * 60 * 60 * 1000;  // 6h for no-show alert
  const nowMs = Date.now();
  const isPostStartReminder =
    reminder.reminderType === 'assignment_checkin_0h' ||
    reminder.reminderType === 'assignment_noshow_check';
  const allowPostStart = isPostStartReminder;
  const staleWindow =
    reminder.reminderType === 'assignment_noshow_check'
      ? NOSHOW_STALE_WINDOW_MS
      : CHECKIN_STALE_WINDOW_MS;
  const startInPast = !!assignmentStart && assignmentStart.toMillis() <= nowMs;
  const checkinStale = allowPostStart
    && !!assignmentStart
    && (nowMs - assignmentStart.toMillis()) > staleWindow;
  const startPastBlocks = startInPast && (!allowPostStart || checkinStale);

  if (!isConfirmedStatus(assignmentStatus) || isCancelLikeStatus(assignmentStatus) || !assignmentStart || startPastBlocks) {
    const suppressReason = !assignmentStart
      ? 'missing_assignment_start'
      : startPastBlocks
        ? (checkinStale ? 'checkin_stale_past_grace_window' : 'assignment_start_in_past')
        : `assignment_status_${assignmentStatus || 'unknown'}`;
    logger.info('[worker_shift_reminders] reminder suppressed', {
      reason: suppressReason,
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      reminderType: canonicalReminderType,
      assignmentStatus,
      scheduledTime: reminder.scheduledFor.toDate().toISOString(),
      actualSendTime: new Date().toISOString(),
    });
    await docSnap.ref.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelReason: suppressReason,
      lastError: suppressReason,
      assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
      lock: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  // Phase 2A: suppress cadence reminders based on worker's reply state.
  //   - Escalations (23h / 22h) are pure nudges to get a YES/CANCEL. Once the
  //     worker has replied (either way), there is nothing left to nudge.
  //   - Post-confirmation operational reminders (2h_instructions / 15m /
  //     0h_checkin) still go out when confirmed (worker needs the address and
  //     clock-in URL), but are pointless — and harmful — once cancelled.
  //   - The T-24h reminder itself is the one that asks for the reply, so we
  //     never suppress it here.
  const cortState = normalizeStatus((assignmentData.cortConfirmation as Record<string, unknown> | undefined)?.state);
  const isEscalation =
    reminder.reminderType === 'assignment_reminder_23h_escalate' ||
    reminder.reminderType === 'assignment_reminder_22h_final';
  const isPostConfirmOperational =
    reminder.reminderType === 'assignment_reminder_2h_instructions' ||
    reminder.reminderType === 'assignment_reminder_15m_clockin' ||
    reminder.reminderType === 'assignment_checkin_0h';

  let cadenceSuppressReason = '';
  if (isEscalation && (cortState === 'confirmed' || cortState === 'cancelled')) {
    cadenceSuppressReason = `cadence_state_${cortState}_escalation_not_needed`;
  } else if (isPostConfirmOperational && cortState === 'cancelled') {
    cadenceSuppressReason = 'cadence_cancelled_by_worker';
  }
  if (cadenceSuppressReason) {
    logger.info('[worker_shift_reminders] reminder suppressed', {
      reason: cadenceSuppressReason,
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      reminderType: canonicalReminderType,
      cortState,
      scheduledTime: reminder.scheduledFor.toDate().toISOString(),
      actualSendTime: new Date().toISOString(),
    });
    await docSnap.ref.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelReason: cadenceSuppressReason,
      lastError: cadenceSuppressReason,
      assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
      lock: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  // Phase 2B: silent dispatch for assignment_noshow_check.
  //
  // This reminder type is NOT worker-facing. It fires 30 minutes after the
  // scheduled start as a "did they actually show up?" probe. There is no SMS,
  // no push, no inbox entry for the worker — we just inspect the cadence state
  // and decide whether to page the recruiter.
  //
  //   cortConfirmation.state:
  //     'checked_in' -> worker replied HERE (or an upstream flow stamped
  //                     checked_in); no action, dismiss.
  //     'cancelled'  -> cadence is already dead; dismiss (the cancel path
  //                     already notified recruiters).
  //     'confirmed'  -> worker said YES but never checked in. This is the
  //                     canonical no-show. Flip to 'no_show' and page.
  //     'pending'    -> worker never even confirmed. Still page the
  //                     recruiter — the job-order may need backfill. Flip to
  //                     'no_show' so downstream state stays consistent.
  //     anything else (missing / empty) -> treat as pending/confirmed for
  //                     safety; recruiter would rather get a false ping than
  //                     miss a real no-show.
  if (reminder.reminderType === 'assignment_noshow_check') {
    if (cortState === 'checked_in' || cortState === 'no_show') {
      // Already resolved (worker arrived, or recruiter was already alerted by
      // an earlier pass and the state stuck). Dismiss silently.
      await docSnap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
        delivery: {
          inbox: { attemptedAt: nowTs, success: true, error: 'noshow_check_dismissed' },
        },
        cancelReason: admin.firestore.FieldValue.delete(),
        lastError: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      });
      logger.info('[worker_shift_reminders] noshow_check dismissed', {
        assignmentId: reminder.assignmentId,
        userId: reminder.workerId,
        reminderType: canonicalReminderType,
        cortState,
        reason: `cadence_state_${cortState}`,
      });
      return;
    }
    if (cortState === 'cancelled') {
      await docSnap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
        delivery: {
          inbox: { attemptedAt: nowTs, success: true, error: 'noshow_check_dismissed_cancelled' },
        },
        cancelReason: admin.firestore.FieldValue.delete(),
        lastError: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      });
      logger.info('[worker_shift_reminders] noshow_check dismissed', {
        assignmentId: reminder.assignmentId,
        userId: reminder.workerId,
        reminderType: canonicalReminderType,
        cortState,
        reason: 'cadence_state_cancelled',
      });
      return;
    }

    // Fire the recruiter alert. We never SMS the worker for this type.
    const startLabel = formatStartInTimezone(reminder.payload.startTime, reminder.payload.timezone);
    const priorCortState = cortState || 'none';
    let notifyError = '';
    try {
      // Flip state to no_show and raise the recruiter-attention flag BEFORE
      // notifying, so the recruiter, clicking through the feed entry, sees
      // a consistent view.
      await db.doc(`tenants/${reminder.tenantId}/assignments/${reminder.assignmentId}`).set(
        {
          cortConfirmation: {
            state: 'no_show',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            noShowDetectedAt: admin.firestore.FieldValue.serverTimestamp(),
            priorState: priorCortState,
          },
          needsRecruiterAttention: true,
        },
        { merge: true },
      );

      await notifyRecruitersOnWorkerEvent({
        tenantId: reminder.tenantId,
        assignmentId: reminder.assignmentId,
        assignment: assignmentData,
        event: {
          kind: 'cadence_no_show',
          title: 'Possible no-show',
          snippet: `${reminder.payload.jobTitle || 'Worker'} has not checked in 30 minutes after start (${startLabel}).`,
          dedupeKey: `cadence_no_show__${reminder.assignmentId}`,
          extra: {
            reminderType: 'assignment_noshow_check',
            priorCortState,
            startTimeIso: reminder.payload.startTime.toDate().toISOString(),
            jobTitle: reminder.payload.jobTitle || null,
            locationName: reminder.payload.locationName || null,
            workerId: reminder.workerId,
          },
        },
      });
    } catch (err: any) {
      notifyError = err?.message || String(err);
      logger.error('[worker_shift_reminders] noshow_check_failed', {
        tenantId: reminder.tenantId,
        assignmentId: reminder.assignmentId,
        reminderType: canonicalReminderType,
        error: notifyError,
      });
    }

    await docSnap.ref.update({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
      delivery: {
        inbox: {
          attemptedAt: nowTs,
          success: !notifyError,
          error: notifyError || 'noshow_check_alerted_recruiters',
        },
      },
      cancelReason: admin.firestore.FieldValue.delete(),
      lastError: notifyError ? `noshow_check:${notifyError}` : admin.firestore.FieldValue.delete(),
      lock: admin.firestore.FieldValue.delete(),
    });
    logger.info('[worker_shift_reminders] noshow_check alerted recruiters', {
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      reminderType: canonicalReminderType,
      priorCortState,
      notifyError: notifyError || null,
    });
    return;
  }

  try {
    logger.info('[worker_shift_reminders] reminder send attempt', {
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      tenantId: reminder.tenantId,
      reminderType: canonicalReminderType,
      assignmentStatus,
      scheduledTime: reminder.scheduledFor.toDate().toISOString(),
      actualSendTime: new Date().toISOString(),
    });

    // Durable in-app record is always required.
    try {
      const inboxDedupeKey = `${canonicalReminderType}__${reminder.assignmentId}__inbox`;
      const inboxIsFirst = await markLifecycleEventIfFirst({
        tenantId: reminder.tenantId,
        dedupeKey: inboxDedupeKey,
        eventType: canonicalReminderType,
        context: {
          assignmentId: reminder.assignmentId,
          userId: reminder.workerId,
          channel: 'inbox',
        },
      });
      if (!inboxIsFirst) {
        inboxSuccess = true;
        delivery.inbox = { attemptedAt: nowTs, success: true, error: 'dedupe_skip_already_sent' };
        logger.info('[worker_shift_reminders] reminder suppressed due to dedupe', {
          assignmentId: reminder.assignmentId,
          userId: reminder.workerId,
          reminderType: canonicalReminderType,
          channel: 'inbox',
          dedupeKey: inboxDedupeKey,
        });
      } else {
        await writeWorkerInboxNotification({
          uid: reminder.workerId,
          tenantId: reminder.tenantId,
          title: message.title,
          body: message.body,
          type: 'assignment',
          category: 'assignments',
          deepLink: reminder.deepLink,
          entityId: reminder.assignmentId,
          source: 'automation',
          metadata: { reminderType: canonicalReminderType, reminderKind: reminder.type },
        });
        inboxSuccess = true;
        delivery.inbox = { attemptedAt: nowTs, success: true };
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      lastError = `inbox_failed:${msg}`;
      delivery.inbox = { attemptedAt: nowTs, success: false, error: msg };
    }

    const pushAllowed = await shouldSendNotification(reminder.workerId, 'shiftUpdates', 'push');
    if (reminder.channels.push && pushAllowed) {
      const tokens = await getEnabledPushTokens(reminder.workerId);
      pushAvailable = tokens.length > 0;
      if (pushAvailable) {
        try {
          const pushDedupeKey = `${canonicalReminderType}__${reminder.assignmentId}__push`;
          const pushIsFirst = await markLifecycleEventIfFirst({
            tenantId: reminder.tenantId,
            dedupeKey: pushDedupeKey,
            eventType: canonicalReminderType,
            context: {
              assignmentId: reminder.assignmentId,
              userId: reminder.workerId,
              channel: 'push',
            },
          });
          if (!pushIsFirst) {
            pushSuccess = true;
            delivery.push = {
              attemptedAt: nowTs,
              success: true,
              error: 'dedupe_skip_already_sent',
            };
            logger.info('[worker_shift_reminders] reminder suppressed due to dedupe', {
              assignmentId: reminder.assignmentId,
              userId: reminder.workerId,
              reminderType: canonicalReminderType,
              channel: 'push',
              dedupeKey: pushDedupeKey,
            });
          } else {
          const push = getPushProvider();
          const result = await push.sendPush({
            tenantId: reminder.tenantId,
            messageTypeId: canonicalReminderType,
            targets: [{ userId: reminder.workerId, deviceTokens: tokens }],
            title: message.title,
            body: message.body,
            data: {
              reminderType: canonicalReminderType,
              assignmentId: reminder.assignmentId,
              deepLink: reminder.deepLink,
            },
          });
          pushSuccess = result.sentCount > 0;
          delivery.push = {
            attemptedAt: nowTs,
            success: pushSuccess,
            error: pushSuccess ? undefined : result.errors?.[0]?.errorMessage || 'Push send failed',
          };
          if (!pushSuccess) {
            lastError = `push_failed:${result.errors?.[0]?.errorMessage || 'unknown'}`;
          }
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          lastError = `push_failed:${msg}`;
          delivery.push = { attemptedAt: nowTs, success: false, error: msg };
        }
      } else {
        delivery.push = { attemptedAt: nowTs, success: false, error: 'No enabled push token' };
      }
    } else {
      delivery.push = {
        attemptedAt: nowTs,
        success: false,
        error: reminder.channels.push ? 'Push disabled by settings' : 'Push disabled',
      };
    }

    if (reminder.channels.sms) {
      const smsAllowed = await shouldSendNotification(reminder.workerId, 'shiftUpdates', 'sms');
      const userSnap = await db.doc(`users/${reminder.workerId}`).get();
      const userData = userSnap.exists ? userSnap.data() : null;
      const phoneE164 = toE164(userData?.phoneE164 || userData?.phone);
      smsAvailable = Boolean(smsAllowed && phoneE164);

      if (smsAvailable) {
        try {
          const smsDedupeKey = `${canonicalReminderType}__${reminder.assignmentId}__sms`;
          const smsIsFirst = await markLifecycleEventIfFirst({
            tenantId: reminder.tenantId,
            dedupeKey: smsDedupeKey,
            eventType: canonicalReminderType,
            context: {
              assignmentId: reminder.assignmentId,
              userId: reminder.workerId,
              channel: 'sms',
            },
          });
          if (!smsIsFirst) {
            smsSuccess = true;
            delivery.sms = {
              attemptedAt: nowTs,
              success: true,
              error: 'dedupe_skip_already_sent',
            };
            logger.info('[worker_shift_reminders] reminder suppressed due to dedupe', {
              assignmentId: reminder.assignmentId,
              userId: reminder.workerId,
              reminderType: canonicalReminderType,
              channel: 'sms',
              dedupeKey: smsDedupeKey,
            });
          } else {
          const result = await sendWorkerMessageInternal(phoneE164, message.sms, {
            source: 'automation',
            sourceId: reminder.assignmentId,
            tenantId: reminder.tenantId,
            messageTypeId: canonicalReminderType,
            userId: reminder.workerId,
            systemContext: true,
          });
          smsSuccess = result.success;
          delivery.sms = {
            attemptedAt: nowTs,
            success: result.success,
            error: result.success ? undefined : result.error || 'SMS send failed',
          };
          if (!result.success) {
            lastError = `sms_failed:${result.error || 'unknown'}`;
          }
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          lastError = `sms_failed:${msg}`;
          delivery.sms = { attemptedAt: nowTs, success: false, error: msg };
        }
      } else {
        delivery.sms = {
          attemptedAt: nowTs,
          success: false,
          error: !smsAllowed ? 'SMS disabled by user settings' : 'Missing E.164 phone',
        };
      }
    }

    // Deterministic success/failure rule:
    // SENT when:
    //   A) durable inbox notification write succeeds, AND
    //   B) if any external channel is actually available (push and/or sms),
    //      at least one external channel succeeds.
    //
    // FAILED/PENDING retry when:
    //   - inbox write fails, OR
    //   - external channels are available but all external sends fail.
    //
    // Retry policy:
    //   - if attempts < maxAttempts => status returns to pending and scheduledFor
    //     is moved to now + RETRY_BACKOFF_MS (deterministic backoff window).
    //   - if attempts >= maxAttempts => status becomes failed.
    const externalAvailable = pushAvailable || smsAvailable;
    const externalSuccess = pushSuccess || smsSuccess;
    const success = inboxSuccess && (!externalAvailable || externalSuccess);

    if (success) {
      await docSnap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
        delivery,
        cancelReason: admin.firestore.FieldValue.delete(),
        lastError: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      });
      logger.info('[worker_shift_reminders] reminder send success', {
        assignmentId: reminder.assignmentId,
        userId: reminder.workerId,
        reminderType: canonicalReminderType,
        assignmentStatus,
      });
      return;
    }

    const attempts = Number(reminder.attempts || 0);
    const exceeded = attempts >= maxAttempts;
    await docSnap.ref.update({
      status: exceeded ? 'failed' : 'pending',
      scheduledFor: exceeded ? reminder.scheduledFor : admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_BACKOFF_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
      delivery,
      cancelReason: admin.firestore.FieldValue.delete(),
      lastError: lastError || 'success_rule_not_met',
      lock: admin.firestore.FieldValue.delete(),
    });
    logger.warn('[worker_shift_reminders] reminder send incomplete', {
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      reminderType: canonicalReminderType,
      assignmentStatus,
      willRetry: !exceeded,
      lastError: lastError || 'success_rule_not_met',
    });
  } catch (err: any) {
    const attempts = Number(reminder.attempts || 0);
    const exceeded = attempts >= maxAttempts;
    await docSnap.ref.update({
      status: exceeded ? 'failed' : 'pending',
      scheduledFor: exceeded ? reminder.scheduledFor : admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_BACKOFF_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      assignmentStatusSnapshot: assignmentStatus || reminder.assignmentStatusSnapshot,
      delivery,
      cancelReason: admin.firestore.FieldValue.delete(),
      lastError: err?.message || String(err),
      lock: admin.firestore.FieldValue.delete(),
    });
    logger.error('[worker_shift_reminders] reminder send failure', {
      assignmentId: reminder.assignmentId,
      userId: reminder.workerId,
      reminderType: canonicalReminderType,
      assignmentStatus,
      error: err?.message || String(err),
      willRetry: !exceeded,
    });
  }
}

export const onAssignmentConfirmedScheduleReminders = onDocumentWritten(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const { tenantId, assignmentId } = event.params;
    const before = event.data?.before.exists ? event.data.before.data() as Record<string, unknown> : null;
    const after = event.data?.after.exists ? event.data.after.data() as Record<string, unknown> : null;
    if (!after) return;

    // Retroactive admin adds (see `addRetroactiveWorker` callable) record
    // shifts that already happened. Scheduling SMS reminders for a past
    // shift is wrong and would either fire immediately or get cancelled
    // by `skipped_past_schedule`. Skip the whole pipeline.
    if (after.retroactive === true || after.notificationsSuppressed === true) {
      logger.info('[worker_shift_reminders] skipping retroactive/suppressed assignment', {
        tenantId,
        assignmentId,
      });
      return;
    }

    const beforeStatus = normalizeStatus(before?.status);
    const afterStatus = normalizeStatus(after.status);

    try {
      if (!isConfirmedStatus(afterStatus) || isCancelLikeStatus(afterStatus)) {
        await cancelNonTerminalReminders(tenantId, assignmentId, `assignment_status_${afterStatus || 'unknown'}`);
        return;
      }

      const transitionedToConfirmed = !isConfirmedStatus(beforeStatus) && isConfirmedStatus(afterStatus);
      const materiallyChanged = shouldResync(before, after);
      if (!transitionedToConfirmed && !materiallyChanged) return;

      if (materiallyChanged && before) {
        await cancelNonTerminalReminders(tenantId, assignmentId, 'assignment_material_change');
      }
      const cleanedLegacyCount = await cleanupLegacyReminderDocsForAssignment(tenantId, assignmentId);
      await upsertReminderDocs(tenantId, assignmentId, after);

      logger.info('[worker_shift_reminders] reminders synced', {
        tenantId,
        assignmentId,
        transitionedToConfirmed,
        materiallyChanged,
        cleanedLegacyCount,
      });
    } catch (err: any) {
      logger.error('[worker_shift_reminders] trigger failed', {
        tenantId,
        assignmentId,
        error: err?.message || String(err),
      });
    }
  },
);

export const dispatchScheduledWorkerReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const due = await db
      .collectionGroup(REMINDER_SUBCOLLECTION)
      .where('type', '==', REMINDER_KIND)
      .where('status', '==', 'pending')
      .where('scheduledFor', '<=', now)
      .limit(DISPATCH_BATCH_LIMIT)
      .get();

    let sent = 0;
    let failed = 0;
    let pending = 0;
    let skipped = 0;
    for (const docSnap of due.docs) {
      const before = docSnap.data() as ReminderDoc;
      await dispatchOneReminder(docSnap);
      const after = await docSnap.ref.get();
      const status = normalizeStatus(after.data()?.status);
      if (status === 'sent' && before.status !== 'sent') sent += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'pending') pending += 1;
      else skipped += 1;
    }

    logger.info('[worker_shift_reminders] dispatch complete', {
      scanned: due.size,
      sent,
      failed,
      pending,
      skipped,
    });
  },
);

export const cleanupLegacyWorkerShiftReminders = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Authentication required.');

  const authLevel = Number((auth.token as Record<string, unknown>)?.securityLevel ?? -1);
  if (!Number.isFinite(authLevel) || authLevel < 5) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const data = (request.data || {}) as Record<string, unknown>;
  const tenantFilter = normalize(data.tenantId);
  const assignmentFilter = normalize(data.assignmentId);
  const dryRun = data.dryRun === true;
  const maxAssignments = Math.max(1, Math.min(500, Number(data.maxAssignments || 100)));
  const assignmentKeySet = new Set<string>();

  for (const legacyType of LEGACY_REMINDER_TYPES) {
    const snap = await db
      .collectionGroup(REMINDER_SUBCOLLECTION)
      .where('type', '==', REMINDER_KIND)
      .where('reminderType', '==', legacyType)
      .where('status', 'in', ['pending', 'processing'])
      .limit(1000)
      .get();
    for (const docSnap of snap.docs) {
      const pathParts = docSnap.ref.path.split('/');
      const tenantIdx = pathParts.indexOf('tenants');
      const assignmentIdx = pathParts.indexOf('assignments');
      const tenantId = tenantIdx >= 0 ? pathParts[tenantIdx + 1] : '';
      const assignmentId = assignmentIdx >= 0 ? pathParts[assignmentIdx + 1] : '';
      if (!tenantId || !assignmentId) continue;
      if (tenantFilter && tenantFilter !== tenantId) continue;
      if (assignmentFilter && assignmentFilter !== assignmentId) continue;
      assignmentKeySet.add(`${tenantId}__${assignmentId}`);
      if (assignmentKeySet.size >= maxAssignments) break;
    }
    if (assignmentKeySet.size >= maxAssignments) break;
  }

  const assignmentKeys = Array.from(assignmentKeySet);
  let cleanedDocs = 0;
  let resyncedAssignments = 0;
  const errors: Array<{ tenantId: string; assignmentId: string; error: string }> = [];

  if (!dryRun) {
    for (const key of assignmentKeys) {
      const [tenantId, assignmentId] = key.split('__');
      try {
        cleanedDocs += await cleanupLegacyReminderDocsForAssignment(tenantId, assignmentId, 'legacy_cleanup_callable_migration');

        const assignmentSnap = await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get();
        if (!assignmentSnap.exists) continue;
        const assignment = assignmentSnap.data() as Record<string, unknown>;
        const status = normalizeStatus(assignment.status);
        if (isConfirmedStatus(status) && !isCancelLikeStatus(status)) {
          await upsertReminderDocs(tenantId, assignmentId, assignment);
          resyncedAssignments += 1;
        }
      } catch (err: any) {
        errors.push({
          tenantId,
          assignmentId,
          error: err?.message || String(err),
        });
      }
    }
  }

  logger.info('[worker_shift_reminders] legacy cleanup complete', {
    dryRun,
    tenantFilter: tenantFilter || null,
    assignmentFilter: assignmentFilter || null,
    assignmentCount: assignmentKeys.length,
    cleanedDocs,
    resyncedAssignments,
    errorCount: errors.length,
  });

  return {
    success: true,
    dryRun,
    assignmentCount: assignmentKeys.length,
    cleanedDocs,
    resyncedAssignments,
    errors,
  };
});

