/**
 * Resend the onboarding payroll setup SMS to a single worker for a single
 * hiring entity. Recruiter / admin-triggered escape hatch — not bound to the
 * scheduler's R1-R5 cadence (so it does NOT touch `onboardingReminderNSentAt`
 * fields and won't suppress / advance future automated reminders).
 *
 * Reuses the same body + URL selection as `processWorkerOnboardingReminders`
 * via `buildOnboardingReminderSmsBody` so the manual surface and the
 * automated cadence produce the exact same SMS for the same worker. For
 * 1099 events workers (today: C1 Events LLC) that means a direct
 * `/c1/workers/payroll/{evereeTenantId}` link with payroll-only copy; for
 * W2 workers it falls back to the My Employment hub URL with the standard
 * "complete I-9 + payroll" copy.
 *
 * Permission: same as I-9 supporting reminder callable —
 * `canManageOnboarding` (HRX or Admin/Recruiter/Manager on this tenant).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { canManageOnboarding } from './workerOnboardingPipeline';
import { sendWorkerMessageInternal } from '../twilio';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { resolveWorkerOnboardingLink } from '../integrations/everee/resolveWorkerOnboardingLink';
import { buildOnboardingReminderSmsBody } from './processWorkerOnboardingReminders';
import { deriveEntityKeyFromName } from './workerOnboardingPipeline';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function firstNameFromUser(ud: Record<string, unknown>): string {
  return (
    String(ud.firstName || (String(ud.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() || 'there'
  );
}

function workerLang(ud: Record<string, unknown>): 'en' | 'es' {
  return String(ud.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
}

function isEventsEntityKey(entityKey: unknown): boolean {
  return String(entityKey || '').trim().toLowerCase() === 'events';
}

export type ResendOnboardingPayrollLinkResult = {
  ok: boolean;
  /** Always echoed back so the client can refresh its UI state (e.g. show "Sent at HH:mm"). */
  pipelineId: string;
  variant: 'standard' | 'events';
  /** Final URL embedded in the SMS — useful for the toast confirmation. */
  link: string;
  /** Set when ok=false; one of: missing_phone, invalid_e164, missing_link, sms_failed, employment_not_found, user_not_found. */
  reason?: string;
  /** Twilio error string when ok=false because of `sms_failed`. */
  twilioError?: string;
};

interface ResendOnboardingPayrollLinkInput {
  tenantId: string;
  userId: string;
  /** Hiring entity id. The scheduler's pipelineId is `userId__entityKey`, but
   *  callers (the `EvereeAdminSyncCard` button) only know the entityId, so
   *  we derive `entityKey` from `tenants/{tid}/entities/{entityId}` and
   *  reconstruct the pipelineId. */
  entityId: string;
}

function parseInput(raw: unknown): ResendOnboardingPayrollLinkInput {
  const obj = (raw || {}) as Record<string, unknown>;
  const tenantId = typeof obj.tenantId === 'string' ? obj.tenantId.trim() : '';
  const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
  const entityId = typeof obj.entityId === 'string' ? obj.entityId.trim() : '';
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (!entityId) throw new HttpsError('invalid-argument', 'entityId is required');
  return { tenantId, userId, entityId };
}

