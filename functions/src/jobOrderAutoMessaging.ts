/**
 * Gig and Careers job orders: when a shift is created, notify members of configured user groups
 * via SMS + push (per user language). Cooldown: one notification per user per job order every 15 minutes.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { sendLegacyGroupMessage } from './messaging/legacyMessageHelpers';
import { sendNotificationAndPush } from './messaging/unifiedWorkerNotifications';
import { normalizeUserPhoneToE164 } from './utils/phoneE164Normalize';
import { buildWorkerJobPostUrl } from './utils/workerUrls';
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

const COOLDOWN_MS = 15 * 60 * 1000;

function preferredLangEs(userData: admin.firestore.DocumentData | undefined): boolean {
  const raw = String(userData?.preferredLanguage ?? '').trim().toLowerCase();
  return raw === 'es' || raw.startsWith('es');
}

function buildMessages(city: string, url: string, es: boolean): { sms: string; pushTitle: string; pushBody: string } {
  if (es) {
    const sms = `Se acaba de publicar un nuevo turno en ${city}: ${url}`;
    return {
      sms,
      pushTitle: 'Nuevo turno publicado',
      pushBody: sms,
    };
  }
  const sms = `A new shift has just been posted in ${city}: ${url}`;
  return {
    sms,
    pushTitle: 'New shift posted',
    pushBody: sms,
  };
}

function resolveCityName(jobOrder: admin.firestore.DocumentData): string {
  const w = jobOrder?.worksiteAddress;
  if (w && typeof w.city === 'string' && w.city.trim()) return w.city.trim();
  if (typeof jobOrder?.city === 'string' && jobOrder.city.trim()) return jobOrder.city.trim();
  const deal = jobOrder?.deal;
  const loc = deal?.locations?.[0];
  if (loc?.city && String(loc.city).trim()) return String(loc.city).trim();
  if (typeof jobOrder?.worksiteName === 'string' && jobOrder.worksiteName.trim()) return jobOrder.worksiteName.trim();
  return 'your area';
}

function collectMembersFromGroupData(data: admin.firestore.DocumentData | undefined): string[] {
  const members = data?.members;
  if (Array.isArray(members)) {
    return members.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim());
  }
  if (members && typeof members === 'object') {
    return Object.keys(members as Record<string, unknown>);
  }
  return [];
}

/**
 * Same post + path as "Copy Jobs Board Link" on the job order Jobs Board tab
 * (`RecruiterJobOrderDetail` → `JobOrderJobsBoardTab`): `/c1/jobs-board/{postId}`
 * with `buildWorkerJobPostUrl` base host.
 *
 * - Non–gig-with-positions: first post when ordered by `createdAt` desc (matches `getPostsByJobOrder`).
 * - Gig with `gigPositions`: post where `positionJobTitle` matches `gigPositions[0].jobTitle`
 *   (same as default sub-tab index 0 when copying).
 */
function createdAtMillis(value: unknown): number {
  if (value == null) return 0;
  if (typeof (value as admin.firestore.Timestamp).toMillis === 'function') {
    return (value as admin.firestore.Timestamp).toMillis();
  }
  return 0;
}

async function resolveJobPostingIdForCopyLink(
  tenantId: string,
  jobOrderId: string,
  jobOrder: admin.firestore.DocumentData,
): Promise<string | null> {
  const snap = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_postings')
    .where('jobOrderId', '==', jobOrderId)
    .get();
  if (snap.empty) return null;

  const posts = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      positionJobTitle: typeof data.positionJobTitle === 'string' ? data.positionJobTitle : undefined,
      createdAt: data.createdAt,
    };
  });
  posts.sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));

  const gigPositions = jobOrder.gigPositions as Array<{ jobTitle?: string }> | undefined;
  const isGigWithPositions =
    String(jobOrder.jobType || '').toLowerCase() === 'gig' &&
    Array.isArray(gigPositions) &&
    gigPositions.length > 0;

  if (isGigWithPositions) {
    const tab0Title = gigPositions[0]?.jobTitle?.trim();
    if (tab0Title) {
      const match = posts.find((p) => p.positionJobTitle === tab0Title);
      if (match) return match.id;
    }
    return null;
  }

  return posts[0]?.id ?? null;
}

async function hasEnabledPushTokens(uid: string): Promise<boolean> {
  const snap = await db.collection(`users/${uid}/pushTokens`).where('enabled', '==', true).limit(1).get();
  return !snap.empty;
}

async function tryClaimCooldownSlot(
  tenantId: string,
  jobOrderId: string,
  userId: string,
): Promise<boolean> {
  const ref = db.doc(
    `tenants/${tenantId}/job_orders/${jobOrderId}/autoMessagingCooldown/${userId}`,
  );
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const nowMs = Date.now();
      let lastMs = 0;
      if (snap.exists) {
        const ts = snap.data()?.lastSentAt as admin.firestore.Timestamp | undefined;
        if (ts) lastMs = ts.toMillis();
      }
      if (lastMs && nowMs - lastMs < COOLDOWN_MS) {
        return false;
      }
      tx.set(
        ref,
        { lastSentAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      return true;
    });
  } catch (e) {
    logger.warn('jobOrderAutoMessaging cooldown transaction failed', { userId, error: String(e) });
    return false;
  }
}

