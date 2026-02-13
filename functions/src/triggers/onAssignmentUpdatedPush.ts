/**
 * FCM push when assignment status changes to scheduled/confirmed/cancelled.
 * Trigger: tenants/{tenantId}/assignments/{assignmentId} onUpdate.
 * Uses sendNotificationAndPush + users/{uid}/pushTokens. Deduped via lastPushSentForStatus.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DEEP_LINK_ASSIGNMENTS = '/c1/workers/assignments';

const NOTIFY_STATUSES = new Set(['proposed', 'confirmed', 'active', 'canceled', 'cancelled']);

function normalizeStatus(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

export const onAssignmentUpdatedPush = onDocumentUpdated(
  'tenants/{tenantId}/assignments/{assignmentId}',
  async (event) => {
    const { tenantId, assignmentId } = event.params;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const beforeStatus = normalizeStatus(before.status);
    const afterStatus = normalizeStatus(after.status);

    if (beforeStatus === afterStatus) {
      logger.info('[PUSH][assignment_updated] skipped: status unchanged', { assignmentId, status: afterStatus });
      return;
    }

    if (!NOTIFY_STATUSES.has(afterStatus)) {
      logger.info('[PUSH][assignment_updated] skipped: status not notify-worthy', { assignmentId, afterStatus });
      return;
    }

    const userId = after.userId ? String(after.userId).trim() : '';
    if (!userId) {
      logger.info('[PUSH][assignment_updated] skipped: no userId', { assignmentId });
      return;
    }

    // Idempotency: already sent push for this status (e.g. trigger retry)
    if (after.lastPushSentForStatus === afterStatus) {
      logger.info('[PUSH][assignment_updated] skipped: already sent for status', { assignmentId, afterStatus });
      return;
    }

    const jobOrderName = after.jobOrderName || after.jobTitle || 'your shift';
    const startTime = after.startTime || after.startDate || '';
    const locationName = after.locationName || after.location || '';
    const statusLabel = afterStatus === 'canceled' || afterStatus === 'cancelled' ? 'Cancelled' : afterStatus === 'proposed' ? 'Scheduled' : afterStatus === 'confirmed' ? 'Confirmed' : afterStatus === 'active' ? 'Active' : 'Updated';
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

      await sendNotificationAndPush({
        uid: userId,
        tenantId,
        title,
        body,
        type: 'assignment',
        ctaUrl: DEEP_LINK_ASSIGNMENTS,
        source: 'automation',
      });

      await event.data.after.ref.update({
        lastPushSentForStatus: afterStatus,
        lastPushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info('[PUSH][assignment_updated] uid=%s status=%s->%s deepLink=%s tokens=%d', userId, beforeStatus, afterStatus, DEEP_LINK_ASSIGNMENTS, tokenCount);
    } catch (err: any) {
      logger.error('[PUSH][assignment_updated] failed', { uid: userId, assignmentId, error: err?.message || String(err) });
      // Do not throw — avoid blocking the assignment write
    }
  }
);
