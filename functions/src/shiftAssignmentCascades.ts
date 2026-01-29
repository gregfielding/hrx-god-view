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

