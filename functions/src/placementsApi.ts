import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { ensureWorkerOnboardingPipeline } from './onboarding/workerOnboardingPipeline';
import { ASSIGNMENT_STATUS_QUERY_LIVE, isAssignmentTerminalNormalized } from './utils/assignmentStatusNormalize';
import { buildWorkerAssignmentResponseUrl } from './utils/workerUrls';
import { assertWorkerHeadshotApproved } from './avatar/headshotAcceptGate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type AssignmentDecision = 'accept' | 'decline';

function toDateOnly(value: any): string {
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

function getApplicationApplyDays(applicationData: Record<string, any>): string[] {
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
  { cors: true },
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
  } = (request.data || {}) as {
    tenantId?: string;
    jobOrderId?: string;
    shiftId?: string;
    userIds?: string[];
    sourceType?: string;
    sourceId?: string | null;
    applyDate?: string | null;
    applyDates?: string[] | null;
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
          const dateStrs = assignments.map((a) => {
            const d = new Date(a.date + 'T12:00:00');
            return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
          });
          const dateTimeInfo = dateStrs.length ? ` on ${dateStrs.join(', ')}` : '';
          const jobUrl = buildWorkerAssignmentResponseUrl({
            jobPostId,
            assignmentId: assignments[0].assignmentId,
            shiftId,
          });
          const locationText = locationNickname ? ` at ${locationNickname}` : '';
          const message = `Hi ${firstName}, your application has been accepted for ${jobTitle}${dateTimeInfo}${locationText}. View details and respond: ${jobUrl}`;
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
      const hasExistingForThisSlot =
        (assignmentDoc.exists && isAssignmentActiveStatus(existingStatus)) ||
        Boolean(legacyAssignmentDoc?.exists && legacySameDay && isAssignmentActiveStatus(legacyStatus));
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
      activeAssignments.docs.forEach((docSnap) => {
        const assignment = docSnap.data() || {};
        const assignmentShiftId = assignment.shiftId;
        if (assignmentShiftId === shiftId) return;

        const assignmentStartDate = toDateOnly(assignment.startDate);
        if (assignmentStartDate !== effectiveStartDate) return;

        const existingStart = parseMinutes(assignment.startTime);
        const existingEnd = parseMinutes(assignment.endTime);
        if (overlapsSameDay(shiftStartMin, shiftEndMin, existingStart, existingEnd)) {
          blockedByOverlap = true;
          return;
        }
        sameDayDifferentShift = true;
      });

      if (blockedByOverlap) {
        skipped.push({ userId, reason: 'overlapping_assignment' });
        continue;
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
        const assignmentData: any = {
          tenantId,
          jobOrderId,
          shiftId,
          candidateId: userId,
          userId,
          status: 'pending',
          startDate: effectiveStartDate || '',
          endDate: effectiveEndDate || effectiveStartDate || '',
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

  if (!tenantId || !assignmentId || !decision || !['accept', 'decline'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'tenantId, assignmentId, and decision (accept|decline) are required');
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
    // Phase 4: universal headshot gate. Throws HttpsError('failed-precondition') with a typed
    // details.code the client maps to localized retake / pending / error UX.
    await assertWorkerHeadshotApproved(uid);

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

  await assignmentRef.set(
    {
      status: 'declined',
      declinedAt: now,
      declinedBy: uid,
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
  return { success: true, status: 'declined' };
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
      if (jobOrderData?.jobTitle) jobTitle = jobOrderData.jobTitle;
      if (jobOrderData?.checkInInstructions) checkInInstructions = String(jobOrderData.checkInInstructions);
    } catch (_) {
      /* ignore */
    }
  }

  let dateTimeInfo = '';
  if (assignment.startDate) {
    const startDate =
      assignment.startDate?.toDate ? assignment.startDate.toDate() : new Date(assignment.startDate);
    dateTimeInfo = ` on ${startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    if (assignment.startTime && assignment.endTime) {
      dateTimeInfo += ` from ${assignment.startTime} - ${assignment.endTime}`;
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
  const jobUrl = buildWorkerAssignmentResponseUrl({
    jobPostId: assignment.jobPostId,
    assignmentId,
    shiftId: assignment.shiftId || '',
  });
  const instructionsText = checkInInstructions ? ` Check-in: ${checkInInstructions}` : '';
  const message = `Hi ${firstName}, your application has been accepted for ${jobTitle}${dateTimeInfo}${locationText}. View details and respond: ${jobUrl}.${instructionsText}`;

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
