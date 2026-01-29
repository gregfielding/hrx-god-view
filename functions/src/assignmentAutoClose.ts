import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

function norm(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Stamp completedAt when an assignment transitions into "completed".
 * This is used by the scheduled auto-close job to move completed -> ended after 24 hours.
 *
 * Idempotent: if completedAt already exists, does nothing.
 */
export const onAssignmentCompletedStampCompletedAt = onDocumentUpdated(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const { tenantId, assignmentId } = event.params as any;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const beforeStatus = norm(before.status);
    const afterStatus = norm(after.status);

    if (beforeStatus === afterStatus) return;
    if (afterStatus !== 'completed') return;

    // Avoid loops: only set if missing
    if (after.completedAt) return;

    try {
      await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).update({
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: after.updatedBy || 'system',
      });
      logger.info('Stamped assignment completedAt', { tenantId, assignmentId });
    } catch (err: any) {
      logger.error('Failed to stamp assignment completedAt', {
        tenantId,
        assignmentId,
        error: err?.message || String(err),
      });
    }
  }
);

