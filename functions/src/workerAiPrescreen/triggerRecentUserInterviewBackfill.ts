/**
 * One-time admin callable: invite the most recently signed-up tenant users who lack a worker AI prescreen interview.
 * Does not replace auto new-user or group flows — separate dedupe + audit.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { randomUUID } from 'node:crypto';
import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
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
import { scheduleInterviewChaseFields, newCadenceStartUserFields } from './interviewCadence';
import { userHasWorkerAiPrescreenWithFallback } from './hasWorkerAiPrescreenDenormalized';
import { phoneE164FromUser } from '../recruiter/userGroupInterviewInviteValidation';
import { DEFAULT_FIRESTORE_TRIGGER_MEMORY } from '../utils/functionRuntimeDefaults';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const HARD_MAX_LIMIT = 500;
const DEFAULT_LIMIT = 500;
const QUERY_BATCH = 100;
const MAX_SCAN = 4000;
/** Parallel Twilio sends per wave — keeps total wall time within callable / client timeouts. */
const SEND_CONCURRENCY = 8;

/** Same as searchRecruiterTableUsers — listable worker security levels on tenantIds.{tid}. */
const TENANT_LISTABLE_SECURITY_LEVELS: Array<string | number> = ['0', '1', '2', '3', '4', 0, 1, 2, 3, 4];

const MESSAGE_TYPE_ID = 'recent_user_backfill_interview_invite';
const ENTRY = 'recent_user_backfill';

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

async function resolveApplicationIdForInvite(uid: string, data: Record<string, unknown>): Promise<string | null> {
  const tids: string[] = [];
  const single = String(data.tenantId || data.activeTenantId || '').trim();
  if (single) tids.push(single);
  const tenantIdsObj = data.tenantIds;
  if (tenantIdsObj && typeof tenantIdsObj === 'object' && !Array.isArray(tenantIdsObj)) {
    for (const k of Object.keys(tenantIdsObj as object)) {
      if (k && !tids.includes(k)) tids.push(k);
    }
  }
  for (const tid of tids.slice(0, 8)) {
    try {
      const apps = await db.collection(`tenants/${tid}/applications`).where('userId', '==', uid).limit(3).get();
      if (!apps.empty) return apps.docs[0].id;
    } catch {
      /* continue */
    }
  }
  return null;
}

function isHrxInternalUser(data: Record<string, unknown>): boolean {
  return data.isHRX === true || data.hrx === true;
}

function isStaffTenantRole(data: Record<string, unknown>, tenantId: string): boolean {
  const tm = (data.tenantIds as Record<string, { role?: string } | undefined> | undefined)?.[tenantId];
  const role = String(tm?.role || '').trim().toLowerCase();
  return ['recruiter', 'manager', 'admin'].includes(role);
}


export type SkippedReason =
  | 'already_backfill_invited'
  | 'has_worker_ai_prescreen'
  | 'interview_reinvite_cooldown'
  | 'sms_opt_out_or_blocked'
  | 'tenant_outreach_disabled'
  | 'no_phone'
  | 'apply_wizard_flow'
  | 'staff_or_internal';

type EligibilityResult = { ok: true } | { ok: false; reason: SkippedReason; detail?: string };

async function assessEligibility(
  uid: string,
  data: Record<string, unknown>,
  tenantId: string,
): Promise<EligibilityResult> {
  if (isHrxInternalUser(data) || isStaffTenantRole(data, tenantId)) {
    return { ok: false, reason: 'staff_or_internal' };
  }
  if (data.applyResumeSnapshot && typeof data.applyResumeSnapshot === 'object') {
    return { ok: false, reason: 'apply_wizard_flow' };
  }
  if (data.applyWizardReminderPending === true) {
    return { ok: false, reason: 'apply_wizard_flow' };
  }
  if (userInInterviewReinviteCooldown(data)) {
    return { ok: false, reason: 'interview_reinvite_cooldown' };
  }
  if (data.smsOptIn === false || data.smsBlockedSystem === true) {
    return { ok: false, reason: 'sms_opt_out_or_blocked' };
  }
  const userTenant = resolveTenantIdForUser(data);
  if (userTenant !== 'system' && !(await tenantOutreachEnabled(userTenant))) {
    return { ok: false, reason: 'tenant_outreach_disabled' };
  }
  const dedupeRef = db.doc(
    `tenants/${tenantId}/notification_dedupe/interview_invite__recent_backfill__user__${uid}`,
  );
  const dedupeSnap = await dedupeRef.get();
  if (dedupeSnap.exists) {
    return { ok: false, reason: 'already_backfill_invited' };
  }
  if (await userHasWorkerAiPrescreenWithFallback(db.doc(`users/${uid}`), data)) {
    return { ok: false, reason: 'has_worker_ai_prescreen' };
  }
  const phone = phoneE164FromUser(data);
  if (!phone) {
    return { ok: false, reason: 'no_phone' };
  }
  return { ok: true };
}

