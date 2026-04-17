/**
 * ~15m after apply-wizard account creation, SMS applicants who have not finished
 * with a link back to the correct wizard (job apply vs /c1/apply vs group signup).
 *
 * Flow:
 * - Wizard writes applyResumeSnapshot + applyWizardReminderPending on first user create.
 * - onUserCreatedScheduleApplyWizardReminder sets applyWizardReminderDueAt = now + 15m.
 * - processApplyWizardReminders (scheduled) sends SMS once, then clears pending flags.
 * - Successful wizard submit removes snapshot + pending (no SMS if they finished).
 * - SMS links to worker AI prescreen (`entry=sms_apply_wizard_invite`) instead of the apply wizard resume URL.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from './twilio';
import { buildWorkerAiPrescreenInviteUrl } from './utils/workerUrls';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import { userInInterviewReinviteCooldown } from './workerAiPrescreen/interviewInviteCooldown';
import { normalizeApplicationStatus } from './utils/applicationStatusNormalize';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const REMINDER_DELAY_MS = 15 * 60 * 1000;
const BATCH_LIMIT = 75;
/** If phone not on profile yet, defer up to ~24h (48 × 30m). */
const MAX_PHONE_DEFERRALS = 48;
const DEFERRAL_MS = 30 * 60 * 1000;

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

/**
 * Best-effort: find an application doc for this user + tenant + job posting id from the apply snapshot
 * so the interview stays job-aware (dynamic prescreen plan + context).
 */
/**
 * Interview-first: if the user already submitted an application for this job context,
 * do not send the legacy apply-wizard reminder SMS (prescreen / status triggers handle next steps).
 */
