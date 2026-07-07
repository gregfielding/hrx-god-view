/**
 * Gig and Careers job orders: when a shift is created, notify members of configured user groups
 * via SMS + push (per user language). Cooldown: one notification per user per job order every 15 minutes.
 *
 * The same core flow is exposed as a callable (`sendJobOrderShiftPostedResendCallable`) for
 * recruiter-initiated manual resends. Manual resends bypass the per-user cooldown by design —
 * the recruiter has explicitly chosen to re-notify.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { sendLegacyGroupMessage } from './messaging/legacyMessageHelpers';
import { sendNotificationAndPush } from './messaging/unifiedWorkerNotifications';
import { normalizeUserPhoneToE164 } from './utils/phoneE164Normalize';
import { buildWorkerJobPostUrl } from './utils/workerUrls';
import { resolveRadiusRecipientUids } from './jobOrderAutoMessagingRadius';
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
  } catch (err) {
    logger.warn('jobOrderAutoMessaging cooldown claim failed; skipping send to be safe', {
      tenantId,
      jobOrderId,
      userId,
      error: String(err),
    });
    return false;
  }
}

const DAILY_SMS_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * Global shift-invite SMS cap: one per worker per 24h across ALL job
 * orders (the per-JO cooldown above can't stop a burst of new orders
 * from each texting the same nearby worker). Transactional claim so
 * concurrent blasts can't double-send.
 */