export const jobOrderAutoMessagingOnShiftCreated = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const shiftId = event.params.shiftId as string;

    try {
      const jobOrderSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
      if (!jobOrderSnap.exists) {
        logger.info('jobOrderAutoMessaging: job order missing', { jobOrderId });
        return;
      }
      const jobOrder = jobOrderSnap.data()!;
      const jt = String(jobOrder.jobType || '').toLowerCase();
      if (jt !== 'gig' && jt !== 'career') {
        return;
      }

      const groupIds: string[] = Array.isArray(jobOrder.autoMessagingUserGroupIds)
        ? jobOrder.autoMessagingUserGroupIds.filter((x: unknown) => typeof x === 'string' && x.trim())
        : [];
      if (groupIds.length === 0) {
        return;
      }

      const city = resolveCityName(jobOrder);
      const jobPostId = await resolveJobPostingIdForCopyLink(tenantId, jobOrderId, jobOrder);
      const boardUrl = buildWorkerJobPostUrl(jobPostId || undefined);

      const uidSet = new Set<string>();
      for (const gid of groupIds) {
        const gSnap = await db.doc(`tenants/${tenantId}/userGroups/${gid}`).get();
        if (!gSnap.exists) continue;
        for (const uid of collectMembersFromGroupData(gSnap.data())) {
          uidSet.add(uid);
        }
      }

      const recipientIds = Array.from(uidSet);
      if (recipientIds.length === 0) {
        await db
          .collection(`tenants/${tenantId}/job_orders/${jobOrderId}/autoMessagingSendLog`)
          .add({
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            shiftId,
            jobPostId: jobPostId || null,
            city,
            boardUrl,
            smsDelivered: 0,
            pushDelivered: 0,
            skippedDueToCooldown: 0,
            skippedNoReachableChannel: 0,
            note: 'no_members_in_groups',
          });
        return;
      }

      let smsDelivered = 0;
      let pushDelivered = 0;
      let skippedDueToCooldown = 0;
      let skippedNoReachableChannel = 0;

      const BATCH = 15;
      for (let i = 0; i < recipientIds.length; i += BATCH) {
        const chunk = recipientIds.slice(i, i + BATCH);
        const userSnaps = await Promise.all(chunk.map((uid) => db.doc(`users/${uid}`).get()));

        for (let j = 0; j < chunk.length; j++) {
          const uid = chunk[j];
          const userDoc = userSnaps[j];
          if (!userDoc.exists) continue;
          const userData = userDoc.data()!;

          const phoneE164 = normalizeUserPhoneToE164(userData);
          const phoneOk = Boolean(phoneE164) && userData?.smsOptIn !== false;
          const pushOk = await hasEnabledPushTokens(uid);
          if (!phoneOk && !pushOk) {
            skippedNoReachableChannel += 1;
            continue;
          }

          const claimed = await tryClaimCooldownSlot(tenantId, jobOrderId, uid);
          if (!claimed) {
            skippedDueToCooldown += 1;
            continue;
          }

          const es = preferredLangEs(userData);
          const { sms, pushTitle, pushBody } = buildMessages(city, boardUrl, es);

          try {
            await sendNotificationAndPush({
              uid,
              tenantId,
              title: pushTitle,
              body: pushBody,
              type: 'opportunity',
              category: 'opportunities',
              deepLink: jobPostId ? `/c1/jobs-board/${jobPostId}` : '/c1/jobs-board',
              entityId: jobPostId || undefined,
              entity: jobPostId ? { kind: 'job_post', id: jobPostId } : undefined,
              source: 'automation',
              metadata: { jobOrderId, shiftId, kind: 'gig_new_shift_auto' },
            });
            pushDelivered += 1;
          } catch (e) {
            logger.warn('jobOrderAutoMessaging push failed', { uid, error: String(e) });
          }

          if (phoneOk) {
            try {
              const result = await sendLegacyGroupMessage({
                tenantId,
                userId: uid,
                phoneE164: phoneE164!,
                message: sms,
                source: 'auto_messaging_shift',
                sourceId: `${jobOrderId}_${shiftId}`,
              });
              if (result.success) smsDelivered += 1;
            } catch (e) {
              logger.warn('jobOrderAutoMessaging sms failed', { uid, error: String(e) });
            }
          }
        }
      }

      await db.collection(`tenants/${tenantId}/job_orders/${jobOrderId}/autoMessagingSendLog`).add({
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        shiftId,
        jobPostId: jobPostId || null,
        city,
        boardUrl,
        smsDelivered,
        pushDelivered,
        skippedDueToCooldown,
        skippedNoReachableChannel,
        recipientPoolSize: recipientIds.length,
        messageEnSample: buildMessages(city, boardUrl, false).sms,
        messageEsSample: buildMessages(city, boardUrl, true).sms,
      });

      logger.info('jobOrderAutoMessaging completed', {
        tenantId,
        jobOrderId,
        shiftId,
        smsDelivered,
        pushDelivered,
        skippedDueToCooldown,
      });
    } catch (err) {
      logger.error('jobOrderAutoMessaging fatal', { err: String(err), tenantId, jobOrderId, shiftId });
    }
  },
);
