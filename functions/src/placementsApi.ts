import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { formatTime12h } from './utils/formatShiftTime';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';

// Twilio secrets must be bound to any function that sends an SMS through the
// routing orchestrator (it reads process.env.TWILIO_*). Without this binding
// the SMS send throws "Twilio credentials not configured" and only the email
// goes out — the cause of placement offer texts silently not sending
// (2026-06-04). Both placement SMS senders below declare these.
const PLACEMENT_SMS_SECRETS = [
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
];
import { ensureWorkerOnboardingPipeline } from './onboarding/workerOnboardingPipeline';
import { filterDnrRecipients } from './dnr/filterDnrRecipients';
import { ASSIGNMENT_STATUS_QUERY_LIVE, isAssignmentTerminalNormalized } from './utils/assignmentStatusNormalize';
import { sendNotificationAndPush } from './messaging/unifiedWorkerNotifications';
import {
  buildWorkerAssignmentResponseUrl,
  buildWorkerAssignmentAcceptUrl,
  buildWorkerAssignmentDeclineUrl,
  buildWorkerAssignmentUrl,
} from './utils/workerUrls';
import { assertWorkerHeadshotApproved } from './avatar/headshotAcceptGate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// 'decline'       → recruiter-offer declined (legacy) → status 'declined'
// 'worker_cancel' → worker pulled out themselves ("I can no longer work" /
//                   cancelled their application on the jobs board) →
//                   distinct status 'worker-cancelled' so the jobs board
//                   can offer "Re-apply to Shift".
type AssignmentDecision = 'accept' | 'decline' | 'worker_cancel';

