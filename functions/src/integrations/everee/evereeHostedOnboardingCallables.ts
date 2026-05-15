/**
 * Everee hosted-onboarding remediation callables.
 *
 * **Background (May 14, 2026 incident — Andrew Freeman, c1_select_llc):**
 *   Everee's anti-fraud engine flips `accountAccessPermitted` to `false` on
 *   workers whose `externalWorkerId` produces a burst of embedded session
 *   creates (we observed 12 in 36h, including 3-in-30s clusters). Once the
 *   flag flips, every embed-session URL we mint renders the iframe message
 *   "Your onboarding has been locked due to a possible security risk.
 *   Please contact your payroll administrator to re-send your onboarding
 *   information." inside the worker's app. We have no API to clear the
 *   flag (Everee admin-only).
 *
 *   The escape hatch Everee documents is the **hosted** account-setup flow:
 *
 *     GET /integration/v1/workers/onboarding-access-details
 *       ?external-worker-id=<HRX_UID>
 *
 *   That returns a fresh `https://app.everee.com/account-setup/<token>?...`
 *   URL. The hosted flow uses a different signing context than the embed
 *   tokens, and in our incident it was the only path that consistently
 *   bypassed the lock. Per Everee's docs, this URL is intended for the
 *   Everee-branded web/mobile apps, NOT the embedded iframe — workers
 *   complete onboarding in Everee's UI; webhooks land in our backend
 *   normally.
 *
 * **Two callables here:**
 *
 *   1. `evereeGetHostedOnboardingUrl` — admin-only read. Returns a fresh
 *      hosted URL for the worker. Used by the admin UI to display a
 *      "Send hosted link" affordance.
 *
 *   2. `evereeSendHostedOnboardingLink` — admin-only write. Mints a fresh
 *      URL, SMSes it to the worker via the same Twilio path the
 *      `processWorkerOnboardingReminders` scheduler uses, writes an audit
 *      row to `tenants/{tid}/onboarding_reminder_audit`. Mirrors the
 *      one-shot `functions/.scratch/sendAndrewEvereeHostedUrl20260514.js`
 *      script but with proper auth and audit fields.
 *
 *   Both gates use `canManageOnboarding` (HRX or Admin/Recruiter/Manager
 *   on this tenant), matching `restartEvereeOnboarding` and
 *   `resendOnboardingPayrollLink`.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../callableBrowserCors';
import { canManageOnboarding } from '../../onboarding/workerOnboardingPipeline';
import { sendWorkerMessageInternal } from '../../twilio';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../../messaging/twilioSecrets';
import { getEvereeConfigForEntity, requireEvereeEnabledEntity } from './evereeConfig';
import { evereeRequest } from './evereeHttp';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface HostedUrlInput {
  tenantId: string;
  entityId: string;
  userId: string;
}

function parseHostedUrlInput(raw: unknown): HostedUrlInput {
  const obj = (raw || {}) as Record<string, unknown>;
  const tenantId = typeof obj.tenantId === 'string' ? obj.tenantId.trim() : '';
  const entityId = typeof obj.entityId === 'string' ? obj.entityId.trim() : '';
  const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  if (!entityId) throw new HttpsError('invalid-argument', 'entityId is required');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  return { tenantId, entityId, userId };
}

/**
 * Calls the Everee `onboarding-access-details` endpoint for a worker by
 * their HRX UID (== Everee `externalWorkerId`). Returns the hosted URL.
 *
 * Throws `HttpsError('not-found')` if the worker doesn't exist in Everee
 * (typically means we never created the shell — caller should hit
 * `evereeEnsureWorker` first).
 */
async function fetchHostedOnboardingUrl(input: {
  tenantId: string;
  entityId: string;
  userId: string;
}): Promise<{ url: string; evereeTenantId: string }> {
  const config = await getEvereeConfigForEntity(input.tenantId, input.entityId);
  if (!config) {
    throw new HttpsError(
      'failed-precondition',
      `Everee not configured for entity ${input.entityId} on tenant ${input.tenantId}`,
    );
  }
  const path = `/integration/v1/workers/onboarding-access-details?external-worker-id=${encodeURIComponent(input.userId)}`;
  let response: unknown;
  try {
    response = await evereeRequest<unknown>(config, 'GET', path);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[evereeGetHostedOnboardingUrl] Everee request failed', {
      tenantId: input.tenantId,
      entityId: input.entityId,
      userId: input.userId,
      evereeTenantId: config.evereeTenantId,
      status,
      message: msg,
    });
    if (status === 404) {
      throw new HttpsError(
        'not-found',
        'Worker is not provisioned in Everee yet. Sync the worker first.',
      );
    }
    throw new HttpsError(
      'failed-precondition',
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Everee request failed',
    );
  }
  const url =
    typeof (response as Record<string, unknown> | null)?.onboardingUrl === 'string'
      ? ((response as Record<string, unknown>).onboardingUrl as string)
      : '';
  if (!url) {
    logger.error('[evereeGetHostedOnboardingUrl] no url in response', {
      tenantId: input.tenantId,
      entityId: input.entityId,
      userId: input.userId,
      response,
    });
    throw new HttpsError('internal', 'Everee returned no onboardingUrl');
  }
  return { url, evereeTenantId: config.evereeTenantId };
}

