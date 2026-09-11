/**
 * In-app shift-confirmation writes (worker app Home card, 2026-08-30).
 *
 * Mirrors the SMS reply path in `cadenceReplyHandler.ts` EXACTLY —
 * `cortConfirmation` field shapes, escalation/reminder cancellation, and the
 * recruiter alert on cancel — with `channel: 'app'` provenance instead of
 * 'sms'. Deliberately a separate module (not a refactor of the reply
 * handler) so shipping it does not force a redeploy of the SMS webhook
 * bundle mid-pilot; if the two ever drift, the reply handler is canonical.
 *
 * Daily-confirm crews (2026-09-11) pass `workDate`: the write lands on that
 * workday's entry (`cortConfirmationDays`) and only that day's reminders are
 * cancelled — see cadence/dailyConfirm.ts.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  ALL_SHIFT_REMINDER_TYPES,
  type ShiftReminderType,
} from './shiftReminderProfile';
import { notifyRecruitersOnWorkerEvent } from '../messaging/notifyRecruitersOnWorkerEvent';
import { applyDailyDayPatch, cancelDailyRemindersForDay } from './dailyConfirmWrites';
import { dayEntriesOf } from './dailyConfirm';
import { enqueueRecruiterEscalation } from '../natalie/natalieAudit';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REMINDER_SUBCOLLECTION = 'scheduled_notifications';
const REMINDER_KIND = 'worker_shift_reminder';

const ESCALATION_REMINDER_TYPES: ReadonlyArray<ShiftReminderType> = [
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
];

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function cancelRemindersByType(args: {
  tenantId: string;
  assignmentId: string;
  reminderTypes: ReadonlyArray<ShiftReminderType>;
  reason: string;
}): Promise<number> {
  const { tenantId, assignmentId, reminderTypes, reason } = args;
  if (reminderTypes.length === 0) return 0;
  const subRef = db.collection(
    `tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}`,
  );
  const snap = await subRef.where('type', '==', REMINDER_KIND).get();
  if (snap.empty) return 0;

  const targets = new Set<string>(reminderTypes);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  let cancelled = 0;
  for (const docSnap of snap.docs) {
    const reminderType = normalize(docSnap.get('reminderType'));
    if (!targets.has(reminderType as ShiftReminderType)) continue;
    const status = normalize(docSnap.get('status')).toLowerCase();
    if (status === 'sent' || status === 'failed' || status === 'cancelled') continue;
    batch.set(
      docSnap.ref,
      {
        status: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        cancelReason: reason,
        lastError: reason,
        claimedAt: admin.firestore.FieldValue.delete(),
        claimedBy: admin.firestore.FieldValue.delete(),
        claimExpiresAt: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
    cancelled += 1;
  }
  if (cancelled > 0) await batch.commit();
  return cancelled;
}

/** In-app YES — same effect as the SMS confirm. */
export async function applyAppShiftConfirmation(args: {
  tenantId: string;
  assignmentId: string;
  uid: string;
  assignment?: Record<string, unknown>;
  workDate?: string;
}): Promise<void> {
  const { tenantId, assignmentId, uid, workDate } = args;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const confirmedVia = { channel: 'app', byUid: uid };

  if (workDate) {
    await applyDailyDayPatch({
      tenantId,
      assignmentId,
      workDate,
      patch: { state: 'confirmed', confirmedAt: now, confirmedVia },
    });
    const cancelled = await cancelDailyRemindersForDay({
      tenantId,
      assignmentId,
      workDate,
      reminderTypes: ESCALATION_REMINDER_TYPES,
      reason: 'cadence_confirmed_by_worker_app',
    });
    logger.info('[cadence_app] daily confirmation applied', { tenantId, assignmentId, workDate, uid, cancelledEscalations: cancelled });
    return;
  }

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      cortConfirmation: {
        state: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
        confirmedVia,
      },
    },
    { merge: true },
  );

  const cancelled = await cancelRemindersByType({
    tenantId,
    assignmentId,
    reminderTypes: ESCALATION_REMINDER_TYPES,
    reason: 'cadence_confirmed_by_worker_app',
  });

  logger.info('[cadence_app] confirmation applied', {
    tenantId,
    assignmentId,
    uid,
    cancelledEscalations: cancelled,
  });
}

