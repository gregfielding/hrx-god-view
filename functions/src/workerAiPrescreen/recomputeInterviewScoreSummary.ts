/**
 * Mirror of recruiter InterviewTab scoreSummary update (admin SDK).
 * Co-locates `riskProfile` with score summary when inputs change (signature-guarded).
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { ComposedPrescreenAiBundle } from './composePrescreenAiBundle';
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import {
  buildWorkerRiskProfileFromBundleWithAnswers,
  buildWorkerRiskProfileFromLatestInterview,
  mergeRiskProfileIntoUserUpdateIfChanged,
} from './workerRiskProfile';
import { refreshRecruiterScoreSnapshotForUser } from '../scoring/refreshRecruiterScoreSnapshot';
import type { RecruiterScoreSnapshotGeneratedBy } from '../scoring/buildRecruiterScoreSnapshot';

const RECRUITER_PRIMARY_SCORE_SOURCE_VERSION = 'recruiter_primary_v1';

function computeAiScoreFromComponents(
  completeness: number,
  responsiveness: number,
  quality: number,
  weights = { completeness: 0.45, responsiveness: 0.25, quality: 0.3 },
): number | null {
  const c = typeof completeness === 'number' && Number.isFinite(completeness) ? completeness : null;
  const r = typeof responsiveness === 'number' && Number.isFinite(responsiveness) ? responsiveness : null;
  const q = typeof quality === 'number' && Number.isFinite(quality) ? quality : null;
  if (c === null || r === null || q === null) return null;
  const raw = weights.completeness * c + weights.responsiveness * r + weights.quality * q;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export type RecomputeUserInterviewScoreSummaryOpts = {
  /** Fresh prescreen bundle from interview submit — avoids stale read before writes land. */
  prescreenBundle?: ComposedPrescreenAiBundle;
  prescreenAnswers?: WorkerAiPrescreenAnswers;
  prescreenDynamicAnswers?: Record<string, string>;
  submitInterviewId?: string;
  /**
   * Firestore `createdAt` (or `timestamp`) of the prescreen interview just written — feeds `riskProfile.staleness`
   * the same way as `buildWorkerRiskProfileFromLatestInterview` reading the stored interview doc.
   */
  interviewCreatedAt?: admin.firestore.Timestamp | null;
  /** Stored on `recruiterScoreSnapshot.generatedBy` after canonical snapshot refresh. */
  recruiterSnapshotGeneratedBy?: RecruiterScoreSnapshotGeneratedBy;
};

