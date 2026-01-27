/**
 * System / Programmatic SMS (Plan B Phase 1)
 *
 * Queue-first: create thread + log + smsOutboundRequest (Cloud Tasks worker sends).
 *
 * Guardrails:
 * - System/programmatic only (do NOT migrate MessageDrawer).
 * - Only enqueue when phoneE164 exists AND user is Worker/Applicant for the tenant.
 * - Dedupe welcome message for 72h via dedupeKey welcome:{tenantId}:{userId}
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { createOutboundRequest } from './smsOutboundQueue';
import { getOrCreateThreadForUser } from './twoWayMessaging';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const SYSTEM_WELCOME_MESSAGE_TYPE_ID = 'system_onboarding_welcome';

function normalizeRole(val: any): string {
  return String(val || '').trim().toLowerCase();
}

function isWorkerOrApplicantForTenant(userData: any, tenantId: string): boolean {
  const directRole = normalizeRole(userData?.role);
  if (directRole === 'worker' || directRole === 'applicant') return true;

  const tenantRole = normalizeRole(userData?.tenantIds?.[tenantId]?.role);
  if (tenantRole === 'worker' || tenantRole === 'applicant') return true;

  // Back-compat: some records may store as "Candidate"
  if (directRole === 'candidate' || tenantRole === 'candidate') return true;

  // Fallback: security level 1-2 is typically worker/applicant; only use if tenantIds exists
  const sec = String(userData?.tenantIds?.[tenantId]?.securityLevel || '').trim();
  if (sec === '1' || sec === '2') return true;

  return false;
}

function getTenantIdForUser(userData: any): string | null {
  return (
    userData?.tenantId ||
    userData?.activeTenantId ||
    (userData?.tenantIds && typeof userData.tenantIds === 'object' ? Object.keys(userData.tenantIds)[0] : null) ||
    null
  );
}

async function hasRecentWelcomeDedupe(tenantId: string, dedupeKey: string, windowHours = 72): Promise<boolean> {
  const cutoff = Timestamp.fromMillis(Date.now() - windowHours * 60 * 60 * 1000);
  const snap = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('smsOutboundRequests')
    .where('dedupeKey', '==', dedupeKey)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return false;
  const data = snap.docs[0].data() as any;
  const createdAt = data?.createdAt as admin.firestore.Timestamp | undefined;
  if (!createdAt?.toMillis) return true; // If unknown, err on safe side
  return createdAt.toMillis() >= cutoff.toMillis();
}

export async function enqueueSystemWelcomeSms(params: {
  tenantId?: string;
  userId: string;
  phoneE164?: string;
  userData?: any;
  messageBody?: string;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string; requestId?: string; threadId?: string; messageLogId?: string }> {
  const resolvedTenantId = params.tenantId || getTenantIdForUser(params.userData);
  if (!resolvedTenantId) {
    return { ok: false, skipped: true, reason: 'Missing tenantId for user' };
  }

  const phoneE164 = (params.phoneE164 || params.userData?.phoneE164 || '').trim();
  if (!phoneE164) {
    return { ok: false, skipped: true, reason: 'Missing phoneE164' };
  }

  if (!isWorkerOrApplicantForTenant(params.userData || {}, resolvedTenantId)) {
    return { ok: false, skipped: true, reason: 'User is not Worker/Applicant for tenant' };
  }

  const dedupeKey = `welcome:${resolvedTenantId}:${params.userId}`;
  const windowHours = 72;
  if (await hasRecentWelcomeDedupe(resolvedTenantId, dedupeKey, windowHours)) {
    return { ok: true, skipped: true, reason: 'Welcome SMS deduped (72h window)' };
  }

  const body =
    (params.messageBody || '').trim() ||
    "Thanks for signing up with C1 Staffing — we’re excited to help you find your next opportunity.";

  // Prefer a fixed Twilio number so replies map to the same thread.
  const twilioNumber = (process.env.TWILIO_MESSAGING_PHONE_NUMBER || '').trim();
  const twilioMasked = twilioNumber ? `***${twilioNumber.replace(/[^\d]/g, '').slice(-4)}` : '(unset)';
  logger.info('[SMS] Welcome enqueue runtime config', {
    tenantId: resolvedTenantId,
    mode: process.env.SMS_PROVIDER ?? 'mock',
    from: twilioMasked,
  });

  let threadId: string | undefined;
  if (twilioNumber) {
    try {
      threadId = await getOrCreateThreadForUser({
        tenantId: resolvedTenantId,
        userId: params.userId,
        phoneE164,
        twilioNumber,
        primaryRecruiterId: null,
      });
    } catch (err: any) {
      logger.warn('Failed to get/create SMS thread for welcome message; proceeding without thread', {
        tenantId: resolvedTenantId,
        userId: params.userId,
        error: err?.message,
      });
    }
  } else {
    logger.warn('TWILIO_MESSAGING_PHONE_NUMBER not set; welcome SMS will not be reply-threaded');
  }

  // Create initial message log (queued)
  const logRef = db
    .collection('tenants')
    .doc(resolvedTenantId)
    .collection('messageLogs')
    .doc();

  await logRef.set({
    tenantId: resolvedTenantId,
    userId: params.userId,
    threadId,
    messageTypeId: SYSTEM_WELCOME_MESSAGE_TYPE_ID,
    channel: 'sms',
    direction: 'outbound',
    fromIdentity: 'system',
    contentOriginal: body,
    contentSent: body,
    language: null,
    status: 'queued',
    createdAt: FieldValue.serverTimestamp(),
  });

  const requestId = await createOutboundRequest({
    tenantId: resolvedTenantId,
    threadId,
    recipientUserId: params.userId,
    toPhoneE164: phoneE164,
    fromPhoneE164: twilioNumber || undefined,
    body,
    templateId: SYSTEM_WELCOME_MESSAGE_TYPE_ID,
    messageTypeId: SYSTEM_WELCOME_MESSAGE_TYPE_ID,
    source: 'automation',
    messageLogId: logRef.id,
    dedupeKey,
    dedupeWindowHours: windowHours,
    metadata: {
      // Keep minimal for Phase 1
    },
  });

  // Attach request id for observability (best-effort; schema is flexible)
  await logRef.set({ smsRequestId: requestId }, { merge: true });

  logger.info('Enqueued system welcome SMS', {
    tenantId: resolvedTenantId,
    userId: params.userId,
    threadId,
    requestId,
    dedupeKey,
  });

  return { ok: true, requestId, threadId, messageLogId: logRef.id };
}

