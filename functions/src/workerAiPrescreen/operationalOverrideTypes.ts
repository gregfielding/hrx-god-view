/**
 * Recruiter operational override layer — types only (canonical in functions/).
 */

export const OPERATIONAL_OVERRIDE_RULES_VERSION = 'ops_override_v1' as const;

export type OperationalOverrideBand = 'A' | 'B' | 'C' | 'D' | 'F';

export type OperationalOverrideItem = {
  code: string;
  label: string;
  direction: 'up' | 'down' | 'gate_only';
  points?: number;
  reason: string;
};

export type OperationalOverrideResult = {
  rulesVersion: typeof OPERATIONAL_OVERRIDE_RULES_VERSION;
  baseInterviewScore: number;
  adjustedScore: number;
  scoreDelta: number;
  finalBand: OperationalOverrideBand;
  overridesApplied: OperationalOverrideItem[];
  softBlocks: string[];
  hardBlocks: string[];
  recruiterTrustLevel: 'high' | 'medium' | 'low';
  /** Interview-oriented recommendation after score + override adjustments. */
  recommendedRecommendation: 'proceed' | 'review' | 'decline';
  /** Hint from gates only — final hiring decision comes from policy engine + mergeOperationalBlocksIntoHiringResult. */
  recommendedHiringDecision: 'advance' | 'review' | 'reject' | 'hold';
  /** Narrow gate: false when soft/hard blocks exist regardless of score. */
  autoAdvanceEligible: boolean;
  /** Fingerprint of rule inputs for idempotency / skip stale writes. */
  overrideInputSignature: string;
  /** For review triage / summary — aligned with adjusted score. */
  prescreenReviewKind?: 'review_quality' | 'review_risk';
};

