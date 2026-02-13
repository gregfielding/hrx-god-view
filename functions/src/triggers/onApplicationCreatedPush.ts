/**
 * FCM push when a worker submits an application.
 * Trigger: tenants/{tenantId}/applications/{applicationId} onCreate.
 * Uses sendNotificationAndPush + users/{uid}/pushTokens. Deduped via applicationPushSentAt.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DEEP_LINK_APPLICATIONS = '/c1/workers/applications';
const JOBS_BOARD_PATH = '/c1/jobs-board';

function getUserId(applicationData: Record<string, any>, applicationId: string): string | null {
  const uid = applicationData.userId || applicationData.candidateId;
  if (uid) return String(uid).trim() || null;
  if (!applicationId.includes('_')) return null;
  const parts = applicationId.split('_');
  const potential = parts[0];
  if (potential && potential.length > 10) return potential;
  return null;
}

export const onApplicationCreatedPush = onDocumentCreated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    const { tenantId, applicationId } = event.params;
    const snap = event.data;
    if (!snap?.exists) return;

    const applicationData = snap.data() as Record<string, any>;
    const userId = getUserId(applicationData, applicationId);
    if (!userId) {
      logger.info('[PUSH][application_created] skipped: no userId', { applicationId, tenantId });
      return;
    }

    // Idempotency: avoid duplicate push on trigger retry
    if (applicationData.applicationPushSentAt) {
      logger.info('[PUSH][application_created] skipped: already sent', { applicationId });
      return;
    }

    const jobTitle =
      applicationData.jobOrderName ||
      applicationData.postTitle ||
      applicationData.jobTitle ||
      'your application';
    const title = 'Application submitted';
    const body = `We received your application for ${jobTitle}.`;

    const jobPostId = applicationData.jobId || applicationData.postId;
    const ctaUrl = jobPostId ? `${JOBS_BOARD_PATH}/${jobPostId}` : DEEP_LINK_APPLICATIONS;

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
        type: 'application',
        ctaUrl,
        entity: jobPostId ? { kind: 'job_post', id: jobPostId } : undefined,
        source: 'automation',
      });

      await snap.ref.update({
        applicationPushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info('[PUSH][application_created] uid=%s tenantId=%s deepLink=%s tokens=%d', userId, tenantId, ctaUrl, tokenCount);
    } catch (err: any) {
      logger.error('[PUSH][application_created] failed', { uid: userId, applicationId, error: err?.message || String(err) });
      // Do not throw — avoid blocking the application write
    }
  }
);
