/**
 * Recruiter profile: one-tap SMS with AI pre-screen interview link (same body pipeline as group interview invites).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { CALLABLE_BROWSER_CORS } from './integrations/callableBrowserCors';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import { sendWorkerMessageInternal } from './twilio';
import { buildWorkerAiPrescreenInviteUrl } from './utils/workerUrls';
import {
  buildInterviewInviteSmsBody,
  firstNameFromUser,
  phoneE164FromUser,
  workerInterviewInviteLang,
} from './recruiter/userGroupInterviewInviteValidation';
import { recruiterProfileOrderInterviewSmsInCooldown } from './workerAiPrescreen/interviewInviteCooldown';
import { scanInterviewsSubcollectionForWorkerAiPrescreen } from './workerAiPrescreen/hasWorkerAiPrescreenDenormalized';

function getMaxSecurityLevel(userData: Record<string, unknown>): number {
  const levels: number[] = [];
  const topLevel = Number.parseInt(String(userData?.securityLevel ?? '0'), 10);
  if (Number.isFinite(topLevel)) levels.push(topLevel);
  const tenantIds = userData?.tenantIds;
  if (tenantIds && typeof tenantIds === 'object') {
    Object.values(tenantIds as Record<string, unknown>).forEach((entry: unknown) => {
      const level = Number.parseInt(String((entry as { securityLevel?: unknown })?.securityLevel ?? '0'), 10);
      if (Number.isFinite(level)) levels.push(level);
    });
  }
  return levels.length > 0 ? Math.max(...levels) : 0;
}

function maxTenantSecurityLevel(userData: Record<string, unknown>, tenantId: string): number {
  const top = Number.parseInt(String(userData.securityLevel ?? '0'), 10);
  const t = userData.tenantIds as Record<string, { securityLevel?: string | number }> | undefined;
  const te = Number.parseInt(String(t?.[tenantId]?.securityLevel ?? '0'), 10);
  return Math.max(Number.isFinite(top) ? top : 0, Number.isFinite(te) ? te : 0);
}

async function tenantOutreachEnabled(tenantId: string): Promise<boolean> {
  try {
    const db = admin.firestore();
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (snap.data()?.workerAiPrescreenOutreachEnabled === false) return false;
  } catch {
    /* fail open */
  }
  return true;
}

async function resolveApplicationIdForUser(
  db: admin.firestore.Firestore,
  uid: string,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  try {
    const apps = await db.collection(`tenants/${tenantId}/applications`).where('userId', '==', uid).limit(3).get();
    if (!apps.empty) return apps.docs[0].id;
  } catch {
    /* continue */
  }
  const tids: string[] = [tenantId];
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

export const sendWorkerOrderInterviewSms = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request) => {
    const actorUid = request.auth?.uid;
    const targetUid = String(request.data?.uid || '').trim();
    const tenantId = String(request.data?.tenantId || '').trim();

    if (!actorUid) throw new HttpsError('unauthenticated', 'You must be signed in.');
    if (!targetUid) throw new HttpsError('invalid-argument', 'Missing uid.');
    if (!tenantId) throw new HttpsError('invalid-argument', 'Missing tenantId.');

    const db = admin.firestore();
    const [actorSnap, targetSnap] = await Promise.all([
      db.collection('users').doc(actorUid).get(),
      db.collection('users').doc(targetUid).get(),
    ]);

    if (!targetSnap.exists) throw new HttpsError('not-found', 'Target user not found.');

    const actorLevel = getMaxSecurityLevel((actorSnap.exists ? actorSnap.data() : {}) as Record<string, unknown>);
    if (actorLevel < 5 || actorLevel > 7) {
      throw new HttpsError('permission-denied', 'Only security levels 5–7 can send interview order SMS.');
    }

    const fd = targetSnap.data() as Record<string, unknown>;

    if (maxTenantSecurityLevel(fd, tenantId) >= 5) {
      throw new HttpsError('failed-precondition', 'Cannot send interview invite to internal/staff accounts.');
    }

    if (!(await tenantOutreachEnabled(tenantId))) {
      throw new HttpsError('failed-precondition', 'Interview outreach is disabled for this tenant.');
    }

    if (fd.hasWorkerAiPrescreenInterview === true) {
      throw new HttpsError('failed-precondition', 'This worker already completed an AI pre-screen interview.');
    }
    if (String(fd.interviewStatus || '') === 'completed') {
      throw new HttpsError('failed-precondition', 'Interview is already marked completed for this worker.');
    }
    if (await scanInterviewsSubcollectionForWorkerAiPrescreen(targetSnap.ref)) {
      throw new HttpsError('failed-precondition', 'This worker already has a worker AI pre-screen on file.');
    }
    if (recruiterProfileOrderInterviewSmsInCooldown(fd)) {
      throw new HttpsError(
        'resource-exhausted',
        'You already sent an interview invite from this profile in the last 24 hours. Try again after that window.',
      );
    }
    if (fd.smsOptIn === false || fd.smsBlockedSystem === true) {
      throw new HttpsError('failed-precondition', 'This worker cannot receive SMS (opt-out or block).');
    }

    const phoneLive = phoneE164FromUser(fd);
    if (!phoneLive || !/^\+[1-9]\d{7,14}$/.test(phoneLive)) {
      throw new HttpsError('failed-precondition', 'User does not have a valid phone number for SMS.');
    }

    const applicationId = await resolveApplicationIdForUser(db, targetUid, tenantId, fd);
    const url = buildWorkerAiPrescreenInviteUrl({
      applicationId,
      entry: 'recruiter_profile_order_interview',
    });
    const fn = firstNameFromUser(fd);
    const lang = workerInterviewInviteLang(fd);
    const body = buildInterviewInviteSmsBody(fn, applicationId || '', url, lang);

    const sms = await sendWorkerMessageInternal(phoneLive, body, {
      tenantId,
      userId: targetUid,
      source: 'recruiter',
      sourceId: actorUid,
      messageTypeId: 'recruiter_profile_order_interview',
      systemContext: true,
    });

    const sentAt = admin.firestore.Timestamp.now();

    if (!sms.success) {
      throw new HttpsError('internal', sms.error || 'Failed to send interview SMS.');
    }

    await db.doc(`users/${targetUid}`).set(
      {
        interviewStatus: 'invited',
        interviewInviteSentAt: sentAt,
        lastInterviewInvitedAt: sentAt,
        interviewSource: 'recruiter_profile_order',
        recruiterOrderInterviewSmsLastSentAt: sentAt,
        recruiterOrderInterviewSmsLastSentBy: actorUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (applicationId) {
      try {
        await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
          {
            ...scheduleInterviewChaseFields(sentAt),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        /* best-effort */
      }
    }

    try {
      await db.collection('users').doc(targetUid).collection('activityLogs').add({
        action: 'Order Interview SMS',
        actionType: 'sms_sent',
        description: `AI pre-screen interview invite SMS sent (${fn || 'worker'})`,
        severity: 'medium',
        source: 'system',
        metadata: {
          reminderType: 'recruiter_order_interview',
          sentByUserId: actorUid,
          tenantId,
          applicationId: applicationId || null,
          phoneE164: phoneLive,
        },
        timestamp: sentAt,
        createdAt: sentAt,
      });
    } catch {
      /* best-effort */
    }

    return {
      success: true,
      sentAt: sentAt.toDate().toISOString(),
    };
  },
);
