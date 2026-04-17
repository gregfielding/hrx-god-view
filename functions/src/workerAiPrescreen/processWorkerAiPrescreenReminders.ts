/**
 * Scheduled: send AI pre-screen invite SMS (eligible) or profile-completion nudge (ineligible).
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { markLifecycleEventIfFirst } from '../messaging/lifecycleDedupe';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { evaluateAiPrescreenEligibility, userDocHasUsablePhone } from './evaluateAiPrescreenEligibility';
import { resolveAiPrescreenTenantPolicy } from './aiPrescreenJobSlice';
import { buildWorkerAiPrescreenInviteUrl } from '../utils/workerUrls';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import { resolveHiringInterviewPolicyForApplication } from './aiHiringPolicyResolution';
import { touchLastInterviewInvitedAt } from './interviewInviteCooldown';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const BATCH_LIMIT = 75;
const DEFERRAL_MS = 30 * 60 * 1000;

/** After an interview-invite SMS (`eligible_invite`), remind if they have not submitted the prescreen. */
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

function tenantIdFromApplicationRef(ref: admin.firestore.DocumentReference): string | null {
  const parts = ref.path.split('/');
  if (parts[0] === 'tenants' && parts.length >= 4 && parts[2] === 'applications') {
    return parts[1];
  }
  return null;
}

async function tenantOutreachEnabled(tenantId: string): Promise<boolean> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (snap.data()?.workerAiPrescreenOutreachEnabled === false) return false;
  } catch {
    /* fail open */
  }
  return true;
}

