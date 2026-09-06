/**
 * Claim Shift — worker-initiated, transactional assignment creation.
 *
 * Entry point: `placementsApi.respondToAssignment` with `decision: 'claim'`
 * (rides the existing callable — we're at the Cloud Run service cap, so no
 * new function). The worker claims ONE shift-day; the assignment is born
 * `confirmed` with `acquisition: 'claimed'` so the cadence engine routes it
 * to the `gig_claimed` profile (no 24h ask ladder; immediate "You're on the
 * crew" confirmation — see cadence/shiftReminderProfile.ts).
 *
 * Order of operations (gates outside the transaction, capacity inside):
 *   1. Load JO / shift / user / posting; posting must have
 *      `claimShiftEnabled: true` + status active (recruiter opt-in per post).
 *   2. Policy gates (claimShiftPolicy): gig JO not paused/closed, shift not
 *      cancelled/open-type, valid day with hours, not yet started, DNR,
 *      headshot gate (typed HEADSHOT_* error, same as accept), tier window
 *      (wired, off), overlap with any live assignment, unproven-worker cap.
 *   3. Transaction on the SHIFT doc: re-read shift + this worker's day doc
 *      (idempotent: already live → return it), count live assignments on
 *      the day, reject `shift_filled`, write the assignment, and bump
 *      `shift.claimStats[day]` — that shift-doc write is what serializes two
 *      concurrent claims for the last spot (the loser retries, recounts,
 *      and gets `shift_filled`).
 *   4. Side effects the recruiter-placement path performs after a create:
 *      onboarding instance, application resolved to 'accepted', overlapping
 *      applications released, onboarding pipeline, and the confirmed-
 *      transition screening automation (the trigger is onUpdate-only and a
 *      born-confirmed doc never transitions — so we call it directly).
 *
 * Never sends the legacy offer SMS (`suppressInitialNotification`) — the
 * claim confirmation is the cadence engine's `gig_claim_confirmation` step.
 */
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { assertWorkerHeadshotApproved } from '../avatar/headshotAcceptGate';
import { runScreeningAutomationForConfirmedAssignment } from '../compliance/screeningAutomationTrigger';
import { filterDnrRecipients } from '../dnr/filterDnrRecipients';
import { ensureWorkerOnboardingPipeline } from '../onboarding/workerOnboardingPipeline';
import {
  buildAssignmentDocId,
  buildLegacyAssignmentDocId,
  computeShiftWindow,
  ensureOnboardingInstance,
  releaseOverlappingApplications,
  resolveApplicationForAssignment,
  resolveOnboardingConfigForJobOrder,
  resolveShiftRates,
  safeFiniteNumber,
  shiftWindowsOverlap,
  toDateOnly,
} from '../placementsApi';
import { ASSIGNMENT_STATUS_QUERY_LIVE } from '../utils/assignmentStatusNormalize';
import {
  assignmentOccupiesDay,
  claimError,
  countsTowardCapacity,
  evaluateClaimCap,
  evaluateClaimTierWindow,
  isJobOrderClaimable,
  isPostingClaimable,
  isShiftClaimable,
  normalizeClaimAcknowledgements,
  resolvePostingPublishedAtMs,
  resolveShiftDay,
  resolveWorkerTier,
  toDayKey,
} from './claimShiftPolicy';

const db = admin.firestore();

export interface ClaimShiftArgs {
  tenantId: string;
  uid: string;
  jobOrderId: string;
  shiftId: string;
  /** YYYY-MM-DD; required for multi-day gigs (one claim per day). */
  date?: string | null;
  /** The posting the worker tapped from — validated against the JO. */
  jobPostId?: string | null;
  /** 'web' | 'app' — audit only. */
  channel?: string | null;
  acknowledgements?: unknown;
  nowMs?: number;
}

export interface ClaimShiftResult {
  success: true;
  status: 'confirmed';
  assignmentId: string;
  /** True when the worker already held a live assignment on this day (no-op). */
  alreadyClaimed: boolean;
  /** Spots left on that day after this claim; null when alreadyClaimed. */
  remaining: number | null;
  dayKey: string;
}

