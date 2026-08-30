/**
 * In-app shift-confirmation writes (worker app Home card, 2026-08-30).
 *
 * Mirrors the SMS reply path in `cadenceReplyHandler.ts` EXACTLY —
 * `cortConfirmation` field shapes, escalation/reminder cancellation, and the
 * recruiter alert on cancel — with `channel: 'app'` provenance instead of
 * 'sms'. Deliberately a separate module (not a refactor of the reply
 * handler) so shipping it does not force a redeploy of the SMS webhook
 * bundle mid-pilot; if the two ever drift, the reply handler is canonical.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  ALL_SHIFT_REMINDER_TYPES,
  type ShiftReminderType,
} from './shiftReminderProfile';
import { notifyRecruitersOnWorkerEvent } from '../messaging/notifyRecruitersOnWorkerEvent';

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
}): Promise<void> {
  const { tenantId, assignmentId, uid } = args;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      cortConfirmation: {
        state: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
        confirmedVia: {
          channel: 'app',
          byUid: uid,
        },
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
}): Promise<void> {
  const { tenantId, assignmentId, uid, assignment } = args;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      cortConfirmation: {
        state: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        cancelledVia: {
          channel: 'app',
          byUid: uid,
        },
      },
      needsRecruiterAttention: true,
    },
    { merge: true },
  );

  const cancelled = await cancelRemindersByType({
    tenantId,
    assignmentId,
    reminderTypes: ALL_SHIFT_REMINDER_TYPES,
    reason: 'cadence_cancelled_by_worker_app',
  });

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
      title: `Worker cancelled ${jobTitle}`,
      snippet: 'Cancelled from the worker app shift-confirmation card.',
      dedupeKey: `cadence_worker_cancelled__${assignmentId}`,
      extra: { channel: 'app', byUid: uid },
    },
  });

  logger.info('[cadence_app] cancellation applied', {
    tenantId,
    assignmentId,
    uid,
    cancelledReminders: cancelled,
  });
}
