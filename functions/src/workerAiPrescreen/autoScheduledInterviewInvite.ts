/**
 * ~15 minutes after account creation, invite eligible users into the adaptive interview via SMS.
 *
 * Uses the same Firestore timestamp + scheduled processor pattern as `applyWizardReminder.ts`
 * (not Cloud Tasks — outbound SMS still queues through the existing SMS pipeline).
 *
 * Flow:
 * - `onUserCreatedScheduleAutoInterviewInvite` sets `interviewStatus = never_invited` and
 *   `interviewInviteScheduledAt = now + 15m` when appropriate.
 * - `processScheduledInterviewInvites` sends SMS once, then sets `invited` + `interviewInviteSentAt`.
 * Suppression when `hasWorkerAiPrescreenInterview` or legacy `interviewStatus === 'completed'`, else capped
 * `users/{uid}/interviews` scan for `worker_ai_prescreen` (not other interview kinds).
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { buildWorkerAiPrescreenInviteUrl } from '../utils/workerUrls';
import { markLifecycleEventIfFirst } from '../messaging/lifecycleDedupe';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { userInInterviewReinviteCooldown } from './interviewInviteCooldown';
import { userHasWorkerAiPrescreenWithFallback } from './hasWorkerAiPrescreenDenormalized';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const REMINDER_DELAY_MS = 15 * 60 * 1000;
const BATCH_LIMIT = 75;
const DEFERRAL_MS = 30 * 60 * 1000;
const MAX_PHONE_DEFERRALS = 48;

/** Align with `processWorkerAiPrescreenReminders` chase scheduling when an application exists. */
const CHASE_1_MS = 4 * 60 * 60 * 1000;
const CHASE_2_MS = 24 * 60 * 60 * 1000;

function scheduleInterviewChaseFields(sentAt: admin.firestore.Timestamp): Record<string, unknown> {
  const t = sentAt.toMillis();
  return {
    workerAiPrescreenChase1Pending: true,
    workerAiPrescreenChase1DueAt: admin.firestore.Timestamp.fromMillis(t + CHASE_1_MS),
    workerAiPrescreenChase2Pending: true,
    workerAiPrescreenChase2DueAt: admin.firestore.Timestamp.fromMillis(t + CHASE_2_MS),
  };
}

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) {
    if (e.startsWith('+1') && !/^\+1[2-9]\d{9}$/.test(e)) return '';
    return e;
  }
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) {
    if (digits[0] === '0' || digits[0] === '1') return '';
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const n = digits.slice(1);
    if (n[0] === '0' || n[0] === '1') return '';
    return `+1${n}`;
  }
  return '';
}

function resolveTenantIdForUser(data: Record<string, unknown>): string {
  const top = String(data.tenantId || data.activeTenantId || '').trim();
  if (top) return top;
  const tids = data.tenantIds;
  if (tids && typeof tids === 'object' && !Array.isArray(tids)) {
    const keys = Object.keys(tids as object);
    if (keys.length > 0) return keys[0];
  }
  return 'system';
}

async function tenantOutreachEnabled(tenantId: string): Promise<boolean> {
  if (!tenantId || tenantId === 'system') return true;
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (snap.data()?.workerAiPrescreenOutreachEnabled === false) return false;
  } catch {
    /* fail open */
  }
  return true;
}

async function resolveApplicationIdForAutoInvite(uid: string, data: Record<string, unknown>): Promise<string | null> {
  const tids: string[] = [];
  const single = String(data.tenantId || data.activeTenantId || '').trim();
  if (single) tids.push(single);
  const tenantIdsObj = data.tenantIds;
  if (tenantIdsObj && typeof tenantIdsObj === 'object' && !Array.isArray(tenantIdsObj)) {
    for (const k of Object.keys(tenantIdsObj as object)) {
      if (k && !tids.includes(k)) tids.push(k);
    }
  }
  for (const tenantId of tids.slice(0, 8)) {
    try {
      const apps = await db.collection(`tenants/${tenantId}/applications`).where('userId', '==', uid).limit(3).get();
      if (!apps.empty) return apps.docs[0].id;
    } catch {
      /* continue */
    }
  }
  return null;
}

