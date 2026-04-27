/**
 * Canonical recruiter-facing score — single read path for all recruiter UI.
 * Stored at `users/{uid}.recruiterScoreSnapshot`.
 *
 * Legacy `scoreSummary` / interview `ai` fields remain for analytics; do not use for primary recruiter display.
 */

export type RecruiterScoreSnapshotVersion = 1;

export type RecruiterScoreSnapshotScoreKind = 'operational' | 'composite' | 'base_interview' | 'none';

export type RecruiterScoreSnapshotConfidence = 'low' | 'medium' | 'high';

export type RecruiterScoreSnapshotDecision = 'advance' | 'review' | 'reject' | 'hold';

export type RecruiterScoreSnapshotRecommendation = 'proceed' | 'review' | 'caution' | 'decline';

export type RecruiterScoreSnapshotRiskLevel = 'low' | 'medium' | 'high';

export type RecruiterScoreSnapshotGeneratedBy =
  | 'interview_submit'
  | 'rescore_script'
  | 'manual_review'
  | 'profile_refresh'
  | 'system';

export type RecruiterScoreSnapshotCategoryScores = {
  reliability?: number | null;
  punctuality?: number | null;
  workEthic?: number | null;
  teamFit?: number | null;
  jobReadiness?: number | null;
  stability?: number | null;
};

export type RecruiterScoreSnapshot = {
  version: RecruiterScoreSnapshotVersion;
  scoreKind: RecruiterScoreSnapshotScoreKind;
  /** Primary 0–100 score recruiters see everywhere */
  score100: number | null;
  grade: string | null;
  confidence: RecruiterScoreSnapshotConfidence | null;

  decision: RecruiterScoreSnapshotDecision | null;
  recommendation: RecruiterScoreSnapshotRecommendation | null;

  riskLevel: RecruiterScoreSnapshotRiskLevel | null;
  riskSummary: string | null;
  reasoningSummary: string | null;

  categoryScores: RecruiterScoreSnapshotCategoryScores;

  interviewScoreBase100: number | null;
  operationalScore100: number | null;
  compositeScore100: number | null;

  sourceInterviewId: string | null;
  sourceModel: string | null;
  updatedAt: unknown;
  generatedBy: RecruiterScoreSnapshotGeneratedBy;

  inputSignature: string | null;
};
