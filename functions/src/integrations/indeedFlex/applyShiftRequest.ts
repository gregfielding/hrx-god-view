/**
 * indeedFlexApplyShiftRequest — Phase 1b of the scheduling review: the
 * first real APPLY path for the Indeed Flex feed (which until now was a
 * dry-run observability inbox — detection without action).
 *
 * v1 scope: `cancel_booking` rows. The matcher already resolves the
 * email's workerNames[] to live assignment ids (`matchedAssignmentIds`);
 * this callable executes the removal in HRX:
 *   1. status → 'cancelled' first (fires the standard worker push/SMS
 *      cascade via onAssignmentUpdatedPush — worker sees the same
 *      cancellation they'd get from a manual removal), then
 *   2. hard-DELETE the assignment doc — required because the timesheet
 *      grid treats presence as payable; this mirrors
 *      placementsCancelAssignment's delete-after-flip pattern.
 *      (We deliberately skip that path's placement/application revert:
 *      a portal-cancelled worker isn't going back to "Placed" — the
 *      booking is gone at the source.)
 *   3. Stamp the request row applied (appliedAt/appliedBy/appliedResult)
 *      so the feed shows it as handled and re-applies are no-ops.
 *
 * Other event types (new_request / change_headcount / change_time) return
 * failed-precondition for now — they land in later Phase 1 slices.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Recruiter/admin band (5+) or HRX super-admin — same gate as the
 *  divergence sweep; the feed UI is already staff-only. */
async function assertRecruiterOrAdmin(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const snap = await db.collection('users').doc(uid).get();
  const data = (snap.data() || {}) as Record<string, unknown>;
  const nested = (data.tenantIds as Record<string, { securityLevel?: unknown }> | undefined)?.[tenantId]
    ?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5) return;
  throw new HttpsError('permission-denied', 'Applying shift requests requires tenant security level 5+.');
}

export const indeedFlexApplyShiftRequest = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const tenantId = String(request.data?.tenantId ?? '').trim();
    const requestId = String(request.data?.requestId ?? '').trim();
    if (!tenantId || !requestId) {
      throw new HttpsError('invalid-argument', 'tenantId and requestId are required');
    }
    await assertRecruiterOrAdmin(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);

    const rowRef = db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`);
    const rowSnap = await rowRef.get();
    if (!rowSnap.exists) throw new HttpsError('not-found', 'Shift request not found');
    const row = rowSnap.data() || {};

    const eventType = String(row.eventType ?? '');
    const rowStatus = String(row.status ?? '');
    if (rowStatus === 'applied') {
      return { ok: true, alreadyApplied: true, cancelled: 0, skipped: [] };
    }

    if (eventType !== 'cancel_booking') {
      throw new HttpsError(
        'failed-precondition',
        `Apply is not yet supported for "${eventType}" — v1 handles cancel_booking only.`,
      );
    }

    const assignmentIds: string[] = Array.isArray(row.matchedAssignmentIds)
      ? (row.matchedAssignmentIds as unknown[]).map((v) => String(v)).filter(Boolean)
      : [];
    if (!assignmentIds.length) {
      throw new HttpsError(
        'failed-precondition',
        'No matched assignments on this request — match the workers first (or handle manually).',
      );
    }

    const cancelled: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const assignmentId of assignmentIds) {
      const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
      const aSnap = await aRef.get();
      if (!aSnap.exists) {
        skipped.push({ id: assignmentId, reason: 'assignment no longer exists' });
        continue;
      }
      const a = aSnap.data() || {};
      const status = String(a.status ?? '').toLowerCase();
      if (/cancel|declined|completed|ended/.test(status)) {
        skipped.push({ id: assignmentId, reason: `already ${status}` });
        continue;
      }
      // Flip first so the standard cancellation notification fires…
      await aRef.update({
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        canceledBy: request.auth.uid,
        cancellationReason: 'Indeed Flex booking removed (portal sync)',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // …then hard-delete so no grid/live query can ever resurface it.
      await aRef.delete();
      cancelled.push(assignmentId);
    }

    await rowRef.update({
      status: 'applied',
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: request.auth.uid,
      appliedResult: {
        action: 'cancel_assignments',
        cancelledAssignmentIds: cancelled,
        skipped,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info('indeedFlexApplyShiftRequest applied', {
      tenantId, requestId, cancelled: cancelled.length, skipped: skipped.length,
    });
    return { ok: true, alreadyApplied: false, cancelled: cancelled.length, skipped };
  },
);