/**
 * Read-only: returns a fresh hosted-onboarding URL for a worker. Each call
 * mints a new short-lived token at Everee, so this is safe to call
 * repeatedly (e.g. when the admin re-opens the panel).
 */
export const evereeGetHostedOnboardingUrl = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, entityId, userId } = parseHostedUrlInput(request.data);
    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }
    await requireEvereeEnabledEntity(tenantId, entityId);
    const { url, evereeTenantId } = await fetchHostedOnboardingUrl({
      tenantId,
      entityId,
      userId,
    });
    return {
      ok: true,
      hostedUrl: url,
      evereeTenantId,
    };
  },
);

/* ----------------------------------------------------------------------- */
/* Send hosted-onboarding URL via SMS                                      */
/* ----------------------------------------------------------------------- */

interface SendHostedLinkInput extends HostedUrlInput {
  /** Optional override of the SMS body. When omitted we use the default. */
  customMessage?: string | null;
}

function parseSendHostedLinkInput(raw: unknown): SendHostedLinkInput {
  const base = parseHostedUrlInput(raw);
  const obj = (raw || {}) as Record<string, unknown>;
  const customMessage =
    typeof obj.customMessage === 'string' && obj.customMessage.trim()
      ? obj.customMessage.trim()
      : null;
  return { ...base, customMessage };
}

function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function pickFirstName(data: FirebaseFirestore.DocumentData | undefined): string {
  if (!data) return 'there';
  if (typeof data.firstName === 'string' && data.firstName.trim()) {
    return data.firstName.trim();
  }
  if (typeof data.displayName === 'string' && data.displayName.trim()) {
    return data.displayName.trim().split(/\s+/)[0];
  }
  return 'there';
}

function buildHostedLinkSmsBody(firstName: string, hostedUrl: string): string {
  // Keep this body intentionally short — the URL itself is ~150 chars and we
  // want the whole message to fit in one segment when carriers don't shove
  // it into MMS. Tone matches the scheduler's onboarding-reminder bodies.
  return (
    `Hi ${firstName}, this is C1 Staffing payroll. We've issued a fresh ` +
    `Everee onboarding link for you. Please open it on a single device and ` +
    `complete it in one sitting if you can: ${hostedUrl}`
  );
}

/**
 * Mint a fresh hosted URL and SMS it to the worker. Writes an audit row so
 * the reminder scheduler / ops dashboards can see it landed and so we don't
 * SMS-spam the same worker on repeat clicks.
 *
 * Result fields:
 *   - `ok`: true on success, false on a recoverable failure (missing phone,
 *     invalid e164, twilio error). Throws only on auth / config / Everee
 *     errors.
 *   - `reason`: when `ok=false`, one of `missing_phone | invalid_e164 |
 *     twilio_failed | user_not_found`.
 *   - `hostedUrl`: the URL we minted (returned even when SMS failed so the
 *     admin can copy/paste manually).
 *   - `twilioSid` / `auditRefPath`: included on success.
 */
export const evereeSendHostedOnboardingLink = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    secrets: [
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      TWILIO_MESSAGING_PHONE_NUMBER,
      TWILIO_A2P_CAMPAIGN,
    ],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, entityId, userId, customMessage } = parseSendHostedLinkInput(request.data);
    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }
    await requireEvereeEnabledEntity(tenantId, entityId);

    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      return { ok: false, reason: 'user_not_found', hostedUrl: null };
    }
    const userData = userSnap.data() ?? {};
    const phone = normalizeE164(userData.phoneE164 ?? userData.phone);
    if (!phone) {
      return { ok: false, reason: 'missing_phone', hostedUrl: null };
    }

    const { url: hostedUrl, evereeTenantId } = await fetchHostedOnboardingUrl({
      tenantId,
      entityId,
      userId,
    });
    const firstName = pickFirstName(userData);
    const body = customMessage || buildHostedLinkSmsBody(firstName, hostedUrl);

    const sendResult = await sendWorkerMessageInternal(phone, body, {
      systemContext: true,
      tenantId,
      userId,
      messageTypeId: 'onboarding_hosted_url',
      source: 'evereeSendHostedOnboardingLink',
      sourceId: `${entityId}__${userId}__${request.auth.uid}__${Date.now()}`,
    });

    if (!sendResult.success) {
      logger.warn('[evereeSendHostedOnboardingLink] twilio send failed', {
        tenantId,
        entityId,
        userId,
        evereeTenantId,
        phone,
        error: sendResult.error,
      });
      return {
        ok: false,
        reason: 'twilio_failed',
        twilioError: sendResult.error ?? null,
        hostedUrl,
      };
    }

    const twilioSid = sendResult.messageId ?? null;
    const auditRef = await db
      .collection(`tenants/${tenantId}/onboarding_reminder_audit`)
      .add({
        tenantId,
        userId,
        entityId,
        evereeTenantId,
        channel: 'sms',
        to: phone,
        bodyPreview: body.slice(0, 160),
        hostedUrl,
        // Out-of-band cadence — keeps these out of the standard R1..R5 lane.
        reminderNumber: 0,
        source: 'evereeSendHostedOnboardingLink',
        triggeredByUid: request.auth.uid,
        twilioSid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

    return {
      ok: true,
      hostedUrl,
      twilioSid,
      auditRefPath: auditRef.path,
    };
  },
);
