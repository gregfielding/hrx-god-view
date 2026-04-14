/**
 * Ordered pipeline: hiring policy engine (job fit + interview rules, gig off) → no-show overlay → gig fallback → auto-advance flag.
 */

import {
  evaluateAiHiringDecision,
  applyGigFallbackAnnotation,
  type AiHiringDecisionResult,
  type AiHiringReasonCode,
  type ApplicationContextInput,
  type ContainerStatsInput,
  type InterviewResultInput,
  type JobFitGateInput,
  type RankingContextInput,
} from './evaluateAiHiringDecision';
import { toAiHiringPolicyDecisionInput, type ResolvedAiHiringPolicy } from './aiHiringPolicyResolution';
import type { OrchestratorV1Step, OrchestratorV1Stored } from './orchestratorV1Types';
import { ORCHESTRATOR_V1_VERSION } from './orchestratorV1Types';

export type RunAiHiringOrchestratorV1Params = {
  interviewResult: InterviewResultInput;
  resolvedPolicy: ResolvedAiHiringPolicy;
  application: ApplicationContextInput;
  containerStats?: ContainerStatsInput;
  /** Pool rank for `topPercentToAdvance` (optional). */
  ranking?: RankingContextInput;
  jobFitScore: number | null;
  applicationNoShowBand?: string | null;
  assignmentNoShowBand?: string | null;
  assignmentIdUsed?: string | null;
};

function applyNoShowOverlay(
  r: AiHiringDecisionResult,
  applicationBand?: string | null,
  assignmentBand?: string | null,
): AiHiringDecisionResult {
  if (r.decision !== 'advance') return r;
  const bad = (b?: string | null) => b === 'high' || b === 'critical';
  if (bad(applicationBand) || bad(assignmentBand)) {
    const reasonCodes: AiHiringReasonCode[] = r.reasonCodes.includes('no_show_overlay_review')
      ? r.reasonCodes
      : [...r.reasonCodes, 'no_show_overlay_review'];
    return {
      ...r,
      decision: 'review',
      eligibleForAutoAdvance: false,
      reasonCodes,
    };
  }
  return r;
}

/**
 * Full orchestrator trace for `aiAutomation.orchestratorV1` (legacy `aiAutomation.decision` etc. stay separate).
 */
export function runAiHiringOrchestratorV1(
  params: RunAiHiringOrchestratorV1Params,
): Omit<OrchestratorV1Stored, 'evaluatedAt'> {
  const policyInput = toAiHiringPolicyDecisionInput(params.resolvedPolicy);
  const jobFitNotes: string[] = [];
  let jobFitGate: JobFitGateInput | undefined;

  if (params.resolvedPolicy.minimumJobScoreGateEnabled === true) {
    if (params.jobFitScore == null || !Number.isFinite(params.jobFitScore)) {
      jobFitNotes.push('job_fit_gate_skipped_missing_fit_v1');
    } else {
      jobFitGate = {
        gateEnabled: true,
        jobFitScore: params.jobFitScore,
        minimumJobScoreToAdvance: params.resolvedPolicy.minimumJobScoreToAdvance,
        onFail: params.resolvedPolicy.jobFitFailAction ?? 'review',
      };
    }
  }

  const policyEngineResult = evaluateAiHiringDecision({
    interviewResult: params.interviewResult,
    hiringPolicy: policyInput,
    application: params.application,
    containerStats: params.containerStats,
    ranking: params.ranking,
    jobFitGate,
    includeGigFallback: false,
  });

  const afterNoShow = applyNoShowOverlay(
    policyEngineResult,
    params.applicationNoShowBand,
    params.assignmentNoShowBand,
  );

  const afterGig = applyGigFallbackAnnotation(afterNoShow, policyInput, params.interviewResult);

  const finalEligibleForAutoAdvance =
    afterGig.decision === 'advance' && params.resolvedPolicy.autoAdvanceEnabled === true;

  const finalResult: AiHiringDecisionResult = {
    ...afterGig,
    eligibleForAutoAdvance: finalEligibleForAutoAdvance,
  };

  const steps: OrchestratorV1Step[] = [
    {
      phase: 'hiring_policy_engine',
      decisionIn: 'advance',
      decisionOut: policyEngineResult.decision,
      eligibleForAutoAdvance: policyEngineResult.eligibleForAutoAdvance,
      reasonCodes: [...policyEngineResult.reasonCodes],
      notes: [
        jobFitNotes.length ? `job_fit: ${jobFitNotes.join(';')}` : null,
        'engine_ran_without_gig_before_overlay',
      ]
        .filter(Boolean)
        .join(' | '),
    },
    {
      phase: 'no_show_overlay',
      decisionIn: policyEngineResult.decision,
      decisionOut: afterNoShow.decision,
      eligibleForAutoAdvance: afterNoShow.eligibleForAutoAdvance,
      reasonCodes: [...afterNoShow.reasonCodes],
    },
    {
      phase: 'gig_fallback',
      decisionIn: afterNoShow.decision,
      decisionOut: afterGig.decision,
      eligibleForAutoAdvance: afterGig.eligibleForAutoAdvance,
      reasonCodes: [...afterGig.reasonCodes],
    },
    {
      phase: 'auto_advance',
      decisionIn: afterGig.decision,
      decisionOut: finalResult.decision,
      eligibleForAutoAdvance: finalEligibleForAutoAdvance,
      reasonCodes: [...finalResult.reasonCodes],
      notes: 'eligibleForAutoAdvance = (finalDecision === advance && autoAdvanceEnabled)',
    },
  ];

  return {
    version: ORCHESTRATOR_V1_VERSION,
    sourceInterviewId: '',
    context: {
      applicationId: params.application.applicationId,
      jobPostingId: params.application.jobId ?? null,
      jobOrderId: params.application.jobOrderId ?? null,
      groupId: params.application.groupId ?? null,
      assignmentIdUsed: params.assignmentIdUsed ?? null,
    },
    policy: {
      resolvedAiHiring: params.resolvedPolicy,
      jobFitGate: jobFitGate
        ? {
            gateEnabled: true,
            jobFitScore: jobFitGate.jobFitScore,
            minimumJobScoreToAdvance: jobFitGate.minimumJobScoreToAdvance,
            onFail: jobFitGate.onFail,
          }
        : null,
      jobFitNotes: jobFitNotes.length ? jobFitNotes : null,
    },
    inputs: {
      interviewOverallScore: params.interviewResult.overallScore,
      jobFitScore: params.jobFitScore,
      containerStats: params.containerStats ?? null,
      applicationNoShowBand: params.applicationNoShowBand ?? null,
      assignmentNoShowBand: params.assignmentNoShowBand ?? null,
      assignmentScoped: (params.assignmentIdUsed ?? '').length > 0,
    },
    steps,
    policyEngineResult,
    afterNoShowOverlay: afterNoShow,
    finalResult,
    finalEligibleForAutoAdvance,
  };
}