export function toDateOnly(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value.split('T')[0];
  if (value?.toDate && typeof value.toDate === 'function') {
    return value.toDate().toISOString().split('T')[0];
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return '';
}

/** Firestore rejects NaN; location/job data sometimes has non-numeric strings. */
function safeFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseMinutes(time?: string): number | null {
  if (!time || typeof time !== 'string' || !time.includes(':')) return null;
  const [h, m] = time.split(':').map((part) => parseInt(part, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function overlapsSameDay(aStart: number | null, aEnd: number | null, bStart: number | null, bEnd: number | null): boolean {
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
  const normalizedAEnd = aEnd < aStart ? aEnd + 24 * 60 : aEnd;
  const normalizedBEnd = bEnd < bStart ? bEnd + 24 * 60 : bEnd;
  return aStart < normalizedBEnd && bStart < normalizedAEnd;
}

/**
 * Concrete time window for an assignment / shift, in absolute milliseconds.
 * `end` is normalized to advance one day when the wall-clock end time
 * falls at or before the start (overnight shifts like 5 PM → 3 AM).
 */
interface ShiftWindow {
  startMs: number;
  endMs: number;
}

/**
 * Build the absolute [start, end) window from a (YYYY-MM-DD, HH:MM, HH:MM)
 * triple. Returns null when any input is missing or unparseable so callers
 * can decide whether to fall back to a coarser check.
 *
 * Why this replaces the old `overlapsSameDay` for the conflict guard: the
 * legacy check matched only on `startDate`, which meant "Mon 5 PM → Tue
 * 3 AM" (startDate=Mon) vs "Tue 5 PM → Wed 3 AM" (startDate=Tue) was
 * early-returned at the date mismatch and never compared. Recruiters
 * reported a false "shifts overlap" toast even when their existing shift
 * ended at 3 AM and the next started 14 hours later — because the
 * minutes-of-day arithmetic was wrong for the cross-midnight case.
 * Comparing full ranges in epoch ms makes overnight + same-day +
 * cross-day all collapse to a single, correct interval-intersect.
 */
function computeShiftWindow(
  startDate: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
): ShiftWindow | null {
  if (!startDate || !startTime || !endTime) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startDate));
  if (!dateMatch) return null;
  const y = Number(dateMatch[1]);
  const mo = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const startParts = String(startTime).split(':').map(Number);
  const endParts = String(endTime).split(':').map(Number);
  if (
    [y, mo, d, ...startParts, ...endParts].some(
      (v) => !Number.isFinite(v),
    )
  ) {
    return null;
  }
  const [sh, sm] = startParts;
  const [eh, em] = endParts;
  // Anchor in local server time — same convention the rest of the file
  // uses when building dates from YYYY-MM-DD inputs.
  const start = new Date(y, mo - 1, d, sh, sm || 0, 0, 0);
  let end = new Date(y, mo - 1, d, eh, em || 0, 0, 0);
  if (end.getTime() <= start.getTime()) {
    // Overnight — end is on the next calendar day.
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * Half-open interval intersection: [aStart, aEnd) ∩ [bStart, bEnd) != ∅.
 * Touching at a single boundary (one shift ends at exactly 5:00 PM, next
 * starts at 5:00 PM) is NOT an overlap — that's a hand-off, not a
 * conflict.
 */
function shiftWindowsOverlap(a: ShiftWindow, b: ShiftWindow): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function buildAssignmentDocId(args: { shiftId: string; userId: string; dayKey: string }): string {
  return `${args.shiftId}__${args.userId}__${args.dayKey}`;
}

function buildLegacyAssignmentDocId(args: { shiftId: string; userId: string }): string {
  return `${args.shiftId}__${args.userId}`;
}

function isAssignmentActiveStatus(status: string): boolean {
  return !isAssignmentTerminalNormalized(status);
}

function legacyAssignmentMatchesDay(args: {
  legacyStartDate: string;
  targetDay: string;
  isGigJob: boolean;
}): boolean {
  const legacyDay = String(args.legacyStartDate || '').trim();
  const targetDay = String(args.targetDay || '').trim();
  // For gig/day-scoped flows, a blank legacy date should not block placement for all days.
  if (args.isGigJob) return Boolean(legacyDay && targetDay && legacyDay === targetDay);
  // Career/undated flows can still treat legacy records as matching.
  return legacyDay === targetDay || legacyDay === '';
}

function isIsoDayToken(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function getApplicationApplyDays(applicationData: Record<string, any>): string[] {
  const days = new Set<string>();
  if (Array.isArray(applicationData.applyDates)) {
    applicationData.applyDates.forEach((entry: unknown) => {
      const value = String(entry || '').trim();
      if (isIsoDayToken(value)) days.add(value);
    });
  }
  const applyDate = String(applicationData.applyDate || '').trim();
  if (isIsoDayToken(applyDate)) days.add(applyDate);
  return Array.from(days).sort();
}

/**
 * Auto-release a worker's other OPEN applications that overlap a shift they
 * were just assigned to (2026-07-11 — the Qwick "confirm-lock" adapted to
 * our recruiter-assigns model). Overlapping applications stay allowed at
 * apply time (they signal "I'd take either"); the moment one wins, the
 * losers for the SAME hours are released so other recruiters stop pursuing
 * a worker who is no longer available. The assignment-time overlap guard
 * remains the last line for anything this can't compute.
 *
 * Conservative by design: releases only when the other application's shift
 * TIMES are resolvable (preferredShiftId, else the JO's single shift) and a
 * specific applyDate's window overlaps a new-assignment window. Career
 * apps, day-less express-interest apps, ambiguous multi-shift apps, and
 * no-fixed-times open shifts are left untouched. Never throws — a release
 * failure must not affect the assignment that triggered it.
 */
async function releaseOverlappingApplications(args: {
  tenantId: string;
  userId: string;
  assignedJobOrderId: string;
  assignedJobOrderTitle: string;
  assignedShiftId: string;
  assignedAssignmentId: string;
  /** Absolute windows of the newly created assignment(s). */
  windows: ShiftWindow[];
}): Promise<void> {
  const { tenantId, userId } = args;
  if (args.windows.length === 0) return;
  try {
    const appsSnap = await db
      .collection(`tenants/${tenantId}/applications`)
      .where('userId', '==', userId)
      .get();
    const TERMINAL = new Set([
      'hired',
      'confirmed',
      'rejected',
      'withdrawn',
      'declined',
      'released_overlap',
      'archived',
      'cancelled',
      'canceled',
    ]);
    const joCache = new Map<string, Record<string, any> | null>();
    const postCache = new Map<string, Record<string, any> | null>();
    for (const appDoc of appsSnap.docs) {
      const app = appDoc.data() as Record<string, any>;
      if (TERMINAL.has(String(app.status || '').toLowerCase())) continue;

      let joId = String(app.jobOrderId || '');
      if (!joId) {
        const postRef = String(app.jobId || app.postId || '');
        if (!postRef) continue;
        let post = postCache.get(postRef);
        if (post === undefined) {
          const snap = await db.doc(`tenants/${tenantId}/job_postings/${postRef}`).get();
          post = snap.exists ? (snap.data() as Record<string, any>) : null;
          postCache.set(postRef, post);
        }
        joId = String(post?.jobOrderId || '');
      }
      if (!joId || joId === args.assignedJobOrderId) continue;

      const days = getApplicationApplyDays(app);
      if (days.length === 0) continue;

      let joData = joCache.get(joId);
      if (joData === undefined) {
        const snap = await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get();
        joData = snap.exists ? (snap.data() as Record<string, any>) : null;
        joCache.set(joId, joData);
      }
      if (!joData) continue;

      let shiftData: Record<string, any> | null = null;
      const preferredShiftId = String(app.preferredShiftId || '');
      if (preferredShiftId) {
        const s = await db
          .doc(`tenants/${tenantId}/job_orders/${joId}/shifts/${preferredShiftId}`)
          .get();
        shiftData = s.exists ? (s.data() as Record<string, any>) : null;
      } else {
        const shifts = await db
          .collection(`tenants/${tenantId}/job_orders/${joId}/shifts`)
          .limit(2)
          .get();
        if (shifts.size === 1) shiftData = shifts.docs[0].data() as Record<string, any>;
      }
      if (!shiftData) continue;
      const st = String(shiftData.startTime || shiftData.defaultStartTime || '');
      const et = String(shiftData.endTime || shiftData.defaultEndTime || '');
      if (!st || !et) continue;

      const overlappingDays = days.filter((day) => {
        const w = computeShiftWindow(day, st, et);
        return !!w && args.windows.some((nw) => shiftWindowsOverlap(nw, w));
      });
      if (overlappingDays.length === 0) continue;

      const remaining = days.filter((d) => !overlappingDays.includes(d));
      const patch: Record<string, unknown> = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        overlapReleasedDays: admin.firestore.FieldValue.arrayUnion(...overlappingDays),
        overlapReleasedFrom: {
          assignmentId: args.assignedAssignmentId,
          jobOrderId: args.assignedJobOrderId,
          shiftId: args.assignedShiftId,
        },
      };
      if (remaining.length === 0) {
        patch.status = 'released_overlap';
        patch.statusChangeReason = 'overlaps_confirmed_assignment';
        patch.releasedAt = admin.firestore.FieldValue.serverTimestamp();
      } else {
        patch.applyDates = remaining;
        patch.applyDate = remaining[0];
      }
      await appDoc.ref.set(patch, { merge: true });

      try {
        const otherTitle = String(joData.jobOrderName || joData.jobTitle || 'another shift');
        await sendNotificationAndPush({
          uid: userId,
          tenantId,
          title: "You're booked!",
          body: `You're confirmed for ${args.assignedJobOrderTitle}. Your request for ${otherTitle} on ${overlappingDays.join(', ')} was released because it overlaps your booked shift.`,
          severity: 'info',
          source: 'automation',
        });
      } catch {
        /* notification is best-effort */
      }
      logger.info('placements: released overlapping application', {
        tenantId,
        userId,
        applicationId: appDoc.id,
        overlappingDays,
        remainingDays: remaining.length,
      });
    }
  } catch (err) {
    logger.warn('placements: overlap auto-release failed (non-fatal)', {
      tenantId,
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function canManageAssignmentsFromClaims(auth: any, tenantId: string): boolean {
  const roles = auth?.token?.roles || {};
  const tenantRole = roles?.[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return true;
  if (auth?.token?.isHRX === true) return true;
  return false;
}

export async function canManageAssignments(auth: any, tenantId: string, uid: string): Promise<boolean> {
  if (canManageAssignmentsFromClaims(auth, tenantId)) return true;

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) return false;
  const userData: any = userSnap.data() || {};

  const tenantMeta = userData?.tenantIds?.[tenantId] || {};
  const role = String(tenantMeta.role || userData.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return true;

  const recruiterEnabled = Boolean(tenantMeta.recruiter ?? userData.recruiter);
  if (recruiterEnabled) return true;

  const secRaw = tenantMeta.securityLevel ?? userData.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) return true;

  return false;
}

// --- Onboarding (Phase 1A) ---
type OnboardingConfig = {
  entityId: string | null;
  requirementPackageId: string | null;
  packageData: any | null;
  blockedReason?: string;
};

async function resolveOnboardingConfigForJobOrder(params: {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
}): Promise<OnboardingConfig> {
  const { tenantId, jobOrder } = params;

  const entityId = jobOrder?.entityId || null;
  if (!entityId) {
    return {
      entityId: null,
      requirementPackageId: null,
      packageData: null,
      blockedReason: 'Job order missing entityId',
    };
  }

  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
  if (!entitySnap.exists) {
    return {
      entityId,
      requirementPackageId: null,
      packageData: null,
      blockedReason: `Entity not found: ${entityId}`,
    };
  }

  const entity = entitySnap.data() || {};
  const requirementPackageId =
    jobOrder?.requirementPackageId ||
    entity?.defaultRequirementPackageId ||
    null;

  if (!requirementPackageId) {
    return {
      entityId,
      requirementPackageId: null,
      packageData: null,
      blockedReason: 'No requirementPackageId on job order and no defaultRequirementPackageId on entity',
    };
  }

  const pkgSnap = await db
    .doc(`tenants/${tenantId}/requirement_packages/${requirementPackageId}`)
    .get();

  if (!pkgSnap.exists) {
    return {
      entityId,
      requirementPackageId,
      packageData: null,
      blockedReason: `Requirement package not found: ${requirementPackageId}`,
    };
  }

  return {
    entityId,
    requirementPackageId,
    packageData: pkgSnap.data() || {},
  };
}

async function ensureOnboardingInstance(params: {
  tenantId: string;
  assignmentId: string;
  userId: string;
  jobOrderId: string;
  shiftId: string;
  entityId: string | null;
  requirementPackageId: string | null;
  packageData: any | null;
  createdBy: any;
  blockedReason?: string;
}) {
  const {
    tenantId,
    assignmentId,
    userId,
    jobOrderId,
    shiftId,
    entityId,
    requirementPackageId,
    packageData,
    createdBy,
    blockedReason,
  } = params;

  const instRef = db.doc(`tenants/${tenantId}/onboarding_instances/${assignmentId}`);
  const instSnap = await instRef.get();
  if (instSnap.exists) return; // idempotent

  const resolvedSteps = Array.isArray(packageData?.steps) ? packageData.steps : [];
  const resolvedDocuments = Array.isArray(packageData?.documents) ? packageData.documents : [];
  const resolvedChecks = Array.isArray(packageData?.checks) ? packageData.checks : [];

  const status =
    entityId && requirementPackageId && packageData
      ? 'not_started'
      : 'blocked';

  await instRef.set(
    {
      tenantId,
      assignmentId,
      userId,
      jobOrderId,
      shiftId,
      entityId,
      requirementPackageId,

      status,
      percentComplete: 0,

      resolvedSteps,
      resolvedDocuments,
      resolvedChecks,

      blockedReason:
        status === 'blocked'
          ? blockedReason || 'Missing onboarding configuration'
          : null,

      createdBy: createdBy ? { userId: createdBy } : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: false },
  );
}

// --- End Onboarding ---

async function resolveApplicationForAssignment(args: {
  tenantId: string;
  jobOrderId: string;
  shiftId: string;
  userId: string;
  createdBy: string;
  assignmentId: string;
  jobPostId?: string;
  entityId?: string | null;
}) {
  const { tenantId, jobOrderId, shiftId, userId, createdBy, assignmentId, jobPostId, entityId } = args;
  const applicationsRef = db.collection(`tenants/${tenantId}/applications`);

  const [byShiftSnap, byShiftIdsSnap, byUserJobSnap] = await Promise.all([
    applicationsRef
      .where('userId', '==', userId)
      .where('jobOrderId', '==', jobOrderId)
      .where('shiftId', '==', shiftId)
      .limit(1)
      .get(),
    applicationsRef
      .where('userId', '==', userId)
      .where('jobOrderId', '==', jobOrderId)
      .where('shiftIds', 'array-contains', shiftId)
      .limit(1)
      .get(),
    applicationsRef
      .where('userId', '==', userId)
      .where('jobOrderId', '==', jobOrderId)
      .limit(1)
      .get(),
  ]);

  const existing = byShiftSnap.docs[0] || byShiftIdsSnap.docs[0] || byUserJobSnap.docs[0];
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (existing) {
    const data = existing.data() || {};
    const nextShiftIds = Array.isArray(data.shiftIds) ? Array.from(new Set([...data.shiftIds, shiftId])) : [shiftId];
    const updateData: Record<string, any> = {
      status: 'accepted',
      assignmentId,
      shiftId: data.shiftId || shiftId,
      shiftIds: nextShiftIds,
      updatedAt: now,
      updatedBy: createdBy,
    };
    if (entityId != null) updateData.entityId = entityId;
    await existing.ref.set(updateData, { merge: true });
    return existing.id;
  }

  const created = await applicationsRef.add({
    tenantId,
    jobOrderId,
    userId,
    jobId: jobPostId || null,
    postId: jobPostId || null,
    status: 'accepted',
    shiftId,
    shiftIds: [shiftId],
    source: 'manual',
    assignmentId,
    entityId: entityId ?? null,
    candidate: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  });

  return created.id;
}

export const placementsCreateAssignments = onCall(
  { cors: true, secrets: PLACEMENT_SMS_SECRETS },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const {
    tenantId,
    jobOrderId,
    shiftId,
    userIds,
    sourceType = 'manual',
    sourceId = null,
    applyDate = null,
    applyDates = null,
    allowOverlapping = false,
  } = (request.data || {}) as {
    tenantId?: string;
    jobOrderId?: string;
    shiftId?: string;
    userIds?: string[];
    sourceType?: string;
    sourceId?: string | null;
    applyDate?: string | null;
    applyDates?: string[] | null;
    /**
     * Recruiter override: when true, the same-day overlap guard
     * (`overlapping_assignment` skip) is bypassed. The UI surfaces this
     * flag via an "Assign anyway" action on the conflict toast — the
     * default-off stance keeps accidental double-books from sneaking
     * through but lets the recruiter deliberately stack a worker on two
     * concurrent shifts when needed (e.g., a short break between shift
     * A's end and shift B's start, or knowingly splitting hours).
     */
    allowOverlapping?: boolean;
  };

  if (!tenantId || !jobOrderId || !shiftId || !Array.isArray(userIds) || userIds.length === 0) {
    throw new HttpsError('invalid-argument', 'tenantId, jobOrderId, shiftId, and userIds[] are required');
  }
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Insufficient permissions to assign workers');
  }

  const createdBy = request.auth.uid;
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

  try {
  const [jobOrderSnap, shiftSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get(),
    db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`).get(),
  ]);

  if (!jobOrderSnap.exists) throw new HttpsError('not-found', 'Job order not found');
  if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found');

  const jobOrder = jobOrderSnap.data() || {};
  const skipPlacementWorkerNotifications = Boolean(jobOrder.muted);
  const shift = shiftSnap.data() || {};
  const isGigJob = String(jobOrder.jobType || '').toLowerCase() === 'gig';

  // DNR (Do Not Return) — a worker marked DNR for this JO's account (child
  // or national) can never be assigned here. Hard reject with names so the
  // recruiter knows exactly who and why; nothing is created for anyone.
  {
    const { blockedUserIds } = await filterDnrRecipients(db, jobOrder, uniqueUserIds);
    if (blockedUserIds.length > 0) {
      const names = await Promise.all(
        blockedUserIds.map(async (bid) => {
          const u = (await db.doc(`users/${bid}`).get()).data() || {};
          return [u.firstName, u.lastName].filter(Boolean).join(' ') || bid;
        }),
      );
      throw new HttpsError(
        'failed-precondition',
        `DNR: ${names.join(', ')} cannot be assigned to this account (Do Not Return). Remove them and retry.`,
      );
    }
  }

  // Position-aware rate resolution (Greg, 2026-04-30 cascade audit).
  // Priority order for assignment payRate / billRate:
  //   1. `shift.payRate` / `shift.billRate` — snapshot stamped by
  //      `EditShiftForm` at save time (every new shift carries this).
  //   2. The position on the JO matching `shift.defaultJobTitle`
  //      (case-insensitive). Catches legacy shifts that pre-date the
  //      shift-form snapshot fix and JOs with multi-position pricing
  //      where each position has a different rate.
  //   3. JO top-level `payRate` / `billRate`.
  // Without this lookup, a multi-position JO would always assign at
  // position[0]'s rate regardless of which position the shift was for.
  const findShiftPosition = (): Record<string, unknown> | null => {
    const title = String(shift.defaultJobTitle ?? '').trim().toLowerCase();
    if (!title) return null;
    const candidates = Array.isArray(jobOrder.positions) && jobOrder.positions.length > 0
      ? jobOrder.positions
      : Array.isArray(jobOrder.gigPositions)
        ? jobOrder.gigPositions
        : [];
    return (
      (candidates as Array<Record<string, unknown>>).find(
        (p) => String((p?.jobTitle as string | undefined) ?? '').trim().toLowerCase() === title,
      ) ?? null
    );
  };
  const positionForShift = findShiftPosition();
  const positionPayRate = safeFiniteNumber(
    (positionForShift?.payRate as number | string | undefined) ?? undefined,
    NaN,
  );
  const positionBillRate = safeFiniteNumber(
    (positionForShift?.billRate as number | string | undefined) ?? undefined,
    NaN,
  );
  const resolvedPayRate = (() => {
    const fromShift = safeFiniteNumber(shift.payRate, NaN);
    if (Number.isFinite(fromShift) && fromShift > 0) return fromShift;
    if (Number.isFinite(positionPayRate) && positionPayRate > 0) return positionPayRate;
    return safeFiniteNumber(jobOrder.payRate, 0);
  })();
  const resolvedBillRate = (() => {
    const fromShift = safeFiniteNumber(shift.billRate, NaN);
    if (Number.isFinite(fromShift) && fromShift > 0) return fromShift;
    if (Number.isFinite(positionBillRate) && positionBillRate > 0) return positionBillRate;
    return safeFiniteNumber(jobOrder.billRate, 0);
  })();
  const onboardingConfig = await resolveOnboardingConfigForJobOrder({
    tenantId,
    jobOrderId,
    jobOrder,
  });
  const shiftDate = toDateOnly(shift.shiftDate);
  const shiftEndDate = toDateOnly(shift.endDate) || shiftDate;
  const bulkDates = Array.isArray(applyDates) && applyDates.length > 0
    ? [...new Set(applyDates.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))]
    : null;
  const useBulkDates = bulkDates && bulkDates.length > 0;
  const effectiveStartDate = useBulkDates ? shiftDate : (applyDate && /^\d{4}-\d{2}-\d{2}$/.test(applyDate) ? applyDate : shiftDate);
  const effectiveEndDate = useBulkDates ? shiftEndDate : (applyDate && /^\d{4}-\d{2}-\d{2}$/.test(applyDate) ? applyDate : shiftEndDate);
  const shiftStartMin = parseMinutes(shift.startTime || shift.defaultStartTime);
  const shiftEndMin = parseMinutes(shift.endTime || shift.defaultEndTime);

  const locationId = jobOrder.worksiteId || jobOrder.locationId;
  const locationSnap = locationId
    ? await db.doc(`tenants/${tenantId}/locations/${locationId}`).get()
    : null;
  const locationData = locationSnap?.exists ? locationSnap.data() || {} : {};
  const latitude = safeFiniteNumber(locationData.latitude ?? locationData.lat, 0);
  const longitude = safeFiniteNumber(locationData.longitude ?? locationData.lng, 0);
  const locationNickname = locationData.nickname || locationData.title || locationData.name || locationData.locationName || jobOrder.worksiteName || '';

  const postingSnap = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', jobOrderId)
    .limit(1)
    .get();
  const jobPostId = postingSnap.docs[0]?.id;

  const created: Array<{ userId: string; assignmentId: string; warnings: string[] }> = [];
  const skipped: Array<{ userId: string; reason: string }> = [];
  const failed: Array<{ userId: string; error: string }> = [];

  // ---- Open shift fast path -------------------------------------------
  // An "open" shift is a standing-crew assignment over a date range with
  // no fixed daily times. Placing a worker creates ONE ongoing "active"
  // assignment per worker — there's no offer to accept and no
  // accept/decline SMS (`suppressInitialNotification`), and the same-day
  // time-overlap guard doesn't apply (no times). Hours are entered
  // weekly later. Isolated from the standard offer/overlap machinery on
  // purpose so the normal placement flow is untouched.
  const isOpenShift = String(shift.shiftType || '').toLowerCase() === 'open';
  if (isOpenShift) {
    const openStartDate = effectiveStartDate || shiftDate || '';
    const openEndDate = toDateOnly(shift.endDate) || ''; // '' = ongoing / rolling
    for (const userId of uniqueUserIds) {
      try {
        const userSnap = await db.doc(`users/${userId}`).get();
        if (!userSnap.exists) {
          skipped.push({ userId, reason: 'user_not_found' });
          continue;
        }
        const userData = userSnap.data() || {};
        const firstName =
          String(userData.firstName || '').trim() ||
          String(userData.displayName || '').split(' ')[0] ||
          '';
        const lastName =
          String(userData.lastName || '').trim() ||
          String(userData.displayName || '').split(' ').slice(1).join(' ').trim() ||
          '';
        // One assignment per (open shift, worker) — simple/legacy id, not
        // day-scoped: the crew membership is continuous, not per-day.
        const assignmentRef = db
          .collection(`tenants/${tenantId}/assignments`)
          .doc(buildLegacyAssignmentDocId({ shiftId, userId }));
        const existing = await assignmentRef.get();
        const existingStatus = existing.exists
          ? String((existing.data() || {}).status || '').toLowerCase()
          : '';
        if (existing.exists && isAssignmentActiveStatus(existingStatus)) {
          skipped.push({ userId, reason: 'already_assigned_to_shift' });
          continue;
        }
        const onboardingStatus =
          onboardingConfig.entityId &&
          onboardingConfig.requirementPackageId &&
          onboardingConfig.packageData
            ? 'not_started'
            : 'blocked';
        const assignmentData: any = {
          tenantId,
          jobOrderId,
          shiftId,
          candidateId: userId,
          userId,
          status: 'active',
          isOpenShift: true,
          noFixedTimes: true,
          startDate: openStartDate,
          endDate: openEndDate,
          startTime: '',
          endTime: '',
          payRate: resolvedPayRate,
          billRate: resolvedBillRate,
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
          assignmentSource: sourceType,
          sourceGroupId: sourceType === 'group' ? sourceId : null,
          placementMode: 'assign_now',
          jobPostId: jobPostId || null,
          createdBy,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          assignedAt: admin.firestore.FieldValue.serverTimestamp(),
          // No worker offer/accept step for an open shift.
          suppressInitialNotification: true,
          entityId: onboardingConfig.entityId ?? null,
          requirementPackageId: onboardingConfig.requirementPackageId ?? null,
          onboardingInstanceId: assignmentRef.id,
          onboardingStatus,
          onboardingPercent: 0,
        };
        await assignmentRef.set(assignmentData, { merge: false });
        await ensureOnboardingInstance({
          tenantId,
          assignmentId: assignmentRef.id,
          userId,
          jobOrderId,
          shiftId,
          entityId: onboardingConfig.entityId,
          requirementPackageId: onboardingConfig.requirementPackageId,
          packageData: onboardingConfig.packageData,
          createdBy,
          blockedReason: onboardingConfig.blockedReason,
        });
        const applicationId = await resolveApplicationForAssignment({
          tenantId,
          jobOrderId,
          shiftId,
          userId,
          createdBy,
          assignmentId: assignmentRef.id,
          jobPostId,
          entityId: onboardingConfig.entityId,
        });
        await assignmentRef.set(
          { applicationId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
        created.push({ userId, assignmentId: assignmentRef.id, warnings: [] });
      } catch (error: any) {
        failed.push({ userId, error: error?.message || 'unknown_error' });
      }
    }
    return { success: failed.length === 0, created, skipped, failed, openShift: true };
  }

  if (useBulkDates && bulkDates) {
    const createdByUserId = new Map<string, Array<{ assignmentId: string; date: string }>>();
    for (const userId of uniqueUserIds) {
      try {
        const userSnap = await db.doc(`users/${userId}`).get();
        if (!userSnap.exists) {
          skipped.push({ userId, reason: 'user_not_found' });
          continue;
        }
        const userData = userSnap.data() || {};
        const firstName = String(userData.firstName || '').trim() || String(userData.displayName || '').split(' ')[0] || '';
        const lastName = String(userData.lastName || '').trim() || (String(userData.displayName || '').split(' ').slice(1).join(' ').trim()) || '';
        const warnings: string[] = [];
        const userCreated: Array<{ assignmentId: string; date: string }> = [];
        for (const singleDate of bulkDates) {
          const assignmentDocId = buildAssignmentDocId({ shiftId, userId, dayKey: singleDate });
          const assignmentRef = db.collection(`tenants/${tenantId}/assignments`).doc(assignmentDocId);
          const legacyAssignmentRef = db
            .collection(`tenants/${tenantId}/assignments`)
            .doc(buildLegacyAssignmentDocId({ shiftId, userId }));
          const [assignmentDoc, legacyAssignmentDoc] = await Promise.all([
            assignmentRef.get(),
            legacyAssignmentRef.get(),
          ]);
          const existingStatus = assignmentDoc.exists ? String((assignmentDoc.data() || {}).status || '').toLowerCase() : '';
          const legacyStatus = legacyAssignmentDoc.exists
            ? String((legacyAssignmentDoc.data() || {}).status || '').toLowerCase()
            : '';
          const legacyStartDate = legacyAssignmentDoc.exists
            ? toDateOnly((legacyAssignmentDoc.data() || {}).startDate)
            : '';
          const legacySameDay = legacyAssignmentMatchesDay({
            legacyStartDate,
            targetDay: singleDate,
            isGigJob,
          });
          if (
            (assignmentDoc.exists && isAssignmentActiveStatus(existingStatus)) ||
            (legacyAssignmentDoc.exists && legacySameDay && isAssignmentActiveStatus(legacyStatus))
          ) {
            continue;
          }
          const activeAssignments = await db
            .collection(`tenants/${tenantId}/assignments`)
            .where('userId', '==', userId)
            .where('status', 'in', [...ASSIGNMENT_STATUS_QUERY_LIVE])
            .get();
          let blockedByOverlap = false;
          activeAssignments.docs.forEach((docSnap) => {
            const assignment = docSnap.data() || {};
            if (assignment.shiftId === shiftId) return;
            const assignmentStartDate = toDateOnly(assignment.startDate);
            if (assignmentStartDate !== singleDate) return;
            const existingStart = parseMinutes(assignment.startTime);
            const existingEnd = parseMinutes(assignment.endTime);
            if (overlapsSameDay(shiftStartMin, shiftEndMin, existingStart, existingEnd)) blockedByOverlap = true;
          });
          if (blockedByOverlap) continue;
          const isReactivating = assignmentDoc.exists && !isAssignmentActiveStatus(existingStatus);
          const assignmentData: any = {
            tenantId,
            jobOrderId,
            shiftId,
            candidateId: userId,
            userId,
            status: 'pending',
            startDate: singleDate,
            endDate: singleDate,
            startTime: shift.startTime || shift.defaultStartTime || '',
            endTime: shift.endTime || shift.defaultEndTime || '',
            payRate: resolvedPayRate,
            billRate: resolvedBillRate,
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
            assignmentSource: sourceType,
            sourceGroupId: sourceType === 'group' ? sourceId : null,
            placementMode: 'assign_now',
            jobPostId: jobPostId || null,
            createdBy,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            suppressInitialNotification: true,
            entityId: onboardingConfig.entityId ?? null,
            requirementPackageId: onboardingConfig.requirementPackageId ?? null,
            onboardingInstanceId: assignmentRef.id,
            onboardingStatus: (onboardingConfig.entityId && onboardingConfig.requirementPackageId && onboardingConfig.packageData) ? 'not_started' : 'blocked',
            onboardingPercent: 0,
          };
          if (isReactivating) {
            await assignmentRef.set(
              {
                status: 'pending',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                assignedAt: admin.firestore.FieldValue.serverTimestamp(),
                suppressInitialNotification: true,
                entityId: onboardingConfig.entityId,
                requirementPackageId: onboardingConfig.requirementPackageId,
                onboardingInstanceId: assignmentRef.id,
                onboardingStatus: (onboardingConfig.entityId && onboardingConfig.requirementPackageId && onboardingConfig.packageData) ? 'not_started' : 'blocked',
                onboardingPercent: 0,
                canceledAt: admin.firestore.FieldValue.delete(),
                cancellationReason: admin.firestore.FieldValue.delete(),
                declinedAt: admin.firestore.FieldValue.delete(),
                declinedBy: admin.firestore.FieldValue.delete(),
              },
              { merge: true },
            );
          } else {
            await assignmentRef.set(assignmentData, { merge: false });
          }
          await ensureOnboardingInstance({
            tenantId,
            assignmentId: assignmentRef.id,
            userId,
            jobOrderId,
            shiftId,
            entityId: onboardingConfig.entityId,
            requirementPackageId: onboardingConfig.requirementPackageId,
            packageData: onboardingConfig.packageData,
            createdBy,
            blockedReason: onboardingConfig.blockedReason,
          });
          const applicationId = await resolveApplicationForAssignment({
            tenantId,
            jobOrderId,
            shiftId,
            userId,
            createdBy,
            assignmentId: assignmentRef.id,
            jobPostId,
            entityId: onboardingConfig.entityId,
          });
          await assignmentRef.set(
            { applicationId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
          );
          created.push({ userId, assignmentId: assignmentRef.id, warnings });
          userCreated.push({ assignmentId: assignmentRef.id, date: singleDate });
        }
        if (userCreated.length > 0) {
          createdByUserId.set(userId, userCreated);
          // These day(s) are now booked — release the worker's overlapping
          // OPEN applications elsewhere (see releaseOverlappingApplications).
          const relSt = String(shift.startTime || shift.defaultStartTime || '');
          const relEt = String(shift.endTime || shift.defaultEndTime || '');
          const relWindows = userCreated
            .map((c) => computeShiftWindow(c.date, relSt, relEt))
            .filter((w): w is ShiftWindow => !!w);
          await releaseOverlappingApplications({
            tenantId,
            userId,
            assignedJobOrderId: jobOrderId,
            assignedJobOrderTitle: String(
              jobOrder.jobOrderName || jobOrder.jobTitle || 'your shift',
            ),
            assignedShiftId: shiftId,
            assignedAssignmentId: userCreated[0].assignmentId,
            windows: relWindows,
          });
        }
      } catch (error: any) {
        failed.push({ userId, error: error?.message || 'unknown_error' });
      }
    }
    if (!skipPlacementWorkerNotifications) {
      for (const [userId, assignments] of createdByUserId) {
        try {
          const userDoc = await db.doc(`users/${userId}`).get();
          const userData = userDoc.data() || {};
          const phoneE164 = (userData?.phoneE164 || userData?.phone || '').trim();
          const firstName = assignments.length ? (userData?.firstName as string) || 'there' : 'there';
          const jobTitle = shift.defaultJobTitle || jobOrder.jobTitle || 'a position';
          // Build EN + ES variants of the date/time/location phrases so
          // Spanish-language workers see a fully localized SMS (day name
          // included), not just "el Sat 6/8" with an English day name.
          // The helper picks the right pair based on `language`; see
          // `buildAssignmentOfferSms`.
          const buildDateStrs = (locale: string) =>
            assignments.map((a) => {
              const d = new Date(a.date + 'T12:00:00');
              return d.toLocaleDateString(locale, {
                weekday: 'short',
                month: 'numeric',
                day: 'numeric',
              });
            });
          const dateStrsEn = buildDateStrs('en-US');
          const dateStrsEs = buildDateStrs('es-US');
          // Append shift start/end times when the shift has uniform
          // hours across the day(s) — parity with `resendAssignmentOffer`
          // which already appends times. For multi-day shifts with
          // per-date times in `dateSchedule`, we'd need a different
          // shape; fall back to date-only in that case.
          const shiftStart = shift.startTime || shift.defaultStartTime || '';
          const shiftEnd = shift.endTime || shift.defaultEndTime || '';
          const hasUniformTimes = Boolean(shiftStart && shiftEnd);
          // AM/PM stays English on purpose — Spanish speakers in the US
          // are accustomed to AM/PM in SMS, and "11:00 a. m." reads
          // weirdly in a quick read.
          const timeRangeEn = hasUniformTimes
            ? ` from ${formatTime12h(shiftStart)} - ${formatTime12h(shiftEnd)}`
            : '';
          const timeRangeEs = hasUniformTimes
            ? ` de ${formatTime12h(shiftStart)} a ${formatTime12h(shiftEnd)}`
            : '';
          const dateTimeInfo = dateStrsEn.length ? ` on ${dateStrsEn.join(', ')}${timeRangeEn}` : '';
          const dateTimeInfoEs = dateStrsEs.length ? ` el ${dateStrsEs.join(', ')}${timeRangeEs}` : '';
          const acceptUrl = buildWorkerAssignmentAcceptUrl({
            assignmentId: assignments[0].assignmentId,
            jobPostId,
          });
          const declineUrl = buildWorkerAssignmentDeclineUrl({
            assignmentId: assignments[0].assignmentId,
            jobPostId,
          });
          const locationText = locationNickname ? ` at ${locationNickname}` : '';
          const locationTextEs = locationNickname ? ` en ${locationNickname}` : '';
          // New ACCEPT/DECLINE pattern — replaces the legacy single
          // "View details and respond:" link. EN/ES picked from the
          // worker doc; see `buildAssignmentOfferSms`.
          const { buildAssignmentOfferSms, resolveOfferLanguage } = await import(
            './messaging/buildAssignmentOfferSms'
          );
          const message = buildAssignmentOfferSms({
            firstName,
            jobTitle,
            dateTimeInfo,
            dateTimeInfoEs,
            locationText,
            locationTextEs,
            acceptUrl,
            declineUrl,
            language: resolveOfferLanguage(userData),
          });
          let emailSubject: string | undefined;
          let emailBody: string | undefined;
          try {
            const { buildAssignmentDetailsEmail } = await import('./messaging/assignmentDetailsEmail');
            const emailResult = await buildAssignmentDetailsEmail(tenantId, assignments[0].assignmentId);
            if (emailResult) {
              emailSubject = emailResult.subject;
              emailBody = emailResult.html;
            }
          } catch (_) {
            /* ignore */
          }
          const { sendLegacyAssignmentMessage } = await import('./messaging/legacyMessageHelpers');
          await sendLegacyAssignmentMessage({
            tenantId,
            userId,
            phoneE164: phoneE164 || '+0000000000',
            message,
            messageTypeId: 'assignment_created',
            source: 'assignment_created',
            sourceId: assignments[0].assignmentId,
            assignmentId: assignments[0].assignmentId,
            emailSubject,
            emailBody,
          });
        } catch (notifyErr: any) {
          // log but don't fail the whole operation
          console.warn(`Bulk assignment notification failed for user ${userId}:`, notifyErr?.message);
        }
      }
    }
    return { success: failed.length === 0, created, skipped, failed };
  }

  for (const userId of uniqueUserIds) {
    try {
      const userSnap = await db.doc(`users/${userId}`).get();
      if (!userSnap.exists) {
        skipped.push({ userId, reason: 'user_not_found' });
        continue;
      }
      const userData = userSnap.data() || {};
      const warnings: string[] = [];

      const shouldUseDayScopedAssignmentId = isGigJob || effectiveStartDate !== shiftDate || effectiveEndDate !== shiftEndDate;
      const canonicalAssignmentDocId = shouldUseDayScopedAssignmentId
        ? buildAssignmentDocId({ shiftId, userId, dayKey: effectiveStartDate })
        : buildLegacyAssignmentDocId({ shiftId, userId });
      const legacyAssignmentDocId = buildLegacyAssignmentDocId({ shiftId, userId });
      const assignmentRef = db.collection(`tenants/${tenantId}/assignments`).doc(canonicalAssignmentDocId);
      const legacyAssignmentRef = db.collection(`tenants/${tenantId}/assignments`).doc(legacyAssignmentDocId);
      const [assignmentDoc, legacyAssignmentDoc] = await Promise.all([
        assignmentRef.get(),
        canonicalAssignmentDocId === legacyAssignmentDocId ? Promise.resolve(null) : legacyAssignmentRef.get(),
      ]);
      const existingStatus = assignmentDoc.exists ? String((assignmentDoc.data() || {}).status || '').toLowerCase() : '';
      const legacyStatus =
        legacyAssignmentDoc?.exists
          ? String((legacyAssignmentDoc.data() || {}).status || '').toLowerCase()
          : '';
      const legacyStartDate = legacyAssignmentDoc?.exists
        ? toDateOnly((legacyAssignmentDoc.data() || {}).startDate)
        : '';
      const legacySameDay = legacyAssignmentMatchesDay({
        legacyStartDate,
        targetDay: effectiveStartDate,
        isGigJob,
      });
      // Phantom-doc guard: ~60 zero-field assignment docs live in this
      // tenant from some earlier write path (no `userId`, no `status`,
      // no `startDate`). Before this guard, the lookup-by-ID found
      // them, read `status` as '', `normalizeAssignmentStatus('')`
      // defaulted to 'pending' (active), and the recruiter saw a
      // false "already assigned to this shift" toast on a worker whose
      // placement tile clearly wasn't on the target shift. Require an
      // explicit non-empty status before considering the slot taken.
      const hasExistingForThisSlot =
        (assignmentDoc.exists &&
          Boolean(existingStatus) &&
          isAssignmentActiveStatus(existingStatus)) ||
        Boolean(
          legacyAssignmentDoc?.exists &&
            legacySameDay &&
            legacyStatus &&
            isAssignmentActiveStatus(legacyStatus),
        );
      if (hasExistingForThisSlot) {
        skipped.push({ userId, reason: 'already_assigned_to_shift' });
        continue;
      }

      const activeAssignments = await db
        .collection(`tenants/${tenantId}/assignments`)
        .where('userId', '==', userId)
        .where('status', 'in', [...ASSIGNMENT_STATUS_QUERY_LIVE])
        .get();

      let blockedByOverlap = false;
      let sameDayDifferentShift = false;
      // Build the new shift's absolute time window once per user so we
      // can compare it to each existing assignment's window. This
      // replaces the legacy minute-of-day check that erroneously
      // matched only on `startDate` — that approach false-positived on
      // overnight shifts (5 PM → 3 AM ends on the NEXT calendar day, so
      // a same-startDate compare with a non-overnight 5 PM start
      // produced incorrect overlap), and false-negatived for the
      // genuine cross-day cases (Mon 11 PM → Tue 7 AM overlaps a Tue
      // 6 AM → 2 PM shift — old code returned at the date mismatch).
      const newShiftStartTime = shift.startTime || shift.defaultStartTime || '';
      const newShiftEndTime = shift.endTime || shift.defaultEndTime || '';
      const newWindow = computeShiftWindow(
        effectiveStartDate,
        newShiftStartTime,
        newShiftEndTime,
      );

      activeAssignments.docs.forEach((docSnap) => {
        const assignment = docSnap.data() || {};
        const assignmentShiftId = assignment.shiftId;
        if (assignmentShiftId === shiftId) return;

        const existingStartDate = toDateOnly(assignment.startDate);
        const existingWindow = computeShiftWindow(
          existingStartDate,
          assignment.startTime,
          assignment.endTime,
        );

        // Window-based overlap test — handles overnight + cross-day
        // shifts that the legacy minute-of-day check got wrong.
        if (newWindow && existingWindow) {
          if (shiftWindowsOverlap(newWindow, existingWindow)) {
            blockedByOverlap = true;
            return;
          }
          // Not overlapping. Still flag same-day-second-shift so the
          // caller can attach the soft warning ("worker on a second
          // shift today") — purely informational, doesn't block.
          if (existingStartDate === effectiveStartDate) {
            sameDayDifferentShift = true;
          }
          return;
        }

        // Fallback: one of the windows didn't have parseable times
        // (defensive — should be rare). Use the legacy minute-of-day
        // overlap on same-startDate matches only, which preserves the
        // pre-fix behavior for that one edge case.
        if (existingStartDate !== effectiveStartDate) return;
        const existingStart = parseMinutes(assignment.startTime);
        const existingEnd = parseMinutes(assignment.endTime);
        if (overlapsSameDay(shiftStartMin, shiftEndMin, existingStart, existingEnd)) {
          blockedByOverlap = true;
          return;
        }
        sameDayDifferentShift = true;
      });

      if (blockedByOverlap && !allowOverlapping) {
        skipped.push({ userId, reason: 'overlapping_assignment' });
        continue;
      }
      // Even when overriding, log a warning so the audit trail captures
      // that this assignment was deliberately stacked on top of another.
      if (blockedByOverlap && allowOverlapping) {
        warnings.push('overlapping_assignment_overridden');
      }
      if (sameDayDifferentShift) {
        warnings.push('same_day_second_shift_warning');
      }

      const firstName = String(userData.firstName || '').trim() || String(userData.displayName || '').split(' ')[0] || '';
      const lastName =
        String(userData.lastName || '').trim() ||
        String(userData.displayName || '')
          .split(' ')
          .slice(1)
          .join(' ')
          .trim() ||
        '';

      const isReactivating = assignmentDoc.exists && !isAssignmentActiveStatus(existingStatus);

      if (isReactivating) {
        const onboardingStatus =
          onboardingConfig.entityId &&
          onboardingConfig.requirementPackageId &&
          onboardingConfig.packageData
            ? 'not_started'
            : 'blocked';
        await assignmentRef.set(
          {
            status: 'pending',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            entityId: onboardingConfig.entityId,
            requirementPackageId: onboardingConfig.requirementPackageId,
            onboardingInstanceId: assignmentRef.id,
            onboardingStatus,
            onboardingPercent: 0,
            // Clear cancellation fields
            canceledAt: admin.firestore.FieldValue.delete(),
            cancellationReason: admin.firestore.FieldValue.delete(),
            declinedAt: admin.firestore.FieldValue.delete(),
            declinedBy: admin.firestore.FieldValue.delete(),
          },
          { merge: true },
        );
        await ensureOnboardingInstance({
          tenantId,
          assignmentId: assignmentRef.id,
          userId,
          jobOrderId,
          shiftId,
          entityId: onboardingConfig.entityId,
          requirementPackageId: onboardingConfig.requirementPackageId,
          packageData: onboardingConfig.packageData,
          createdBy,
          blockedReason: onboardingConfig.blockedReason,
        });
      } else {
        // A recurring multi-day shift (weeklySchedule has 2+ enabled days)
        // placed via plain "assign now" (no explicit applyDate/applyDates —
        // i.e. the recruiter didn't pick a single date) represents an
        // ONGOING placement, not a single calendar day. Defaulting endDate
        // to the shift's own anchor `shiftDate` collapsed it to one day —
        // and when that anchor date's day-of-week isn't even one of the
        // shift's enabled recurring days (shifts don't validate that their
        // own start date lands on an enabled day), the denorm trigger's
        // per-day weeklySchedule remap then keyed the assignment to that
        // WRONG/disabled day, so the worker only ever showed up on that one
        // bad day of the week instead of the shift's real Mon-Fri (etc.)
        // pattern. Leave endDate open-ended in that case so the trigger
        // copies the shift's real weeklySchedule verbatim (see
        // `resolveWeeklySchedule` / `onAssignmentWriteEnsureDenormFields`).
        const shiftEnabledDayCount = (() => {
          const ws = shift.weeklySchedule;
          if (!ws || typeof ws !== 'object') return 0;
          return Object.values(ws as Record<string, unknown>).filter(
            (d) => d && typeof d === 'object' && (d as Record<string, unknown>).enabled === true,
          ).length;
        })();
        const isExplicitSingleDate = !!(applyDate && /^\d{4}-\d{2}-\d{2}$/.test(applyDate));
        const isOngoingRecurringPlacement =
          !useBulkDates && !isExplicitSingleDate && shiftEnabledDayCount > 1;
        const resolvedEndDate = isOngoingRecurringPlacement
          ? ''
          : effectiveEndDate || effectiveStartDate || '';
        const assignmentData: any = {
          tenantId,
          jobOrderId,
          shiftId,
          candidateId: userId,
          userId,
          status: 'pending',
          startDate: effectiveStartDate || '',
          endDate: resolvedEndDate,
          startTime: shift.startTime || shift.defaultStartTime || '',
          endTime: shift.endTime || shift.defaultEndTime || '',
          payRate: resolvedPayRate,
          billRate: resolvedBillRate,
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
          assignmentSource: sourceType,
          sourceGroupId: sourceType === 'group' ? sourceId : null,
          placementMode: 'assign_now',
          jobPostId: jobPostId || null,
          createdBy,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          assignedAt: admin.firestore.FieldValue.serverTimestamp(),
          entityId: onboardingConfig.entityId ?? null,
          requirementPackageId: onboardingConfig.requirementPackageId ?? null,
          onboardingInstanceId: assignmentRef.id,
          onboardingStatus:
            onboardingConfig.entityId &&
            onboardingConfig.requirementPackageId &&
            onboardingConfig.packageData
              ? 'not_started'
              : 'blocked',
          onboardingPercent: 0,
        };

        await assignmentRef.set(assignmentData, { merge: false });
        await ensureOnboardingInstance({
          tenantId,
          assignmentId: assignmentRef.id,
          userId,
          jobOrderId,
          shiftId,
          entityId: onboardingConfig.entityId,
          requirementPackageId: onboardingConfig.requirementPackageId,
          packageData: onboardingConfig.packageData,
          createdBy,
          blockedReason: onboardingConfig.blockedReason,
        });
        const applicationId = await resolveApplicationForAssignment({
          tenantId,
          jobOrderId,
          shiftId,
          userId,
          createdBy,
          assignmentId: assignmentRef.id,
          jobPostId,
          entityId: onboardingConfig.entityId,
        });

        await assignmentRef.set(
          {
            applicationId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      created.push({ userId, assignmentId: assignmentRef.id, warnings });
      // This shift is now booked — release the worker's overlapping OPEN
      // applications elsewhere (see releaseOverlappingApplications).
      if (newWindow) {
        await releaseOverlappingApplications({
          tenantId,
          userId,
          assignedJobOrderId: jobOrderId,
          assignedJobOrderTitle: String(jobOrder.jobOrderName || jobOrder.jobTitle || 'your shift'),
          assignedShiftId: shiftId,
          assignedAssignmentId: assignmentRef.id,
          windows: [newWindow],
        });
      }
    } catch (error: any) {
      failed.push({ userId, error: error?.message || 'unknown_error' });
    }
  }

  return {
    success: failed.length === 0,
    created,
    skipped,
    failed,
  };
  } catch (e: any) {
    if (e instanceof HttpsError) throw e;
    logger.error('placementsCreateAssignments_unhandled', {
      message: e?.message,
      stack: e?.stack,
    });
    throw new HttpsError('internal', e?.message || 'Assignment creation failed');
  }
  },
);

export const respondToAssignment = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { tenantId, assignmentId, decision } = (request.data || {}) as {
    tenantId?: string;
    assignmentId?: string;
    decision?: AssignmentDecision;
  };

  if (!tenantId || !assignmentId || !decision || !['accept', 'decline', 'worker_cancel'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'tenantId, assignmentId, and decision (accept|decline|worker_cancel) are required');
  }

  const uid = request.auth.uid;
  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignmentSnap = await assignmentRef.get();

  if (!assignmentSnap.exists) throw new HttpsError('not-found', 'Assignment not found');
  const assignment = assignmentSnap.data() || {};
  if (assignment.userId !== uid && assignment.candidateId !== uid) {
    throw new HttpsError('permission-denied', 'This assignment does not belong to the current user');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const applicationId = assignment.applicationId as string | undefined;
  const applicationRef = applicationId ? db.doc(`tenants/${tenantId}/applications/${applicationId}`) : null;

  if (decision === 'accept') {
    // Headshot gate removed 2026-06-07 per ops decision — recruiters reported
    // the gate was silently blocking too many self-confirmations (workers
    // tapped the SMS link, got a confusing error, and gave up). The
    // `assertWorkerHeadshotApproved` helper is kept in the codebase for
    // potential reuse on other surfaces (e.g., first-shift check-in) but is
    // no longer called from the Accept path.
    // Audit signal preserved: the placement tile still shows "Headshot
    // Missing/Rejected" chips so recruiters know which workers have
    // incomplete profiles, and the HeadshotBypassesSection on
    // /readiness/employee-readiness still lists historical bypasses.

    await assignmentRef.set(
      {
        status: 'confirmed',
        confirmedAt: now,
        confirmedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );
    if (applicationRef) {
      await applicationRef.set(
        {
          status: 'confirmed',
          confirmedAt: now,
          confirmedBy: uid,
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );
    }
    await ensureWorkerOnboardingPipeline({
      tenantId,
      userId: uid,
      assignmentId,
      jobOrderId: (assignment.jobOrderId as string) || null,
      entityId: (assignment.entityId as string) || null,
      triggeredByUid: uid,
      triggerSource: 'worker_confirmation',
    });
    return { success: true, status: 'confirmed' };
  }

  // decision === 'decline' | 'worker_cancel' below.
  // Both withdraw the application the same way; they differ only in the
  // assignment status they write so the jobs board can distinguish a
  // worker self-cancel (→ "Re-apply to Shift") from other terminal states.
  const isWorkerCancel = decision === 'worker_cancel';
  const cancelStatus = isWorkerCancel ? 'worker-cancelled' : 'declined';
  await assignmentRef.set(
    {
      status: cancelStatus,
      declinedAt: now,
      declinedBy: uid,
      ...(isWorkerCancel ? { workerCancelledAt: now, workerCancelledBy: uid } : {}),
      updatedAt: now,
      updatedBy: uid,
    },
    { merge: true },
  );
  if (applicationRef) {
    const appSnap = await applicationRef.get();
    const appData = appSnap.exists ? (appSnap.data() as Record<string, any>) : {};
    const declinedDay = toDateOnly(assignment.startDate);
    const currentDays = getApplicationApplyDays(appData);
    const canAdjustByDay = Boolean(declinedDay && currentDays.length > 0);
    if (canAdjustByDay) {
      const remainingDays = currentDays.filter((day) => day !== declinedDay);
      if (remainingDays.length > 0) {
        await applicationRef.set(
          {
            status: 'submitted',
            applyDate: remainingDays[0],
            applyDates: remainingDays,
            updatedAt: now,
            updatedBy: uid,
            withdrawnAt: admin.firestore.FieldValue.delete(),
            withdrawnBy: admin.firestore.FieldValue.delete(),
          },
          { merge: true },
        );
      } else {
        await applicationRef.set(
          {
            status: 'withdrawn',
            withdrawnAt: now,
            withdrawnBy: uid,
            applyDate: admin.firestore.FieldValue.delete(),
            applyDates: admin.firestore.FieldValue.delete(),
            updatedAt: now,
            updatedBy: uid,
          },
          { merge: true },
        );
      }
    } else {
      await applicationRef.set(
        {
          status: 'withdrawn',
          withdrawnAt: now,
          withdrawnBy: uid,
          applyDate: admin.firestore.FieldValue.delete(),
          applyDates: admin.firestore.FieldValue.delete(),
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );
    }
  }
  return { success: true, status: cancelStatus };
  },
);

/**
 * Recruiter confirms an assignment on behalf of the worker (same effect as worker clicking "Accept").
 * Allowed when the caller can manage assignments for the tenant.
 */
export const confirmAssignmentForWorker = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { tenantId, assignmentId } = (request.data || {}) as { tenantId?: string; assignmentId?: string };
    if (!tenantId || !assignmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
    }

    const canManage = await canManageAssignments(request.auth, tenantId, request.auth.uid);
    if (!canManage) {
      throw new HttpsError('permission-denied', 'You do not have permission to confirm assignments for this tenant');
    }

    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) throw new HttpsError('not-found', 'Assignment not found');
    const assignment = assignmentSnap.data() || {};
    const applicationId = assignment.applicationId as string | undefined;
    const applicationRef = applicationId ? db.doc(`tenants/${tenantId}/applications/${applicationId}`) : null;

    let jobOrderMuted = false;
    const confirmJoId = String(assignment.jobOrderId || '').trim();
    if (confirmJoId) {
      const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${confirmJoId}`).get();
      jobOrderMuted = Boolean(joSnap.data()?.muted);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const uid = request.auth.uid;

    // Headshot policy on this path:
    //   The worker-self-accept path (`respondToAssignment`, decision='accept')
    //   keeps the universal headshot gate (`assertWorkerHeadshotApproved`) —
    //   workers must have an approved photo before they can self-confirm.
    //
    //   The recruiter-on-behalf path (this callable) intentionally does NOT
    //   gate on headshot status. Originally (Phase 4) we enforced the gate
    //   on both paths and pointed recruiters at the Phase 5 manual-approve
    //   UI as the escape hatch. In practice a recruiter manually confirming
    //   on behalf of a worker is itself the human override (e.g. CORT-style
    //   placements where ops have reviewed the candidate face-to-face and
    //   the photo verification pipeline isn't trusted enough to block ops),
    //   and routing them through a second admin surface just to flip a flag
    //   was friction without value. (May 15 2026 — confirmed this policy
    //   with the product owner after recruiter-side complaints.)
    //
    //   We still capture an audit trail on the assignment doc so a later
    //   sweep can find recruiter-confirms that bypassed the gate, and we
    //   log to function logs at info level for live observability.
    const targetWorkerId = String(assignment.userId || assignment.candidateId || '').trim();
    let headshotBypassDetails: {
      bypassed: boolean;
      reason: string | null;
      avatarStatus: string | null;
    } = { bypassed: false, reason: null, avatarStatus: null };
    if (targetWorkerId) {
      try {
        const userSnap = await db.doc(`users/${targetWorkerId}`).get();
        const userData = userSnap.exists ? userSnap.data() ?? null : null;
        const verification = (userData?.avatarVerification ?? null) as {
          status?: string | null;
        } | null;
        const avatarStatus = (verification?.status ?? null) as string | null;
        const hasAvatar =
          typeof userData?.avatar === 'string' && userData.avatar.trim().length > 0;
        const wouldHaveBlocked = avatarStatus !== 'approved' && !hasAvatar;
        if (wouldHaveBlocked) {
          headshotBypassDetails = {
            bypassed: true,
            reason: avatarStatus ? `status=${avatarStatus}` : 'no_avatar',
            avatarStatus,
          };
          logger.info('confirmAssignmentForWorker: bypassing headshot gate', {
            tenantId,
            assignmentId,
            workerUid: targetWorkerId,
            recruiterUid: uid,
            avatarStatus,
            hasAvatar,
          });
        } else {
          headshotBypassDetails.avatarStatus = avatarStatus;
        }
      } catch (err) {
        // Non-fatal — we never want headshot diagnostics to block a manual
        // confirm. Just log and continue with `bypassed=false` defaults.
        logger.warn('confirmAssignmentForWorker: headshot diagnostic read failed', {
          tenantId,
          assignmentId,
          workerUid: targetWorkerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await assignmentRef.set(
      {
        status: 'confirmed',
        confirmedAt: now,
        confirmedBy: uid,
        updatedAt: now,
        updatedBy: uid,
        // Audit: recruiter-acted-on-behalf metadata so downstream surfaces
        // (and post-hoc compliance sweeps) can distinguish a manual
        // recruiter confirm from a worker self-confirm. The
        // `headshotBypass` block is only set when this confirm would have
        // failed the worker-self-accept gate.
        confirmedBySource: 'recruiter_manual',
        ...(headshotBypassDetails.bypassed
          ? {
              headshotBypass: {
                at: now,
                byUid: uid,
                reason: headshotBypassDetails.reason,
                avatarStatus: headshotBypassDetails.avatarStatus,
              },
            }
          : {}),
      },
      { merge: true },
    );
    if (applicationRef) {
      await applicationRef.set(
        {
          status: 'confirmed',
          confirmedAt: now,
          confirmedBy: uid,
          updatedAt: now,
          updatedBy: uid,
          confirmedBySource: 'recruiter_manual',
        },
        { merge: true },
      );
    }
    if (targetWorkerId) {
      await ensureWorkerOnboardingPipeline({
        tenantId,
        userId: targetWorkerId,
        assignmentId,
        jobOrderId: (assignment.jobOrderId as string) || null,
        entityId: (assignment.entityId as string) || null,
        triggeredByUid: uid,
        triggerSource: 'recruiter_confirmation',
        suppressOutboundAutomation: jobOrderMuted,
      });
    }
    return { success: true, status: 'confirmed' };
  },
);

/**
 * Revert a `declined` assignment back to `pending` so the recruiter can
 * re-offer / re-confirm. Used when a worker declined by mistake (or the
 * recruiter wants to override the decline after a conversation off-platform).
 *
 * Effects:
 *   - assignment.status: 'declined' → 'pending'
 *   - clears declinedAt / declinedBy
 *   - stamps declineRevertedAt / declineRevertedBy for audit
 *   - linked application: 'withdrawn' → 'accepted' (so it lines up with the
 *     state placementsCreateAssignments produces after the initial offer)
 *
 * Auth: recruiter-level (canManageAssignments). Workers cannot un-decline
 * their own assignments via this path; they'd have to re-apply.
 */
export const revertAssignmentDecline = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, assignmentId } = (request.data || {}) as {
      tenantId?: string;
      assignmentId?: string;
    };
    if (!tenantId || !assignmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
    }
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to revert declines');
    }

    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      throw new HttpsError('not-found', 'Assignment not found');
    }
    const assignment = assignmentSnap.data() || {};
    if (assignment.status !== 'declined') {
      throw new HttpsError(
        'failed-precondition',
        `Assignment status is '${assignment.status}', not 'declined'. Only declined assignments can be reverted via this path.`,
      );
    }

    const uid = request.auth.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();
    await assignmentRef.set(
      {
        status: 'pending',
        declinedAt: admin.firestore.FieldValue.delete(),
        declinedBy: admin.firestore.FieldValue.delete(),
        declineRevertedAt: now,
        declineRevertedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    // Restore the linked application from 'withdrawn' (set by the decline
    // path at L1036) back to 'accepted' (the state right after the offer
    // was sent at L318) so the worker's posting view aligns with the
    // assignment again. If the decline path took the multi-day route and
    // shifted to a remaining day, we leave it alone — recruiters who want
    // to bring it back to this specific day's offer can manage it from the
    // application UI.
    const applicationId = assignment.applicationId as string | undefined;
    if (applicationId) {
      const applicationRef = db.doc(`tenants/${tenantId}/applications/${applicationId}`);
      const appSnap = await applicationRef.get();
      if (appSnap.exists) {
        const appData = appSnap.data() as Record<string, any>;
        if (appData.status === 'withdrawn') {
          await applicationRef.set(
            {
              status: 'accepted',
              withdrawnAt: admin.firestore.FieldValue.delete(),
              withdrawnBy: admin.firestore.FieldValue.delete(),
              updatedAt: now,
              updatedBy: uid,
            },
            { merge: true },
          );
        }
      }
    }

    return { success: true, status: 'pending' };
  },
);

/**
 * Revert a `cancelled` assignment back to `pending`. Symmetric with
 * `revertAssignmentDecline` for the recruiter-cancel-by-mistake case
 * (or "wait, that other worker actually can't make it after all —
 * undo my cancel and confirm this one again").
 *
 * Scope: only handles the case where the assignment doc STILL EXISTS
 * with status='cancelled'. The full `placementsCancelAssignment` flow
 * deletes the assignment doc and creates a placement after stamping the
 * cancellation — that path can't be undone here because the source data
 * (startDate, applicationId, hireDate, etc.) is gone. In that case the
 * recruiter sees a "Click to Hire" tile and can re-offer through the
 * existing flow.
 *
 * Effects:
 *   - assignment.status: 'cancelled' → 'pending'
 *   - clears cancelledAt / canceledBy
 *   - stamps cancelRevertedAt / cancelRevertedBy for audit
 *   - linked application: 'submitted' → 'accepted' (mirror of the
 *     cancel path's status transition)
 *
 * Auth: recruiter-level (canManageAssignments).
 */
export const revertAssignmentCancel = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, assignmentId } = (request.data || {}) as {
      tenantId?: string;
      assignmentId?: string;
    };
    if (!tenantId || !assignmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
    }
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to revert cancellations');
    }

    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      // The full cancel flow already deleted the assignment and created
      // a placement. The recruiter can re-offer from the Placed tile.
      throw new HttpsError(
        'failed-precondition',
        'Assignment no longer exists — the cancellation already completed. The worker now shows as Placed; re-offer from the placements tile instead.',
      );
    }
    const assignment = assignmentSnap.data() || {};
    const status = String(assignment.status || '').toLowerCase();
    if (status !== 'cancelled' && status !== 'canceled') {
      throw new HttpsError(
        'failed-precondition',
        `Assignment status is '${assignment.status}', not 'cancelled'. Only cancelled assignments can be reverted via this path.`,
      );
    }

    const uid = request.auth.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();
    await assignmentRef.set(
      {
        status: 'pending',
        cancelledAt: admin.firestore.FieldValue.delete(),
        canceledBy: admin.firestore.FieldValue.delete(),
        cancelRevertedAt: now,
        cancelRevertedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    // Restore the linked application back to 'accepted' (where it was
    // post-offer, pre-cancel) when it's currently 'submitted' from the
    // cancel path. We only touch 'submitted' so we don't trample any
    // status the recruiter may have set in the meantime.
    const applicationId = assignment.applicationId as string | undefined;
    if (applicationId) {
      const applicationRef = db.doc(`tenants/${tenantId}/applications/${applicationId}`);
      const appSnap = await applicationRef.get();
      if (appSnap.exists) {
        const appData = appSnap.data() as Record<string, any>;
        if (appData.status === 'submitted') {
          await applicationRef.set(
            {
              status: 'accepted',
              statusChangeReason: admin.firestore.FieldValue.delete(),
              updatedAt: now,
              updatedBy: uid,
            },
            { merge: true },
          );
        }
      }
    }

    return { success: true, status: 'pending' };
  },
);

/**
 * Resend the shift-details confirmation (email + SMS) to every confirmed
 * worker on a shift. Used by the placement card's "resend" icon when a
 * recruiter wants every confirmed worker to re-receive the start-time /
 * parking / check-in details email (e.g., updates to a JO's check-in
 * instructions, or just a day-before nudge).
 *
 * Email body is freshly built via `buildAssignmentDetailsEmail` per
 * worker, so any JO/shift edits since the original send are reflected.
 *
 * Auth: recruiter-level (canManageAssignments). Workers can't trigger
 * this on themselves.
 *
 * Returns counts: { sent, skipped, failed, errors }. Per-worker failures
 * do NOT short-circuit the loop — every worker gets attempted, and the
 * caller sees the summary.
 */
export const resendShiftConfirmationsToConfirmedStaff = onCall(
  {
    cors: [
      'http://localhost:3000',
      'https://hrx1-d3beb.web.app',
      'https://hrx1-d3beb.firebaseapp.com',
      'https://hrxone.com',
      'https://www.hrxone.com',
    ],
    secrets: PLACEMENT_SMS_SECRETS,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, shiftId, jobOrderId } = (request.data || {}) as {
      tenantId?: string;
      shiftId?: string;
      jobOrderId?: string;
    };
    if (!tenantId || !shiftId) {
      throw new HttpsError('invalid-argument', 'tenantId and shiftId are required');
    }
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to resend confirmations');
    }

    // Find all confirmed assignments on this shift.
    // We restrict to confirmed/active because that's the state where the
    // worker has agreed to work and is expecting the details — sending to
    // pending/declined/cancelled would be spam or confusing.
    let q = db
      .collection(`tenants/${tenantId}/assignments`)
      .where('shiftId', '==', shiftId)
      .where('status', 'in', ['confirmed', 'active']);
    if (jobOrderId) {
      // Narrow further when the caller knows the JO — avoids any cross-JO bleed
      // if the same shiftId ever recurred under different orders.
      q = q.where('jobOrderId', '==', jobOrderId);
    }
    const snap = await q.get();
    const assignments = snap.docs.map((d) => ({ id: d.id, data: d.data() }));

    const errors: Array<{ assignmentId: string; userId: string; error: string }> = [];
    let sent = 0;
    let skipped = 0;

    const { buildAssignmentDetailsEmail } = await import('./messaging/assignmentDetailsEmail');
    const { sendLegacyAssignmentMessage } = await import('./messaging/legacyMessageHelpers');

    for (const a of assignments) {
      const ad = a.data as Record<string, any>;
      const userId = String(ad.userId || ad.candidateId || '');
      if (!userId) {
        skipped++;
        continue;
      }
      try {
        // Fetch user for phone/email (the helper picks them up from the
        // user doc when phoneE164 is falsy at the call site).
        const userSnap = await db.doc(`users/${userId}`).get();
        const ud = userSnap.exists ? (userSnap.data() as Record<string, any>) : {};
        const phoneE164 = String(ud.phoneE164 || ud.phone || '').trim() || '+0000000000';

        const built = await buildAssignmentDetailsEmail(tenantId, a.id);
        const emailSubject = built?.subject;
        const emailBody = built?.html;
        if (!emailSubject || !emailBody) {
          // Couldn't build the email — skip this worker rather than send
          // a half-broken message. (Most likely cause: assignment is
          // missing denormalized fields the email template requires.)
          skipped++;
          errors.push({
            assignmentId: a.id,
            userId,
            error: 'Could not build email body — missing assignment denorm fields',
          });
          continue;
        }

        // Build a short SMS-side message so the worker also gets a ping.
        // Mirrors the assignment_created copy with "Updated details" framing
        // so the worker knows this is a re-send, not a fresh offer.
        const firstName = ud.firstName || ad.firstName || 'there';
        const jobTitle = ad.jobTitle || 'your shift';
        const assignmentUrl = buildWorkerAssignmentUrl(a.id);
        const smsMessage = `Hi ${firstName}, here are the latest details for ${jobTitle}. Check your email for the full briefing (check-in time, parking, what to bring), or view them here: ${assignmentUrl} . Reply to your recruiter if anything looks off.`;

        await sendLegacyAssignmentMessage({
          tenantId,
          userId,
          phoneE164,
          message: smsMessage,
          messageTypeId: 'assignment_confirmed',
          source: 'assignment_confirmed_resend',
          sourceId: a.id,
          assignmentId: a.id,
          emailSubject,
          emailBody,
        });
        sent++;
      } catch (err: any) {
        errors.push({
          assignmentId: a.id,
          userId,
          error: err?.message || String(err),
        });
      }
    }

    return {
      success: errors.length === 0,
      totalConfirmed: assignments.length,
      sent,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 20), // cap so we don't blow up the callable response
    };
  },
);

/**
 * Per-worker version of the resend confirmation. Mirrors
 * `resendAssignmentOffer` (which resends the accept/decline message for
 * a pending offer); this one resends the assignment-details confirmation
 * for a single CONFIRMED worker — same channels (email + SMS), same
 * template, freshly rebuilt against current JO/shift data.
 *
 * Used by the per-tile refresh icon on confirmed worker rows.
 *
 * Auth: recruiter-level (canManageAssignments).
 */
export const resendAssignmentConfirmation = onCall(
  {
    cors: [
      'http://localhost:3000',
      'https://hrx1-d3beb.web.app',
      'https://hrx1-d3beb.firebaseapp.com',
      'https://hrxone.com',
      'https://www.hrxone.com',
    ],
    secrets: PLACEMENT_SMS_SECRETS,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, assignmentId } = (request.data || {}) as {
      tenantId?: string;
      assignmentId?: string;
    };
    if (!tenantId || !assignmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
    }
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to resend confirmation');
    }

    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      throw new HttpsError('not-found', 'Assignment not found');
    }
    const assignment = assignmentSnap.data() || {};
    const status = String(assignment.status || '').toLowerCase();
    if (status !== 'confirmed' && status !== 'active') {
      throw new HttpsError(
        'failed-precondition',
        `Assignment status is '${assignment.status}'. Confirmation resend only applies to confirmed/active assignments — for pending offers, use Resend Offer instead.`,
      );
    }

    const userId = String(assignment.userId || assignment.candidateId || '');
    if (!userId) {
      throw new HttpsError('failed-precondition', 'Assignment has no userId/candidateId');
    }

    const userSnap = await db.doc(`users/${userId}`).get();
    const ud = userSnap.exists ? (userSnap.data() as Record<string, any>) : {};
    const phoneE164 = String(ud.phoneE164 || ud.phone || '').trim() || '+0000000000';

    const { buildAssignmentDetailsEmail } = await import('./messaging/assignmentDetailsEmail');
    const { sendLegacyAssignmentMessage } = await import('./messaging/legacyMessageHelpers');

    const built = await buildAssignmentDetailsEmail(tenantId, assignmentId);
    if (!built?.subject || !built?.html) {
      throw new HttpsError(
        'failed-precondition',
        'Could not build confirmation email — assignment is missing denormalized fields the template requires. Check the JO/shift for completeness.',
      );
    }

    const firstName = ud.firstName || assignment.firstName || 'there';
    const jobTitle = assignment.jobTitle || 'your shift';
    const assignmentUrl = buildWorkerAssignmentUrl(assignmentId);
    const smsMessage = `Hi ${firstName}, here are the latest details for ${jobTitle}. Check your email for the full briefing (check-in time, parking, what to bring), or view them here: ${assignmentUrl} . Reply to your recruiter if anything looks off.`;

    await sendLegacyAssignmentMessage({
      tenantId,
      userId,
      phoneE164,
      message: smsMessage,
      messageTypeId: 'assignment_confirmed',
      source: 'assignment_confirmed_resend',
      sourceId: assignmentId,
      assignmentId,
      emailSubject: built.subject,
      emailBody: built.html,
    });

    // Stamp resend timestamp on the assignment for audit + UI cooldown
    await assignmentRef.set(
      {
        lastConfirmationResendAt: admin.firestore.FieldValue.serverTimestamp(),
        lastConfirmationResendBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { success: true };
  },
);

/**
 * openShiftSetEndDate — close-out for open (standing-crew) shifts.
 *
 * Stamps an `endDate` (YYYY-MM-DD); past timecards are preserved and the
 * timesheet resolver simply stops generating rows past that date. Two
 * modes:
 *   - `{ assignmentId }` → remove ONE worker from the crew.
 *   - `{ shiftId, jobOrderId }` → end the WHOLE open shift: stamp the
 *     shift doc's endDate AND every still-active open assignment on it.
 *
 * No SMS — open shifts never carried an offer; removal/close-out is a
 * recruiter action. endDate is clamped to be on/after each assignment's
 * startDate so we never create an inverted window.
 */
export const openShiftSetEndDate = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, assignmentId, shiftId, jobOrderId, endDate } = (request.data || {}) as {
      tenantId?: string;
      assignmentId?: string;
      shiftId?: string;
      jobOrderId?: string;
      endDate?: string;
    };
    if (!tenantId || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpsError('invalid-argument', 'tenantId and endDate (YYYY-MM-DD) are required');
    }
    if (!assignmentId && !shiftId) {
      throw new HttpsError('invalid-argument', 'Either assignmentId or shiftId is required');
    }
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to manage assignments');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const isOpenAssignment = (a: Record<string, unknown>): boolean =>
      a.isOpenShift === true || a.noFixedTimes === true;
    const clampEnd = (a: Record<string, unknown>): string => {
      const start = toDateOnly(a.startDate);
      return start && endDate < start ? start : endDate;
    };

    // Mode 1 — single worker.
    if (assignmentId) {
      const ref = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError('not-found', 'Assignment not found');
      const data = snap.data() || {};
      if (!isOpenAssignment(data)) {
        throw new HttpsError('failed-precondition', 'Assignment is not an open-shift assignment');
      }
      await ref.set(
        { endDate: clampEnd(data), updatedAt: now, closedOutBy: request.auth.uid, closedOutAt: now },
        { merge: true },
      );
      return { success: true, updated: 1, mode: 'worker' };
    }

    // Mode 2 — whole shift: stamp the shift doc + every active open assignment.
    if (!jobOrderId) {
      throw new HttpsError('invalid-argument', 'jobOrderId is required when ending a shift');
    }
    const shiftRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`);
    const shiftSnap = await shiftRef.get();
    if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found');
    await shiftRef.set({ endDate, updatedAt: now }, { merge: true });

    const assignmentsSnap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('shiftId', '==', shiftId)
      .get();
    let updated = 0;
    const batch = db.batch();
    assignmentsSnap.docs.forEach((d) => {
      const a = d.data() || {};
      if (!isOpenAssignment(a)) return;
      const st = String(a.status || '').toLowerCase();
      if (st === 'cancelled' || st === 'canceled' || st === 'completed') return;
      batch.set(
        d.ref,
        { endDate: clampEnd(a), updatedAt: now, closedOutBy: request.auth!.uid, closedOutAt: now },
        { merge: true },
      );
      updated += 1;
    });
    await batch.commit();
    return { success: true, updated, mode: 'shift' };
  },
);

/**
 * Cancel an assignment and revert to Placed state.
 * Deletes the assignment and creates a placement so the worker shows as "Placed" again.
 * For testing / recruiter use.
 */
export const placementsCancelAssignment = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const {
      tenantId,
      assignmentId,
      shiftId,
      userId,
    } = (request.data || {}) as {
    tenantId?: string;
    assignmentId?: string;
    shiftId?: string;
    userId?: string;
  };

  if (!tenantId || !assignmentId || !shiftId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId, assignmentId, shiftId, and userId are required');
  }
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Insufficient permissions to cancel assignments');
  }

  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    throw new HttpsError('not-found', 'Assignment not found');
  }
  const assignmentData = assignmentSnap.data() || {};
  if (assignmentData.userId !== userId || assignmentData.shiftId !== shiftId) {
    throw new HttpsError('invalid-argument', 'Assignment does not match userId/shiftId');
  }

  const placementDayKey = toDateOnly(assignmentData.startDate);
  const placementId = placementDayKey
    ? `${shiftId}__${userId}__${placementDayKey}`
    : `${shiftId}__${userId}`;
  const placementRef = db.doc(`tenants/${tenantId}/placements/${placementId}`);

  // Linked application: revert to submitted so worker's job posting view no longer shows "Confirmed"
  const applicationId = assignmentData.applicationId as string | undefined;
  const applicationRef = applicationId
    ? db.doc(`tenants/${tenantId}/applications/${applicationId}`)
    : null;

  // Update assignment to cancelled first so Firestore onUpdate trigger sends cancellation message (SMS/email/push)
  await assignmentRef.set(
    {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      canceledBy: request.auth!.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Firestore requires ALL reads in a transaction to precede ALL writes —
  // doing `tx.get(applicationRef)` after `tx.delete(assignmentRef)` /
  // `tx.set(placementRef)` throws
  // "Firestore transactions require all reads to be executed before all
  // writes." which surfaces in the client as a vague callable
  // INTERNAL error and blocks every assignment cancel that has a linked
  // application doc. We do the read up front, then derive the day patch,
  // then perform every write in a single batch.
  await db.runTransaction(async (tx) => {
    const appSnap = applicationRef ? await tx.get(applicationRef) : null;

    tx.delete(assignmentRef);
    tx.set(placementRef, {
      tenantId,
      jobOrderId: assignmentData.jobOrderId,
      shiftId,
      startDate: placementDayKey || '',
      userId,
      createdBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (applicationRef && appSnap) {
      const appData = appSnap.exists ? (appSnap.data() as Record<string, any>) : {};
      const currentDays = getApplicationApplyDays(appData);
      const remainingDays = placementDayKey
        ? currentDays.filter((day) => day !== placementDayKey)
        : currentDays;
      const dayPatch: Record<string, unknown> =
        currentDays.length > 0
          ? remainingDays.length > 0
            ? {
                applyDates: remainingDays,
                applyDate: remainingDays[0],
              }
            : {
                applyDates: admin.firestore.FieldValue.delete(),
                applyDate: admin.firestore.FieldValue.delete(),
              }
          : {};
      tx.update(applicationRef, {
        status: 'submitted',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        confirmedAt: admin.firestore.FieldValue.delete(),
        confirmedBy: admin.firestore.FieldValue.delete(),
        // Signal to application triggers: do not send application_received SMS (assignment cancel already sends one message)
        statusChangeReason: 'assignment_cancelled',
        ...dayPatch,
      });
    }
  });

  return { success: true };
  },
);

/**
 * Resend accept/decline offer (SMS, push, email) for an assignment.
 * Updates lastReminderSentAt on the assignment and sends the same notification as assignment_created.
 */
export const resendAssignmentOffer = onCall(
  {
    cors: [
      'http://localhost:3000',
      'https://hrx1-d3beb.web.app',
      'https://hrx1-d3beb.firebaseapp.com',
      'https://hrxone.com',
      'https://www.hrxone.com',
    ],
    secrets: PLACEMENT_SMS_SECRETS,
  },
  async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { tenantId, assignmentId } = (request.data || {}) as { tenantId?: string; assignmentId?: string };
  if (!tenantId || !assignmentId) {
    throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
  }
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Insufficient permissions to resend assignment offer');
  }

  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    throw new HttpsError('not-found', 'Assignment not found');
  }
  const assignment = assignmentSnap.data() || {};
  const userId = assignment.userId || assignment.candidateId;
  if (!userId) {
    throw new HttpsError('invalid-argument', 'Assignment has no userId');
  }

  if (assignment.jobOrderId) {
    try {
      const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${assignment.jobOrderId}`).get();
      if (joSnap.exists && Boolean(joSnap.data()?.muted)) {
        return { success: true, skipped: 'job_order_muted' as const };
      }
    } catch (_) {
      /* continue */
    }
  }

  await assignmentRef.set(
    {
      lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const userDoc = await db.doc(`users/${userId}`).get();
  const userData = userDoc.data() || {};
  const phoneE164 = (userData.phoneE164 || userData.phone || '').trim();
  let jobTitle = assignment.jobTitle || 'a position';
  let checkInInstructions = '';

  let jobOrderData: admin.firestore.DocumentData | undefined;
  if (assignment.jobOrderId) {
    try {
      const jobOrderDoc = await db.doc(`tenants/${tenantId}/job_orders/${assignment.jobOrderId}`).get();
      jobOrderData = jobOrderDoc.data();
      // Prefer the SHIFT-specific assignment.jobTitle; only fall back to
      // the JO-level title when the assignment lacks one. See the same
      // fix in index.ts logAssignmentCreated (Danny "Usher" bug) — a JO
      // can span multiple roles, so the JO title is the wrong label.
      if (!assignment.jobTitle && jobOrderData?.jobTitle) jobTitle = jobOrderData.jobTitle;
      if (jobOrderData?.checkInInstructions) checkInInstructions = String(jobOrderData.checkInInstructions);
    } catch (_) {
      /* ignore */
    }
  }

  // EN + ES variants of the date/time phrase — see equivalent block in
  // `placementsCreateAssignments` for the rationale. AM/PM stays English
  // since US-based Spanish workers expect that form.
  let dateTimeInfo = '';
  let dateTimeInfoEs = '';
  if (assignment.startDate) {
    const startDate =
      assignment.startDate?.toDate ? assignment.startDate.toDate() : new Date(assignment.startDate);
    const dateOpts: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    };
    dateTimeInfo = ` on ${startDate.toLocaleDateString('en-US', dateOpts)}`;
    dateTimeInfoEs = ` el ${startDate.toLocaleDateString('es-US', dateOpts)}`;
    if (assignment.startTime && assignment.endTime) {
      dateTimeInfo += ` from ${formatTime12h(assignment.startTime)} - ${formatTime12h(assignment.endTime)}`;
      dateTimeInfoEs += ` de ${formatTime12h(assignment.startTime)} a ${formatTime12h(assignment.endTime)}`;
    }
  }

  const firstName = assignment.firstName || userData.firstName || 'there';
  let worksiteName = assignment.locationNickname || assignment.worksiteName || '';
  if (!worksiteName && jobOrderData) {
    worksiteName = String(jobOrderData.worksiteName || jobOrderData.locationName || '');
    if (!worksiteName) {
      const locId = jobOrderData.worksiteId || jobOrderData.locationId;
      if (locId) {
        try {
          const locSnap = await db.doc(`tenants/${tenantId}/locations/${locId}`).get();
          const loc = locSnap.exists ? locSnap.data() : null;
          worksiteName = loc?.nickname || loc?.title || loc?.name || loc?.locationName || '';
          if (!worksiteName && jobOrderData.companyId) {
            const crmLoc = await db.doc(`tenants/${tenantId}/crm_companies/${jobOrderData.companyId}/locations/${locId}`).get();
            const crmData = crmLoc.exists ? crmLoc.data() : null;
            worksiteName = crmData?.nickname || crmData?.title || crmData?.name || crmData?.locationName || '';
          }
        } catch (_) {
          /* ignore */
        }
      }
    }
    if (!worksiteName && jobOrderData?.worksiteAddress) {
      const addr = jobOrderData.worksiteAddress;
      worksiteName = [addr.city, addr.state].filter(Boolean).join(', ');
    }
  }
  const locationText = worksiteName ? ` at ${worksiteName}` : '';
  const locationTextEs = worksiteName ? ` en ${worksiteName}` : '';
  const acceptUrl = buildWorkerAssignmentAcceptUrl({
    assignmentId,
    jobPostId: assignment.jobPostId,
  });
  const declineUrl = buildWorkerAssignmentDeclineUrl({
    assignmentId,
    jobPostId: assignment.jobPostId,
  });
  const instructionsText = checkInInstructions ? ` Check-in: ${checkInInstructions}` : '';
  const instructionsTextEs = checkInInstructions
    ? ` Instrucciones de llegada: ${checkInInstructions}`
    : '';
  // New ACCEPT/DECLINE pattern — see comment on the placementsCreateAssignments
  // call site for rationale. Same builder, same EN/ES picker, so the
  // refresh-icon resend looks identical to the original offer SMS.
  const { buildAssignmentOfferSms, resolveOfferLanguage } = await import(
    './messaging/buildAssignmentOfferSms'
  );
  const message = buildAssignmentOfferSms({
    firstName,
    jobTitle,
    dateTimeInfo,
    dateTimeInfoEs,
    locationText,
    locationTextEs,
    instructionsText,
    instructionsTextEs,
    acceptUrl,
    declineUrl,
    language: resolveOfferLanguage(userData),
  });

  let emailSubject: string | undefined;
  let emailBody: string | undefined;
  try {
    const { buildAssignmentDetailsEmail } = await import('./messaging/assignmentDetailsEmail');
    const emailResult = await buildAssignmentDetailsEmail(tenantId, assignmentId);
    if (emailResult) {
      emailSubject = emailResult.subject;
      emailBody = emailResult.html;
    }
  } catch (_) {
    /* continue without email body */
  }

  const { sendLegacyAssignmentMessage } = await import('./messaging/legacyMessageHelpers');
  const result = await sendLegacyAssignmentMessage({
    tenantId,
    userId,
    phoneE164: phoneE164 || '+0000000000',
    message,
    messageTypeId: 'assignment_created',
    source: 'assignment_created',
    sourceId: assignmentId,
    assignmentId,
    emailSubject,
    emailBody,
  });

  return { success: result.success, error: result.error };
});

/**
 * Preview the assignment details email (subject + HTML) that workers receive when confirmed.
 * Does not send anything; used for recruiter preview in Placements tab.
 */
export const previewAssignmentDetailsEmail = onCall(
  {
    // Allow all origins so localhost and production both work (v2 callables can be strict with CORS)
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { tenantId, assignmentId } = (request.data || {}) as { tenantId?: string; assignmentId?: string };
    if (!tenantId || !assignmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
    }
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to preview assignment email');
    }

    const { buildAssignmentDetailsEmail } = await import('./messaging/assignmentDetailsEmail');
    const result = await buildAssignmentDetailsEmail(tenantId, assignmentId);
    if (!result) {
      throw new HttpsError('not-found', 'Assignment not found or email could not be built');
    }
    return { subject: result.subject, html: result.html };
  }
);