async function userHasSubmittedApplicationForSnapshot(
  uid: string,
  snapshot: Record<string, unknown>,
): Promise<boolean> {
  const tenantId = String(snapshot.tenantId || '').trim();
  const jobId = String(snapshot.jobId || '').trim();
  if (!tenantId || !jobId) return false;
  try {
    const apps = await db
      .collection(`tenants/${tenantId}/applications`)
      .where('userId', '==', uid)
      .limit(40)
      .get();
    for (const d of apps.docs) {
      const o = d.data() as Record<string, unknown>;
      const jp = String(o.jobPostingId || o.jobPostId || '').trim();
      const jid = String(o.jobId || '').trim();
      const matchJob = jp === jobId || jid === jobId || d.id.includes(jobId);
      if (!matchJob) continue;
      if (normalizeApplicationStatus(String(o.status ?? '')) === 'submitted') {
        return true;
      }
    }
  } catch (e) {
    logger.warn('applyWizardReminder: userHasSubmittedApplicationForSnapshot failed', {
      uid,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return false;
}

async function resolveApplicationIdForInterviewInvite(
  uid: string,
  snapshot: Record<string, unknown>,
): Promise<string | null> {
  const tenantId = String(snapshot.tenantId || '').trim();
  const jobId = String(snapshot.jobId || '').trim();
  if (!tenantId || !jobId) return null;
  try {
    const apps = await db
      .collection(`tenants/${tenantId}/applications`)
      .where('userId', '==', uid)
      .limit(40)
      .get();
    for (const d of apps.docs) {
      const o = d.data() as Record<string, unknown>;
      const jp = String(o.jobPostingId || o.jobPostId || '').trim();
      const jid = String(o.jobId || '').trim();
      if (jp === jobId || jid === jobId) return d.id;
    }
    for (const d of apps.docs) {
      if (d.id.includes(jobId)) return d.id;
    }
  } catch (e) {
    logger.warn('applyWizardReminder: resolveApplicationIdForInterviewInvite failed', {
      uid,
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return null;
}

function resolveTenantIdForLog(data: Record<string, unknown>, snapshot: Record<string, unknown>): string {
  const fromSnap = String(snapshot.tenantId || '').trim();
  if (fromSnap) return fromSnap;
  const top = String(data.tenantId || data.activeTenantId || '').trim();
  if (top) return top;
  const tids = data.tenantIds;
  if (tids && typeof tids === 'object' && !Array.isArray(tids)) {
    const keys = Object.keys(tids as object);
    if (keys.length > 0) return keys[0];
  }
  return 'system';
}

export const onUserCreatedScheduleApplyWizardReminder = onDocumentCreated(
  {
    document: 'users/{userId}',
    region: 'us-central1',
    memory: '512MiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as Record<string, unknown>;
    if (!data.applyResumeSnapshot || typeof data.applyResumeSnapshot !== 'object') return;
    if (data.applyWizardReminderPending !== true) return;
    if (data.applyWizardReminderDueAt) return;

    const due = admin.firestore.Timestamp.fromMillis(Date.now() + REMINDER_DELAY_MS);
    await snap.ref.update({ applyWizardReminderDueAt: due });
    logger.info('applyWizardReminder: scheduled dueAt', { userId: event.params.userId, due: due.toDate().toISOString() });
  }
);

export const processApplyWizardReminders = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: 'us-central1',
    memory: '512MiB',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    timeoutSeconds: 300,
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    let q;
    try {
      q = await db
        .collection('users')
        .where('applyWizardReminderPending', '==', true)
        .where('applyWizardReminderDueAt', '<=', now)
        .limit(BATCH_LIMIT)
        .get();
    } catch (err: any) {
      logger.error('applyWizardReminder: query failed (missing index?)', { error: err?.message });
      throw err;
    }

    if (q.empty) {
      return;
    }

    let sent = 0;
    let deferred = 0;
    let aborted = 0;

    for (const docSnap of q.docs) {
      const uid = docSnap.id;
      const data = docSnap.data() as Record<string, unknown>;
      const snapshot = data.applyResumeSnapshot as Record<string, unknown> | undefined;
      if (!snapshot || typeof snapshot !== 'object') {
        await docSnap.ref.update({
          applyWizardReminderPending: false,
          applyWizardReminderAbortedReason: 'missing_snapshot',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        aborted += 1;
        continue;
      }

      const phone = phoneE164FromUser(data);
      if (!phone) {
        const deferrals = Number(data.applyWizardReminderDeferrals || 0) || 0;
        if (deferrals >= MAX_PHONE_DEFERRALS) {
          await docSnap.ref.update({
            applyWizardReminderPending: false,
            applyWizardReminderAbortedReason: 'no_phone',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          aborted += 1;
          logger.info('applyWizardReminder: aborted after phone deferrals', { uid, deferrals });
        } else {
          await docSnap.ref.update({
            applyWizardReminderDueAt: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
            applyWizardReminderDeferrals: deferrals + 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          deferred += 1;
        }
        continue;
      }

      if (userInInterviewReinviteCooldown(data)) {
        await docSnap.ref.update({
          applyWizardReminderPending: false,
          applyWizardReminderAbortedReason: 'interview_reinvite_cooldown',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        aborted += 1;
        continue;
      }

      if (await userHasSubmittedApplicationForSnapshot(uid, snapshot)) {
        await docSnap.ref.update({
          applyWizardReminderPending: false,
          applyWizardReminderAbortedReason: 'interview_first_submitted_application',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        aborted += 1;
        logger.info('applyWizardReminder: aborted interview_first_submitted_application', { uid });
        continue;
      }

      const applicationIdResolved = await resolveApplicationIdForInterviewInvite(uid, snapshot);
      const url = buildWorkerAiPrescreenInviteUrl({
        applicationId: applicationIdResolved,
        entry: 'sms_apply_wizard_invite',
      });

      const firstName =
        String(data.firstName || (String(data.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() ||
        'there';
      const preferredLanguage = String(data.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';

      const english =
        applicationIdResolved
          ? `Hi ${firstName}, quick next step: answer a few questions so we can consider you for this job and match you with the right opportunities. Start here: ${url}`
          : `Hi ${firstName}, answer a few quick questions so we can get you job-ready and match you with work. Start here: ${url}`;
      const spanish =
        applicationIdResolved
          ? `Hola ${firstName}, siguiente paso rápido: responde unas preguntas para que podamos considerarte para este trabajo y emparejarte con las oportunidades adecuadas. Empieza aquí: ${url}`
          : `Hola ${firstName}, responde unas preguntas rápidas para prepararte para trabajar y emparejarte con empleos. Empieza aquí: ${url}`;
      const body = preferredLanguage === 'es' ? spanish : english;

      const tenantId = resolveTenantIdForLog(data, snapshot);

      const smsResult = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId: uid,
        source: 'system',
        messageTypeId: 'apply_wizard_interview_invite',
        systemContext: true,
      });

      const sentAt = admin.firestore.Timestamp.now();

      if (!smsResult.success) {
        logger.warn('applyWizardReminder: send failed', { uid, error: smsResult.error });
        await docSnap.ref.update({
          applyWizardReminderLastError: smsResult.error || 'send_failed',
          applyWizardReminderDueAt: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
          applyWizardReminderDeferrals: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      await docSnap.ref.update({
        applyWizardReminderPending: false,
        applyWizardReminderSentAt: sentAt,
        lastInterviewInvitedAt: sentAt,
        applyWizardReminderLastError: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await docSnap.ref.collection('activityLogs').add({
          action: 'Apply wizard interview invite',
          actionType: 'sms_sent',
          description: 'Automated SMS with link to guided worker interview (adaptive entry)',
          severity: 'low',
          source: 'system',
          metadata: {
            reminderType: 'apply_wizard_interview_invite',
            phoneE164: phone,
            interviewUrl: url,
            applicationIdResolved: applicationIdResolved || null,
            tenantId,
            preferredLanguage,
          },
          timestamp: sentAt,
          createdAt: sentAt,
        });
      } catch (logErr: any) {
        logger.warn('applyWizardReminder: activity log failed', { uid, error: logErr?.message });
      }

      sent += 1;
    }

    logger.info('applyWizardReminder: batch done', {
      scanned: q.size,
      sent,
      deferred,
      aborted,
    });
  }
);
