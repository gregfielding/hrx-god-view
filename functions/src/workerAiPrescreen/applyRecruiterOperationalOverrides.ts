/**
 * Canonical recruiter operational override engine — deterministic, no I/O.
 * Adjusted score is the operational truth for display + policy thresholds; base score is never mutated.
 */
import type { PrescreenAssignmentReadiness } from './aiInterviewContextTypes';
import type { AiHiringDecisionResult } from './evaluateAiHiringDecision';
import type { PrescreenCategoryScoresV1 } from './prescreenCategoryScores';
import type { PrescreenReviewKindLegacy } from './prescreenReviewTriage';
import { derivePrescreenRecommendationFromScore, type WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import { computeOperationalTrustPromoteDeclineToReview } from './operationalTrustOverride';
import {
  clampOverridePointDelta,
  computeOverrideInputSignature,
  evaluateOperationalOverrideRules,
  type OperationalRuleEvalContext,
} from './operationalOverrideRules';
import {
  OPERATIONAL_OVERRIDE_RULES_VERSION,
  type OperationalOverrideBand,
  type OperationalOverrideResult,
} from './operationalOverrideTypes';

export type ApplyRecruiterOperationalOverridesInput = {
  baseInterviewScore: number;
  flags: string[];
  subScores: {
    experience: number;
    reliability: number;
    transportation: number;
    risk: number;
    physical: number;
  };
  answers: WorkerAiPrescreenAnswers;
  dynamicAnswers: Record<string, string>;
  categoryScores: PrescreenCategoryScoresV1 | null;
  assignmentReadiness: PrescreenAssignmentReadiness;
  userDoc: Record<string, unknown>;
  scoreSummary?: Record<string, unknown> | null;
  certificationsCount: number;
  /** False when certifications were not read (skip cert soft blocks). */
  certificationsLoaded: boolean;
};

function bandFromScore(score: number): OperationalOverrideBand {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 70) return 'C';
  if (s >= 60) return 'D';
  return 'F';
}

function trustLevel(adjusted: number, hardBlocks: string[]): 'high' | 'medium' | 'low' {
  if (hardBlocks.length > 0) return 'low';
  if (adjusted >= 85) return 'high';
  if (adjusted >= 65) return 'medium';
  return 'low';
}

function hiringHint(softBlocks: string[], hardBlocks: string[]): 'advance' | 'review' | 'reject' | 'hold' {
  if (hardBlocks.length > 0) return 'reject';
  if (softBlocks.length > 0) return 'review';
  return 'advance';
}

/**
 * Single entry: base interview score + context → adjusted score, gates, and interview recommendation on adjusted band.
 */
export function applyRecruiterOperationalOverrides(
  input: ApplyRecruiterOperationalOverridesInput,
): OperationalOverrideResult {
  const workAuthorized = input.userDoc.workEligibility !== false;

  const ctx: OperationalRuleEvalContext = {
    baseInterviewScore: input.baseInterviewScore,
    flags: input.flags,
    answers: input.answers,
    dynamicAnswers: input.dynamicAnswers,
    categoryScores: input.categoryScores,
    assignmentReadiness: input.assignmentReadiness,
    workAuthorized,
    certificationsLoaded: input.certificationsLoaded,
    certificationsCount: input.certificationsCount,
  };

  const evaluated = evaluateOperationalOverrideRules(ctx);
  const delta = clampOverridePointDelta(evaluated.rawPointDelta);
  const adjustedScore = Math.max(0, Math.min(100, Math.round(input.baseInterviewScore + delta)));

  let { recommendation: recommendedRecommendation, reviewKind } = derivePrescreenRecommendationFromScore(
    adjustedScore,
    input.flags,
  );

  let prescreenReviewKind: PrescreenReviewKindLegacy | undefined = reviewKind;

  if (
    computeOperationalTrustPromoteDeclineToReview({
      recommendation: recommendedRecommendation,
      overallScore: adjustedScore,
      flags: input.flags,
      subScores: input.subScores,
    })
  ) {
    recommendedRecommendation = 'review';
    prescreenReviewKind = 'review_quality';
  }

  const softBlocks = [...new Set(evaluated.softBlocks)].sort();
  const hardBlocks = [...new Set(evaluated.hardBlocks)].sort();

  const recommendedHiringDecision = hiringHint(softBlocks, hardBlocks);

  const overrideInputSignature = computeOverrideInputSignature(ctx);

  return {
    rulesVersion: OPERATIONAL_OVERRIDE_RULES_VERSION,
    baseInterviewScore: input.baseInterviewScore,
    adjustedScore,
    scoreDelta: adjustedScore - input.baseInterviewScore,
    finalBand: bandFromScore(adjustedScore),
    overridesApplied: evaluated.items,
    softBlocks,
    hardBlocks,
    recruiterTrustLevel: trustLevel(adjustedScore, hardBlocks),
    recommendedRecommendation,
    recommendedHiringDecision,
    autoAdvanceEligible: hardBlocks.length === 0 && softBlocks.length === 0,
    overrideInputSignature,
    prescreenReviewKind,
  };
}

/**
 * Merge compliance/onboarding gates into hiring engine output. Idempotent if blocks unchanged.
 */
export function mergeOperationalBlocksIntoHiringResult(
  result: AiHiringDecisionResult,
  softBlocks: string[],
  hardBlocks: string[],
): AiHiringDecisionResult {
  if (hardBlocks.length === 0 && softBlocks.length === 0) return result;

  let decision = result.decision;
  let eligible = result.eligibleForAutoAdvance;
  const reasonCodes = [...result.reasonCodes];

  if (hardBlocks.length > 0) {
    if (decision === 'advance') decision = 'reject';
    eligible = false;
    if (!reasonCodes.includes('operational_hard_block')) {
      reasonCodes.push('operational_hard_block');
    }
  } else if (softBlocks.length > 0) {
    if (decision === 'advance') decision = 'review';
    eligible = false;
    if (!reasonCodes.includes('operational_soft_block')) {
      reasonCodes.push('operational_soft_block');
    }
  }

  return { decision, eligibleForAutoAdvance: eligible, reasonCodes };
}