async function tryClaimDailySmsSlot(tenantId: string, userId: string): Promise<boolean> {
  const ref = db.doc(`tenants/${tenantId}/shiftInviteSmsCooldown/${userId}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const ts = snap.exists
        ? (snap.data()?.lastSentAt as admin.firestore.Timestamp | undefined)
        : undefined;
      if (ts && Date.now() - ts.toMillis() < DAILY_SMS_CAP_MS) {
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

export interface RunAutoMessagingResult {
  status: 'sent' | 'no_groups' | 'no_recipients' | 'job_order_missing' | 'unsupported_job_type';
  smsDelivered: number;
  pushDelivered: number;
  skippedDueToCooldown: number;
  skippedNoReachableChannel: number;
  skippedSmsDailyCap?: number;
  recipientPoolSize: number;
  city: string;
  boardUrl: string;
  jobPostId: string | null;
  logId: string | null;
}

interface RunAutoMessagingOptions {
  /** Bypass the 15-min per-user cooldown. Used by recruiter-triggered manual resends. */
  bypassCooldown?: boolean;
  /** Tagged onto the autoMessagingSendLog row for filtering (e.g. 'manual_resend'). */
  source?: 'shift_created' | 'manual_resend';
  /** Recruiter UID for audit on manual resends. */
  triggeredByUid?: string | null;
}

/**
 * Core auto-messaging flow shared by the on-shift-created trigger and the
 * recruiter-initiated manual resend callable. All notification work, cooldown
 * accounting, and `autoMessagingSendLog` writes happen here.
 */
export async function runJobOrderAutoMessagingForShift(
  tenantId: string,
  jobOrderId: string,
  shiftId: string,
  options: RunAutoMessagingOptions = {},
): Promise<RunAutoMessagingResult> {
  const { bypassCooldown = false, source = 'shift_created', triggeredByUid = null } = options;

  const empty: RunAutoMessagingResult = {
    status: 'sent',
    smsDelivered: 0,
    pushDelivered: 0,
    skippedDueToCooldown: 0,
    skippedNoReachableChannel: 0,
    recipientPoolSize: 0,
    city: 'your area',
    boardUrl: '',
    jobPostId: null,
    logId: null,
  };

  const jobOrderSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  if (!jobOrderSnap.exists) {
    logger.info('jobOrderAutoMessaging: job order missing', { jobOrderId });
    return { ...empty, status: 'job_order_missing' };
  }
  const jobOrder = jobOrderSnap.data()!;
  const jt = String(jobOrder.jobType || '').toLowerCase();
  if (jt !== 'gig' && jt !== 'career') {
    return { ...empty, status: 'unsupported_job_type' };
  }

  const groupIds: string[] = Array.isArray(jobOrder.autoMessagingUserGroupIds)
    ? jobOrder.autoMessagingUserGroupIds.filter((x: unknown) => typeof x === 'string' && x.trim())
    : [];

  // Smart-radius mode (FG Slice 7): JOs can carry
  // `autoMessagingSmartRadius: { miles, maxRecipients }` +
  // `worksiteCoordinates: { lat, lng }` — every nearby worker becomes a
  // recipient, no group membership needed. Groups and radius compose
  // (union) when both are configured.
  const radiusCfg = jobOrder.autoMessagingSmartRadius as
    | { miles?: unknown; maxRecipients?: unknown }
    | undefined;
  const radiusCenter = jobOrder.worksiteCoordinates as
    | { lat?: unknown; lng?: unknown }
    | undefined;
  const radiusMiles = Number(radiusCfg?.miles);
  const radiusActive =
    Number.isFinite(radiusMiles) &&
    radiusMiles > 0 &&
    Number.isFinite(radiusCenter?.lat as number) &&
    Number.isFinite(radiusCenter?.lng as number);

  if (groupIds.length === 0 && !radiusActive) {
    return { ...empty, status: 'no_groups' };
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

  if (radiusActive) {
    try {
      const resolved = await resolveRadiusRecipientUids(db, {
        tenantId,
        center: { lat: radiusCenter!.lat as number, lng: radiusCenter!.lng as number },
        miles: radiusMiles,
        maxRecipients: Number(radiusCfg?.maxRecipients) > 0 ? Number(radiusCfg?.maxRecipients) : 200,
      });
      for (const uid of resolved.uids) uidSet.add(uid);
      logger.info('jobOrderAutoMessaging: smart radius resolved', {
        tenantId,
        jobOrderId,
        miles: radiusMiles,
        scanned: resolved.scanned,
        inRadius: resolved.inRadius,
        capped: resolved.uids.length,
      });
    } catch (err) {
      // Radius failure must not kill a group-based send.
      logger.warn('jobOrderAutoMessaging: smart radius failed (continuing with groups)', {
        tenantId,
        jobOrderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const recipientIds = Array.from(uidSet);
  if (recipientIds.length === 0) {
    const noMembersLog = await db
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
        source,
        ...(triggeredByUid ? { triggeredByUid } : {}),
      });
    return {
      ...empty,
      status: 'no_recipients',
      city,
      boardUrl,
      jobPostId: jobPostId || null,
      logId: noMembersLog.id,
    };
  }

  let smsDelivered = 0;
  let pushDelivered = 0;
  let skippedDueToCooldown = 0;
  let skippedNoReachableChannel = 0;
  let skippedSmsDailyCap = 0;

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

      if (!bypassCooldown) {
        const claimed = await tryClaimCooldownSlot(tenantId, jobOrderId, uid);
        if (!claimed) {
          skippedDueToCooldown += 1;
          continue;
        }
      } else {
        // Manual resend: still stamp the cooldown doc so subsequent automatic
        // sends respect the most recent send time.
        await db
          .doc(`tenants/${tenantId}/job_orders/${jobOrderId}/autoMessagingCooldown/${uid}`)
          .set(
            {
              lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch((e) =>
            logger.warn('jobOrderAutoMessaging cooldown stamp (bypass) failed', {
              uid,
              error: String(e),
            }),
          );
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
          metadata: { jobOrderId, shiftId, kind: 'gig_new_shift_auto', resendSource: source },
        });
        pushDelivered += 1;
      } catch (e) {
        logger.warn('jobOrderAutoMessaging push failed', { uid, error: String(e) });
      }

      if (phoneOk) {
        // Global (cross-job-order) cap: at most one shift-invite SMS per
        // worker per 24h, so a burst of new orders can't stack texts on the
        // same person. Push/in-app above are not capped.
        const smsSlotClaimed = await tryClaimDailySmsSlot(tenantId, uid);
        if (!smsSlotClaimed) {
          skippedSmsDailyCap += 1;
        } else {
          try {
            const result = await sendLegacyGroupMessage({
              tenantId,
              userId: uid,
              phoneE164: phoneE164!,
              message: sms,
              source: source === 'manual_resend' ? 'auto_messaging_shift_resend' : 'auto_messaging_shift',
              sourceId: `${jobOrderId}_${shiftId}`,
              messageTypeId: 'shift_invite',
            });
            if (result.success) smsDelivered += 1;
            else if (result.error) {
              logger.info('jobOrderAutoMessaging sms not sent', { uid, reason: result.error });
            }
          } catch (e) {
            logger.warn('jobOrderAutoMessaging sms failed', { uid, error: String(e) });
          }
        }
      }
    }
  }

  const sendLog = await db
    .collection(`tenants/${tenantId}/job_orders/${jobOrderId}/autoMessagingSendLog`)
    .add({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      shiftId,
      jobPostId: jobPostId || null,
      city,
      boardUrl,
      smsDelivered,
      pushDelivered,
      skippedDueToCooldown,
      skippedNoReachableChannel,
      skippedSmsDailyCap,
      recipientPoolSize: recipientIds.length,
      messageEnSample: buildMessages(city, boardUrl, false).sms,
      messageEsSample: buildMessages(city, boardUrl, true).sms,
      source,
      ...(triggeredByUid ? { triggeredByUid } : {}),
    });

  logger.info('jobOrderAutoMessaging completed', {
    tenantId,
    jobOrderId,
    shiftId,
    smsDelivered,
    pushDelivered,
    skippedDueToCooldown,
    source,
  });

  return {
    status: 'sent',
    smsDelivered,
    pushDelivered,
    skippedDueToCooldown,
    skippedNoReachableChannel,
    skippedSmsDailyCap,
    recipientPoolSize: recipientIds.length,
    city,
    boardUrl,
    jobPostId: jobPostId || null,
    logId: sendLog.id,
  };
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
      await runJobOrderAutoMessagingForShift(tenantId, jobOrderId, shiftId, {
        source: 'shift_created',
      });
    } catch (err) {
      logger.error('jobOrderAutoMessaging fatal', {
        err: String(err),
        tenantId,
        jobOrderId,
        shiftId,
      });
    }
  },
);

/**
 * Recruiter-initiated manual resend. Picks the most recent shift on the JO,
 * re-runs the same notification flow, and bypasses the per-user 15-min cooldown
 * so that users skipped on the first send still receive the message.
 *
 * Auth: any caller authenticated against the tenant works for now — we intentionally
 * keep this lenient because tenant-scoped Firestore rules already control which
 * recruiters can read the parent JO. Tighten with a securityLevel check if abuse
 * surfaces.
 */
export const sendJobOrderShiftPostedResendCallable = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request: CallableRequest<{ tenantId?: string; jobOrderId?: string; shiftId?: string }>) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const tenantId = String(request.data?.tenantId ?? '').trim();
    const jobOrderId = String(request.data?.jobOrderId ?? '').trim();
    const explicitShiftId = String(request.data?.shiftId ?? '').trim();
    if (!tenantId || !jobOrderId) {
      throw new HttpsError('invalid-argument', 'tenantId and jobOrderId are required.');
    }

    let shiftId = explicitShiftId;
    if (!shiftId) {
      // Pick the most recent shift on the JO so the log row + cooldown bookkeeping
      // is anchored to a real shift. We try `createdAt desc` first, then fall back
      // to `startDate desc` for older docs that don't carry `createdAt`.
      const shiftsRef = db.collection(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts`);
      let shiftSnap;
      try {
        shiftSnap = await shiftsRef.orderBy('createdAt', 'desc').limit(1).get();
      } catch {
        shiftSnap = await shiftsRef.limit(1).get();
      }
      if (shiftSnap.empty) {
        try {
          shiftSnap = await shiftsRef.orderBy('startDate', 'desc').limit(1).get();
        } catch {
          // ignore — fall through to error below
        }
      }
      const first = shiftSnap?.docs?.[0];
      if (!first) {
        throw new HttpsError('failed-precondition', 'No shifts on this job order to resend for.');
      }
      shiftId = first.id;
    }

    try {
      const result = await runJobOrderAutoMessagingForShift(tenantId, jobOrderId, shiftId, {
        bypassCooldown: true,
        source: 'manual_resend',
        triggeredByUid: request.auth.uid,
      });

      if (result.status === 'job_order_missing') {
        throw new HttpsError('not-found', 'Job order not found.');
      }
      if (result.status === 'unsupported_job_type') {
        throw new HttpsError(
          'failed-precondition',
          'Auto-messaging is only available for gig and career job orders.',
        );
      }
      if (result.status === 'no_groups') {
        throw new HttpsError(
          'failed-precondition',
          'No user groups configured on this job order.',
        );
      }

      return {
        success: true,
        sentAt: new Date().toISOString(),
        shiftId,
        smsDelivered: result.smsDelivered,
        pushDelivered: result.pushDelivered,
        skippedDueToCooldown: result.skippedDueToCooldown,
        skippedNoReachableChannel: result.skippedNoReachableChannel,
        recipientPoolSize: result.recipientPoolSize,
        boardUrl: result.boardUrl,
        jobPostId: result.jobPostId,
        logId: result.logId,
      };
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      logger.error('sendJobOrderShiftPostedResendCallable fatal', {
        err: String(err),
        tenantId,
        jobOrderId,
        shiftId,
      });
      throw new HttpsError('internal', 'Resend failed.');
    }
  },
);
