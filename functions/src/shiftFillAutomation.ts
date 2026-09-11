import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { ASSIGNMENT_STATUS_QUERY_LIVE } from './utils/assignmentStatusNormalize';
import { computeAssignmentsTarget, computeLiveFill, liveFillChanged } from './shifts/shiftLiveFill';

const db = admin.firestore();

type ShiftStatus = 'open' | 'closed' | 'filled' | 'cancelled' | 'pending_indeed_approval';

function norm(v: unknown): string {
  return String(v || '').trim().toLowerCase();
}

async function recomputeShiftFill(params: {
  tenantId: string;
  jobOrderId: string;
  shiftId: string;
}): Promise<void> {
  const { tenantId, jobOrderId, shiftId } = params;

  const shiftRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`);
  const shiftSnap = await shiftRef.get();
  if (!shiftSnap.exists) return;

  const shift = shiftSnap.data() || {};
  const shiftStatus = (norm(shift.status) || 'open') as ShiftStatus | string;

  // Do not auto-modify cancelled/closed shifts.
  if (shiftStatus === 'cancelled' || shiftStatus === 'closed') {
    return;
  }

  const assignmentsRef = db.collection(`tenants/${tenantId}/assignments`);

  // Count "assigned" workers as assignments that are not canceled.
  // We treat proposed/confirmed/active as "count toward fill" (i.e., created assignments).
  const [assignmentsSnap, liveSnap] = await Promise.all([
    assignmentsRef
      .where('shiftId', '==', shiftId)
      .where('status', 'in', ['proposed', 'confirmed', 'active'])
      .get(),
    assignmentsRef
      .where('shiftId', '==', shiftId)
      .where('status', 'in', [...ASSIGNMENT_STATUS_QUERY_LIVE])
      .get(),
  ]);

  const assignedCount = assignmentsSnap.size;
  const target = computeAssignmentsTarget(shift);
  const liveFill = computeLiveFill(
    shift,
    liveSnap.docs.map((d) => d.data() || {}),
  );

  // Open (standing-crew) shifts are ongoing and always accepting workers.
  // Reaching the headcount target must NOT flip them to "filled" — that would
  // stop them accepting applicants and drop them off the jobs board. Keep the
  // status "open" no matter the count (we still track the count for display).
  const shiftIsOpen = norm(shift.shiftType) === 'open';

  const shouldBeFilled = !shiftIsOpen && assignedCount >= target;
  const nextStatus: ShiftStatus = shouldBeFilled ? 'filled' : 'open';
  const acceptingBackupsNext = shiftIsOpen ? true : nextStatus === 'filled';

  // Avoid loops/no-op writes.
  const currentStatus = (shiftStatus === 'filled' || shiftStatus === 'open') ? (shiftStatus as ShiftStatus) : 'open';
  const needsStatusUpdate = currentStatus !== nextStatus;

  const derived: any = {
    assignmentsTarget: target,
    assignmentsCount: assignedCount,
    acceptingBackups: acceptingBackupsNext,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (needsStatusUpdate) {
    derived.status = nextStatus;
  }

  // Only write if anything materially changes.
  const prevTarget = Number(shift.assignmentsTarget ?? NaN);
  const prevCount = Number(shift.assignmentsCount ?? NaN);
  const prevAccepting = Boolean(shift.acceptingBackups);

  const needsDerivedUpdate =
    prevTarget !== target ||
    prevCount !== assignedCount ||
    prevAccepting !== acceptingBackupsNext;
  const needsLiveFillUpdate = liveFillChanged(shift.liveFill, liveFill);

  if (!needsStatusUpdate && !needsDerivedUpdate && !needsLiveFillUpdate) return;

  if (needsLiveFillUpdate) {
    derived.liveFill = { ...liveFill, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  }

  await shiftRef.update(derived);
  logger.info('Recomputed shift fill status', {
    tenantId,
    jobOrderId,
    shiftId,
    assignedCount,
    target,
    status: needsStatusUpdate ? nextStatus : currentStatus,
  });
}

/**
 * Recompute fill whenever an assignment changes (created/updated/deleted).
 */
export const onAssignmentWriteRecomputeShiftFill = onDocumentCreated(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const a = event.data?.data();
    if (!a?.shiftId || !a?.jobOrderId) return;
    await recomputeShiftFill({ tenantId, jobOrderId: a.jobOrderId, shiftId: a.shiftId });
  }
);

export const onAssignmentUpdateRecomputeShiftFill = onDocumentUpdated(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const beforeShiftId = before.shiftId;
    const afterShiftId = after.shiftId;
    const beforeJobOrderId = before.jobOrderId;
    const afterJobOrderId = after.jobOrderId;

    // If assignment moved shifts/jobOrders, recompute both.
    if (beforeShiftId && beforeJobOrderId) {
      await recomputeShiftFill({ tenantId, jobOrderId: beforeJobOrderId, shiftId: beforeShiftId });
    }
    if (afterShiftId && afterJobOrderId) {
      await recomputeShiftFill({ tenantId, jobOrderId: afterJobOrderId, shiftId: afterShiftId });
    }
  }
);

export const onAssignmentDeleteRecomputeShiftFill = onDocumentDeleted(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const a = event.data?.data();
    if (!a?.shiftId || !a?.jobOrderId) return;
    await recomputeShiftFill({ tenantId, jobOrderId: a.jobOrderId, shiftId: a.shiftId });
  }
);

/**
 * If staffing requirements change on the shift (e.g. totalStaffRequested, overstaffCount),
 * recompute fill.
 */
export const onJobOrderShiftUpdatedRecomputeFill = onDocumentUpdated(
  'tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const shiftId = event.params.shiftId as string;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only recompute when relevant fields change. dateSchedule carries the
    // per-day workersNeeded that feeds liveFill.targetByDay (2026-09-06).
    const relevantChanged =
      before.totalStaffRequested !== after.totalStaffRequested ||
      before.overstaffCount !== after.overstaffCount ||
      before.overstaffPercent !== after.overstaffPercent ||
      JSON.stringify(before.dateSchedule ?? null) !== JSON.stringify(after.dateSchedule ?? null);

    if (!relevantChanged) return;
    await recomputeShiftFill({ tenantId, jobOrderId, shiftId });
  }
);