export async function recomputeUserInterviewScoreSummary(
  db: Firestore,
  uid: string,
  opts?: RecomputeUserInterviewScoreSummaryOpts,
): Promise<void> {
  const interviewsRef = db.collection('users').doc(uid).collection('interviews');
  let snap;
  try {
    snap = await interviewsRef.orderBy('createdAt', 'desc').get();
  } catch {
    try {
      snap = await interviewsRef.orderBy('timestamp', 'desc').get();
    } catch {
      snap = await interviewsRef.get();
    }
  }

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
    .filter((d) => d && d.isArchived !== true);

  const scored = docs
    .map((d) => (typeof d.score10 === 'number' ? d.score10 : typeof d.score === 'number' ? d.score : null))
    .filter((n): n is number => typeof n === 'number');

  const interviewCount = docs.length;
  const interviewAvg =
    scored.length > 0 ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : undefined;

  const lastInterview = docs[0];
  const lastAt = (lastInterview?.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
  const lastTimestamp = (lastInterview?.timestamp as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
  const lastResolved = lastAt || lastTimestamp;
  const lastScore10 =
    lastInterview != null &&
    (typeof lastInterview.score10 === 'number' || typeof lastInterview.score === 'number')
      ? typeof lastInterview.score10 === 'number'
        ? lastInterview.score10
        : (lastInterview.score as number)
      : null;

  const lastKind =
    lastInterview != null ? String((lastInterview as Record<string, unknown>).interviewKind ?? '') : '';

  const userSnap = await db.collection('users').doc(uid).get();
  const userData = (userSnap.data() || {}) as Record<string, unknown>;
  const scoreSummary = (userData.scoreSummary as Record<string, unknown> | undefined) || {};
  const reviewAvg = typeof scoreSummary.reviewAvg === 'number' ? scoreSummary.reviewAvg : null;

  const hasInterview = typeof interviewAvg === 'number' && Number.isFinite(interviewAvg);
  const hasReview = typeof reviewAvg === 'number' && Number.isFinite(reviewAvg);

  let qualityScore: number | null = null;
  if (hasInterview || hasReview) {
    const interviewScore100 = hasInterview ? ((interviewAvg as number) / 10) * 100 : 0;
    const reviewScore100 = hasReview ? (((reviewAvg as number) - 1) / 4) * 100 : 0;
    const iw = hasInterview && hasReview ? 0.5 : hasInterview ? 1 : 0;
    const rw = hasInterview && hasReview ? 0.5 : hasReview ? 1 : 0;
    const raw = interviewScore100 * iw + reviewScore100 * rw;
    qualityScore = Math.round(Math.max(0, Math.min(100, raw)));
  }

  const completeness = typeof scoreSummary.completenessScore === 'number' ? scoreSummary.completenessScore : 0;
  const responsiveness = typeof scoreSummary.responsivenessScore === 'number' ? scoreSummary.responsivenessScore : 50;
  const newAiScore =
    qualityScore !== null ? computeAiScoreFromComponents(completeness, responsiveness, qualityScore) : null;

  const update: Record<string, unknown> = {
    'scoreSummary.interviewAvg': interviewAvg ?? null,
    'scoreSummary.interviewCount': interviewCount,
    'scoreSummary.interviewLastAt': lastResolved ?? null,
    'scoreSummary.interviewLastScore10': lastScore10,
    'scoreSummary.interviewLastInterviewKind': lastKind || null,
  };

  let prescreenOperational: number | null = null;
  if (lastKind === 'worker_ai_prescreen' && lastInterview) {
    const ai = (lastInterview as Record<string, unknown>).ai as Record<string, unknown> | undefined;
    if (ai && typeof ai === 'object') {
      const base =
        typeof ai.baseInterviewScore === 'number'
          ? ai.baseInterviewScore
          : typeof ai.overallScore === 'number'
            ? ai.overallScore
            : null;
      const adj = typeof ai.overrideAdjustedScore === 'number' ? ai.overrideAdjustedScore : base;
      prescreenOperational = typeof adj === 'number' && Number.isFinite(adj) ? Math.round(adj) : null;
      const delta = typeof ai.overrideScoreDelta === 'number' ? ai.overrideScoreDelta : null;
      if (base != null) update['scoreSummary.baseInterviewScore'] = base;
      if (adj != null) update['scoreSummary.overrideAdjustedScore'] = adj;
      if (delta != null) update['scoreSummary.overrideScoreDelta'] = delta;
      if (typeof ai.overrideBand === 'string') update['scoreSummary.overrideBand'] = ai.overrideBand;
      if (typeof ai.recruiterTrustLevel === 'string') update['scoreSummary.recruiterTrustLevel'] = ai.recruiterTrustLevel;
      const hd = ai.hiringDecision as Record<string, unknown> | undefined;
      if (hd && typeof hd.eligibleForAutoAdvance === 'boolean') {
        update['scoreSummary.autoAdvanceEligible'] = hd.eligibleForAutoAdvance;
      }
      if (typeof ai.overrideRulesVersion === 'string') {
        update['scoreSummary.overrideRulesVersion'] = ai.overrideRulesVersion;
      }
      if (typeof ai.scoreComputationVersion === 'string') {
        update['scoreSummary.scoreComputationVersion'] = ai.scoreComputationVersion;
      }
    }
  }
  if (qualityScore !== null) update['scoreSummary.qualityScore'] = qualityScore;
  if (newAiScore !== null) {
    update['scoreSummary.aiScore'] = newAiScore;
    update['scoreSummary.aiScoreUpdatedAt'] = admin.firestore.FieldValue.serverTimestamp();
  }

  update['scoreSummary.primaryRecruiterScoreUpdatedAt'] = admin.firestore.FieldValue.serverTimestamp();
  update['scoreSummary.recruiterScoreSourceVersion'] = RECRUITER_PRIMARY_SCORE_SOURCE_VERSION;
  if (prescreenOperational != null) {
    update['scoreSummary.primaryRecruiterScoreSource'] = 'operational_prescreen';
    if (newAiScore != null) {
      update['scoreSummary.scoreConflictDetected'] = Math.abs(prescreenOperational - newAiScore) >= 15;
    } else {
      update['scoreSummary.scoreConflictDetected'] = false;
    }
  } else if (interviewCount > 0) {
    update['scoreSummary.primaryRecruiterScoreSource'] = 'interview_quality_proxy';
    update['scoreSummary.scoreConflictDetected'] = false;
  } else {
    update['scoreSummary.primaryRecruiterScoreSource'] = 'legacy_profile_composite';
    update['scoreSummary.scoreConflictDetected'] = false;
  }

  try {
    let riskDraft = null as ReturnType<typeof buildWorkerRiskProfileFromBundleWithAnswers> | null;
    if (
      opts?.prescreenBundle &&
      opts.prescreenAnswers &&
      opts.submitInterviewId &&
      opts.prescreenBundle.scored &&
      opts.prescreenBundle.aiFlags
    ) {
      riskDraft = buildWorkerRiskProfileFromBundleWithAnswers(
        opts.prescreenBundle,
        opts.prescreenAnswers,
        opts.prescreenDynamicAnswers ?? {},
        userData,
        opts.submitInterviewId,
        'interview_submit',
        opts.interviewCreatedAt ?? null,
      );
    } else {
      riskDraft = await buildWorkerRiskProfileFromLatestInterview(db, uid, userData, 'score_review');
    }
    const riskMerge = mergeRiskProfileIntoUserUpdateIfChanged(userData, riskDraft);
    if (riskMerge) {
      Object.assign(update, riskMerge);
    }
  } catch (e) {
    logger.warn('recomputeUserInterviewScoreSummary.riskProfile_failed', {
      uid,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  await db.collection('users').doc(uid).update(update);

  try {
    await refreshRecruiterScoreSnapshotForUser(
      db,
      uid,
      opts?.recruiterSnapshotGeneratedBy ?? 'system',
    );
  } catch (e) {
    logger.warn('recomputeUserInterviewScoreSummary.recruiterScoreSnapshot_failed', {
      uid,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
