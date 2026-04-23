/**
 * Phase 5: recruiter / manager override for `users/{uid}.avatarVerification`.
 *
 * Supported decisions:
 *   - 'approve'           — flip to status='approved' (clears the Phase 4 Accept-shift gate).
 *   - 'reject'            — flip to status='rejected' with rejectionReason='manual_override'.
 *   - 'request_reupload'  — same as 'reject' + nudge the worker (in-app notification AND SMS
 *                           via the existing outbound-request queue).
 *
 * The prior automated decision is stashed in `previousAutoDecision` the first time a recruiter
 * flips away from it, so the UI can render a "recruiter overrode auto-<x>" badge and we don't
 * lose the Vision signal. Once the worker reuploads, the trigger clears this via
 * avatarVerificationTrigger's echo logic.
 *
 * The worker's `preferredLanguage` (en/es) drives the SMS + notification copy. We keep the
 * English/Spanish strings inline here so this module stays independent of the React i18n
 * bundles — the same keys should exist on the client, but the server must not depend on the
 * client translation loader to decide what to send.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';

import { assertCallerCanManageAvatarTarget, toTenantIdSet } from './avatarAdminPerms';
import type { AvatarRejectionReason, AvatarVerificationStatus } from './avatarVerificationTypes';
import { createOutboundRequest } from '../messaging/smsOutboundQueue';
import { getOrCreateThreadForUser } from '../messaging/twoWayMessaging';
import { createNotification } from '../utils/createNotification';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type AvatarAdminDecision = 'approve' | 'reject' | 'request_reupload';
type WorkerLanguage = 'en' | 'es';

interface SetAvatarVerificationDecisionRequest {
  userId: string;
  decision: AvatarAdminDecision;
  /** Free-form recruiter note (why the override was made). Trimmed + capped at 500 chars. */
  overrideNote?: string;
  /**
   * Optional explicit tenantId. When omitted we pick the worker's active tenant so the SMS
   * nudge goes out under the right Twilio sender / messaging service. Required when the
   * worker doc has more than one tenant and the caller wants to force the channel.
   */
  tenantId?: string;
}

interface SetAvatarVerificationDecisionResponse {
  status: AvatarVerificationStatus;
  rejectionReason: AvatarRejectionReason | null;
  verifiedBy: string;
  nudge?: {
    inAppCreated: boolean;
    smsQueued: boolean;
    smsSkipReason?: string;
  };
}

const OVERRIDE_NOTE_MAX = 500;

/** Worker-facing in-app + SMS copy. Kept short — SMS segments cap at 160 GSM-7 chars. */
const REUPLOAD_COPY: Record<WorkerLanguage, { inApp: string; sms: string }> = {
  en: {
    inApp: 'Please retake your profile photo to keep accepting shifts.',
    sms: 'C1 Staffing: Please retake your profile photo so you can accept shifts. Open the app to upload a new photo.',
  },
  es: {
    inApp: 'Por favor toma una nueva foto de tu perfil para seguir aceptando turnos.',
    sms: 'C1 Staffing: Por favor toma una nueva foto de tu perfil para poder aceptar turnos. Abre la app para subir una nueva foto.',
  },
};

export const setAvatarVerificationDecision = onCall<
  SetAvatarVerificationDecisionRequest,
  Promise<SetAvatarVerificationDecisionResponse>
