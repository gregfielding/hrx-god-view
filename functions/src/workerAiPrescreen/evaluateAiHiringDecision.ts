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
  /**
   * When `true`, the prescreen LLM's `recommendation === 'review'` is lifted to `proceed` so a
   * candidate who otherwise passes every gate (score, flags, dynamic-answers, capacity, no-show)
   * can still advance.
   *
   * **User groups:** resolved policy sets this to `true` whenever `hiringConfig.quality` exists
   * (preset only changes numeric floors); a stale `userGroup.aiHiring` flag cannot turn it off.
   * **Job orders / tenant:** often unset — legacy behavior keeps `review` as a hold until STEP 1b.
   *
   * Has no effect on `recommendation === 'decline'` or any of the policy-engine's other gates.
   * When the override fires and the engine returns `advance`, the trace includes
   * `interview_recommendation_review_overridden` so audits stay attributable.
   */
  advanceOnReviewRecommendation?: boolean;
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
  /** Advance on score/policy, but interview flags still recorded (not “clean pass”). */
  | 'advance_with_caution_flags'
  /** Interview score engine said `review` — hiring decision aligns (no Review+Advance). */
  | 'interview_recommendation_review'
  /**
   * Interview score engine said `review`, but the resolved policy
   * (`advanceOnReviewRecommendation: true`) lifted it to `proceed`. Stamped on
   * `advance` results so audits know the candidate would otherwise have been held.
   */
  | 'interview_recommendation_review_overridden'
  | 'not_in_top_percent'
  | 'recommendation_decline'
  | 'gig_path_eligible'
  | 'below_job_fit_threshold'
  | 'no_show_overlay_review'
  | 'operational_hard_block'
  | 'operational_soft_block';

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
  /**
   * When true, a score-engine `decline` is treated as `review` for automation (no auto-reject).
   * Mirrors `computeOperationalTrustPromoteDeclineToReview` — callers that already lifted recommendation can omit.
   */
  operationalTrust?: { promoteDeclineToReview: boolean };
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

/** Align with recruiter grade bands: proceed/advance expected when score ≥ 80 (B+). */
const DEFAULT_MIN_SCORE = 80;

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

/** Flags that are “positive” only — do not block `passed_all_checks` when present alone. */
const POSITIVE_SIGNAL_FLAGS = new Set(['strong_candidate_signal', 'high_confidence_candidate']);

function shouldUsePassedAllChecks(flags: string[]): boolean {
  if (!flags || flags.length === 0) return true;
  return flags.every((f) => POSITIVE_SIGNAL_FLAGS.has(normFlag(f)));
}

function advanceReasonCodes(flags: string[]): AiHiringReasonCode[] {
  return shouldUsePassedAllChecks(flags) ? ['passed_all_checks'] : ['advance_with_caution_flags'];
}

// --- Helpers ---------------------------------------------------------------

function normFlag(f: string): string {
  return String(f ?? '').trim();
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
  const { interviewResult, hiringPolicy, containerStats, ranking, jobFitGate, includeGigFallback, operationalTrust } =
    params;
  const applyGig = includeGigFallback !== false;
  const { overallScore, flags, recommendation, dynamicAnswers } = interviewResult;

  let effectiveRecommendation = recommendation;
  let reviewOverridden = false;
  if (operationalTrust?.promoteDeclineToReview && recommendation === 'decline') {
    effectiveRecommendation = 'review';
  }
  // Policy-level lift: when `advanceOnReviewRecommendation` is true (user groups always set this
  // from `hiringConfig.quality`; job orders may leave it unset), promote `review` → `proceed` so
  // the candidate is re-graded by the score / flag / dynamic / capacity / no-show gates rather than
  // being held by the LLM's qualitative review verdict alone. `decline` is intentionally NOT lifted here.
  if (
    effectiveRecommendation === 'review' &&
    hiringPolicy.advanceOnReviewRecommendation === true
  ) {
    effectiveRecommendation = 'proceed';
    reviewOverridden = true;
  }

  const minScore =
    typeof hiringPolicy.minimumScoreToAdvance === 'number' && Number.isFinite(hiringPolicy.minimumScoreToAdvance)
      ? hiringPolicy.minimumScoreToAdvance
      : DEFAULT_MIN_SCORE;

  // STEP 1 — Recommendation-driven reject (numeric score already reflects compliance/risk penalties).
  if (effectiveRecommendation === 'decline') {
    return finalize(
      'reject',
      hiringPolicy,
      ['recommendation_decline'],
      interviewResult,
      applyGig,
    );
  }

  // STEP 1b — Interview recommendation `review` must align with hiring decision (no Review + Advance).
  if (effectiveRecommendation === 'review') {
    return finalize(
      'review',
      hiringPolicy,
      ['interview_recommendation_review'],
      interviewResult,
      applyGig,
    );
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

  // STEP 4 — Moderate risk flags (only when score is not already in the “confident proceed” band)
  if (hasModerateFlag(flags) && overallScore < 80) {
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

  // STEP 8 — Default advance (`finalize` applies gig-path annotation when applicable).
  // Never emit `passed_all_checks` when caution flags remain (only positive signals allowed).
  const advanceCodes = advanceReasonCodes(flags);
  if (reviewOverridden && !advanceCodes.includes('interview_recommendation_review_overridden')) {
    advanceCodes.push('interview_recommendation_review_overridden');
  }
  return finalize(
    'advance',
    hiringPolicy,
    advanceCodes,
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
  hasModerateFlag,
  hasCriticalDynamicFailure,
  isInTopPercentBucket,
  DEFAULT_MIN_SCORE,
  CRITICAL_DYNAMIC_KEYS,
};
