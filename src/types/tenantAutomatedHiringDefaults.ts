/**
 * Tenant-wide automated hiring defaults — mirrors Cloud Functions:
 * - `functions/.../aiPrescreenJobSlice.ts` → `tenants/{id}.aiPrescreen`
 * - `functions/.../aiHiringPolicyResolution.ts` → `tenants/{id}.aiHiring`
 * Job orders / groups may override via their own `aiHiring` maps.
 */

export type TenantAiPrescreenEligibility = {
  /** When true, worker must have a stored resume or at least one skill on their profile. */
  requireResumeOrSkill: boolean;
  requirePhone: boolean;
  requireLocation: boolean;
  requireWorkAuthorization: boolean;
};

export type TenantAiPrescreenQuestions = {
  askShiftConfirmation: boolean;
  askLocationConfirmation: boolean;
  askDrugScreenConfirmation: boolean;
  askBackgroundConfirmation: boolean;
  askCertificationConfirmation: boolean;
  askUniformConfirmation: boolean;
  allowGigFallbackQuestion: boolean;
};

export type TenantAiPrescreenConfig = {
  enabled: boolean;
  eligibility: TenantAiPrescreenEligibility;
  questions: TenantAiPrescreenQuestions;
};

export type TenantAiHiringConfig = {
  autoAdvanceEnabled: boolean;
  /** Interview score floor (0–100) — maps to policy `minimumScoreToAdvance`. */
  minimumScoreToAdvance?: number;
  /** When true with `minimumJobScoreToAdvance`, compares to application job fit. */
  minimumJobScoreGateEnabled?: boolean;
  minimumJobScoreToAdvance?: number;
  jobFitFailAction?: 'review' | 'hold';
  maximumAutoAdvances?: number;
  targetOnboardingCount?: number;
  stopWhenTargetReached?: boolean;
  allowGigFallback?: boolean;
};

export const DEFAULT_TENANT_AI_PRESCREEN: TenantAiPrescreenConfig = {
  enabled: true,
  eligibility: {
    requireResumeOrSkill: true,
    requirePhone: true,
    requireLocation: true,
    requireWorkAuthorization: true,
  },
  questions: {
    askShiftConfirmation: true,
    askLocationConfirmation: true,
    askDrugScreenConfirmation: true,
    askBackgroundConfirmation: true,
    askCertificationConfirmation: true,
    askUniformConfirmation: true,
    allowGigFallbackQuestion: true,
  },
};

export const DEFAULT_TENANT_AI_HIRING: TenantAiHiringConfig = {
  autoAdvanceEnabled: false,
};

/** Optional tenant-level quality cap (0–100), stored on `tenants/{id}.hiringConfig.quality`. */
export type TenantHiringQualityDefaults = {
  maximumNoShowRiskToAdvance?: number;
};