>(
  { cors: true, region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Sign-in required.');

    const targetUserId = String(request.data?.userId || '').trim();
    const decision = request.data?.decision;
    const overrideNote = String(request.data?.overrideNote || '').trim().slice(0, OVERRIDE_NOTE_MAX);

    if (!targetUserId) throw new HttpsError('invalid-argument', 'userId is required.');
    if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_reupload') {
      throw new HttpsError(
        'invalid-argument',
        "decision must be one of 'approve' | 'reject' | 'request_reupload'.",
      );
    }
    if (targetUserId === callerUid) {
      // Prevent a recruiter from self-approving their own photo via this endpoint. Workers
      // route through the automatic `onUserAvatarChangedVerify` trigger instead.
      throw new HttpsError(
        'failed-precondition',
        'Self-approval is not allowed. Upload a new photo to re-run automated verification.',
      );
    }

    const targetRef = db.doc(`users/${targetUserId}`);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const targetData = targetSnap.data() as Record<string, unknown>;

    await assertCallerCanManageAvatarTarget(callerUid, targetData);

    const prior = (targetData.avatarVerification ?? null) as
      | {
          status?: AvatarVerificationStatus;
          rejectionReason?: AvatarRejectionReason | null;
          verifiedBy?: string;
          previousAutoDecision?: {
            status: AvatarVerificationStatus;
            rejectionReason: AvatarRejectionReason | null;
          };
        }
      | null;

    // Stash the auto decision the first time a recruiter flips away from it, so the UI can
    // show "recruiter overrode auto-<x>" without losing the Vision signal. If an override is
    // already in place (previousAutoDecision set), keep the existing one.
    const shouldStashPrevious =
      prior &&
      prior.verifiedBy === 'system' &&
      !prior.previousAutoDecision &&
      (prior.status === 'approved' || prior.status === 'rejected' || prior.status === 'error');

    const nextStatus: AvatarVerificationStatus = decision === 'approve' ? 'approved' : 'rejected';
    const nextRejection: AvatarRejectionReason | null =
      decision === 'approve' ? null : 'manual_override';

    const record: Record<string, unknown> = {
      status: nextStatus,
      rejectionReason: nextRejection,
      verifiedBy: callerUid,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      overrideNote: overrideNote || FieldValue.delete(),
      // Approve clears any lingering error fields; reject/request_reupload leave them alone
      // since they're not meaningful when status === 'rejected'.
      ...(decision === 'approve'
        ? {
            errorCode: FieldValue.delete(),
            errorMessage: FieldValue.delete(),
          }
        : {}),
    };

    if (shouldStashPrevious && prior) {
      record.previousAutoDecision = {
        status: prior.status as AvatarVerificationStatus,
        rejectionReason: (prior.rejectionReason ?? null) as AvatarRejectionReason | null,
      };
    }

    await targetRef.set({ avatarVerification: record }, { merge: true });

    logger.info('avatar_verification.manual_decision', {
      callerUid,
      targetUserId,
      decision,
      priorStatus: prior?.status ?? null,
      stashedPrevious: Boolean(shouldStashPrevious),
    });

    // Fire the nudge only on `request_reupload` — 'approve' and plain 'reject' are silent
    // (recruiter can follow up out-of-band; plain 'reject' is usually a cleanup action).
    let nudge: SetAvatarVerificationDecisionResponse['nudge'];
    if (decision === 'request_reupload') {
      nudge = await sendReuploadNudge({
        callerUid,
        targetUserId,
        targetData,
        explicitTenantId: request.data?.tenantId,
      });
    }

    return {
      status: nextStatus,
      rejectionReason: nextRejection,
      verifiedBy: callerUid,
      nudge,
    };
  },
);

/**
 * Writes an in-app notification AND enqueues an outbound SMS via the existing pipeline so
 * quiet-hours / opt-in gating all stays in one place. Either channel failing is logged and
 * returned as a skipReason but does NOT unwind the Firestore status flip — the recruiter's
 * intent stands regardless of delivery hiccups.
 */