/** In-app CANCEL — same effect as the SMS cancel, including recruiter alert. */
export async function applyAppShiftCancellation(args: {
  tenantId: string;
  assignmentId: string;
  uid: string;
  assignment: Record<string, unknown>;
  workDate?: string;
}): Promise<void> {
  const { tenantId, assignmentId, uid, assignment, workDate } = args;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const cancelledVia = { channel: 'app', byUid: uid };

  let cancelled = 0;
  if (workDate) {
    await applyDailyDayPatch({
      tenantId,
      assignmentId,
      workDate,
      patch: { state: 'cancelled', cancelledAt: now, cancelledVia },
      options: { assignmentFields: { needsRecruiterAttention: true } },
    });
    cancelled = await cancelDailyRemindersForDay({
      tenantId,
      assignmentId,
      workDate,
      reminderTypes: ALL_SHIFT_REMINDER_TYPES,
      reason: 'cadence_cancelled_by_worker_app',
    });
  } else {
    await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
      {
        cortConfirmation: {
          state: 'cancelled',
          cancelledAt: now,
          updatedAt: now,
          cancelledVia,
        },
        needsRecruiterAttention: true,
      },
      { merge: true },
    );

    cancelled = await cancelRemindersByType({
      tenantId,
      assignmentId,
      reminderTypes: ALL_SHIFT_REMINDER_TYPES,
      reason: 'cadence_cancelled_by_worker_app',
    });
  }

  const jobTitle =
    normalize(assignment.jobTitle) ||
    normalize(assignment.jobOrderName) ||
    normalize(assignment.title) ||
    'Shift';
  await notifyRecruitersOnWorkerEvent({
    tenantId,
    assignmentId,
    assignment,
    event: {
      kind: 'cadence_worker_cancelled',
      title: workDate ? `Worker cancelled ${jobTitle} (${workDate})` : `Worker cancelled ${jobTitle}`,
      snippet: 'Cancelled from the worker app shift-confirmation card.',
      dedupeKey: workDate
        ? `cadence_worker_cancelled__${assignmentId}__${workDate}`
        : `cadence_worker_cancelled__${assignmentId}`,
      extra: { channel: 'app', byUid: uid, workDate: workDate ?? null },
    },
  });
  if (workDate) {
    // Standing crews: Natalie DMs the recruiter for that day, same as an SMS NO.
    await enqueueRecruiterEscalation({
      tenantId,
      assignmentId,
      assignment,
      kind: 'cancelled',
      workDate,
      startAt: dayEntriesOf(assignment)[workDate]?.startAt,
      detail: 'They tapped "Can\'t make it" in the worker app.',
    });
  }

  logger.info('[cadence_app] cancellation applied', {
    tenantId,
    assignmentId,
    uid,
    workDate: workDate ?? null,
    cancelledReminders: cancelled,
  });
}

/**
 * In-app "Running late" (worker app day-of hero card, 2026-09-03): purely
 * informational — never touches assignment status or cortConfirmation, so a
 * late worker who already confirmed stays confirmed. Re-reports with a new
 * ETA overwrite the field and (via the eta-suffixed dedupe key) re-alert
 * the recruiter feed; identical double-taps dedupe away.
 */
export async function applyAppRunningLate(args: {
  tenantId: string;
  assignmentId: string;
  uid: string;
  assignment: Record<string, unknown>;
  etaMinutes: number | null;
}): Promise<void> {
  const { tenantId, assignmentId, uid, assignment, etaMinutes } = args;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      runningLate: {
        state: 'reported',
        etaMinutes: etaMinutes ?? null,
        reportedAt: now,
        updatedAt: now,
        reportedVia: {
          channel: 'app',
          byUid: uid,
        },
      },
      needsRecruiterAttention: true,
    },
    { merge: true },
  );

  const jobTitle =
    normalize(assignment.jobTitle) ||
    normalize(assignment.jobOrderName) ||
    normalize(assignment.title) ||
    'Shift';
  const etaText = etaMinutes ? `~${etaMinutes} min late` : 'running late';
  await notifyRecruitersOnWorkerEvent({
    tenantId,
    assignmentId,
    assignment,
    event: {
      kind: 'worker_running_late',
      title: `Running late — ${jobTitle}`,
      snippet: `Worker reports ${etaText} (worker app day-of card).`,
      dedupeKey: `worker_running_late__${assignmentId}__${etaMinutes ?? 'na'}`,
      extra: { channel: 'app', byUid: uid, etaMinutes: etaMinutes ?? null },
    },
  });

  logger.info('[cadence_app] running_late applied', {
    tenantId,
    assignmentId,
    uid,
    etaMinutes,
  });
}
