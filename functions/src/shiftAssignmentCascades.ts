import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * When a job order shift is cancelled, cancel all related assignments.
 *
 * Why server-side?
 * - Ensures consistency even if UI/API forgets to cascade
 * - Keeps worker notifications centralized (assignment triggers already send SMS/push)
 *
 * Note:
 * - Shift status uses "cancelled" (double-L) in UI
 * - AssignmentStatus uses "canceled" (single-L) in phase2 types
 */
export const onJobOrderShiftCancelledCascadeAssignments = onDocumentUpdated(
  'tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}',
  async (event) => {
    const { tenantId, shiftId } = event.params as any;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    const beforeStatus = normalizeStatus(before.status || 'open');
    const afterStatus = normalizeStatus(after.status || 'open');

    // Only act on transition into cancelled
    if (beforeStatus === afterStatus) return;
    const isCancelled = afterStatus === 'cancelled' || afterStatus === 'canceled';
    if (!isCancelled) return;

    try {
      // Find all active-ish assignments for this shift.
      // (Keeping the set small avoids write storms and is idempotent.)
      const assignmentsRef = db.collection(`tenants/${tenantId}/assignments`);

      const q = assignmentsRef
        .where('shiftId', '==', shiftId)
        .where('status', 'in', ['proposed', 'confirmed', 'active']);

      const snap = await q.get();
      if (snap.empty) {
        logger.info('Shift cancelled: no active assignments to cancel', { tenantId, shiftId });
        return;
      }

      // Batch update with chunking (Firestore batch limit is 500 ops).
      const now = admin.firestore.FieldValue.serverTimestamp();
      const chunks: Array<admin.firestore.QueryDocumentSnapshot> = snap.docs;

      let updated = 0;
      for (let i = 0; i < chunks.length; i += 450) {
        const batch = db.batch();
        const slice = chunks.slice(i, i + 450);

        for (const docSnap of slice) {
          batch.update(docSnap.ref, {
            status: 'canceled',
            canceledAt: now,
            cancellationReason: 'shift_cancelled',
            updatedAt: now,
            updatedBy: 'system',
          });
        }

        await batch.commit();
        updated += slice.length;
      }

      logger.info('Shift cancelled: assignments cancelled', { tenantId, shiftId, assignmentsCancelled: updated });
    } catch (err: any) {
      // Never fail the originating write; log and move on.
      logger.error('Failed cascading assignment cancellations for shift', {
        tenantId,
        shiftId,
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * When an application is withdrawn/deleted, cancel related active assignments.
 *
 * This prevents workers from remaining "Placed" on Placements after either:
 * - worker withdraws application, or
 * - recruiter removes/deletes application from the Applications tab.
 */
export const onApplicationWithdrawnOrDeletedCascadeAssignments = onDocumentUpdated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    const { tenantId } = event.params as any;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const beforeStatus = normalizeStatus(before.status || 'submitted');
    const afterStatus = normalizeStatus(after.status || 'submitted');
    if (beforeStatus === afterStatus) return;
    if (!['withdrawn', 'deleted'].includes(afterStatus)) return;

    const userId = String(after.userId || '').trim();
    const jobOrderId = String(after.jobOrderId || '').trim();
    if (!userId || !jobOrderId) {
      logger.warn('Application cascade skipped: missing userId or jobOrderId', {
        tenantId,
        applicationId: event.params?.applicationId,
        userId,
        jobOrderId,
      });
      return;
    }

    const shiftIds = new Set<string>();
    const primaryShiftId = String(after.shiftId || '').trim();
    if (primaryShiftId) shiftIds.add(primaryShiftId);
    if (Array.isArray(after.shiftIds)) {
      after.shiftIds.forEach((id: any) => {
        const normalized = String(id || '').trim();
        if (normalized) shiftIds.add(normalized);
      });
    }
    if (Array.isArray(after.selectedShifts)) {
      after.selectedShifts.forEach((s: any) => {
        const normalized = String(s?.shiftId || s?.id || '').trim();
        if (normalized) shiftIds.add(normalized);
      });
    }

    try {
      const assignmentsRef = db.collection(`tenants/${tenantId}/assignments`);
      const q = assignmentsRef
        .where('userId', '==', userId)
        .where('jobOrderId', '==', jobOrderId)
        .where('status', 'in', ['proposed', 'confirmed', 'active']);
      const snap = await q.get();
      if (snap.empty) return;

      const now = admin.firestore.FieldValue.serverTimestamp();
      const cancellationReason =
        afterStatus === 'withdrawn'
          ? 'application_withdrawn'
          : 'application_deleted';

      const candidates = snap.docs.filter((docSnap) => {
        if (shiftIds.size === 0) return true;
        const assignment = docSnap.data() || {};
        const assignmentShiftId = String(assignment.shiftId || '').trim();
        return assignmentShiftId ? shiftIds.has(assignmentShiftId) : true;
      });
      if (candidates.length === 0) return;

      let updated = 0;
      for (let i = 0; i < candidates.length; i += 450) {
        const batch = db.batch();
        const slice = candidates.slice(i, i + 450);
        for (const docSnap of slice) {
          batch.update(docSnap.ref, {
            status: 'canceled',
            canceledAt: now,
            cancellationReason,
            updatedAt: now,
            updatedBy: 'system',
          });
        }
        await batch.commit();
        updated += slice.length;
      }

      logger.info('Application status cascade: assignments cancelled', {
        tenantId,
        applicationId: event.params?.applicationId,
        userId,
        jobOrderId,
        applicationStatus: afterStatus,
        assignmentsCancelled: updated,
      });
    } catch (err: any) {
      logger.error('Failed cascading assignment cancellations for application status', {
        tenantId,
        applicationId: event.params?.applicationId,
        userId,
        jobOrderId,
        applicationStatus: afterStatus,
        error: err?.message || String(err),
      });
    }
  },
);