function buildSmsBody(
  firstName: string,
  preferredLanguage: 'en' | 'es',
  applicationId: string | null,
  url: string,
): string {
  const english =
    applicationId != null
      ? `Hi ${firstName}, quick next step: answer a few questions so we can consider you for this job and match you with the right opportunities. Start here: ${url}`
      : `Hi ${firstName}, answer a few quick questions so we can get you job-ready and match you with work. Start here: ${url}`;
  const spanish =
    applicationId != null
      ? `Hola ${firstName}, siguiente paso rápido: responde unas preguntas para que podamos considerarte para este trabajo y emparejarte con las oportunidades adecuadas. Empieza aquí: ${url}`
      : `Hola ${firstName}, responde unas preguntas rápidas para prepararte para trabajar y emparejarte con empleos. Empieza aquí: ${url}`;
  return preferredLanguage === 'es' ? spanish : english;
}

type WaveResult =
  | { kind: 'bump'; reason: SkippedReason }
  | { kind: 'detail'; detail: { userId: string; outcome: 'sent' | 'failed'; error?: string }; sent: boolean; failed: boolean };

async function sendOneRecentBackfillCandidate(args: {
  uid: string;
  data: Record<string, unknown>;
  tenantId: string;
  auditId: string;
}): Promise<WaveResult> {
  const { uid, data, tenantId, auditId } = args;
  const re = await assessEligibility(uid, data, tenantId);
  if (re.ok === false) {
    return { kind: 'bump', reason: re.reason };
  }

  const userTenant = resolveTenantIdForUser(data);
  const applicationId = await resolveApplicationIdForInvite(uid, data);
  const url = buildWorkerAiPrescreenInviteUrl({
    applicationId,
    entry: ENTRY,
  });
  const firstName =
    String(data.firstName || (String(data.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() ||
    'there';
  const preferredLanguage = String(data.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
  const body = buildSmsBody(firstName, preferredLanguage, applicationId, url);
  const phone = phoneE164FromUser(data);

  const claimed = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: `interview_invite__recent_backfill__user__${uid}`,
    eventType: 'recent_user_backfill_interview_invite_sent',
    context: { userId: uid, applicationId: applicationId || null, auditId },
  });
  if (!claimed) {
    return {
      kind: 'detail',
      detail: { userId: uid, outcome: 'failed', error: 'already_backfill_invited' },
      sent: false,
      failed: true,
    };
  }

  const smsResult = await sendWorkerMessageInternal(phone, body, {
    tenantId: userTenant,
    userId: uid,
    source: 'system',
    messageTypeId: MESSAGE_TYPE_ID,
    systemContext: true,
  });

  const sentAt = admin.firestore.Timestamp.now();

  if (!smsResult.success) {
    try {
      await db.doc(`tenants/${tenantId}/notification_dedupe/interview_invite__recent_backfill__user__${uid}`).delete();
    } catch {
      /* best-effort */
    }
    logger.warn('triggerRecentUserInterviewBackfill.send_failed', { uid, error: smsResult.error });
    return {
      kind: 'detail',
      detail: { userId: uid, outcome: 'failed', error: smsResult.error },
      sent: false,
      failed: true,
    };
  }

  await db.doc(`users/${uid}`).set(
    {
      interviewStatus: 'invited',
      interviewInviteSentAt: sentAt,
      lastInterviewInvitedAt: sentAt,
      // Anchor the 5-day cadence hard stop (cold invite, cooldown-gated).
      ...newCadenceStartUserFields(sentAt),
      interviewSource: 'recent_user_backfill',
      interviewInviteLastOutcome: 'sent',
      interviewInviteLastError: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (applicationId && userTenant !== 'system') {
    try {
      await db.doc(`tenants/${userTenant}/applications/${applicationId}`).set(
        {
          ...scheduleInterviewChaseFields(sentAt),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      logger.warn('triggerRecentUserInterviewBackfill.chase_failed', {
        uid,
        applicationId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    kind: 'detail',
    detail: { userId: uid, outcome: 'sent' },
    sent: true,
    failed: false,
  };
}

export const triggerRecentUserInterviewBackfill = onCall(
  {
    region: 'us-central1',
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
    /** Large backfills (hundreds of SMS) exceed the default 60s / client ~70s without this. */
    timeoutSeconds: 3600,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data || {}) as {
      tenantId?: string;
      limit?: number;
      dryRun?: boolean;
    };
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    let limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : DEFAULT_LIMIT;
    if (limit < 1) limit = 1;
    if (limit > HARD_MAX_LIMIT) limit = HARD_MAX_LIMIT;

    const dryRun = raw.dryRun === true;

    const skippedBreakdown: Record<string, number> = {};
    const bump = (reason: string) => {
      skippedBreakdown[reason] = (skippedBreakdown[reason] || 0) + 1;
    };

    const fieldPath = `tenantIds.${tenantId}.securityLevel` as const;
    const candidates: Array<{ uid: string; data: Record<string, unknown> }> = [];
    let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
    let scanned = 0;

    while (candidates.length < limit && scanned < MAX_SCAN) {
      let q = db
        .collection('users')
        .where(fieldPath, 'in', TENANT_LISTABLE_SECURITY_LEVELS)
        .orderBy('createdAt', 'desc')
        .limit(QUERY_BATCH);
      if (lastDoc) {
        q = q.startAfter(lastDoc);
      }
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        scanned += 1;
        if (candidates.length >= limit) break;
        const data = doc.data() as Record<string, unknown>;
        const el = await assessEligibility(doc.id, data, tenantId);
        if (el.ok === false) {
          bump(el.reason);
        } else {
          candidates.push({ uid: doc.id, data });
        }
      }
      lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.docs.length < QUERY_BATCH) break;
    }

    const auditId = randomUUID();
    const actorUid = request.auth.uid;

    if (dryRun) {
      const auditPayload = {
        actorUid,
        tenantId,
        dryRun: true,
        limitRequested: limit,
        usersScanned: scanned,
        eligibleCount: candidates.length,
        sentCount: 0,
        skippedCount: scanned - candidates.length,
        skippedBreakdown,
        messageTypeId: MESSAGE_TYPE_ID,
        entry: ENTRY,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.doc(`tenants/${tenantId}/interview_recent_user_backfill_audit/${auditId}`).set(auditPayload);
      logger.info('triggerRecentUserInterviewBackfill.dry_run', {
        tenantId,
        auditId,
        eligibleCount: candidates.length,
        scanned,
      });
      return {
        auditId,
        dryRun: true,
        tenantId,
        limitRequested: limit,
        usersScanned: scanned,
        eligibleCount: candidates.length,
        eligibleUserIds: candidates.map((c) => c.uid),
        skippedBreakdown,
        messageTypeId: MESSAGE_TYPE_ID,
        entry: ENTRY,
      };
    }

    let sent = 0;
    let failed = 0;
    const sendDetails: Array<{ userId: string; outcome: 'sent' | 'failed'; error?: string }> = [];

    for (let i = 0; i < candidates.length; i += SEND_CONCURRENCY) {
      const slice = candidates.slice(i, i + SEND_CONCURRENCY);
      const wave = await Promise.all(
        slice.map(({ uid, data }) =>
          sendOneRecentBackfillCandidate({ uid, data, tenantId, auditId }),
        ),
      );
      for (const w of wave) {
        if (w.kind === 'bump') {
          bump(w.reason);
        } else {
          sendDetails.push(w.detail);
          if (w.detail.error === 'already_backfill_invited') {
            bump('already_backfill_invited');
          }
          if (w.sent) sent += 1;
          if (w.failed) failed += 1;
        }
      }
    }

    const auditPayload = {
      actorUid,
      tenantId,
      dryRun: false,
      limitRequested: limit,
      usersScanned: scanned,
      eligibleCount: candidates.length,
      sentCount: sent,
      failedCount: failed,
      skippedCount: scanned - candidates.length,
      skippedBreakdown,
      messageTypeId: MESSAGE_TYPE_ID,
      entry: ENTRY,
      sendDetails,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.doc(`tenants/${tenantId}/interview_recent_user_backfill_audit/${auditId}`).set(auditPayload);

    logger.info('triggerRecentUserInterviewBackfill.complete', {
      tenantId,
      auditId,
      sent,
      failed,
      scanned,
    });

    return {
      auditId,
      dryRun: false,
      tenantId,
      limitRequested: limit,
      usersScanned: scanned,
      eligibleCount: candidates.length,
      sentCount: sent,
      failedCount: failed,
      skippedBreakdown,
      messageTypeId: MESSAGE_TYPE_ID,
      entry: ENTRY,
      sendDetails,
    };
  },
);
