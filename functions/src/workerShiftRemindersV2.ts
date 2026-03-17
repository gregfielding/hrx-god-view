import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { writeWorkerInboxNotification } from './messaging/unifiedWorkerNotifications';
import { getPushProvider } from './messaging/pushProviderFactory';
import { sendWorkerMessageInternal } from './twilio';
import { shouldSendNotification } from './utils/notificationSettings';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REMINDER_SUBCOLLECTION = 'scheduled_notifications';
const REMINDER_KIND = 'worker_shift_reminder';
const REMINDER_VERSION = 1;
const MAX_ATTEMPTS = 3;
const CLAIM_TTL_MS = 5 * 60 * 1000;
// Deterministic retry delay for non-terminal retry path.
const RETRY_BACKOFF_MS = 2 * 60 * 1000;
const DISPATCH_BATCH_LIMIT = 200;

type ReminderType = 'shift_reminder_24h' | 'shift_reminder_4h';
type ReminderStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

function isTerminalReminderStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return s === 'sent' || s === 'failed' || s === 'cancelled';
}

const HOURS_BY_TYPE: Record<ReminderType, number> = {
  shift_reminder_24h: 24,
  shift_reminder_4h: 4,
};

const DOC_ID_BY_TYPE: Record<ReminderType, string> = {
  shift_reminder_24h: 'shift_reminder_24h',
  shift_reminder_4h: 'shift_reminder_4h',
};

type ReminderPayload = {
  jobTitle: string;
  companyName: string;
  locationName: string;
  locationAddress?: string;
  startTime: admin.firestore.Timestamp;
  endTime?: admin.firestore.Timestamp;
  timezone?: string;
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
  return ['cancelled', 'canceled', 'declined', 'withdrawn', 'reassigned'].includes(s);
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
      lastError: reason,
      lock: admin.firestore.FieldValue.delete(),
    }, { merge: true });
  }
  await batch.commit();
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
  const payload = buildPayload(assignment, start, end, resolvedTimezone);
  const assignmentStatusSnapshot = normalizeStatus(assignment.status) || 'confirmed';
  const deepLink = `/c1/workers/assignments/${assignmentId}`;
  const nowMs = Date.now();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const writes: Promise<unknown>[] = [];
  for (const reminderType of Object.keys(HOURS_BY_TYPE) as ReminderType[]) {
    const scheduledForMs = start.toMillis() - HOURS_BY_TYPE[reminderType] * 60 * 60 * 1000;
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

function buildReminderMessage(reminderType: ReminderType, payload: ReminderPayload, assignmentId: string) {
  const startLabel = formatStartInTimezone(payload.startTime, payload.timezone);
  const assignmentUrl = `https://hrxone.com/c1/workers/assignments/${assignmentId}`;
  if (reminderType === 'shift_reminder_24h') {
    return {
      title: 'Shift Reminder: Tomorrow',
      body: `You are scheduled for ${payload.jobTitle} at ${payload.companyName} tomorrow at ${startLabel}. Tap to review assignment details.`,
      sms: `Reminder: You are scheduled for ${payload.jobTitle} at ${payload.companyName} tomorrow at ${startLabel}. View details: ${assignmentUrl}`,
    };
  }
  return {
    title: 'Shift Starts Soon',
    body: `Your shift for ${payload.jobTitle} at ${payload.companyName} starts in 4 hours. Please review directions and arrival instructions.`,
    sms: `Reminder: Your shift for ${payload.jobTitle} at ${payload.companyName} starts in 4 hours. Review details: ${assignmentUrl}`,
  };
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
  const message = buildReminderMessage(reminder.reminderType, reminder.payload, reminder.assignmentId);
  const delivery: NonNullable<ReminderDoc['delivery']> = {};
  let inboxSuccess = false;
  let pushSuccess = false;
  let smsSuccess = false;
  let pushAvailable = false;
  let smsAvailable = false;
  let lastError = '';

  try {
    // Durable in-app record is always required.
    try {
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
        metadata: { reminderType: reminder.reminderType, reminderKind: reminder.type },
      });
      inboxSuccess = true;
      delivery.inbox = { attemptedAt: nowTs, success: true };
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
          const push = getPushProvider();
          const result = await push.sendPush({
            tenantId: reminder.tenantId,
            messageTypeId: 'worker_shift_reminder',
            targets: [{ userId: reminder.workerId, deviceTokens: tokens }],
            title: message.title,
            body: message.body,
            data: {
              reminderType: reminder.reminderType,
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
          const result = await sendWorkerMessageInternal(phoneE164, message.sms, {
            source: 'automation',
            sourceId: reminder.assignmentId,
            tenantId: reminder.tenantId,
            messageTypeId: 'assignment_shift_reminder',
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
        delivery,
        lastError: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      });
      return;
    }

    const attempts = Number(reminder.attempts || 0);
    const exceeded = attempts >= maxAttempts;
    await docSnap.ref.update({
      status: exceeded ? 'failed' : 'pending',
      scheduledFor: exceeded ? reminder.scheduledFor : admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_BACKOFF_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      delivery,
      lastError: lastError || 'success_rule_not_met',
      lock: admin.firestore.FieldValue.delete(),
    });
  } catch (err: any) {
    const attempts = Number(reminder.attempts || 0);
    const exceeded = attempts >= maxAttempts;
    await docSnap.ref.update({
      status: exceeded ? 'failed' : 'pending',
      scheduledFor: exceeded ? reminder.scheduledFor : admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_BACKOFF_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      delivery,
      lastError: err?.message || String(err),
      lock: admin.firestore.FieldValue.delete(),
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
      await upsertReminderDocs(tenantId, assignmentId, after);

      logger.info('[worker_shift_reminders] reminders synced', {
        tenantId,
        assignmentId,
        transitionedToConfirmed,
        materiallyChanged,
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

