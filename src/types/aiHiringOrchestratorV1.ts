/**
 * Mirror of `functions/src/workerAiPrescreen/orchestratorV1Types.ts` for UI —
 * `applications/{id}.aiAutomation.orchestratorV1`.
 */

export type OrchestratorV1Phase =
  | 'hard_reject'
  | 'job_fit_gate'
  | 'hiring_policy_engine'
  | 'no_show_overlay'
  | 'auto_advance'
  | 'gig_fallback';

export type OrchestratorV1Step = {
  phase: OrchestratorV1Phase;
  decisionIn: string;
  decisionOut: string;
  eligibleForAutoAdvance: boolean;
  reasonCodes: string[];
  notes?: string;
};
