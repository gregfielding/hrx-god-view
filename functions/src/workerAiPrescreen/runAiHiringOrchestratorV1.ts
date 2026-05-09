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
  type EvaluateAiHiringDecisionParams,
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
  /**
   * Numeric application no-show risk (0–100). When provided, the no-show overlay compares this to
   * `resolvedPolicy.maximumNoShowRiskToAdvance` instead of relying on the band string. Falls back to
   * a band-derived approximation (low=0, moderate=25, high=50, critical=75) when not provided.
   */
  applicationNoShowScore?: number | null;
  /** Numeric assignment-level no-show risk (0–100); same semantics as `applicationNoShowScore`. */
  assignmentNoShowScore?: number | null;
  assignmentIdUsed?: string | null;
  /** Optional — same as {@link EvaluateAiHiringDecisionParams.operationalTrust}. */
  operationalTrust?: EvaluateAiHiringDecisionParams['operationalTrust'];
  /**
   * When provided, replaces `interviewResult.overallScore` for **score-threshold and gig-fallback** comparisons
   * inside `evaluateAiHiringDecision`. Used by **group-scoped** containers to gate on the candidate's
   * Master Recruiter Score (50% category + 35% interview + 15% profile) instead of the raw prescreen overall.
   *
   * Recommendation (proceed/review/decline) and dynamic-answer logic still operate on the original
   * `interviewResult` — only the numeric score input changes.
   */
  gateScoreOverride?: number | null;
  /** Provenance label for the orchestratorV1 trace. */
  gateScoreSource?: 'master_recruiter' | 'prescreen_overall';
};

/**
 * Lower bound numeric approximation when only a band string is available — used so the policy
 * threshold (`maximumNoShowRiskToAdvance`) still has predictable semantics in legacy code paths
 * that haven't been wired to pass `applicationNoShowScore` yet.
 */
function approxScoreFromBand(b?: string | null): number | null {
  if (b === 'low') return 0;
  if (b === 'moderate') return 25;
  if (b === 'high') return 50;
  if (b === 'critical') return 75;
  return null;
}

/**
 * Step 2 of the orchestrator pipeline: clamp a hiring `advance` to `review` when no-show risk is too
 * high. Threshold is `resolvedPolicy.maximumNoShowRiskToAdvance` (0–100, exclusive — strictly greater
 * blocks). When the policy does not supply a threshold (legacy callers, tenant default not set),
 * falls back to the original band-based behavior of blocking on `high` or `critical`.
 */
function applyNoShowOverlay(
  r: AiHiringDecisionResult,
  applicationBand?: string | null,
  assignmentBand?: string | null,
  applicationScore?: number | null,
  assignmentScore?: number | null,
  maximumNoShowRiskToAdvance?: number,
): AiHiringDecisionResult {
  if (r.decision !== 'advance') return r;

  const thresholdSet =
    typeof maximumNoShowRiskToAdvance === 'number' && Number.isFinite(maximumNoShowRiskToAdvance);

  let block = false;
  if (thresholdSet) {
    const t = maximumNoShowRiskToAdvance as number;
    const appScore =
      typeof applicationScore === 'number' && Number.isFinite(applicationScore)
        ? applicationScore
        : approxScoreFromBand(applicationBand);
    const asgScore =
      typeof assignmentScore === 'number' && Number.isFinite(assignmentScore)
        ? assignmentScore
        : approxScoreFromBand(assignmentBand);
    if ((appScore != null && appScore > t) || (asgScore != null && asgScore > t)) block = true;
  } else {
    const bad = (b?: string | null) => b === 'high' || b === 'critical';
    if (bad(applicationBand) || bad(assignmentBand)) block = true;
  }

  if (!block) return r;
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

  const useGateOverride =
    typeof params.gateScoreOverride === 'number' && Number.isFinite(params.gateScoreOverride);
  const effectiveInterviewResult: InterviewResultInput = useGateOverride
    ? { ...params.interviewResult, overallScore: params.gateScoreOverride as number }
    : params.interviewResult;
  const gateScoreSource: 'master_recruiter' | 'prescreen_overall' = useGateOverride
    ? params.gateScoreSource ?? 'master_recruiter'
    : 'prescreen_overall';

  const policyEngineResult = evaluateAiHiringDecision({
    interviewResult: effectiveInterviewResult,
    hiringPolicy: policyInput,
    application: params.application,
    containerStats: params.containerStats,
    ranking: params.ranking,
    jobFitGate,
    includeGigFallback: false,
    operationalTrust: params.operationalTrust,
  });

  const afterNoShow = applyNoShowOverlay(
    policyEngineResult,
    params.applicationNoShowBand,
    params.assignmentNoShowBand,
    params.applicationNoShowScore,
    params.assignmentNoShowScore,
    params.resolvedPolicy.maximumNoShowRiskToAdvance,
  );

  const afterGig = applyGigFallbackAnnotation(afterNoShow, policyInput, effectiveInterviewResult);

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
      applicationNoShowScore:
        typeof params.applicationNoShowScore === 'number' && Number.isFinite(params.applicationNoShowScore)
          ? params.applicationNoShowScore
          : null,
      assignmentNoShowScore:
        typeof params.assignmentNoShowScore === 'number' && Number.isFinite(params.assignmentNoShowScore)
          ? params.assignmentNoShowScore
          : null,
      maximumNoShowRiskToAdvance:
        typeof params.resolvedPolicy.maximumNoShowRiskToAdvance === 'number' &&
        Number.isFinite(params.resolvedPolicy.maximumNoShowRiskToAdvance)
          ? params.resolvedPolicy.maximumNoShowRiskToAdvance
          : null,
      assignmentScoped: (params.assignmentIdUsed ?? '').length > 0,
      gateScoreSource,
      gateScoreUsed: useGateOverride ? (params.gateScoreOverride as number) : params.interviewResult.overallScore,
      masterRecruiterScore: useGateOverride ? (params.gateScoreOverride as number) : null,
    },
    steps,
    policyEngineResult,
    afterNoShowOverlay: afterNoShow,
    finalResult,
    finalEligibleForAutoAdvance,
  };
}