export const resendOnboardingPayrollLink = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request): Promise<ResendOnboardingPayrollLinkResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, userId, entityId } = parseInput(request.data);

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    // Pull the entity doc up front: we need both `entityKey` (to pick variant
    // + reconstruct pipelineId) and `evereeTenantId` (for the direct URL).
    // One read instead of two — `getEvereeConfigForEntity` reads the same
    // doc for the Everee config side.
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
    if (!entitySnap.exists) {
      throw new HttpsError('not-found', `Entity ${entityId} not found on tenant ${tenantId}`);
    }
    const entityData = (entitySnap.data() || {}) as Record<string, unknown>;
    // May 2026 — entity docs created before the `entityKey` migration may be
    // missing this field (we saw it on `c1_events_llc`). Derive it from the
    // entity name (same helper `resolveEntityContext` uses) and backfill so
    // future calls hit the canonical field. Mirrors the fallback in
    // `restartEvereeOnboardingCallable`.
    let entityKey = String(entityData.entityKey || '').trim();
    if (!entityKey) {
      const entityName = String(
        entityData.name || entityData.legalName || entityData.title || '',
      );
      if (!entityName.trim()) {
        throw new HttpsError(
          'failed-precondition',
          `Entity ${entityId} has no entityKey and no name — cannot reconstruct pipelineId`,
        );
      }
      entityKey = deriveEntityKeyFromName(entityName);
      try {
        await entitySnap.ref.update({
          entityKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info('resendOnboardingPayrollLink: backfilled missing entityKey', {
          tenantId,
          entityId,
          entityKey,
          derivedFromName: entityName,
        });
      } catch (e: unknown) {
        logger.warn('resendOnboardingPayrollLink: entityKey backfill failed', {
          tenantId,
          entityId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const pipelineId = `${userId}__${entityKey}`;

    // Sanity-check that the entity_employments doc actually exists; we
    // intentionally don't gate on `onboardingPhase` so a recruiter can
    // re-send to someone whose status is borderline (e.g. just-completed
    // payroll but the worker says they didn't get the link). The scheduler
    // handles the "stop sending once complete" gate; a manual button is a
    // human override.
    const empSnap = await db
      .doc(`tenants/${tenantId}/entity_employments/${pipelineId}`)
      .get();
    if (!empSnap.exists) {
      return {
        ok: false,
        pipelineId,
        variant: 'standard',
        link: '',
        reason: 'employment_not_found',
      };
    }

    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      return {
        ok: false,
        pipelineId,
        variant: 'standard',
        link: '',
        reason: 'user_not_found',
      };
    }
    const userData = (userSnap.data() || {}) as Record<string, unknown>;

    // URL + body variant — kept in lockstep with `sendOnboardingReminderSms`
    // (the scheduler's R1–R5 sender) via the shared
    // `resolveWorkerOnboardingLink` helper. URL: Everee direct for any
    // entity with an `evereeTenantId` (W2 + 1099); My Employment hub
    // fallback when the entity isn't on Everee at all. Body wording: still
    // 'events' for 1099 (no I-9 mention) vs 'standard' for W2.
    const eventsEntity = isEventsEntityKey(entityKey);
    const variant: 'standard' | 'events' = eventsEntity ? 'events' : 'standard';
    const { link } = await resolveWorkerOnboardingLink({
      tenantId,
      entityId,
      pipelineId,
      context: 'resendOnboardingPayrollLink',
    });
    if (!link) {
      return { ok: false, pipelineId, variant, link: '', reason: 'missing_link' };
    }

    if (!userDocHasUsablePhone(userData)) {
      return { ok: false, pipelineId, variant, link, reason: 'missing_phone' };
    }
    const phone = phoneE164FromUser(userData);
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      return { ok: false, pipelineId, variant, link, reason: 'invalid_e164' };
    }
    const lang = workerLang(userData);
    const fn = firstNameFromUser(userData);
    const body = buildOnboardingReminderSmsBody(fn, link, lang, variant);

    const result = await sendWorkerMessageInternal(phone, body, {
      systemContext: true,
      tenantId,
      userId,
      messageTypeId: 'onboarding_reminder',
      source: 'onboarding_reminder_manual_resend',
      // Distinct from the scheduler's `${pipelineId}__r{N}` so audit logs
      // can tell automated cadence reminders apart from manual resends at
      // a glance. Includes initiating recruiter uid for accountability.
      sourceId: `${pipelineId}__manual__${request.auth.uid}`,
    });

    // Audit row mirrors the scheduler's so a single query against
    // `onboarding_reminder_audit` shows the whole conversation history per
    // worker (automated + manual). Reminder number 0 = manual; never used
    // by the scheduler so it's a safe sentinel.
    try {
      await db.collection(`tenants/${tenantId}/onboarding_reminder_audit`).add({
        userId,
        entityEmploymentId: pipelineId,
        entityId,
        entityKey,
        reminderNumber: 0,
        messageType: 'onboarding_reminder',
        source: 'manual_resend',
        initiatedByUid: request.auth.uid,
        variant,
        success: result.success,
        error: result.success ? null : result.error || result.status || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e: unknown) {
      logger.warn('resendOnboardingPayrollLink: audit write failed', {
        tenantId,
        userId,
        pipelineId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (!result.success) {
      return {
        ok: false,
        pipelineId,
        variant,
        link,
        reason: 'sms_failed',
        twilioError: result.error || result.status || 'unknown',
      };
    }
    return { ok: true, pipelineId, variant, link };
  },
);
