import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import {
  sendAssignmentReminderNotification,
  writeWorkerInboxNotification,
} from './messaging/unifiedWorkerNotifications';
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
const REMINDER_VERSION = 1;
const CLAIM_TTL_MS = 5 * 60 * 1000;
const DISPATCH_BATCH_LIMIT = 200;

type ReminderType = 'shift_reminder_24h' | 'shift_reminder_4h';
type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

const HOURS_BY_TYPE: Record<ReminderType, number> = {
  shift_reminder_24h: 24,
  shift_reminder_4h: 4,
};

const DOC_ID_BY_TYPE: Record<ReminderType, string> = {
  shift_reminder_24h: '24h',
  shift_reminder_4h: '4h',
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
  type: ReminderType;
  workerId: string;
  tenantId: string;
  assignmentId: string;
  scheduledFor: admin.firestore.Timestamp;
  status: ReminderStatus;
  channels: { push: boolean; sms: boolean; inbox: boolean };
  payload: ReminderPayload;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  sentAt?: admin.firestore.Timestamp | admin.firestore.FieldValue;
  cancelledAt?: admin.firestore.Timestamp | admin.firestore.FieldValue;
  delivery?: {
    push?: { attemptedAt?: admin.firestore.Timestamp; success?: boolean; error?: string };
    sms?: { attemptedAt?: admin.firestore.Timestamp; success?: boolean; error?: string };
    inbox?: { attemptedAt?: admin.firestore.Timestamp; success?: boolean; error?: string };
  };
  dedupeKey: string;
  retryCount: number;
  lastError?: string;
  version: number;
  dispatchLock?: {
    claimId?: string;
    claimedAt?: admin.firestore.Timestamp;
    expiresAt?: admin.firestore.Timestamp;
  };
};

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function normalizeStatus(value: unknown): string {
  return normalize(value).toLowerCase();
}

function isConfirmedStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return s === 'confirmed' || s === 'active';
}

function isCancelledStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return ['cancelled', 'canceled', 'declined', 'withdrawn'].includes(s);
}

function toTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) return null;
  const candidate = value as {
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
  };
  if (typeof candidate.toDate === 'function') {
    const d = candidate.toDate();
    return Number.isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
  }
  if (typeof candidate.seconds === 'number') {
    try {
      return new admin.firestore.Timestamp(candidate.seconds, candidate.nanoseconds ?? 0);
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return admin.firestore.Timestamp.fromDate(asDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const d = new Date(`${value}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
    }
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : admin.firestore.Timestamp.fromDate(value);
  }
  return null;
}

function combineDateAndTimeToTimestamp(dateValue: unknown, timeValue: unknown): admin.firestore.Timestamp | null {
  const dateTs = toTimestamp(dateValue);
  if (!dateTs) return null;
  const base = dateTs.toDate();
  if (typeof timeValue !== 'string' || !timeValue.trim()) return dateTs;
  const m = timeValue.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return dateTs;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  const merged = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm, 0, 0));
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

function resolveTimezone(tenantData: Record<string, unknown> | null, assignment: Record<string, unknown>): string {
  const tz = normalize(
    assignment.timezone ||
      assignment.timeZone ||
      assignment.worksiteTimezone ||
      assignment.locationTimezone ||
      tenantData?.timezone ||
      tenantData?.timeZone
  );
  return tz || 'UTC';
}

function resolveLocationAddress(assignment: Record<string, unknown>): string {
  const rawAddress = assignment.worksiteAddress || assignment.locationAddress;
  if (typeof rawAddress === 'string') return rawAddress;
  if (rawAddress && typeof rawAddress === 'object') {
    const row = rawAddress as Record<string, unknown>;
    return [row.street, row.city, row.state, row.zipCode || row.zip]
      .map((x) => normalize(x))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function buildPayload(
  assignment: Record<string, unknown>,
  timezone: string,
  startTime: admin.firestore.Timestamp,
  endTime: admin.firestore.Timestamp | null,
): ReminderPayload {
  const payload: ReminderPayload = {
    jobTitle: normalize(assignment.jobTitle || assignment.jobOrderName || assignment.title) || 'Shift',
    companyName: normalize(assignment.companyName) || 'C1 Staffing',
    locationName: normalize(assignment.locationName || assignment.location || assignment.worksiteName) || 'Worksite',
    startTime,
    timezone,
  };
  const address = resolveLocationAddress(assignment);
  if (address) payload.locationAddress = address;
  if (endTime) payload.endTime = endTime;
  return payload;
}

function reminderDocRef(tenantId: string, assignmentId: string, type: ReminderType) {
  return db.doc(
    `tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}/${DOC_ID_BY_TYPE[type]}`,
  );
}

function formatStartInTimezone(start: admin.firestore.Timestamp, timezone?: string): string {
  const date = start.toDate();
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

async function cancelPendingReminders(
  tenantId: string,
  assignmentId: string,
  reason: string,
): Promise<void> {
  const remindersSnap = await db
    .collection(`tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}`)
    .where('status', '==', 'pending')
    .get();
  if (remindersSnap.empty) return;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  remindersSnap.docs.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
      lastError: reason,
      dispatchLock: admin.firestore.FieldValue.delete(),
    });
  });
  await batch.commit();
}

function shouldReschedule(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): boolean {
  if (!before) return true;
  const keysToCompare = [
    'status',
    'userId',
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
  return keysToCompare.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

async function upsertRemindersFromAssignment(
  tenantId: string,
  assignmentId: string,
  after: Record<string, unknown>,
): Promise<void> {
  const workerId = normalize(after.userId || after.candidateId);
  if (!workerId) {
    logger.info('[shift_reminders] skip scheduling: missing workerId', { tenantId, assignmentId });
    return;
  }

  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenantData = tenantSnap.exists ? (tenantSnap.data() as Record<string, unknown>) : null;
  const startTs = resolveAssignmentStart(after);
  if (!startTs) {
    logger.warn('[shift_reminders] skip scheduling: missing start datetime', { tenantId, assignmentId });
    await cancelPendingReminders(tenantId, assignmentId, 'missing_start_time');
    return;
  }
  const endTs = resolveAssignmentEnd(after);
  const timezone = resolveTimezone(tenantData, after);
  const payload = buildPayload(after, timezone, startTs, endTs);

  const nowMs = Date.now();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const writes: Promise<unknown>[] = [];

  (Object.keys(HOURS_BY_TYPE) as ReminderType[]).forEach((type) => {
    const offsetMs = HOURS_BY_TYPE[type] * 60 * 60 * 1000;
    const scheduledAtMs = startTs.toMillis() - offsetMs;
    const ref = reminderDocRef(tenantId, assignmentId, type);
    if (scheduledAtMs <= nowMs) {
      writes.push(
        ref.set(
          {
            type,
            workerId,
            tenantId,
            assignmentId,
            scheduledFor: admin.firestore.Timestamp.fromMillis(scheduledAtMs),
            status: 'cancelled',
            channels: { push: true, sms: true, inbox: true },
            payload,
            createdAt: now,
            updatedAt: now,
            cancelledAt: now,
            dedupeKey: `${assignmentId}_${type}`,
            retryCount: 0,
            version: REMINDER_VERSION,
            lastError: 'skipped_past_schedule',
          },
          { merge: true },
        ),
      );
      return;
    }

    writes.push(
      ref.set(
        {
          type,
          workerId,
          tenantId,
          assignmentId,
          scheduledFor: admin.firestore.Timestamp.fromMillis(scheduledAtMs),
          status: 'pending',
          channels: { push: true, sms: true, inbox: true },
          payload,
          createdAt: now,
          updatedAt: now,
          sentAt: admin.firestore.FieldValue.delete(),
          cancelledAt: admin.firestore.FieldValue.delete(),
          dedupeKey: `${assignmentId}_${type}`,
          retryCount: 0,
          version: REMINDER_VERSION,
          lastError: admin.firestore.FieldValue.delete(),
          dispatchLock: admin.firestore.FieldValue.delete(),
        },
        { merge: true },
      ),
    );
  });

  writes.push(
    assignmentRef.set(
      {
        scheduledNotificationSyncAt: now,
        scheduledNotificationVersion: REMINDER_VERSION,
      },
      { merge: true },
    ),
  );

  await Promise.all(writes);
}

export const syncAssignmentScheduledNotifications = onDocumentWritten(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const { tenantId, assignmentId } = event.params;
    const before = event.data?.before.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after.exists ? (event.data.after.data() as Record<string, unknown>) : null;

    if (!after) return;

    const afterStatus = normalizeStatus(after.status);
    const beforeStatus = normalizeStatus(before?.status);

    try {
      if (isCancelledStatus(afterStatus) || !isConfirmedStatus(afterStatus)) {
        await cancelPendingReminders(tenantId, assignmentId, `assignment_status_${afterStatus || 'unknown'}`);
        return;
      }

      if (!isConfirmedStatus(afterStatus)) return;

      const becameConfirmed = !isConfirmedStatus(beforeStatus) && isConfirmedStatus(afterStatus);
      const needsResync = becameConfirmed || shouldReschedule(before, after);
      if (!needsResync) return;

      await upsertRemindersFromAssignment(tenantId, assignmentId, after);
      logger.info('[shift_reminders] reminders synced', { tenantId, assignmentId, afterStatus, becameConfirmed });
    } catch (err: any) {
      logger.error('[shift_reminders] sync failed', {
        tenantId,
        assignmentId,
        error: err?.message || String(err),
      });
    }
  },
);

function buildReminderMessage(
  type: ReminderType,
  payload: ReminderPayload,
  assignmentId: string,
): { title: string; body: string; sms: string } {
  const startLabel = formatStartInTimezone(payload.startTime, payload.timezone);
  const assignmentUrl = `https://hrxone.com/c1/workers/assignments/${assignmentId}`;
  if (type === 'shift_reminder_24h') {
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

async function hasEnabledPushToken(workerId: string): Promise<boolean> {
  const tokens = await db
    .collection(`users/${workerId}/pushTokens`)
    .where('enabled', '==', true)
    .limit(1)
    .get();
  return !tokens.empty;
}

function toE164(value: unknown): string {
  const raw = normalize(value);
  return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : '';
}

async function dispatchOneReminder(docSnap: admin.firestore.QueryDocumentSnapshot): Promise<void> {
  const reminder = docSnap.data() as ReminderDoc;
  const nowTs = admin.firestore.Timestamp.now();
  const claimId = db.collection('_').doc().id;
  const lockUntil = admin.firestore.Timestamp.fromMillis(nowTs.toMillis() + CLAIM_TTL_MS);

  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(docSnap.ref);
    if (!fresh.exists) return false;
    const data = fresh.data() as ReminderDoc;
    if (data.status !== 'pending') return false;
    if (data.scheduledFor.toMillis() > Date.now()) return false;
    const lock = data.dispatchLock;
    if (lock?.expiresAt && lock.expiresAt.toMillis() > Date.now()) return false;
    tx.update(docSnap.ref, {
      dispatchLock: {
        claimId,
        claimedAt: nowTs,
        expiresAt: lockUntil,
      },
      updatedAt: nowTs,
    });
    return true;
  });
  if (!claimed) return;

  const workerId = reminder.workerId;
  const assignmentId = reminder.assignmentId;
  const deepLink = `/c1/workers/assignments/${assignmentId}`;
  const message = buildReminderMessage(reminder.type, reminder.payload, assignmentId);

  const delivery: NonNullable<ReminderDoc['delivery']> = {};
  let inboxOk = false;
  let pushOk = false;
  let smsOk = false;
  let pushRequired = false;
  let smsRequired = false;
  let lastError = '';

  try {
    pushRequired = Boolean(reminder.channels?.push && (await hasEnabledPushToken(workerId)));

    if (pushRequired) {
      try {
        await sendAssignmentReminderNotification({
          uid: workerId,
          tenantId: reminder.tenantId,
          assignmentId,
          title: message.title,
          body: message.body,
        });
        inboxOk = true;
        pushOk = true;
        delivery.inbox = { attemptedAt: nowTs, success: true };
        delivery.push = { attemptedAt: nowTs, success: true };
      } catch (err: any) {
        lastError = `push_failed:${err?.message || String(err)}`;
        delivery.push = { attemptedAt: nowTs, success: false, error: err?.message || String(err) };
        try {
          await writeWorkerInboxNotification({
            uid: workerId,
            tenantId: reminder.tenantId,
            title: message.title,
            body: message.body,
            type: 'assignment',
            category: 'assignments',
            deepLink,
            entityId: assignmentId,
            source: 'automation',
          });
          inboxOk = true;
          delivery.inbox = { attemptedAt: nowTs, success: true };
        } catch (inboxErr: any) {
          lastError = `inbox_failed:${inboxErr?.message || String(inboxErr)}`;
          delivery.inbox = { attemptedAt: nowTs, success: false, error: inboxErr?.message || String(inboxErr) };
        }
      }
    } else {
      try {
        await writeWorkerInboxNotification({
          uid: workerId,
          tenantId: reminder.tenantId,
          title: message.title,
          body: message.body,
          type: 'assignment',
          category: 'assignments',
          deepLink,
          entityId: assignmentId,
          source: 'automation',
        });
        inboxOk = true;
        delivery.inbox = { attemptedAt: nowTs, success: true };
      } catch (err: any) {
        lastError = `inbox_failed:${err?.message || String(err)}`;
        delivery.inbox = { attemptedAt: nowTs, success: false, error: err?.message || String(err) };
      }
      delivery.push = { attemptedAt: nowTs, success: false, error: 'No enabled push token' };
    }

    smsRequired = Boolean(reminder.channels?.sms);
    if (smsRequired) {
      try {
        const smsAllowed = await shouldSendNotification(workerId, 'shiftUpdates', 'sms');
        const userSnap = await db.doc(`users/${workerId}`).get();
        const userData = userSnap.exists ? userSnap.data() : null;
        const phoneE164 = toE164(userData?.phoneE164);
        if (!smsAllowed || !phoneE164) {
          smsRequired = false;
          delivery.sms = {
            attemptedAt: nowTs,
            success: false,
            error: !smsAllowed ? 'SMS disabled by user settings' : 'Missing E.164 phone',
          };
        } else {
          const smsResult = await sendWorkerMessageInternal(phoneE164, message.sms, {
            source: 'automation',
            sourceId: assignmentId,
            tenantId: reminder.tenantId,
            messageTypeId: 'assignment_shift_reminder',
            userId: workerId,
            systemContext: true,
          });
          smsOk = smsResult.success;
          delivery.sms = {
            attemptedAt: nowTs,
            success: smsResult.success,
            error: smsResult.success ? undefined : smsResult.error || 'SMS send failed',
          };
          if (!smsResult.success) {
            lastError = `sms_failed:${smsResult.error || 'unknown'}`;
          }
        }
      } catch (err: any) {
        lastError = `sms_failed:${err?.message || String(err)}`;
        delivery.sms = { attemptedAt: nowTs, success: false, error: err?.message || String(err) };
      }
    }

    const requiredChecks = [
      { required: true, ok: inboxOk, name: 'inbox' },
      { required: pushRequired, ok: pushOk, name: 'push' },
      { required: smsRequired, ok: smsOk, name: 'sms' },
    ];
    const failedRequired = requiredChecks.find((c) => c.required && !c.ok);

    if (failedRequired) {
      await docSnap.ref.update({
        status: 'failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        delivery,
        retryCount: admin.firestore.FieldValue.increment(1),
        lastError: lastError || `required_channel_failed:${failedRequired.name}`,
        dispatchLock: admin.firestore.FieldValue.delete(),
      });
      return;
    }

    await docSnap.ref.update({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      delivery,
      lastError: admin.firestore.FieldValue.delete(),
      dispatchLock: admin.firestore.FieldValue.delete(),
    });
  } catch (err: any) {
    await docSnap.ref.update({
      status: 'failed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      retryCount: admin.firestore.FieldValue.increment(1),
      lastError: err?.message || String(err),
      dispatchLock: admin.firestore.FieldValue.delete(),
    });
  }
}

export const dispatchScheduledAssignmentNotifications = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const due = await db
      .collectionGroup(REMINDER_SUBCOLLECTION)
      .where('status', '==', 'pending')
      .where('scheduledFor', '<=', now)
      .limit(DISPATCH_BATCH_LIMIT)
      .get();

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const docSnap of due.docs) {
      const before = docSnap.data() as ReminderDoc;
      await dispatchOneReminder(docSnap);
      const afterSnap = await docSnap.ref.get();
      const status = normalizeStatus(afterSnap.data()?.status);
      if (status === 'sent' && before.status !== 'sent') sent += 1;
      else if (status === 'failed') failed += 1;
      else skipped += 1;
    }

    logger.info('[shift_reminders] dispatch run complete', {
      scanned: due.size,
      sent,
      failed,
      skipped,
    });
  },
);
