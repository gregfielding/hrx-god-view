/**
 * Optional fields on users/{uid}/interviews/* when interviewKind === 'worker_ai_prescreen`.
 *
 * Top-level interview document may also include:
 * - `entry` (optional string): prescreen URL `entry` query param at submit time for attribution
 *   (aligned with `buildWorkerAiPrescreenInviteUrl` / worker dashboard links). Omitted when absent or invalid.
 * - `prescreenInterviewMode` (optional): `application` | `profile_first` — set by submit callable for analytics.
 */

import type { PrescreenCategoryEvidenceV1, PrescreenCategoryScoresV1 } from './prescreenCategoryScores';

export type WorkerAiPrescreenInterviewKind = 'worker_ai_prescreen';

export type WorkerAiPrescreenRecommendation = 'proceed' | 'review' | 'caution' | 'decline';

export type PrescreenAssignmentReadinessStatus = 'ready' | 'review' | 'blocked';

export interface WorkerInterviewAssignmentReadiness {
  status: PrescreenAssignmentReadinessStatus;
  reasons: string[];
}

export interface WorkerInterviewAlternatePaths {
  gigEligible?: boolean;
}

export type WorkerInterviewHiringDecision = 'advance' | 'review' | 'hold' | 'reject';

/** Parsed from interview document `ai.hiringDecision` when present. */
export interface WorkerInterviewHiringDecisionBlock {
  decision: WorkerInterviewHiringDecision;
  eligibleForAutoAdvance: boolean;
  reasonCodes: string[];
}

export interface WorkerInterviewAiBlock {
  overallScore: number;
  /** Raw interview score (same as overallScore before overrides; both kept for audit). */
  baseInterviewScore?: number;
  /** Recruiter-trust score after `applyRecruiterOperationalOverrides` — primary display score. */
  overrideAdjustedScore?: number;
  overrideScoreDelta?: number;
  overrideBand?: string;
  overrideRulesVersion?: string;
  overrideInputSignature?: string;
  recruiterTrustLevel?: 'high' | 'medium' | 'low';
  softBlocks?: string[];
  hardBlocks?: string[];
  scoreComputationVersion?: string;
  recommendation: WorkerAiPrescreenRecommendation;
  flags: string[];
  subScores?: {
    experience?: number;
    reliability?: number;
    transportation?: number;
    risk?: number;
    physical?: number;
    /** Legacy shape from older scoring runs */
    fit?: number;
    compliance?: number;
  };
  summary?: string;
  model?: string;
  computedAt?: Date;
  /** Context-aware pre-screen (optional; present when application context was resolved). */
  assignmentReadiness?: WorkerInterviewAssignmentReadiness;
  alternatePaths?: WorkerInterviewAlternatePaths;
  /** Snapshot of `AiInterviewContext` at submit time (JSON-serializable). */
  aiInterviewContext?: Record<string, unknown>;
  /** Rules-based hiring decision (separate from score `recommendation`). */
  hiringDecision?: WorkerInterviewHiringDecisionBlock;
  /** Phase 1: six 0–100 category snapshots (same shape as `applications/.../aiAutomation.categoryScores`). */
  categoryScores?: PrescreenCategoryScoresV1;
  /** Short audit tags per category (optional). */
  categoryEvidence?: PrescreenCategoryEvidenceV1;
  /** Drug/background severity + reasons (rules-based prescreen v2+). */
  riskSummary?: {
    drug: { level: 'low' | 'moderate' | 'high' | 'unknown'; reason: string };
    background: { level: 'low' | 'moderate' | 'high' | 'unknown'; reason: string };
  };
  /** Structured review triage when `recommendation === 'review'` (v3+). */
  reviewTriage?: {
    lane: 'strong_check_one' | 'borderline_maybe_usable';
    subtype: string;
    reasons: string[];
    summaryShort: string;
  };
  reviewLane?: string | null;
  reviewSubtype?: string | null;
  reviewReasons?: string[];
  reviewSummaryShort?: string | null;
}
