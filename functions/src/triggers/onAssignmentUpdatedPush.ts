/**
 * FCM push when assignment status changes to scheduled/confirmed/cancelled.
 * Trigger: tenants/{tenantId}/assignments/{assignmentId} onUpdate.
 * Uses sendNotificationAndPush + users/{uid}/pushTokens. Deduped via lastPushSentForStatus.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';
import { markLifecycleEventIfFirst } from '../messaging/lifecycleDedupe';
import { normalizeAssignmentStatus } from '../utils/assignmentStatusNormalize';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ASSIGNMENTS_PATH = '/c1/workers/assignments';

/** Notify on canonical transitions; legacy raw strings normalized first in handler. */
const NOTIFY_CANONICAL = new Set(['pending', 'confirmed', 'in_progress', 'cancelled']);

export const onAssignmentUpdatedPush = onDocumentUpdated(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const { tenantId, assignmentId } = event.params;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const afterRaw = String(after.status ?? '').trim();
    const afterCanon = normalizeAssignmentStatus(after.status);
    const beforeCanon = normalizeAssignmentStatus(before.status);

    if (beforeCanon === afterCanon) {
      logger.info('[PUSH][assignment_updated] skipped: status unchanged (canonical)', {
        assignmentId,
        status: afterCanon,
      });
      return;
    }

    if (!NOTIFY_CANONICAL.has(afterCanon)) {
      logger.info('[PUSH][assignment_updated] skipped: status not notify-worthy', {
        assignmentId,
        afterCanon,
        afterRaw,
      });
      return;
    }

    const userId = after.userId ? String(after.userId).trim() : '';
    if (!userId) {
      logger.info('[PUSH][assignment_updated] skipped: no userId', { assignmentId });
      return;
    }

    const jobOrderIdForMute = after.jobOrderId ? String(after.jobOrderId).trim() : '';
    if (jobOrderIdForMute) {
      try {
        const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderIdForMute}`).get();
        if (joSnap.exists && Boolean(joSnap.data()?.muted)) {
          logger.info('[PUSH][assignment_updated] skipped: job order muted', {
            assignmentId,
            jobOrderId: jobOrderIdForMute,
          });
          return;
        }
      } catch (err: unknown) {
        logger.warn('[PUSH][assignment_updated] job order mute check failed', {
          assignmentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Idempotency: already sent push for this status (e.g. trigger retry)
    if (after.lastPushSentForStatus === afterRaw) {
      logger.info('[PUSH][assignment_updated] skipped: already sent for status', { assignmentId, afterRaw });
      return;
    }
    const updatedAtToken =
      typeof (after.updatedAt as any)?.toMillis === 'function'
        ? String((after.updatedAt as any).toMillis())
        : typeof (after.updatedAt as any)?._seconds === 'number'
          ? String((after.updatedAt as any)._seconds)
          : 'na';
    const canProcessPushEvent = await markLifecycleEventIfFirst({
      tenantId,
      dedupeKey: `assignment_push_status__${assignmentId}__${beforeCanon}__${afterCanon}__${updatedAtToken}`,
      eventType: 'assignment_status_push',
      context: { assignmentId, userId, beforeStatus: beforeCanon, afterStatus: afterCanon },
    });
    if (!canProcessPushEvent) {
      return;
    }

    const jobOrderName = after.jobOrderName || after.jobTitle || 'your shift';
    const startTime = after.startTime || after.startDate || '';
    const locationName = after.locationName || after.location || '';
    const statusLabel =
      afterCanon === 'cancelled'
        ? 'Cancelled'
        : afterCanon === 'pending'
          ? 'Scheduled'
          : afterCanon === 'confirmed'
            ? 'Confirmed'
            : afterCanon === 'in_progress'
              ? 'Active'
              : 'Updated';
    const title = `Shift ${statusLabel}`;
    let body = jobOrderName;
    if (startTime) body += ` — ${startTime}`;
    if (locationName) body += ` at ${locationName}`;
    body = body.trim() || 'Your assignment has been updated.';

    try {
      const tokensSnap = await db
        .collection('users')
        .doc(userId)
        .collection('pushTokens')
        .where('enabled', '==', true)
        .get();
      const tokenCount = tokensSnap.size;

      const deepLink = `${ASSIGNMENTS_PATH}/${assignmentId}`;
      await sendNotificationAndPush({
        uid: userId,
        tenantId,
        title,
        body,
        type: 'assignment',
        category: 'assignments',
        deepLink,
        entityId: assignmentId,
        source: 'automation',
      });

      await event.data.after.ref.update({
        lastPushSentForStatus: afterRaw,
        lastPushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(
        '[PUSH][assignment_updated] uid=%s status=%s->%s deepLink=%s tokens=%d',
        userId,
        beforeCanon,
        afterCanon,
        deepLink,
        tokenCount
      );
    } catch (err: any) {
      logger.error('[PUSH][assignment_updated] failed', { uid: userId, assignmentId, error: err?.message || String(err) });
      // Do not throw — avoid blocking the assignment write
    }
  }
);
