/**
 * Canonical recruiter score snapshot — read path for recruiter UI only.
 * Writes happen server-side via `refreshRecruiterScoreSnapshotForUser` (Cloud Functions).
 */

import type { RecruiterScoreSnapshot } from '../../types/recruiterScoreSnapshot';
import { recruiterTableLetterGrade } from '../recruiterUsersReadinessDisplay';

/** Normalize Firestore / JSON into a typed snapshot or null. */
export function parseRecruiterScoreSnapshot(raw: unknown): RecruiterScoreSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  const scoreKind = o.scoreKind;
  if (
    scoreKind !== 'operational' &&
    scoreKind !== 'composite' &&
    scoreKind !== 'base_interview' &&
    scoreKind !== 'none'
  ) {
    return null;
  }
  const score100 =
    typeof o.score100 === 'number' && Number.isFinite(o.score100) ? Math.round(o.score100) : null;
  const grade = typeof o.grade === 'string' ? o.grade : o.grade === null ? null : null;
  const cat = o.categoryScores && typeof o.categoryScores === 'object' && !Array.isArray(o.categoryScores)
    ? (o.categoryScores as RecruiterScoreSnapshot['categoryScores'])
    : {};

  return {
    version: 1,
    scoreKind,
    score100: score100 as number | null,
    grade,
    confidence:
      o.confidence === 'low' || o.confidence === 'medium' || o.confidence === 'high' || o.confidence === null
        ? (o.confidence as RecruiterScoreSnapshot['confidence'])
        : null,
    decision:
      o.decision === 'advance' ||
      o.decision === 'review' ||
      o.decision === 'reject' ||
      o.decision === 'hold' ||
      o.decision === null
        ? (o.decision as RecruiterScoreSnapshot['decision'])
        : null,
    recommendation:
      o.recommendation === 'proceed' ||
      o.recommendation === 'review' ||
      o.recommendation === 'caution' ||
      o.recommendation === 'decline' ||
      o.recommendation === null
        ? (o.recommendation as RecruiterScoreSnapshot['recommendation'])
        : null,
    riskLevel:
      o.riskLevel === 'low' || o.riskLevel === 'medium' || o.riskLevel === 'high' || o.riskLevel === null
        ? (o.riskLevel as RecruiterScoreSnapshot['riskLevel'])
        : null,
    riskSummary: typeof o.riskSummary === 'string' ? o.riskSummary : o.riskSummary === null ? null : null,
    reasoningSummary:
      typeof o.reasoningSummary === 'string' ? o.reasoningSummary : o.reasoningSummary === null ? null : null,
    categoryScores: cat,
    interviewScoreBase100:
      typeof o.interviewScoreBase100 === 'number' && Number.isFinite(o.interviewScoreBase100)
        ? Math.round(o.interviewScoreBase100)
        : o.interviewScoreBase100 === null
          ? null
          : null,
    operationalScore100:
      typeof o.operationalScore100 === 'number' && Number.isFinite(o.operationalScore100)
        ? Math.round(o.operationalScore100)
        : o.operationalScore100 === null
          ? null
          : null,
    compositeScore100:
      typeof o.compositeScore100 === 'number' && Number.isFinite(o.compositeScore100)
        ? Math.round(o.compositeScore100)
        : o.compositeScore100 === null
          ? null
          : null,
    sourceInterviewId: typeof o.sourceInterviewId === 'string' ? o.sourceInterviewId : o.sourceInterviewId === null ? null : null,
    sourceModel: typeof o.sourceModel === 'string' ? o.sourceModel : o.sourceModel === null ? null : null,
    updatedAt: o.updatedAt,
    generatedBy:
      o.generatedBy === 'interview_submit' ||
      o.generatedBy === 'rescore_script' ||
      o.generatedBy === 'manual_review' ||
      o.generatedBy === 'profile_refresh' ||
      o.generatedBy === 'system'
        ? o.generatedBy
        : 'system',
    inputSignature: typeof o.inputSignature === 'string' ? o.inputSignature : o.inputSignature === null ? null : null,
  };
}

/** Single normalized grade helper — same bands as Users table / header. */
export function scoreToRecruiterGrade(score100: number | null | undefined): string | null {
  if (score100 == null || !Number.isFinite(score100)) return null;
  return recruiterTableLetterGrade(Math.round(Math.max(0, Math.min(100, score100))));
}

export function getRecruiterPrimaryScore(snapshot: RecruiterScoreSnapshot | null | undefined): number | null {
  if (!snapshot) return null;
  return typeof snapshot.score100 === 'number' && Number.isFinite(snapshot.score100) ? Math.round(snapshot.score100) : null;
}

export function getRecruiterPrimaryGrade(snapshot: RecruiterScoreSnapshot | null | undefined): string | null {
  if (!snapshot) return null;
  if (typeof snapshot.grade === 'string' && snapshot.grade.trim()) return snapshot.grade.trim();
  return scoreToRecruiterGrade(snapshot.score100);
}

/** Recruiter UI when snapshot is missing — do not substitute legacy score fields. */
export const RECRUITER_SNAPSHOT_MISSING_LABEL = 'No score yet';

/** Single read for admin/recruiter surfaces — no fallback to scoreSummary when snapshot is absent. */
export function getRecruiterScoreDisplayForAdminUi(recruiterScoreSnapshotRaw: unknown): {
  score100: number | null;
  grade: string | null;
  reasoningSummary: string | null;
  riskLevel: string | null;
  riskSummary: string | null;
  operationalScore100: number | null;
  compositeScore100: number | null;
  interviewScoreBase100: number | null;
  categoryScores: RecruiterScoreSnapshot['categoryScores'];
  hasSnapshot: boolean;
} {
  const snap = parseRecruiterScoreSnapshot(recruiterScoreSnapshotRaw);
  if (!snap) {
    return {
      score100: null,
      grade: null,
      reasoningSummary: null,
      riskLevel: null,
      riskSummary: null,
      operationalScore100: null,
      compositeScore100: null,
      interviewScoreBase100: null,
      categoryScores: {},
      hasSnapshot: false,
    };
  }
  return {
    score100: getRecruiterPrimaryScore(snap),
    grade: getRecruiterPrimaryGrade(snap),
    reasoningSummary: snap.reasoningSummary,
    riskLevel: snap.riskLevel,
    riskSummary: snap.riskSummary,
    operationalScore100: snap.operationalScore100,
    compositeScore100: snap.compositeScore100,
    interviewScoreBase100: snap.interviewScoreBase100,
    categoryScores: snap.categoryScores || {},
    hasSnapshot: true,
  };
}
