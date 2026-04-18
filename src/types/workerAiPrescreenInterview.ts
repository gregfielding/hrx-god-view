/**
 * Optional fields on users/{uid}/interviews/* when interviewKind === 'worker_ai_prescreen`.
 *
 * Top-level interview document may also include:
 * - `entry` (optional string): prescreen URL `entry` query param at submit time for attribution
 *   (aligned with `buildWorkerAiPrescreenInviteUrl` / worker dashboard links). Omitted when absent or invalid.
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
}