function firstNameFromUser(ud: Record<string, unknown>): string {
  return (
    String(ud.firstName || (String(ud.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() || 'there'
  );
}

/** From application doc only — no extra reads. Fallback per language when missing. */
function jobTitleFromApplicationForSms(app: Record<string, unknown>, lang: 'en' | 'es'): string {
  const t = String(app.jobTitle || app.roleTitle || app.positionTitle || '').trim();
  if (t) return t;
  return lang === 'es' ? 'este trabajo' : 'this job';
}

type ChaseProcessResult = 'sent' | 'skipped' | 'error';

async function processPrescreenChaseSms(args: {
  docSnap: admin.firestore.QueryDocumentSnapshot;
  chase: 1 | 2;
}): Promise<ChaseProcessResult> {
  const { docSnap, chase } = args;
  const tenantId = tenantIdFromApplicationRef(docSnap.ref);
  const applicationId = docSnap.id;
  if (!tenantId) return 'skipped';

  const data = docSnap.data() as Record<string, unknown>;

  const pendingKey = chase === 1 ? 'workerAiPrescreenChase1Pending' : 'workerAiPrescreenChase2Pending';
  const dueKey = chase === 1 ? 'workerAiPrescreenChase1DueAt' : 'workerAiPrescreenChase2DueAt';
  const sentKey = chase === 1 ? 'workerAiPrescreenChase1SentAt' : 'workerAiPrescreenChase2SentAt';
  const errKey = chase === 1 ? 'workerAiPrescreenChase1LastError' : 'workerAiPrescreenChase2LastError';
  const outcomeKey = chase === 1 ? 'workerAiPrescreenChase1LastOutcome' : 'workerAiPrescreenChase2LastOutcome';

  if (data.workerAiPrescreenInterviewCompletedAt) {
    await docSnap.ref.update({
      workerAiPrescreenChase1Pending: false,
      workerAiPrescreenChase2Pending: false,
      workerAiPrescreenChase1LastOutcome: 'skipped_interview_done',
      workerAiPrescreenChase2LastOutcome: 'skipped_interview_done',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  if (!(await tenantOutreachEnabled(tenantId))) {
    await docSnap.ref.update({
      [pendingKey]: false,
      [outcomeKey]: 'skipped',
      [errKey]: 'tenant_outreach_disabled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  if (normalizeApplicationStatus(String(data.status ?? '')) !== 'submitted') {
    await docSnap.ref.update({
      [pendingKey]: false,
      [outcomeKey]: 'skipped',
      [errKey]: 'not_submitted',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  try {
    const interviewPol = await resolveHiringInterviewPolicyForApplication(db, tenantId, data);
    if (!interviewPol.workerAiPrescreenRequired) {
      await docSnap.ref.update({
        [pendingKey]: false,
        [outcomeKey]: 'skipped',
        [errKey]: 'prescreen_not_required',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return 'skipped';
    }
  } catch {
    await docSnap.ref.update({
      [pendingKey]: false,
      [outcomeKey]: 'skipped',
      [errKey]: 'policy_resolve_failed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  const userId = String(data.userId || data.candidateId || '').trim();
  if (!userId) {
    await docSnap.ref.update({
      [pendingKey]: false,
      [outcomeKey]: 'skipped',
      [errKey]: 'no_user_id',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  const userSnap = await db.doc(`users/${userId}`).get();
  const ud = (userSnap.data() || {}) as Record<string, unknown>;

  if (!userDocHasUsablePhone(ud)) {
    await docSnap.ref.update({
      [pendingKey]: false,
      [outcomeKey]: 'skipped',
      [errKey]: 'no_usable_phone',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  const phone = phoneE164FromUser(ud);
  if (!phone) {
    await docSnap.ref.update({
      [pendingKey]: false,
      [outcomeKey]: 'skipped',
      [errKey]: 'no_usable_phone',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  const claim = await db.runTransaction(async (tx) => {
    const s = await tx.get(docSnap.ref);
    const d = (s.data() || {}) as Record<string, unknown>;
    if (d.workerAiPrescreenInterviewCompletedAt) return 'interview_done';
    if (d[sentKey]) return 'already_sent';
    if (d[pendingKey] !== true) return 'not_pending';
    tx.update(docSnap.ref, {
      [pendingKey]: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'claimed';
  });

  if (claim === 'interview_done') {
    await docSnap.ref.update({
      workerAiPrescreenChase1Pending: false,
      workerAiPrescreenChase2Pending: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }
  if (claim !== 'claimed') {
    return 'skipped';
  }

  let prescreenPolicy = resolveAiPrescreenTenantPolicy({});
  try {
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    prescreenPolicy = resolveAiPrescreenTenantPolicy((tenantSnap.data() || {}) as Record<string, unknown>);
  } catch {
    /* defaults */
  }
  const eligibility = evaluateAiPrescreenEligibility(ud, {
    requireResumeOrSkill: prescreenPolicy.eligibility.requireResumeOrSkill,
    requirePhone: prescreenPolicy.eligibility.requirePhone,
    requireLocation: prescreenPolicy.eligibility.requireLocation,
    requireWorkAuthorization: prescreenPolicy.eligibility.requireWorkAuthorization,
  });

  const prescreenUrl = buildWorkerAiPrescreenInviteUrl({
    applicationId,
    entry: chase === 1 ? 'chase_1' : 'chase_2',
  });
  const firstName = firstNameFromUser(ud);
  const preferredLanguage = String(ud.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
  const jobTitle = jobTitleFromApplicationForSms(data, preferredLanguage);

  if (!eligibility.eligibleForInterview) {
    await docSnap.ref.update({
      [outcomeKey]: 'send_time_ineligible',
      [errKey]: eligibility.reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'skipped';
  }

  let body: string;
  if (chase === 1) {
    if (preferredLanguage === 'es') {
      body = `Recordatorio: Hola ${firstName} — aún necesitamos tu entrevista rápida (2 minutos) para ${jobTitle}:\n${prescreenUrl}`;
    } else {
      body = `Reminder: Hi ${firstName} — we still need your quick 2-minute interview for ${jobTitle}:\n${prescreenUrl}`;
    }
  } else if (preferredLanguage === 'es') {
    body = `Último recordatorio: Hola ${firstName} — completa tu entrevista de 2 minutos para ${jobTitle} cuando puedas:\n${prescreenUrl}`;
  } else {
    body = `Last reminder: Hi ${firstName} — complete your 2-minute interview for ${jobTitle} when you can:\n${prescreenUrl}`;
  }

  const messageTypeId =
    chase === 1 ? 'worker_ai_prescreen_chase_1' : 'worker_ai_prescreen_chase_2';

  const smsResult = await sendWorkerMessageInternal(phone, body, {
    tenantId,
    userId,
    source: 'system',
    messageTypeId,
    systemContext: true,
  });

  const sentAt = admin.firestore.Timestamp.now();

  if (!smsResult.success) {
    await docSnap.ref.update({
      [pendingKey]: true,
      [errKey]: smsResult.error || 'send_failed',
      [dueKey]: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'error';
  }

  await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: `worker_ai_prescreen_chase_${chase}__${tenantId}__${applicationId}`,
    eventType: chase === 1 ? 'worker_ai_prescreen_chase_1_sent' : 'worker_ai_prescreen_chase_2_sent',
    context: { applicationId, userId },
  });

  await docSnap.ref.update({
    [sentKey]: sentAt,
    [outcomeKey]: 'eligible_invite',
    [errKey]: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await touchLastInterviewInvitedAt(db, userId, sentAt);

  return 'sent';
}

export const processWorkerAiPrescreenReminders = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: 'us-central1',
    /** Monolithic index + Twilio; 256MiB global default can OOM during Cloud Run cold start. */
    memory: '512MiB',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    timeoutSeconds: 300,
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    let q: admin.firestore.QuerySnapshot;
    let qFollowUp: admin.firestore.QuerySnapshot;
    let qChase1: admin.firestore.QuerySnapshot;
    let qChase2: admin.firestore.QuerySnapshot;
    try {
      [q, qFollowUp, qChase1, qChase2] = await Promise.all([
        db
          .collectionGroup('applications')
          .where('workerAiPrescreenReminderPending', '==', true)
          .where('workerAiPrescreenReminderDueAt', '<=', now)
          .limit(BATCH_LIMIT)
          .get(),
        db
          .collectionGroup('applications')
          .where('workerAiPrescreenFollowUpPending', '==', true)
          .where('workerAiPrescreenFollowUpDueAt', '<=', now)
          .limit(BATCH_LIMIT)
          .get(),
        db
          .collectionGroup('applications')
          .where('workerAiPrescreenChase1Pending', '==', true)
          .where('workerAiPrescreenChase1DueAt', '<=', now)
          .limit(BATCH_LIMIT)
          .get(),
        db
          .collectionGroup('applications')
          .where('workerAiPrescreenChase2Pending', '==', true)
          .where('workerAiPrescreenChase2DueAt', '<=', now)
          .limit(BATCH_LIMIT)
          .get(),
      ]);
    } catch (err: unknown) {
      logger.error('workerAiPrescreenReminder: query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (q.empty && qFollowUp.empty && qChase1.empty && qChase2.empty) return;

    let sent = 0;
    let skipped = 0;
    let errors = 0;
    let followUpSent = 0;
    let followUpSkipped = 0;
    let followUpErrors = 0;
    let chase1Sent = 0;
    let chase1Skipped = 0;
    let chase1Errors = 0;
    let chase2Sent = 0;
    let chase2Skipped = 0;
    let chase2Errors = 0;

    for (const docSnap of q.docs) {
      const tenantId = tenantIdFromApplicationRef(docSnap.ref);
      const applicationId = docSnap.id;
      if (!tenantId) {
        skipped += 1;
        continue;
      }

      const data = docSnap.data() as Record<string, unknown>;

      if (!(await tenantOutreachEnabled(tenantId))) {
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: false,
          workerAiPrescreenReminderLastOutcome: 'skipped',
          workerAiPrescreenReminderLastError: 'tenant_outreach_disabled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        skipped += 1;
        continue;
      }

      if (normalizeApplicationStatus(String(data.status ?? '')) !== 'submitted') {
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: false,
          workerAiPrescreenReminderLastOutcome: 'skipped',
          workerAiPrescreenReminderLastError: 'not_submitted',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        skipped += 1;
        continue;
      }

      const userId = String(data.userId || data.candidateId || '').trim();
      if (!userId) {
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: false,
          workerAiPrescreenReminderLastOutcome: 'skipped',
          workerAiPrescreenReminderLastError: 'no_user_id',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        skipped += 1;
        continue;
      }

      try {
        const interviewPol = await resolveHiringInterviewPolicyForApplication(db, tenantId, data);
        if (!interviewPol.workerAiPrescreenRequired) {
          await docSnap.ref.update({
            workerAiPrescreenReminderPending: false,
            workerAiPrescreenReminderLastOutcome: 'skipped',
            workerAiPrescreenReminderLastError: 'prescreen_not_required',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          skipped += 1;
          continue;
        }
      } catch {
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: false,
          workerAiPrescreenReminderLastOutcome: 'skipped',
          workerAiPrescreenReminderLastError: 'policy_resolve_failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        skipped += 1;
        continue;
      }

      const userSnap = await db.doc(`users/${userId}`).get();
      const ud = (userSnap.data() || {}) as Record<string, unknown>;

      if (!userDocHasUsablePhone(ud)) {
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: false,
          workerAiPrescreenReminderLastOutcome: 'skipped',
          workerAiPrescreenReminderLastError: 'no_usable_phone',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        skipped += 1;
        continue;
      }

      const phone = phoneE164FromUser(ud);
      if (!phone) {
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: false,
          workerAiPrescreenReminderLastOutcome: 'skipped',
          workerAiPrescreenReminderLastError: 'no_usable_phone',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        skipped += 1;
        continue;
      }

      const claim = await db.runTransaction(async (tx) => {
        const s = await tx.get(docSnap.ref);
        const d = (s.data() || {}) as Record<string, unknown>;
        if (d.workerAiPrescreenReminderSentAt) return 'already_sent';
        if (d.workerAiPrescreenReminderPending !== true) return 'not_pending';
        tx.update(docSnap.ref, {
          workerAiPrescreenReminderPending: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return 'claimed';
      });

      if (claim !== 'claimed') {
        skipped += 1;
        continue;
      }

      let prescreenPolicy = resolveAiPrescreenTenantPolicy({});
      try {
        const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
        prescreenPolicy = resolveAiPrescreenTenantPolicy((tenantSnap.data() || {}) as Record<string, unknown>);
      } catch {
        /* fail open: defaults */
      }
      const eligibility = evaluateAiPrescreenEligibility(ud, {
        requireResumeOrSkill: prescreenPolicy.eligibility.requireResumeOrSkill,
        requirePhone: prescreenPolicy.eligibility.requirePhone,
        requireLocation: prescreenPolicy.eligibility.requireLocation,
        requireWorkAuthorization: prescreenPolicy.eligibility.requireWorkAuthorization,
      });
      const prescreenUrl = buildWorkerAiPrescreenInviteUrl({ applicationId, entry: 'scheduled_invite' });
      const prescreenGapUrl = buildWorkerAiPrescreenInviteUrl({ applicationId, entry: 'scheduled_gap_invite' });

      const firstName = firstNameFromUser(ud);
      const preferredLanguage = String(ud.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
      const jobTitle = jobTitleFromApplicationForSms(data, preferredLanguage);

      let body: string;
      let outcome: 'eligible_invite' | 'ineligible_nudge';

      if (eligibility.eligibleForInterview) {
        outcome = 'eligible_invite';
        if (preferredLanguage === 'es') {
          body = `Hola ${firstName}, siguiente paso rápido: responde unas preguntas para que podamos considerarte para ${jobTitle} y emparejarte bien. Empieza aquí:\n${prescreenUrl}`;
        } else {
          body = `Hi ${firstName}, quick next step: answer a few questions so we can consider you for ${jobTitle} and match you with the right opportunities. Start here:\n${prescreenUrl}`;
        }
      } else {
        outcome = 'ineligible_nudge';
        if (preferredLanguage === 'es') {
          body = `Hola ${firstName}, responde unas preguntas rápidas para prepararte para trabajar y completar lo que falta. Empieza aquí:\n${prescreenGapUrl}`;
        } else {
          body = `Hi ${firstName}, answer a few quick questions so we can get you job-ready and fill in what’s missing. Start here:\n${prescreenGapUrl}`;
        }
      }

      const smsResult = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId,
        source: 'system',
        messageTypeId:
          outcome === 'eligible_invite' ? 'worker_ai_prescreen_invite' : 'worker_ai_prescreen_gap_interview_invite',
        systemContext: true,
      });

      const sentAt = admin.firestore.Timestamp.now();

      if (!smsResult.success) {
        errors += 1;
        logger.warn('workerAiPrescreenReminder: send failed', {
          applicationId,
          userId,
          error: smsResult.error,
        });
        await docSnap.ref.update({
          workerAiPrescreenReminderPending: true,
          workerAiPrescreenReminderLastError: smsResult.error || 'send_failed',
          workerAiPrescreenReminderDueAt: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      await markLifecycleEventIfFirst({
        tenantId,
        dedupeKey: `worker_ai_prescreen_reminder__${tenantId}__${applicationId}`,
        eventType: 'worker_ai_prescreen_reminder_sent',
        context: { applicationId, userId },
      });

      await docSnap.ref.update({
        workerAiPrescreenReminderSentAt: sentAt,
        workerAiPrescreenReminderLastOutcome: outcome,
        workerAiPrescreenReminderLastError: admin.firestore.FieldValue.delete(),
        ...(outcome === 'eligible_invite' ? scheduleInterviewChaseFields(sentAt) : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await touchLastInterviewInvitedAt(db, userId, sentAt);

      sent += 1;
    }

    for (const docSnap of qFollowUp.docs) {
      const tenantId = tenantIdFromApplicationRef(docSnap.ref);
      const applicationId = docSnap.id;
      if (!tenantId) {
        followUpSkipped += 1;
        continue;
      }

      const data = docSnap.data() as Record<string, unknown>;

      if (!(await tenantOutreachEnabled(tenantId))) {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: false,
          workerAiPrescreenFollowUpLastOutcome: 'skipped',
          workerAiPrescreenFollowUpLastError: 'tenant_outreach_disabled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      if (normalizeApplicationStatus(String(data.status ?? '')) !== 'submitted') {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: false,
          workerAiPrescreenFollowUpLastOutcome: 'skipped',
          workerAiPrescreenFollowUpLastError: 'not_submitted',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      const userId = String(data.userId || data.candidateId || '').trim();
      if (!userId) {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: false,
          workerAiPrescreenFollowUpLastOutcome: 'skipped',
          workerAiPrescreenFollowUpLastError: 'no_user_id',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      try {
        const interviewPol = await resolveHiringInterviewPolicyForApplication(db, tenantId, data);
        if (!interviewPol.workerAiPrescreenRequired) {
          await docSnap.ref.update({
            workerAiPrescreenFollowUpPending: false,
            workerAiPrescreenFollowUpLastOutcome: 'skipped',
            workerAiPrescreenFollowUpLastError: 'prescreen_not_required',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          followUpSkipped += 1;
          continue;
        }
      } catch {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: false,
          workerAiPrescreenFollowUpLastOutcome: 'skipped',
          workerAiPrescreenFollowUpLastError: 'policy_resolve_failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      const userSnap = await db.doc(`users/${userId}`).get();
      const ud = (userSnap.data() || {}) as Record<string, unknown>;

      if (!userDocHasUsablePhone(ud)) {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: false,
          workerAiPrescreenFollowUpLastOutcome: 'skipped',
          workerAiPrescreenFollowUpLastError: 'no_usable_phone',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      const phone = phoneE164FromUser(ud);
      if (!phone) {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: false,
          workerAiPrescreenFollowUpLastOutcome: 'skipped',
          workerAiPrescreenFollowUpLastError: 'no_usable_phone',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      const claimFollowUp = await db.runTransaction(async (tx) => {
        const s = await tx.get(docSnap.ref);
        const d = (s.data() || {}) as Record<string, unknown>;
        if (d.workerAiPrescreenFollowUpInviteSentAt) return 'already_sent';
        if (d.workerAiPrescreenFollowUpPending !== true) return 'not_pending';
        tx.update(docSnap.ref, {
          workerAiPrescreenFollowUpPending: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return 'claimed';
      });

      if (claimFollowUp !== 'claimed') {
        followUpSkipped += 1;
        continue;
      }

      let prescreenPolicy = resolveAiPrescreenTenantPolicy({});
      try {
        const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
        prescreenPolicy = resolveAiPrescreenTenantPolicy((tenantSnap.data() || {}) as Record<string, unknown>);
      } catch {
        /* fail open: defaults */
      }
      const eligibility = evaluateAiPrescreenEligibility(ud, {
        requireResumeOrSkill: prescreenPolicy.eligibility.requireResumeOrSkill,
        requirePhone: prescreenPolicy.eligibility.requirePhone,
        requireLocation: prescreenPolicy.eligibility.requireLocation,
        requireWorkAuthorization: prescreenPolicy.eligibility.requireWorkAuthorization,
      });

      const prescreenUrl = buildWorkerAiPrescreenInviteUrl({ applicationId, entry: 'followup_invite' });
      const firstName = firstNameFromUser(ud);
      const preferredLanguage = String(ud.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
      const jobTitle = jobTitleFromApplicationForSms(data, preferredLanguage);

      if (!eligibility.eligibleForInterview) {
        await docSnap.ref.update({
          workerAiPrescreenFollowUpLastOutcome: 'send_time_ineligible',
          workerAiPrescreenFollowUpLastError: eligibility.reason,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        followUpSkipped += 1;
        continue;
      }

      let body: string;
      if (preferredLanguage === 'es') {
        body = `Hola ${firstName}, siguiente paso rápido: responde unas preguntas para que podamos considerarte para ${jobTitle} y emparejarte bien. Empieza aquí:\n${prescreenUrl}`;
      } else {
        body = `Hi ${firstName}, quick next step: answer a few questions so we can consider you for ${jobTitle} and match you with the right opportunities. Start here:\n${prescreenUrl}`;
      }

      const smsResult = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId,
        source: 'system',
        messageTypeId: 'worker_ai_prescreen_invite',
        systemContext: true,
      });

      const sentAt = admin.firestore.Timestamp.now();

      if (!smsResult.success) {
        followUpErrors += 1;
        logger.warn('workerAiPrescreenFollowUp: send failed', {
          applicationId,
          userId,
          error: smsResult.error,
        });
        await docSnap.ref.update({
          workerAiPrescreenFollowUpPending: true,
          workerAiPrescreenFollowUpLastError: smsResult.error || 'send_failed',
          workerAiPrescreenFollowUpDueAt: admin.firestore.Timestamp.fromMillis(Date.now() + DEFERRAL_MS),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      await markLifecycleEventIfFirst({
        tenantId,
        dedupeKey: `worker_ai_prescreen_followup_invite__${tenantId}__${applicationId}`,
        eventType: 'worker_ai_prescreen_followup_invite_sent',
        context: { applicationId, userId },
      });

      await docSnap.ref.update({
        workerAiPrescreenFollowUpInviteSentAt: sentAt,
        workerAiPrescreenFollowUpLastOutcome: 'eligible_invite',
        workerAiPrescreenFollowUpLastError: admin.firestore.FieldValue.delete(),
        ...scheduleInterviewChaseFields(sentAt),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await touchLastInterviewInvitedAt(db, userId, sentAt);

      followUpSent += 1;
    }

    for (const docSnap of qChase1.docs) {
      const r = await processPrescreenChaseSms({
        docSnap,
        chase: 1,
      });
      if (r === 'sent') chase1Sent += 1;
      else if (r === 'skipped') chase1Skipped += 1;
      else if (r === 'error') chase1Errors += 1;
    }

    for (const docSnap of qChase2.docs) {
      const r = await processPrescreenChaseSms({
        docSnap,
        chase: 2,
      });
      if (r === 'sent') chase2Sent += 1;
      else if (r === 'skipped') chase2Skipped += 1;
      else if (r === 'error') chase2Errors += 1;
    }

    logger.info('workerAiPrescreenReminder: batch done', {
      scanned: q.size,
      sent,
      skipped,
      errors,
      followUpScanned: qFollowUp.size,
      followUpSent,
      followUpSkipped,
      followUpErrors,
      chase1Scanned: qChase1.size,
      chase1Sent,
      chase1Skipped,
      chase1Errors,
      chase2Scanned: qChase2.size,
      chase2Sent,
      chase2Skipped,
      chase2Errors,
    });
  },
);
