/**
 * AI Hiring Decision Engine — pure evaluation only (no automation, no Firestore).
 * @see product spec AI_HIRING_DECISION_ENGINE
 */

import { logger } from 'firebase-functions/v2';

// --- Types -----------------------------------------------------------------

export type AiInterviewRecommendation = 'proceed' | 'review' | 'decline';

export type DynamicAnswerValue = 'yes' | 'no' | 'not_sure';

export type InterviewResultInput = {
  overallScore: number;
  /** 0–10 derived; informational only for callers */
  score10?: number;
  flags: string[];
  recommendation: AiInterviewRecommendation;
  dynamicAnswers?: Record<string, DynamicAnswerValue>;
};

/** Resolved hiring policy slice (job order / group / tenant); safe defaults when fields missing */
export type AiHiringPolicyDecisionInput = {
  autoAdvanceEnabled?: boolean;
  minimumScoreToAdvance?: number;
  maximumAutoAdvances?: number;
  targetReadyCount?: number;
  targetOnboardingCount?: number;
  stopWhenTargetReached?: boolean;
  allowGigFallback?: boolean;
  topPercentToAdvance?: number;
};

export type ApplicationContextInput = {
  applicationId: string;
  jobId?: string;
  jobOrderId?: string;
  groupId?: string;
};

export type ContainerStatsInput = {
  currentReadyCount?: number;
  currentOnboardingCount?: number;
  totalApplicants?: number;
  totalInterviewed?: number;
};

/**
 * When `topPercentToAdvance` is set, pass pool ranking so the top-% rule can apply.
 * Rank 1 = best score. Omit to skip STEP 6 (backward compatible).
 */
export type RankingContextInput = {
  rank: number;
  total: number;
};

export type HiringDecision = 'advance' | 'review' | 'hold' | 'reject';

export type AiHiringReasonCode =
  | 'critical_flag_drug'
  | 'critical_flag_background'
  | 'critical_flag_physical'
  | 'moderate_flags_present'
  | 'below_score_threshold'
  | 'failed_job_requirement'
  | 'capacity_reached'
  | 'onboarding_throttled'
  | 'passed_all_checks'
  | 'not_in_top_percent'
  | 'recommendation_decline'
  | 'gig_path_eligible'
  | 'below_job_fit_threshold'
  | 'no_show_overlay_review';

export type AiHiringDecisionResult = {
  decision: HiringDecision;
  eligibleForAutoAdvance: boolean;
  reasonCodes: AiHiringReasonCode[];
};

/** When set, runs after hard rejects and before interview score threshold. Missing fit skips the gate (v1). */
export type JobFitGateInput = {
  gateEnabled: true;
  jobFitScore?: number | null;
  minimumJobScoreToAdvance?: number;
  onFail: 'review' | 'hold';
};

export type EvaluateAiHiringDecisionParams = {
  interviewResult: InterviewResultInput;
  hiringPolicy: AiHiringPolicyDecisionInput;
  application: ApplicationContextInput;
  containerStats?: ContainerStatsInput;
  ranking?: RankingContextInput;
  jobFitGate?: JobFitGateInput;
  /** Default true. Set false when orchestrator applies no-show overlay before gig fallback. */
  includeGigFallback?: boolean;
};

export type WorkerAiHiringDecisionLogPayload = {
  userId: string;
  applicationId: string;
  decision: HiringDecision;
  score: number;
  flags: string[];
  reasonCodes: AiHiringReasonCode[];
  policySnapshot: AiHiringPolicyDecisionInput;
};

// --- Constants -------------------------------------------------------------

const DEFAULT_MIN_SCORE = 75;

const HARD_REJECT_FLAGS: Record<string, AiHiringReasonCode> = {
  drug_risk: 'critical_flag_drug',
  background_risk: 'critical_flag_background',
  physical_mismatch: 'critical_flag_physical',
};

const MODERATE_FLAGS = new Set([
  'attendance_risk',
  'transportation_risk',
  'no_backup_transport',
  'limited_relevant_experience',
  'drug_unknown',
  'background_unknown',
]);

/** Job-specific “critical” dynamics — any explicit `'no'` ⇒ hold */
const CRITICAL_DYNAMIC_KEYS = ['dyn_shift_punctuality', 'dyn_worksite_commute', 'dyn_physical_job_fit'] as const;

