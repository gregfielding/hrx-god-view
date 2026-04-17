/**
 * Delayed AI pre-screen outreach: queue fields on application when status becomes `submitted`.
 * Processor: `processWorkerAiPrescreenReminders`.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import { resolveHiringInterviewPolicyForApplication } from './aiHiringPolicyResolution';

const db = admin.firestore();
/** Time after `submitted` before first AI pre-screen SMS (interview invite or profile nudge). */
const REMINDER_DELAY_MS = 15 * 60 * 1000;

function isSubmittedStatus(status: unknown): boolean {
  return normalizeApplicationStatus(String(status ?? '')) === 'submitted';
}

async function tenantOutreachEnabled(tenantId: string): Promise<boolean> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    const v = snap.data()?.workerAiPrescreenOutreachEnabled;
    if (v === false) return false;
  } catch (e) {
    logger.warn('scheduleWorkerAiPrescreenReminder: tenant read failed', {
      tenantId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
  return true;
}

/**
 * Call from `onApplicationStatusChanged` (with before+after) or `onApplicationCreated` (before undefined).
 */
export async function maybeScheduleWorkerAiPrescreenReminder(args: {
  tenantId: string;
  applicationId: string;
  before?: Record<string, unknown> | null;
  after: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, applicationId, before, after } = args;

  if (!(await tenantOutreachEnabled(tenantId))) {
    return;
  }

  if (!isSubmittedStatus(after.status)) {
    return;
  }

  if (before && isSubmittedStatus(before.status)) {
    return;
  }

  if (
    String(after.statusChangeReason || '') === 'assignment_cancelled' ||
    after.revertedFromAssignmentCancel === true
  ) {
    return;
  }

  const userId = String(after.userId || after.candidateId || '').trim();
  if (!userId) {
    logger.info('scheduleWorkerAiPrescreenReminder: no userId on application', { applicationId, tenantId });
    return;
  }

  try {
    const interviewPol = await resolveHiringInterviewPolicyForApplication(db, tenantId, after);
    if (!interviewPol.workerAiPrescreenRequired) {
      logger.info('scheduleWorkerAiPrescreenReminder: skipped prescreen optional', { tenantId, applicationId });
      return;
    }
  } catch (e) {
    logger.warn('scheduleWorkerAiPrescreenReminder: policy resolve failed', {
      tenantId,
      applicationId,
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const ref = db.doc(`tenants/${tenantId}/applications/${applicationId}`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.workerAiPrescreenFirstTouchCombinedAt) return;
      if (data.workerAiPrescreenReminderSentAt) return;
      if (data.workerAiPrescreenReminderPending === true && data.workerAiPrescreenReminderDueAt) return;

      const due = admin.firestore.Timestamp.fromMillis(Date.now() + REMINDER_DELAY_MS);
      tx.update(ref, {
        workerAiPrescreenReminderPending: true,
        workerAiPrescreenReminderDueAt: due,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    logger.info('scheduleWorkerAiPrescreenReminder: queued', {
      tenantId,
      applicationId,
      userId,
      delayMs: REMINDER_DELAY_MS,
    });
  } catch (e) {
    logger.error('scheduleWorkerAiPrescreenReminder: failed', {
      tenantId,
      applicationId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