export const onUserCreatedScheduleAutoInterviewInvite = onDocumentCreated(
  {
    document: 'users/{userId}',
    region: 'us-central1',
    memory: '512MiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as Record<string, unknown>;
    const status = data.interviewStatus;

    if (status === 'completed' || status === 'invited' || status === 'skipped') return;
    if (data.interviewInviteScheduledAt) return;

    if (data.applyResumeSnapshot && typeof data.applyResumeSnapshot === 'object') return;
    if (data.applyWizardReminderPending === true) return;

    if (userInInterviewReinviteCooldown(data)) {
      await snap.ref.set(
        {
          interviewStatus: 'skipped',
          interviewSource: 'interview_reinvite_cooldown',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    if (data.smsOptIn === false || data.smsBlockedSystem === true) {
      await snap.ref.set(
        {
          interviewStatus: 'skipped',
          interviewSource: 'opt_out_guard',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const tenantId = resolveTenantIdForUser(data);
    if (tenantId !== 'system' && !(await tenantOutreachEnabled(tenantId))) {
      await snap.ref.set(
        {
          interviewStatus: 'skipped',
          interviewSource: 'tenant_outreach_disabled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    if (await userHasWorkerAiPrescreenWithFallback(snap.ref, data)) {
      await snap.ref.set(
        {
          interviewStatus: 'completed',
          interviewSource: 'existing_worker_ai_prescreen_on_create',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const due = admin.firestore.Timestamp.fromMillis(Date.now() + REMINDER_DELAY_MS);
    await snap.ref.set(
      {
        interviewStatus: 'never_invited',
        interviewInviteScheduledAt: due,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.info('autoInterviewInvite: scheduled', { userId: event.params.userId, due: due.toDate().toISOString() });
  },
);

export const processScheduledInterviewInvites = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'us-central1',
    memory: '512MiB',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    timeoutSeconds: 300,
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    let q: admin.firestore.QuerySnapshot;
    try {
      q = await db
        .collection('users')
        .where('interviewStatus', '==', 'never_invited')
        .where('interviewInviteScheduledAt', '<=', now)
        .limit(BATCH_LIMIT)
        .get();
    } catch (err: unknown) {
      logger.error('autoInterviewInvite: query failed (missing index?)', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (q.empty) return;

    let sent = 0;
    let deferred = 0;
    let skipped = 0;

    for (const docSnap of q.docs) {
      const uid = docSnap.id;
      const data = docSnap.data() as Record<string, unknown>;

      if (data.interviewStatus !== 'never_invited') {
        skipped += 1;
        continue;
      }

      if (data.applyResumeSnapshot && typeof data.applyResumeSnapshot === 'object') {
        await docSnap.ref.set(
          {
            interviewStatus: 'skipped',
            interviewInviteLastOutcome: 'skipped_apply_wizard_flow',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        skipped += 1;
        continue;
      }
      if (data.applyWizardReminderPending === true) {
        await docSnap.ref.set(
          {
            interviewStatus: 'skipped',
            interviewInviteLastOutcome: 'skipped_apply_wizard_reminder',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        skipped += 1;
        continue;
      }

      if (userInInterviewReinviteCooldown(data)) {
        await docSnap.ref.set(
          {
            interviewStatus: 'skipped',
            interviewInviteLastOutcome: 'skipped_reinvite_cooldown',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        skipped += 1;
        continue;
      }

      if (await userHasWorkerAiPrescreenWithFallback(docSnap.ref, data)) {
        await docSnap.ref.set(
          {
            interviewStatus: 'completed',
            interviewInviteLastOutcome: 'skipped_worker_ai_prescreen_exists',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        skipped += 1;
        continue;
      }

      if (data.smsOptIn === false || data.smsBlockedSystem === true) {
        await docSnap.ref.set(
          {
            interviewStatus: 'skipped',
            interviewSource: 'opt_out_guard',
            interviewInviteLastOutcome: 'skipped_opt_out',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        skipped += 1;
        continue;
      }

      const tenantId = resolveTenantIdForUser(data);
      if (!(await tenantOutreachEnabled(tenantId))) {
        await docSnap.ref.set(
          {
            interviewStatus: 'skipped',
            interviewSource: 'tenant_outreach_disabled',
            interviewInviteLastOutcome: 'skipped_tenant',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        skipped += 1;
        continue;
      }

      const phone = phoneE164FromUser(data);
      if (!phone) {
        const deferrals = Number(data.autoInterviewInvitePhoneDeferrals || 0) || 0;
        if (deferrals >= MAX_PHONE_DEFERRALS) {
          await docSnap.ref.set(
            {
              interviewStatus: 'skipped',
              interviewInviteLastOutcome: 'no_phone',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          skipped += 1;
        } else {
          await docSnap.ref.set(
            {
              interviewInviteScheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
              autoInterviewInvitePhoneDeferrals: deferrals + 1,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          deferred += 1;
        }
        continue;
      }

      const applicationId = await resolveApplicationIdForAutoInvite(uid, data);
      const url = buildWorkerAiPrescreenInviteUrl({
        applicationId,
        entry: 'sms_auto_new_user',
      });

      const firstName =
        String(data.firstName || (String(data.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() ||
        'there';
      const preferredLanguage = String(data.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';

      const english =
        applicationId != null
          ? `Hi ${firstName}, quick next step: answer a few questions so we can consider you for this job and match you with the right opportunities. Start here: ${url}`
          : `Hi ${firstName}, answer a few quick questions so we can get you job-ready and match you with work. Start here: ${url}`;
      const spanish =
        applicationId != null
          ? `Hola ${firstName}, siguiente paso rápido: responde unas preguntas para que podamos considerarte para este trabajo y emparejarte con las oportunidades adecuadas. Empieza aquí: ${url}`
          : `Hola ${firstName}, responde unas preguntas rápidas para prepararte para trabajar y emparejarte con empleos. Empieza aquí: ${url}`;
      const body = preferredLanguage === 'es' ? spanish : english;

      const smsResult = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId: uid,
        source: 'system',
        messageTypeId: 'auto_new_user_interview_invite',
        systemContext: true,
      });

      const sentAt = admin.firestore.Timestamp.now();

      if (!smsResult.success) {
        logger.warn('autoInterviewInvite: send failed', { uid, error: smsResult.error });
        await docSnap.ref.set(
          {
            interviewInviteLastError: smsResult.error || 'send_failed',
            interviewInviteScheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
            autoInterviewInvitePhoneDeferrals: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        continue;
      }

      await markLifecycleEventIfFirst({
        tenantId,
        dedupeKey: `interview_invite__user__${uid}`,
        eventType: 'auto_new_user_interview_invite_sent',
        context: { userId: uid, applicationId: applicationId || null },
      });

      await docSnap.ref.set(
        {
          interviewStatus: 'invited',
          interviewInviteSentAt: sentAt,
          lastInterviewInvitedAt: sentAt,
          interviewSource: 'auto_new_user',
          interviewInviteLastError: admin.firestore.FieldValue.delete(),
          interviewInviteLastOutcome: 'sent',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (applicationId && tenantId !== 'system') {
        try {
          await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
            {
              ...scheduleInterviewChaseFields(sentAt),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } catch (e) {
          logger.warn('autoInterviewInvite: chase schedule on application failed', {
            uid,
            applicationId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      try {
        await docSnap.ref.collection('activityLogs').add({
          action: 'Auto new-user interview invite',
          actionType: 'sms_sent',
          description: 'Automated SMS with link to adaptive worker interview',
          severity: 'low',
          source: 'system',
          metadata: {
            reminderType: 'auto_new_user_interview_invite',
            phoneE164: phone,
            interviewUrl: url,
            applicationId: applicationId || null,
            tenantId,
            preferredLanguage,
          },
          timestamp: sentAt,
          createdAt: sentAt,
        });
      } catch (logErr: unknown) {
        logger.warn('autoInterviewInvite: activity log failed', {
          uid,
          error: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }

      sent += 1;
    }

    logger.info('autoInterviewInvite: batch done', { scanned: q.size, sent, deferred, skipped });
  },
);