async function sendReuploadNudge(params: {
  callerUid: string;
  targetUserId: string;
  targetData: Record<string, unknown>;
  explicitTenantId?: string;
}): Promise<SetAvatarVerificationDecisionResponse['nudge']> {
  const { callerUid, targetUserId, targetData, explicitTenantId } = params;
  const lang: WorkerLanguage = resolveWorkerLanguage(targetData);
  const copy = REUPLOAD_COPY[lang];

  let inAppCreated = false;
  try {
    await createNotification({
      recipientType: 'user',
      recipientId: targetUserId,
      type: 'avatar_reupload_request',
      message: copy.inApp,
      actions: ['retake_profile_photo'],
      relatedId: callerUid,
    });
    inAppCreated = true;
  } catch (err: unknown) {
    logger.warn('avatar_verification.in_app_notification_failed', {
      targetUserId,
      error: (err as { message?: string })?.message ?? String(err),
    });
  }

  const tenantId = explicitTenantId || resolvePrimaryTenant(targetData);
  if (!tenantId) {
    return { inAppCreated, smsQueued: false, smsSkipReason: 'no_tenant_for_sms' };
  }

  const phoneE164 = String((targetData as { phoneE164?: unknown }).phoneE164 || '').trim();
  if (!phoneE164) {
    return { inAppCreated, smsQueued: false, smsSkipReason: 'no_phone_on_record' };
  }

  const smsOptIn = extractSmsOptIn(targetData);
  if (!smsOptIn) {
    return { inAppCreated, smsQueued: false, smsSkipReason: 'worker_has_not_opted_in_to_sms' };
  }

  const twilioNumber = (process.env.TWILIO_MESSAGING_PHONE_NUMBER || '').trim();
  let threadId: string | undefined;
  if (twilioNumber) {
    try {
      threadId = await getOrCreateThreadForUser({
        tenantId,
        userId: targetUserId,
        phoneE164,
        twilioNumber,
        primaryRecruiterId: null,
      });
    } catch (err) {
      logger.warn('avatar_verification.thread_resolve_failed_continuing', {
        tenantId,
        targetUserId,
        error: (err as { message?: string })?.message,
      });
    }
  }

  try {
    await createOutboundRequest({
      tenantId,
      threadId,
      recipientUserId: targetUserId,
      toPhoneE164: phoneE164,
      fromPhoneE164: twilioNumber || undefined,
      body: copy.sms,
      templateId: 'avatar_reupload_request',
      messageTypeId: 'avatar_reupload_request',
      source: 'automation',
      requestedByUid: callerUid,
      // Dedupe identical nudges within 24h — recruiters sometimes click twice, and we don't
      // want to rack up duplicate SMS under the worker's carrier-deliverability ledger.
      dedupeKey: `avatar_reupload:${tenantId}:${targetUserId}`,
      dedupeWindowHours: 24,
    });
    return { inAppCreated, smsQueued: true };
  } catch (err: unknown) {
    logger.warn('avatar_verification.sms_enqueue_failed', {
      tenantId,
      targetUserId,
      error: (err as { message?: string })?.message ?? String(err),
    });
    return { inAppCreated, smsQueued: false, smsSkipReason: 'sms_enqueue_error' };
  }
}

function resolveWorkerLanguage(userData: Record<string, unknown>): WorkerLanguage {
  const pref = String((userData as { preferredLanguage?: unknown }).preferredLanguage || '')
    .trim()
    .toLowerCase();
  return pref === 'es' ? 'es' : 'en';
}

function resolvePrimaryTenant(userData: Record<string, unknown>): string | null {
  const direct = (userData as { tenantId?: unknown }).tenantId;
  if (typeof direct === 'string' && direct) return direct;
  const active = (userData as { activeTenantId?: unknown }).activeTenantId;
  if (typeof active === 'string' && active) return active;
  const ids = toTenantIdSet(userData);
  return ids.size > 0 ? [...ids][0] : null;
}

/**
 * Checks whether the worker has opted in to SMS, respecting both the explicit `smsOptIn`
 * flag and the `notificationSettings.smsNotifications` toggle. Either being true is enough;
 * both being falsy means we skip SMS (TCPA hygiene).
 */
function extractSmsOptIn(userData: Record<string, unknown>): boolean {
  const flat = (userData as { smsOptIn?: unknown }).smsOptIn;
  if (flat === true) return true;
  const settings = (userData as { notificationSettings?: { smsNotifications?: unknown } })
    .notificationSettings;
  if (settings && settings.smsNotifications === true) return true;
  return false;
}
