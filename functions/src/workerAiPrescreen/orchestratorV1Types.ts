/**
 * aiAutomation.orchestratorV1 — full hiring orchestration trace (legacy aiAutomation.* stays unchanged).
 *
 * Definitions (v1) — canonical for container stats + job-fit missing behavior:
 *
 * currentReadyCount — Count of tenant applications in the same hiring container whose canonical
 * application status (`normalizeApplicationStatus`) is `accepted` (offer accepted / cleared to hire).
 *
 * currentOnboardingCount — Count of tenant applications in the same hiring container whose canonical
 * status is `interview` or `offer_pending` (mid-funnel, pre-acceptance; used for maximumAutoAdvances).
 *
 * totalApplicants — Count of tenant applications in the same hiring container whose canonical status
 * is not `withdrawn` (still in play or terminal other than withdrawn).
 *
 * totalInterviewed — Count of tenant applications in the same hiring container where canonical status
 * is `interview`, `offer_pending`, or `accepted`, OR when `workerAiPrescreenRequired` is true
 * `workerAiPrescreenInterviewCompletedAt` is set, OR when `workerAiPrescreenRequired` is false status is
 * `submitted` (see `loadHiringContainerStats` / `hiringContainerStats.ts`).
 *
 * Job-fit missing (v1) — When `minimumJobScoreGateEnabled` is true but `scores.fitScore` is absent or
 * non-finite, the job-fit gate is skipped (treated as pass). Recorded in `jobFitNotes` on orchestratorV1.
 */

import type { ResolvedAiHiringPolicy } from './aiHiringPolicyResolution';
import type { AiHiringDecisionResult, ContainerStatsInput, HiringDecision } from './evaluateAiHiringDecision';

export const ORCHESTRATOR_V1_VERSION = 1 as const;

export type OrchestratorV1Phase =
  | 'hard_reject'
  | 'job_fit_gate'
  | 'hiring_policy_engine'
  | 'no_show_overlay'
  | 'auto_advance'
  | 'gig_fallback';

export type OrchestratorV1Step = {
  phase: OrchestratorV1Phase;
  decisionIn: HiringDecision;
  decisionOut: HiringDecision;
  eligibleForAutoAdvance: boolean;
  reasonCodes: string[];
  notes?: string;
};

export type OrchestratorV1Stored = {
  version: typeof ORCHESTRATOR_V1_VERSION;
  evaluatedAt: unknown;
  sourceInterviewId: string;
  context: {
    applicationId: string;
    jobPostingId?: string;
    jobOrderId?: string | null;
    groupId?: string;
    assignmentIdUsed?: string | null;
  };
  policy: {
    resolvedAiHiring: ResolvedAiHiringPolicy;
    jobFitGate?: {
      gateEnabled: true;
      jobFitScore?: number | null;
      minimumJobScoreToAdvance?: number;
      onFail: 'review' | 'hold';
    } | null;
    jobFitNotes?: string[];
  };
  inputs: {
    interviewOverallScore: number;
    jobFitScore?: number | null;
    containerStats?: ContainerStatsInput;
    applicationNoShowBand?: string;
    assignmentNoShowBand?: string | null;
    assignmentScoped?: boolean;
    /**
     * Which signal the engine actually used for score thresholds.
     * `master_recruiter` for group-scoped applications when a Master Recruiter Score was available;
     * `prescreen_overall` for job-order containers and group fallbacks (master not computable).
     */
    gateScoreSource?: 'master_recruiter' | 'prescreen_overall';
    /** The numeric value passed into the score-threshold step (master or prescreen, see `gateScoreSource`). */
    gateScoreUsed?: number;
    /** Master Recruiter Score (0–100) when computed; null otherwise. Useful for audit. */
    masterRecruiterScore?: number | null;
  };
  steps: OrchestratorV1Step[];
  policyEngineResult: AiHiringDecisionResult;
  afterNoShowOverlay: AiHiringDecisionResult;
  finalResult: AiHiringDecisionResult;
  finalEligibleForAutoAdvance: boolean;
};