const GIG_DYNAMIC_KEY = 'dyn_gig_path_willing';

// --- Helpers ---------------------------------------------------------------

function normFlag(f: string): string {
  return String(f ?? '').trim();
}

function collectHardRejectReasonCodes(flags: string[]): AiHiringReasonCode[] {
  const out: AiHiringReasonCode[] = [];
  for (const f of flags) {
    const key = normFlag(f);
    const code = HARD_REJECT_FLAGS[key];
    if (code) out.push(code);
  }
  return out;
}

function hasModerateFlag(flags: string[]): boolean {
  for (const f of flags) {
    if (MODERATE_FLAGS.has(normFlag(f))) return true;
  }
  return false;
}

function hasCriticalDynamicFailure(dynamicAnswers?: Record<string, DynamicAnswerValue>): boolean {
  if (!dynamicAnswers) return false;
  for (const key of CRITICAL_DYNAMIC_KEYS) {
    if (dynamicAnswers[key] === 'no') return true;
  }
  return false;
}

function isInTopPercentBucket(rank: number, total: number, topPercent: number): boolean {
  if (!Number.isFinite(rank) || !Number.isFinite(total) || total <= 0) return true;
  if (topPercent <= 0 || topPercent > 100) return true;
  const cutoff = Math.max(1, Math.ceil(total * (topPercent / 100)));
  return rank <= cutoff;
}

// --- Pure API --------------------------------------------------------------

/**
 * Deterministic decision: same input ⇒ same output. No I/O.
 * Does not trigger onboarding or mutate application state.
 */
export function evaluateAiHiringDecision(params: EvaluateAiHiringDecisionParams): AiHiringDecisionResult {
  const { interviewResult, hiringPolicy, containerStats, ranking, jobFitGate, includeGigFallback } = params;
  const applyGig = includeGigFallback !== false;
  const { overallScore, flags, recommendation, dynamicAnswers } = interviewResult;

  const minScore =
    typeof hiringPolicy.minimumScoreToAdvance === 'number' && Number.isFinite(hiringPolicy.minimumScoreToAdvance)
      ? hiringPolicy.minimumScoreToAdvance
      : DEFAULT_MIN_SCORE;

  // STEP 1 — Hard reject
  if (recommendation === 'decline') {
    return finalize(
      'reject',
      hiringPolicy,
      ['recommendation_decline'],
      interviewResult,
      applyGig,
    );
  }

  const hardCodes = collectHardRejectReasonCodes(flags);
  if (hardCodes.length > 0) {
    return finalize('reject', hiringPolicy, hardCodes, interviewResult, applyGig);
  }

  // STEP 2 — Job fit gate (optional; v1 skips when fit score missing)
  if (jobFitGate?.gateEnabled === true) {
    const minFit = jobFitGate.minimumJobScoreToAdvance;
    const fit = jobFitGate.jobFitScore;
    if (
      typeof minFit === 'number' &&
      Number.isFinite(minFit) &&
      typeof fit === 'number' &&
      Number.isFinite(fit)
    ) {
      if (fit < minFit) {
        return finalize(jobFitGate.onFail, hiringPolicy, ['below_job_fit_threshold'], interviewResult, applyGig);
      }
    }
  }

  // STEP 3 — Score threshold
  if (overallScore < minScore) {
    return finalize(
      'review',
      hiringPolicy,
      ['below_score_threshold'],
      interviewResult,
      applyGig,
    );
  }

  // STEP 4 — Moderate risk flags
  if (hasModerateFlag(flags)) {
    return finalize(
      'review',
      hiringPolicy,
      ['moderate_flags_present'],
      interviewResult,
      applyGig,
    );
  }

  // STEP 5 — Critical dynamic answers
  if (hasCriticalDynamicFailure(dynamicAnswers)) {
    return finalize(
      'hold',
      hiringPolicy,
      ['failed_job_requirement'],
      interviewResult,
      applyGig,
    );
  }

  // STEP 6 — Capacity / throttling
  const stats = containerStats ?? {};
  if (
    hiringPolicy.stopWhenTargetReached === true &&
    typeof hiringPolicy.targetReadyCount === 'number' &&
    Number.isFinite(hiringPolicy.targetReadyCount) &&
    typeof stats.currentReadyCount === 'number' &&
    Number.isFinite(stats.currentReadyCount) &&
    stats.currentReadyCount >= hiringPolicy.targetReadyCount
  ) {
    return finalize(
      'hold',
      hiringPolicy,
      ['capacity_reached'],
      interviewResult,
      applyGig,
    );
  }

  if (
    typeof hiringPolicy.maximumAutoAdvances === 'number' &&
    Number.isFinite(hiringPolicy.maximumAutoAdvances) &&
    typeof stats.currentOnboardingCount === 'number' &&
    Number.isFinite(stats.currentOnboardingCount) &&
    stats.currentOnboardingCount >= hiringPolicy.maximumAutoAdvances
  ) {
    return finalize(
      'hold',
      hiringPolicy,
      ['onboarding_throttled'],
      interviewResult,
      applyGig,
    );
  }

  // STEP 7 — Top percent (optional; skipped if ranking omitted)
  const topPct = hiringPolicy.topPercentToAdvance;
  if (
    typeof topPct === 'number' &&
    Number.isFinite(topPct) &&
    ranking &&
    Number.isFinite(ranking.rank) &&
    Number.isFinite(ranking.total) &&
    !isInTopPercentBucket(ranking.rank, ranking.total, topPct)
  ) {
    return finalize(
      'review',
      hiringPolicy,
      ['not_in_top_percent'],
      interviewResult,
      applyGig,
    );
  }

  // STEP 8 — Default advance (`finalize` applies gig-path annotation when applicable)
  return finalize(
    'advance',
    hiringPolicy,
    ['passed_all_checks'],
    interviewResult,
    applyGig,
  );
}

