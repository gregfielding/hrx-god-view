/**
 * Worker funnel / activity signals → category scores (trusted processor + idempotency only).
 */

import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { applyCategoryScoreEventInternal } from './applyCategoryScoreEventCore';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';

function logActivityScoreError(context: string, err: unknown, extra: Record<string, unknown>): void {
  if (err instanceof HttpsError && err.code === 'failed-precondition') {
    logger.warn(`categoryScoreEvolution.activity.${context}.skip`, { ...extra, message: err.message });
    return;
  }
  logger.error(`categoryScoreEvolution.activity.${context}.failed`, {
    ...extra,
    err: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Worker submitted an application (entered funnel). Not for assignment-driven `accepted` creates.
 */
export async function maybeEmitJobAppliedCategoryScore(
  db: admin.firestore.Firestore,
  args: { tenantId: string; applicationId: string; applicationData: Record<string, unknown> },
): Promise<void> {
  const status = normalizeApplicationStatus(String(args.applicationData.status ?? ''));
  if (status === 'accepted') return;
  if (status !== 'submitted') return;
  const uid = String(args.applicationData.userId || args.applicationData.candidateId || '').trim();
  if (!uid) return;
  try {
    await applyCategoryScoreEventInternal(db, {
      uid,
      category: 'stability',
      delta: 1,
      source: 'activity',
      idempotencyKey: `job_applied:${args.tenantId}:${args.applicationId}`,
      referenceId: args.applicationId,
    });
  } catch (err) {
    logActivityScoreError('job_applied', err, { uid, tenantId: args.tenantId, applicationId: args.applicationId });
  }
}

/**
 * Worker AI prescreen interview submitted successfully (one-time per interview doc).
 */
export async function maybeEmitInterviewCompletedCategoryScores(
  db: admin.firestore.Firestore,
  args: { uid: string; interviewId: string },
): Promise<void> {
  const { uid, interviewId } = args;
  if (!uid || !interviewId) return;
  try {
    await applyCategoryScoreEventInternal(db, {
      uid,
      source: 'activity',
      idempotencyKey: `interview_completed:${interviewId}`,
      referenceId: interviewId,
      categoryDeltas: {
        stability: 2,
        jobReadiness: 1,
      },
    });
  } catch (err) {
    logActivityScoreError('interview_completed', err, { uid, interviewId });
  }
}

/**
 * Resume merge committed to profile (`parsedResumes` upload id).
 */
export async function maybeEmitResumeUploadedCategoryScore(
  db: admin.firestore.Firestore,
  args: { uid: string; uploadId: string },
): Promise<void> {
  const { uid, uploadId } = args;
  if (!uid || !uploadId) return;
  try {
    await applyCategoryScoreEventInternal(db, {
      uid,
      category: 'jobReadiness',
      delta: 2,
      source: 'activity',
      idempotencyKey: `resume_uploaded:${uploadId}`,
      referenceId: uploadId,
    });
  } catch (err) {
    logActivityScoreError('resume_uploaded', err, { uid, uploadId });
  }
}

/**
 * Twilio Verify approved — first time `phoneVerified` becomes true for this user doc.
 */
export async function maybeEmitPhoneVerifiedCategoryScore(
  db: admin.firestore.Firestore,
  args: { uid: string },
): Promise<void> {
  const uid = String(args.uid || '').trim();
  if (!uid) return;
  try {
    await applyCategoryScoreEventInternal(db, {
      uid,
      category: 'jobReadiness',
      delta: 1,
      source: 'activity',
      idempotencyKey: `phone_verified:${uid}`,
      referenceId: uid,
    });
  } catch (err) {
    logActivityScoreError('phone_verified', err, { uid });
  }
}

/**
 * Home address gained finite geocoordinates (first time).
 */
export async function maybeEmitAddressGeocodedCategoryScore(
  db: admin.firestore.Firestore,
  args: { uid: string },
): Promise<void> {
  const uid = String(args.uid || '').trim();
  if (!uid) return;
  try {
    await applyCategoryScoreEventInternal(db, {
      uid,
      category: 'jobReadiness',
      delta: 1,
      source: 'activity',
      idempotencyKey: `address_geocoded:${uid}`,
      referenceId: uid,
    });
  } catch (err) {
    logActivityScoreError('address_geocoded', err, { uid });
  }
}
