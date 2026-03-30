/**
 * ~1h after apply-wizard account creation, SMS applicants who have not finished
 * with a link back to the correct wizard (job apply vs /c1/apply vs group signup).
 *
 * Flow:
 * - Wizard writes applyResumeSnapshot + applyWizardReminderPending on first user create.
 * - onUserCreatedScheduleApplyWizardReminder sets applyWizardReminderDueAt = now + 1h.
 * - processApplyWizardReminders (scheduled) sends SMS once, then clears pending flags.
 * - Successful wizard submit removes snapshot + pending (no SMS if they finished).
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from './twilio';
import { buildApplyWizardResumeUrl } from './utils/workerUrls';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const REMINDER_DELAY_MS = 60 * 60 * 1000;
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

      const url = buildApplyWizardResumeUrl({
        path: snapshot.path as string,
        tenantSlug: snapshot.tenantSlug as string,
        tenantId: snapshot.tenantId as string,
        jobId: snapshot.jobId as string,
        signupGroupId: snapshot.signupGroupId as string,
      });

      const firstName =
        String(data.firstName || (String(data.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() ||
        'there';
      const preferredLanguage = String(data.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';

      const english =
        `Hi ${firstName}, you started an application with C1 Staffing but have not finished yet. ` +
        `Continue here: ${url}`;
      const spanish =
        `Hola ${firstName}, empezaste una solicitud con C1 Staffing pero no la has terminado. ` +
        `Continua aqui: ${url}`;
      const body = preferredLanguage === 'es' ? spanish : english;

      const tenantId = resolveTenantIdForLog(data, snapshot);

      const smsResult = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId: uid,
        source: 'system',
        messageTypeId: 'apply_wizard_resume_reminder',
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
        applyWizardReminderLastError: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await docSnap.ref.collection('activityLogs').add({
          action: 'Apply wizard resume reminder',
          actionType: 'sms_sent',
          description: 'Automated SMS with link to continue application',
          severity: 'low',
          source: 'system',
          metadata: {
            reminderType: 'apply_wizard_resume',
            phoneE164: phone,
            resumeUrl: url,
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