function finalize(
  decision: HiringDecision,
  hiringPolicy: AiHiringPolicyDecisionInput,
  reasonCodes: AiHiringReasonCode[],
  interviewResult: InterviewResultInput,
  applyGig: boolean,
): AiHiringDecisionResult {
  const eligibleForAutoAdvance =
    decision === 'advance' && hiringPolicy.autoAdvanceEnabled === true;

  const base: AiHiringDecisionResult = {
    decision,
    eligibleForAutoAdvance,
    reasonCodes: [...reasonCodes],
  };

  if (!applyGig) return base;
  return applyGigFallbackAnnotation(base, hiringPolicy, interviewResult);
}

export function applyGigFallbackAnnotation(
  result: AiHiringDecisionResult,
  hiringPolicy: AiHiringPolicyDecisionInput,
  interviewResult: InterviewResultInput,
): AiHiringDecisionResult {
  const { overallScore, dynamicAnswers } = interviewResult;
  const allow = hiringPolicy.allowGigFallback === true;
  const willing = dynamicAnswers?.[GIG_DYNAMIC_KEY] === 'yes';
  const scoreOk = overallScore >= 70;
  const decisionOk = result.decision === 'hold' || result.decision === 'review';

  if (allow && willing && scoreOk && decisionOk) {
    if (!result.reasonCodes.includes('gig_path_eligible')) {
      return {
        ...result,
        reasonCodes: [...result.reasonCodes, 'gig_path_eligible'],
      };
    }
  }
  return result;
}

/**
 * Structured log for observability. Call from HTTPS/callable handlers after `evaluateAiHiringDecision`.
 * Not invoked by `evaluateAiHiringDecision` (keeps evaluation pure).
 */
export function logWorkerAiHiringDecision(payload: WorkerAiHiringDecisionLogPayload): void {
  logger.info('worker_ai_hiring.decision', {
    userId: payload.userId,
    applicationId: payload.applicationId,
    decision: payload.decision,
    score: payload.score,
    flags: payload.flags,
    reasonCodes: payload.reasonCodes,
    policySnapshot: payload.policySnapshot,
  });
}

/** @internal — exported for tests */
export const __testing = {
  collectHardRejectReasonCodes,
  hasModerateFlag,
  hasCriticalDynamicFailure,
  isInTopPercentBucket,
  DEFAULT_MIN_SCORE,
  CRITICAL_DYNAMIC_KEYS,
};
