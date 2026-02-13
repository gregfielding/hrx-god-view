/**
 * Complete-requirements reminder: send one notification per application when
 * the backend knows there are still missing items (e.g. 24h after submit).
 * Link in notification: https://hrxone.com/c1/jobs-board/{jobId}
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendMessage } from './messaging/routingOrchestrator';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const JOBS_BOARD_BASE_URL = 'https://hrxone.com';
const JOBS_BOARD_PATH = '/c1/jobs-board';
const HOURS_AFTER_SUBMIT = 24;
const BATCH_LIMIT = 100;

function hasMissingRequirements(jobScoreSummary: any): boolean {
  if (!jobScoreSummary) return false;
  const v1 =
    jobScoreSummary.version === 'v1' &&
    Array.isArray(jobScoreSummary.buckets?.missingRequired) &&
    jobScoreSummary.buckets.missingRequired.length > 0;
  const legacy =
    Array.isArray(jobScoreSummary.missingLabels) && jobScoreSummary.missingLabels.length > 0;
  return v1 || legacy;
}

function getJobId(applicationId: string, data: Record<string, any>): string | null {
  if (data.jobId) return data.jobId;
  // applicationId is often {userId}_{jobId}
  const lastUnderscore = applicationId.lastIndexOf('_');
  if (lastUnderscore > 0) return applicationId.substring(lastUnderscore + 1);
  return null;
}

function getUserId(data: Record<string, any>, applicationId: string): string | null {
  if (data.userId) return data.userId;
  if (data.candidateId) return data.candidateId;
  const parts = applicationId.split('_');
  if (parts.length >= 2 && parts[0].length > 10) return parts[0];
  return null;
}

export const scheduledCompleteRequirementsReminder = onSchedule(
  {
    schedule: '0 14 * * *', // 14:00 UTC daily
    timeZone: 'UTC',
  },
  async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - HOURS_AFTER_SUBMIT * 60 * 60 * 1000);
    const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

    const applicationsRef = db.collectionGroup('applications');
    const snapshot = await applicationsRef
      .where('status', '==', 'submitted')
      .where('appliedAt', '<=', cutoffTs)
      .limit(BATCH_LIMIT)
      .get();

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const applicationId = docSnap.id;
      const ref = docSnap.ref;
      const pathParts = ref.path.split('/');
      const tenantId = pathParts[1] ?? '';

      if (data.completeRequirementsNotificationSentAt) {
        skipped++;
        continue;
      }
      if (!hasMissingRequirements(data.jobScoreSummary)) {
        skipped++;
        continue;
      }

      const userId = getUserId(data, applicationId);
      const jobId = getJobId(applicationId, data);
      if (!userId || !jobId) {
        skipped++;
        continue;
      }

      const jobTitle = data.jobTitle || data.postTitle || data.jobOrderName || 'your application';
      const ctaUrl = `${JOBS_BOARD_BASE_URL}${JOBS_BOARD_PATH}/${jobId}`;
      const subject = 'Complete your application';
      const messageHtml = `You have a few requirements left for <strong>${jobTitle}</strong>. <a href="${ctaUrl}">Complete them here</a>.`;

      try {
        await sendMessage({
          userId,
          tenantId,
          messageTypeId: 'application_requirements_reminder',
          variables: {
            _directMessage: true,
            _message: messageHtml,
            _subject: subject,
            jobTitle,
            ctaUrl,
          },
          metadata: { ctaUrl },
        });

        await ref.update({
          completeRequirementsNotificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        sent++;
      } catch (err: any) {
        logger.error('Complete-requirements reminder send failed', {
          applicationId: ref.path,
          userId,
          error: err?.message ?? err,
        });
        errors++;
      }
    }

    logger.info('scheduledCompleteRequirementsReminder finished', {
      total: snapshot.size,
      sent,
      skipped,
      errors,
    });
  }
);