const NOT_CLAIMABLE_MSG = 'This shift is not open for instant claims.';

async function resolvePosting(
  tenantId: string,
  jobOrderId: string,
  jobPostId: string | null | undefined,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  if (jobPostId) {
    const snap = await db.doc(`tenants/${tenantId}/job_postings/${jobPostId}`).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (String(data.jobOrderId || '') === jobOrderId) return { id: snap.id, data };
    }
  }
  const q = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', jobOrderId)
    .limit(5)
    .get();
  if (q.empty) return null;
  const preferred = q.docs.find((d) => isPostingClaimable(d.data() || {})) || q.docs[0];
  return { id: preferred.id, data: preferred.data() || {} };
}

export async function claimShiftForWorker(args: ClaimShiftArgs): Promise<ClaimShiftResult> {
  const { tenantId, uid, jobOrderId, shiftId } = args;
  const nowMs = args.nowMs ?? Date.now();
  const channel = args.channel === 'app' ? 'app' : args.channel === 'web' ? 'web' : null;

  const shiftRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`);
  const [jobOrderSnap, shiftSnap, userSnap, posting] = await Promise.all([
    db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get(),
    shiftRef.get(),
    db.doc(`users/${uid}`).get(),
    resolvePosting(tenantId, jobOrderId, args.jobPostId),
  ]);
  if (!jobOrderSnap.exists) throw new HttpsError('not-found', 'Job order not found');
  if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found');
  if (!userSnap.exists) throw claimError('ineligible', 'We could not find your worker profile.', { reason: 'user_not_found' });

  const jobOrder = jobOrderSnap.data() || {};
  const shift = shiftSnap.data() || {};
  const userData = userSnap.data() || {};

  // --- Opt-in + liveness gates ------------------------------------------
  if (!posting || !isPostingClaimable(posting.data)) {
    throw claimError('not_claimable', NOT_CLAIMABLE_MSG, { reason: 'posting_not_claimable' });
  }
  const joCheck = isJobOrderClaimable(jobOrder);
  if (joCheck.ok === false) throw claimError('not_claimable', NOT_CLAIMABLE_MSG, { reason: joCheck.reason });
  const shiftCheck = isShiftClaimable(shift);
  if (shiftCheck.ok === false) throw claimError('not_claimable', NOT_CLAIMABLE_MSG, { reason: shiftCheck.reason });

  const day = resolveShiftDay(shift, args.date);
  if (day.ok === false) {
    const msg =
      day.reason === 'date_required'
        ? 'Pick which day you want to claim.'
        : day.reason === 'no_times'
          ? 'This shift has no scheduled hours yet.'
          : 'That day is not part of this shift.';
    throw claimError('not_claimable', msg, { reason: day.reason });
  }
  const window = computeShiftWindow(day.dayKey, day.startTime, day.endTime);
  if (!window) throw claimError('not_claimable', 'This shift has no scheduled hours yet.', { reason: 'no_times' });
  if (window.startMs <= nowMs) {
    throw claimError('not_claimable', 'This shift has already started.', { reason: 'started' });
  }

  // --- Worker eligibility ------------------------------------------------
  const { blockedUserIds } = await filterDnrRecipients(db, jobOrder, [uid]);
  if (blockedUserIds.includes(uid)) {
    throw claimError('ineligible', 'You are not able to work at this account.', { reason: 'dnr' });
  }
  // Same typed HEADSHOT_* contract as Accept (web renders the inline
  // uploader, the app shows the headshot sheet); grace clause via tenantId.
  await assertWorkerHeadshotApproved(uid, userData, { tenantId });

  const tier = resolveWorkerTier(userData);
  const tierWindow = evaluateClaimTierWindow({
    tier,
    publishedAtMs: resolvePostingPublishedAtMs(posting.data),
    nowMs,
  });
  if (tierWindow.locked) {
    throw claimError('tier_locked', 'This shift opens to you a little later.', {
      tier,
      opensAtMs: tierWindow.opensAtMs ?? undefined,
    });
  }

  const liveSnap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('userId', '==', uid)
    .where('status', 'in', [...ASSIGNMENT_STATUS_QUERY_LIVE])
    .get();
  let liveClaimedFutureCount = 0;
  for (const docSnap of liveSnap.docs) {
    const a = docSnap.data() || {};
    if (String(a.shiftId || '') === shiftId) continue; // same shift → idempotency handles it
    const existingWindow = computeShiftWindow(toDateOnly(a.startDate), a.startTime, a.endTime);
    if (existingWindow && shiftWindowsOverlap(window, existingWindow)) {
      throw claimError('conflict', "You're already booked during these hours.", {
        conflict: {
          assignmentId: docSnap.id,
          jobTitle: String(a.jobTitle || a.shiftTitle || ''),
          locationName: String(a.locationNickname || a.worksiteName || ''),
          startDate: toDateOnly(a.startDate),
          startTime: String(a.startTime || ''),
          endTime: String(a.endTime || ''),
        },
      });
    }
    if (String(a.acquisition || '').trim().toLowerCase() === 'claimed') {
      if (!existingWindow || existingWindow.startMs > nowMs) liveClaimedFutureCount += 1;
    }
  }
  const completedSnap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('userId', '==', uid)
    .where('status', 'in', ['completed', 'ended'])
    .limit(1)
    .get();
  const cap = evaluateClaimCap({ hasCompletedShift: !completedSnap.empty, liveClaimedCount: liveClaimedFutureCount });
  if (cap.blocked) {
    throw claimError(
      'claim_cap',
      `You can hold up to ${cap.cap} claimed shifts until you complete your first one.`,
      { cap: cap.cap },
    );
  }

  // --- Assignment payload ------------------------------------------------
  const { payRate, billRate } = resolveShiftRates(jobOrder, shift);
  const onboardingConfig = await resolveOnboardingConfigForJobOrder({ tenantId, jobOrderId, jobOrder });
  const locationId = jobOrder.worksiteId || jobOrder.locationId;
  const locationSnap = locationId ? await db.doc(`tenants/${tenantId}/locations/${locationId}`).get() : null;
  const locationData = locationSnap?.exists ? locationSnap.data() || {} : {};
  const latitude = safeFiniteNumber(locationData.latitude ?? locationData.lat, 0);
  const longitude = safeFiniteNumber(locationData.longitude ?? locationData.lng, 0);
  const locationNickname =
    locationData.nickname ||
    locationData.title ||
    locationData.name ||
    locationData.locationName ||
    jobOrder.worksiteName ||
    '';
  const firstName =
    String(userData.firstName || '').trim() || String(userData.displayName || '').split(' ')[0] || '';
  const lastName =
    String(userData.lastName || '').trim() ||
    String(userData.displayName || '').split(' ').slice(1).join(' ').trim() ||
    '';
  const onboardingStatus =
    onboardingConfig.entityId && onboardingConfig.requirementPackageId && onboardingConfig.packageData
      ? 'not_started'
      : 'blocked';
  const acknowledgements = normalizeClaimAcknowledgements(args.acknowledgements);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const assignmentRef = db
    .collection(`tenants/${tenantId}/assignments`)
    .doc(buildAssignmentDocId({ shiftId, userId: uid, dayKey: day.dayKey }));
  const legacyRef = db
    .collection(`tenants/${tenantId}/assignments`)
    .doc(buildLegacyAssignmentDocId({ shiftId, userId: uid }));
  const singleDayShiftDate = day.multiDay ? '' : day.dayKey;

  const assignmentData: Record<string, unknown> = {
    tenantId,
    jobOrderId,
    shiftId,
    candidateId: uid,
    userId: uid,
    status: 'confirmed',
    confirmedAt: now,
    confirmedBy: uid,
    startDate: day.dayKey,
    endDate: day.dayKey,
    startTime: day.startTime,
    endTime: day.endTime,
    payRate,
    billRate,
    timesheetMode: jobOrder.timesheetMode || 'mobile',
    firstName,
    lastName,
    email: userData.email || '',
    phone: userData.phone || userData.phoneE164 || '',
    companyId: jobOrder.companyId || '',
    companyName: jobOrder.companyName || '',
    companyTitle: jobOrder.companyName || '',
    locationId: locationId || '',
    locationIds: locationId ? [locationId] : [],
    locationNickname,
    worksiteName: locationNickname,
    latitude,
    longitude,
    jobOrderType: jobOrder.jobType || 'gig',
    jobTitle: shift.defaultJobTitle || jobOrder.jobTitle || '',
    shiftTitle: shift.shiftTitle || '',
    assignmentSource: 'worker_claim',
    sourceGroupId: null,
    placementMode: 'claim',
    jobPostId: posting.id,
    // Claim provenance — the cadence engine fences on `acquisition`.
    acquisition: 'claimed',
    claimedAt: now,
    claimChannel: channel,
    acknowledgements,
    acknowledgedAt: now,
    // The claim IS the confirmation (same shape workerShiftRemindersV2 seeds).
    cortConfirmation: {
      state: 'confirmed',
      profileId: 'gig_claimed',
      confirmedAt: now,
      updatedAt: now,
      confirmedVia: 'claim',
    },
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
    assignedAt: now,
    // No offer/accept step — never send the legacy ACCEPT/DECLINE SMS.
    suppressInitialNotification: true,
    entityId: onboardingConfig.entityId ?? null,
    requirementPackageId: onboardingConfig.requirementPackageId ?? null,
    onboardingInstanceId: assignmentRef.id,
    onboardingStatus,
    onboardingPercent: 0,
  };

  // --- Capacity transaction ---------------------------------------------
  const tx = await db.runTransaction(async (t) => {
    const [shiftTx, existingTx, legacyTx, liveOnShiftTx] = await Promise.all([
      t.get(shiftRef),
      t.get(assignmentRef),
      t.get(legacyRef),
      t.get(
        db
          .collection(`tenants/${tenantId}/assignments`)
          .where('shiftId', '==', shiftId)
          .where('status', 'in', [...ASSIGNMENT_STATUS_QUERY_LIVE]),
      ),
    ]);
    if (!shiftTx.exists) throw new HttpsError('not-found', 'Shift not found');
    const shiftNow = shiftTx.data() || {};
    const liveCheck = isShiftClaimable(shiftNow);
    if (liveCheck.ok === false) throw claimError('not_claimable', NOT_CLAIMABLE_MSG, { reason: liveCheck.reason });

    const existing = existingTx.exists ? existingTx.data() || {} : null;
    if (existing && countsTowardCapacity(existing.status)) {
      return { assignmentId: assignmentRef.id, alreadyClaimed: true, remaining: null as number | null, created: false };
    }
    const legacy = legacyTx.exists ? legacyTx.data() || {} : null;
    if (legacy && countsTowardCapacity(legacy.status) && toDayKey(legacy.startDate) === day.dayKey) {
      return { assignmentId: legacyRef.id, alreadyClaimed: true, remaining: null as number | null, created: false };
    }

    const dayNow = resolveShiftDay(shiftNow, day.dayKey);
    const capacity = dayNow.ok ? dayNow.capacity : day.capacity;
    const taken = liveOnShiftTx.docs.filter((d) => {
      if (d.id === assignmentRef.id || d.id === legacyRef.id) return false;
      const a = d.data() || {};
      if (String(a.userId || a.candidateId || '') === uid) return false;
      return assignmentOccupiesDay(a, day.dayKey, singleDayShiftDate);
    }).length;
    if (taken >= capacity) {
      throw claimError('shift_filled', 'This shift just filled up.', { remaining: 0 });
    }

    t.set(assignmentRef, assignmentData, { merge: false });
    // Writing the shift doc is what makes two same-spot claims conflict
    // (Firestore serializes transactions that read+write the same doc).
    t.set(
      shiftRef,
      {
        claimStats: {
          [day.dayKey]: {
            claimedCount: admin.firestore.FieldValue.increment(1),
            lastClaimedAt: now,
            lastClaimedBy: uid,
          },
        },
      },
      { merge: true },
    );
    return {
      assignmentId: assignmentRef.id,
      alreadyClaimed: false,
      remaining: Math.max(0, capacity - taken - 1) as number | null,
      created: true,
    };
  });

  if (!tx.created) {
    logger.info('[claimShift] idempotent — worker already holds this day', {
      tenantId,
      uid,
      shiftId,
      dayKey: day.dayKey,
      assignmentId: tx.assignmentId,
    });
    return {
      success: true,
      status: 'confirmed',
      assignmentId: tx.assignmentId,
      alreadyClaimed: true,
      remaining: null,
      dayKey: day.dayKey,
    };
  }

  // --- Post-create side effects (mirror placementsCreateAssignments) ----
  const assignmentId = tx.assignmentId;
  try {
    await ensureOnboardingInstance({
      tenantId,
      assignmentId,
      userId: uid,
      jobOrderId,
      shiftId,
      entityId: onboardingConfig.entityId,
      requirementPackageId: onboardingConfig.requirementPackageId,
      packageData: onboardingConfig.packageData,
      createdBy: uid,
      blockedReason: onboardingConfig.blockedReason,
    });
    const applicationId = await resolveApplicationForAssignment({
      tenantId,
      jobOrderId,
      shiftId,
      userId: uid,
      createdBy: uid,
      assignmentId,
      jobPostId: posting.id,
      entityId: onboardingConfig.entityId,
    });
    await Promise.all([
      assignmentRef.set({ applicationId, updatedAt: now }, { merge: true }),
      db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
        {
          workerClaimConfirmation: {
            claimedAt: now,
            assignmentId,
            shiftId,
            dayKey: day.dayKey,
            acknowledgements,
            channel,
            version: 1,
          },
          lastAssignmentDecision: {
            decision: 'claim',
            assignmentId,
            shiftId,
            entryPoint: 'claim_shift',
            byUid: uid,
            at: now,
          },
        },
        { merge: true },
      ),
    ]);
  } catch (err) {
    logger.error('[claimShift] post-create bookkeeping failed (assignment is committed)', {
      tenantId,
      uid,
      assignmentId,
      error: (err as Error)?.message || String(err),
    });
  }

  await releaseOverlappingApplications({
    tenantId,
    userId: uid,
    assignedJobOrderId: jobOrderId,
    assignedJobOrderTitle: String(jobOrder.jobOrderName || jobOrder.jobTitle || 'your shift'),
    assignedShiftId: shiftId,
    assignedAssignmentId: assignmentId,
    windows: [window],
  });

  try {
    await ensureWorkerOnboardingPipeline({
      tenantId,
      userId: uid,
      assignmentId,
      jobOrderId,
      entityId: onboardingConfig.entityId ?? null,
      triggeredByUid: uid,
      triggerSource: 'worker_confirmation',
    });
  } catch (err) {
    logger.warn('[claimShift] onboarding pipeline failed', {
      tenantId,
      assignmentId,
      error: (err as Error)?.message || String(err),
    });
  }

  // Born-confirmed → the onUpdate screening trigger never sees a transition.
  try {
    const afterSnap = await assignmentRef.get();
    const after = (afterSnap.data() || {}) as Record<string, unknown>;
    await runScreeningAutomationForConfirmedAssignment({ tenantId, assignmentId, after });
  } catch (err) {
    logger.warn('[claimShift] screening automation failed', {
      tenantId,
      assignmentId,
      error: (err as Error)?.message || String(err),
    });
  }

  logger.info('[claimShift] claimed', {
    tenantId,
    uid,
    jobOrderId,
    shiftId,
    dayKey: day.dayKey,
    assignmentId,
    remaining: tx.remaining,
    channel,
    tier,
  });

  return {
    success: true,
    status: 'confirmed',
    assignmentId,
    alreadyClaimed: false,
    remaining: tx.remaining,
    dayKey: day.dayKey,
  };
}
