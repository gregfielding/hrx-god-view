/**
 * Optional fields on users/{uid}/interviews/* when interviewKind === 'worker_ai_prescreen'.
 */

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
}
