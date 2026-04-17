/**
 * Admin-triggered backfill: SMS interview invites for all group members who have not completed
 * an interview, with re-invite cooldown via `lastInterviewInvitedAt` / `lastInterviewCompletedAt` (see interviewInviteCooldown).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
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
import {
  buildInterviewInviteSmsBody,
  firstNameFromUser,
  phoneE164FromUser,
  workerInterviewInviteLang,
} from './userGroupInterviewInviteValidation';
import { userInInterviewReinviteCooldown } from '../workerAiPrescreen/interviewInviteCooldown';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const USER_READ_CHUNK = 10;
const SMS_CONCURRENCY = 5;
/** Avoid HTTPS timeout on huge groups; re-run the callable to process more. */
const MAX_INVITES_PER_CALL = 350;

/** Dedupe key pattern: interview_invite__group__{groupId}user{uid} */
function groupUserDedupeKey(groupId: string, uid: string): string {
  return `interview_invite__group__${groupId}user${uid}`;
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

function maxTenantSecurityLevel(userData: Record<string, unknown>, tenantId: string): number {
  const top = Number.parseInt(String(userData.securityLevel ?? '0'), 10);
  const t = userData.tenantIds as Record<string, { securityLevel?: string | number }> | undefined;
  const te = Number.parseInt(String(t?.[tenantId]?.securityLevel ?? '0'), 10);
  return Math.max(Number.isFinite(top) ? top : 0, Number.isFinite(te) ? te : 0);
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

async function resolveApplicationIdForUser(uid: string, data: Record<string, unknown>): Promise<string | null> {
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

async function userHasWorkerAiPrescreenInterview(uid: string): Promise<boolean> {
  try {
    const snap = await db.collection(`users/${uid}/interviews`).limit(25).get();
    for (const d of snap.docs) {
      if (String((d.data() as { interviewKind?: string }).interviewKind || '') === 'worker_ai_prescreen') {
        return true;
      }
    }
  } catch {
    /* fail open */
  }
  return false;
}

export type TriggerUserGroupInterviewInvitesResult = {
  tenantId: string;
  groupId: string;
  totalMembers: number;
  /** Members that passed filters and were attempted for SMS. */
  candidatesConsidered: number;
  sent: number;
  failed: number;
  /** Users skipped (not attempted or ineligible), excluding SMS send failures. */
  skipped: number;
  /** True when eligible list was truncated by MAX_INVITES_PER_CALL. */
  truncated: boolean;
  eligibleQueuedForSend: number;
  skippedBreakdown: {
    missingUserDoc: number;
    completed: number;
    hasPrescreenInterviewDoc: number;
    cooldown: number;
    smsOptOut: number;
    noPhone: number;
    internalStaff: number;
    notGroupMember: number;
    noLongerEligible: number;
  };
};

export const triggerUserGroupInterviewInvites = onCall(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request): Promise<TriggerUserGroupInterviewInvitesResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const raw = (request.data || {}) as { tenantId?: unknown; groupId?: unknown };
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : '';

    if (!tenantId || !groupId) {
      throw new HttpsError('invalid-argument', 'tenantId and groupId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    const groupSnap = await db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get();
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', 'User group not found');
    }
    const memberIds = Array.isArray((groupSnap.data() as { memberIds?: string[] }).memberIds)
      ? (groupSnap.data() as { memberIds: string[] }).memberIds.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const totalMembers = memberIds.length;
    const skippedBreakdown: TriggerUserGroupInterviewInvitesResult['skippedBreakdown'] = {
      missingUserDoc: 0,
      completed: 0,
      hasPrescreenInterviewDoc: 0,
      cooldown: 0,
      smsOptOut: 0,
      noPhone: 0,
      internalStaff: 0,
      notGroupMember: 0,
      noLongerEligible: 0,
    };

    if (totalMembers === 0) {
      logger.info('triggerUserGroupInterviewInvites: empty group', { tenantId, groupId, actor: request.auth.uid });
      return {
        tenantId,
        groupId,
        totalMembers: 0,
        candidatesConsidered: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        truncated: false,
        eligibleQueuedForSend: 0,
        skippedBreakdown,
      };
    }

    if (!(await tenantOutreachEnabled(tenantId))) {
      logger.warn('triggerUserGroupInterviewInvites: tenant outreach disabled', { tenantId, groupId });
      throw new HttpsError('failed-precondition', 'Interview outreach is disabled for this tenant');
    }

    const eligibleUids: string[] = [];

    for (let i = 0; i < memberIds.length; i += USER_READ_CHUNK) {
      const chunk = memberIds.slice(i, i + USER_READ_CHUNK);
      const refs = chunk.map((uid) => db.doc(`users/${uid}`));
      const snaps = await db.getAll(...refs);
      for (let j = 0; j < snaps.length; j++) {
        const uid = chunk[j];
        const snap = snaps[j];
        if (!snap.exists) {
          skippedBreakdown.missingUserDoc += 1;
          continue;
        }
        const userData = snap.data() as Record<string, unknown>;

        if (maxTenantSecurityLevel(userData, tenantId) >= 5) {
          skippedBreakdown.internalStaff += 1;
          continue;
        }

        if (userData.interviewStatus === 'completed') {
          skippedBreakdown.completed += 1;
          continue;
        }

        if (await userHasWorkerAiPrescreenInterview(uid)) {
          skippedBreakdown.hasPrescreenInterviewDoc += 1;
          continue;
        }

        if (userInInterviewReinviteCooldown(userData)) {
          skippedBreakdown.cooldown += 1;
          continue;
        }

        if (userData.smsOptIn === false || userData.smsBlockedSystem === true) {
          skippedBreakdown.smsOptOut += 1;
          continue;
        }

        const phone = phoneE164FromUser(userData);
        if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
          skippedBreakdown.noPhone += 1;
          continue;
        }

        eligibleUids.push(uid);
      }
    }

    const candidatesConsidered = eligibleUids.length;
    const truncated = eligibleUids.length > MAX_INVITES_PER_CALL;
    const sendQueue = eligibleUids.slice(0, MAX_INVITES_PER_CALL);

    async function processOne(uid: string): Promise<'sent' | 'failed' | 'not_group_member' | 'no_longer_eligible'> {
      const groupSnap2 = await db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get();
      const mids = Array.isArray((groupSnap2.data() as { memberIds?: string[] })?.memberIds)
        ? (groupSnap2.data() as { memberIds: string[] }).memberIds.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (!mids.includes(uid)) {
        return 'not_group_member';
      }

      const fresh = await db.doc(`users/${uid}`).get();
      const fd = fresh.data() as Record<string, unknown> | undefined;
      if (!fd) {
        return 'no_longer_eligible';
      }
      if (fd.interviewStatus === 'completed' || userInInterviewReinviteCooldown(fd)) {
        return 'no_longer_eligible';
      }
      if (fd.smsOptIn === false || fd.smsBlockedSystem === true) {
        return 'no_longer_eligible';
      }
      const phoneLive = phoneE164FromUser(fd);
      if (!phoneLive || !/^\+[1-9]\d{7,14}$/.test(phoneLive)) {
        return 'no_longer_eligible';
      }

      const applicationId = await resolveApplicationIdForUser(uid, fd);
      const url = buildWorkerAiPrescreenInviteUrl({
        applicationId,
        entry: 'user_group_backfill',
      });
      const fn = firstNameFromUser(fd);
      const lang = workerInterviewInviteLang(fd);
      const body = buildInterviewInviteSmsBody(fn, applicationId || '', url, lang);

      const sms = await sendWorkerMessageInternal(phoneLive, body, {
        tenantId,
        userId: uid,
        source: 'recruiter',
        sourceId: request.auth.uid,
        messageTypeId: 'user_group_backfill_interview_invite',
      });

      const sentAt = admin.firestore.Timestamp.now();

      if (!sms.success) {
        logger.warn('triggerUserGroupInterviewInvites: send failed', {
          uid,
          groupId,
          tenantId,
          error: sms.error,
        });
        return 'failed';
      }

      await db.doc(`users/${uid}`).set(
        {
          interviewStatus: 'invited',
          interviewInviteSentAt: sentAt,
          lastInterviewInvitedAt: sentAt,
          interviewSource: 'user_group_backfill',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await markLifecycleEventIfFirst({
        tenantId,
        dedupeKey: groupUserDedupeKey(groupId, uid),
        eventType: 'user_group_backfill_interview_invite_sent',
        context: { groupId, userId: uid, applicationId: applicationId || null },
      });

      if (applicationId) {
        try {
          await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
            {
              ...scheduleInterviewChaseFields(sentAt),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } catch (e) {
          logger.warn('triggerUserGroupInterviewInvites: chase schedule failed', {
            uid,
            applicationId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return 'sent';
    }

    let sent = 0;
    let failed = 0;

    if (truncated) {
      logger.warn('triggerUserGroupInterviewInvites: truncating send queue', {
        tenantId,
        groupId,
        candidatesConsidered,
        maxPerCall: MAX_INVITES_PER_CALL,
      });
    }

    for (let i = 0; i < sendQueue.length; i += SMS_CONCURRENCY) {
      const batch = sendQueue.slice(i, i + SMS_CONCURRENCY);
      const outcomes = await Promise.all(batch.map((uid) => processOne(uid)));
      for (const o of outcomes) {
        if (o === 'sent') sent += 1;
        else if (o === 'failed') failed += 1;
        else if (o === 'not_group_member') skippedBreakdown.notGroupMember += 1;
        else skippedBreakdown.noLongerEligible += 1;
      }
    }

    const skipped =
      skippedBreakdown.missingUserDoc +
      skippedBreakdown.completed +
      skippedBreakdown.hasPrescreenInterviewDoc +
      skippedBreakdown.cooldown +
      skippedBreakdown.smsOptOut +
      skippedBreakdown.noPhone +
      skippedBreakdown.internalStaff +
      skippedBreakdown.notGroupMember +
      skippedBreakdown.noLongerEligible;

    const auditId = db.collection(`tenants/${tenantId}/user_group_interview_backfill_audit`).doc().id;
    await db.doc(`tenants/${tenantId}/user_group_interview_backfill_audit/${auditId}`).set({
      type: 'user_group_interview_backfill',
      tenantId,
      groupId,
      actorUid: request.auth.uid,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
      totalMembers,
      candidatesConsidered,
      eligibleQueuedForSend: sendQueue.length,
      truncated,
      maxInvitesPerCall: MAX_INVITES_PER_CALL,
      sent,
      failed,
      skippedBreakdown,
    });

    logger.info('triggerUserGroupInterviewInvites: done', {
      tenantId,
      groupId,
      actor: request.auth.uid,
      totalMembers,
      candidatesConsidered,
      sent,
      failed,
      skippedBreakdown,
    });

    return {
      tenantId,
      groupId,
      totalMembers,
      candidatesConsidered,
      sent,
      failed,
      skipped,
      truncated,
      eligibleQueuedForSend: sendQueue.length,
      skippedBreakdown,
    };
  },
);
