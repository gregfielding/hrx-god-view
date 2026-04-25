/**
 * Pure translator: `worker_onboarding.externalOnboardingSteps[stepKey]`
 * status → canonical `EmployeeReadinessItemStatus`.
 *
 * Phase E of the readiness execution roadmap. See
 * `docs/READINESS_EXECUTION_MATRIX.md` §5.4 for the spec this implements.
 *
 * Several Employee Readiness items derive from CSA-verified writes to
 * `tenants/{tid}/worker_onboarding/{userId}__{entityKey}.externalOnboardingSteps`,
 * via the `updateExternalOnboardingStepVerification()` callable. This
 * translator covers all of them with one mapping table and a step-key →
 * requirement-type lookup.
 *
 * Runtime-neutral. No firebase imports. Used by the Phase A reconciliation
 * trigger that fans out from `worker_onboarding` writes to update the
 * appropriate readiness items.
 */

import type {
  EmployeeReadinessItemStatus,
  EmployeeReadinessRequirementType,
} from './employeeReadinessItemV1';

/**
 * The `status` enum stamped on each
 * `externalOnboardingSteps[stepKey]` entry by the verification callable.
 * Mirrors the literals accepted by `updateExternalOnboardingStepVerification`.
 */
export type OnboardingStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'needs_review';

export interface OnboardingStepReadinessInput {
  status: OnboardingStepStatus | null | undefined;
}

/**
 * Translate a single onboarding step's status into canonical readiness
 * status. See `docs/READINESS_EXECUTION_MATRIX.md` §5.4.
 */
export function onboardingStepToReadinessStatus(
  input: OnboardingStepReadinessInput,
): EmployeeReadinessItemStatus {
  const status = input.status ?? null;

  switch (status) {
    case null:
    case undefined:
    case 'pending':
      return 'incomplete';

    case 'in_progress':
      return 'in_progress';

    case 'completed':
      return 'complete_pass';

    case 'failed':
    case 'rejected':
      return 'complete_fail';

    case 'needs_review':
      return 'needs_review';

    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'needs_review';
    }
  }
}

/**
 * Map from `worker_onboarding.externalOnboardingSteps` key → the
 * `EmployeeReadinessRequirementType` it backs. Single source of truth for
 * the bridge between the two parallel onboarding state holders. Used by
 * the Phase A reconciliation trigger to know which readiness item to
 * update when a given step changes.
 *
 * Step keys not in this table are unmapped — they exist in the onboarding
 * pipeline but don't have a readiness-item equivalent (e.g. CSA-internal
 * tasks). The trigger should no-op silently for those.
 *
 * Keep this aligned with §5.4 of `READINESS_EXECUTION_MATRIX.md`.
 */
export const ONBOARDING_STEP_TO_REQUIREMENT_TYPE: Readonly<
  Record<string, EmployeeReadinessRequirementType>
> = {
  tax_withholding_forms: 'tax_w4',
  contractor_tax_form_w9: 'tax_w9',
  tax_1099_consent_form: 'tax_1099_consent',
  handbook_acknowledgment: 'handbook_acknowledgement',
  ic_agreement_form: 'ic_agreement',
  policy_acknowledgments: 'policy_acknowledgement',
  payroll_onboarding: 'everee_profile',
  direct_deposit_setup: 'direct_deposit',
  // I-9 §1 / §2: there's no externalOnboardingSteps key for these; they
  // live on the older `steps[]` array. The Phase A trigger needs a
  // separate path for I-9 — it watches `worker_onboarding.steps` rather
  // than `externalOnboardingSteps`.
};

/**
 * Inverse lookup helper — given a requirement type, find the matching
 * onboarding step key (if any). Used by the action queue UI to deep-link
 * a CSA from a readiness item back to the corresponding step verification
 * surface. Returns `null` for requirement types that aren't backed by an
 * onboarding step (e.g. `background_check`, `e_verify`, profile basics).
 */
export function requirementTypeToOnboardingStepKey(
  requirementType: EmployeeReadinessRequirementType,
): string | null {
  for (const [stepKey, reqType] of Object.entries(ONBOARDING_STEP_TO_REQUIREMENT_TYPE)) {
    if (reqType === requirementType) return stepKey;
  }
  return null;
}
