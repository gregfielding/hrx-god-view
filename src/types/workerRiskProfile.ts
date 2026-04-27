/**
 * Persistent worker risk layer on `users/{uid}.riskProfile`.
 * Higher `overallRiskScore` = more operational / compliance concern (not auto-reject).
 *
 * Extension (future, not implemented):
 * - Recruiter-authored notes / overrides on items (`recruiterNote`, `dismissedAt`, `confirmedAt`)
 * - Manual risk rows with audit trail
 * See `stubRecruiterRiskExtensions` in `src/utils/workerRiskProfileDisplay.ts`.
 */

export type WorkerRiskItemType =
  | 'attendance'
  | 'transportation'
  | 'drug'
  | 'background'
  | 'communication'
  | 'experience'
  | 'stability'
  | 'compliance'
  | 'documentation'
  | 'job_fit';

export type WorkerRiskSeverity = 'low' | 'moderate' | 'high' | 'unknown';

export type WorkerRiskItemSource =
  | 'interview'
  | 'onboarding'
  | 'system_review'
  | 'behavioral'
  | 'recruiter_note';

export type WorkerRiskItemStatus = 'active' | 'resolved' | 'pending';

export type WorkerRiskItemV1 = {
  type: WorkerRiskItemType;
  severity: WorkerRiskSeverity;
  /** 0–1 model confidence in this item */
  confidence: number;
  /** Short recruiter-facing summary (table + tooltip) */
  summary: string;
  source: WorkerRiskItemSource;
  sourceRef?: string | null;
  status?: WorkerRiskItemStatus;
};

/** Input observation times snapshot at last compute (Firestore Timestamps in data). */
export type WorkerRiskProfileStalenessV1 = {
  lastInterviewAt?: unknown;
  lastCategoryScoresAt?: unknown;
  lastComplianceSnapshotAt?: unknown;
  lastInputAt?: unknown;
};

/** Stored on Firestore; timestamps are Firestore Timestamp in data. */
export type WorkerRiskProfileV1 = {
  /**
   * 0–100 composite index: higher = more operational/compliance concern.
   * Not a hiring decision; use for triage and tooltips.
   */
  overallRiskScore: number;
  topRisks: WorkerRiskItemV1[];
  lastGeneratedBy: 'interview_submit' | 'score_review' | 'system';
  version: number;
  /** Stable hash of meaningful payload; skip writes when unchanged */
  generationSignature: string;
  /** Set server-side when profile is written */
  lastUpdatedAt?: unknown;
  /** Signals observed when this profile was computed (staleness / maintenance) */
  staleness?: WorkerRiskProfileStalenessV1;
};
