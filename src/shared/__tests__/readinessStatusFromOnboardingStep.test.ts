/**
 * Unit tests for `onboardingStepToReadinessStatus` and the bidirectional
 * step-key ↔ requirement-type lookup. Covers every value in the
 * `OnboardingStepStatus` union plus null/undefined and the mapping
 * round-trip.
 *
 * See `docs/READINESS_EXECUTION_MATRIX.md` §5.4 for the spec.
 */

import {
  ONBOARDING_STEP_TO_REQUIREMENT_TYPE,
  onboardingStepToReadinessStatus,
  requirementTypeToOnboardingStepKey,
  OnboardingStepStatus,
} from '../readinessStatusFromOnboardingStep';

describe('onboardingStepToReadinessStatus', () => {
  describe('null/undefined/pending', () => {
    it('returns incomplete for null', () => {
      expect(onboardingStepToReadinessStatus({ status: null })).toBe('incomplete');
    });

    it('returns incomplete for undefined', () => {
      expect(onboardingStepToReadinessStatus({ status: undefined })).toBe('incomplete');
    });

    it("returns incomplete for 'pending'", () => {
      expect(onboardingStepToReadinessStatus({ status: 'pending' })).toBe('incomplete');
    });
  });

  describe('explicit statuses', () => {
    const cases: Array<[OnboardingStepStatus, ReturnType<typeof onboardingStepToReadinessStatus>]> = [
      ['in_progress', 'in_progress'],
      ['completed', 'complete_pass'],
      ['failed', 'complete_fail'],
      ['rejected', 'complete_fail'],
      ['needs_review', 'needs_review'],
    ];

    it.each(cases)('%s → %s', (input, expected) => {
      expect(onboardingStepToReadinessStatus({ status: input })).toBe(expected);
    });
  });
});

describe('ONBOARDING_STEP_TO_REQUIREMENT_TYPE', () => {
  it('contains the expected mappings (snapshot of §5.4)', () => {
    // Locks the bridge between step keys (worker_onboarding) and
    // requirement types (employee_readiness_items). Changes to either
    // side must update this map AND the matrix doc.
    expect(ONBOARDING_STEP_TO_REQUIREMENT_TYPE).toEqual({
      tax_withholding_forms: 'tax_w4',
      contractor_tax_form_w9: 'tax_w9',
      tax_1099_consent_form: 'tax_1099_consent',
      handbook_acknowledgment: 'handbook_acknowledgement',
      ic_agreement_form: 'ic_agreement',
      policy_acknowledgments: 'policy_acknowledgement',
      payroll_onboarding: 'everee_profile',
      direct_deposit_setup: 'direct_deposit',
    });
  });

  it('all values are unique (no two step keys map to the same requirement type)', () => {
    const values = Object.values(ONBOARDING_STEP_TO_REQUIREMENT_TYPE);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('requirementTypeToOnboardingStepKey', () => {
  it('inverts every entry in ONBOARDING_STEP_TO_REQUIREMENT_TYPE', () => {
    for (const [stepKey, reqType] of Object.entries(ONBOARDING_STEP_TO_REQUIREMENT_TYPE)) {
      expect(requirementTypeToOnboardingStepKey(reqType)).toBe(stepKey);
    }
  });

  it('returns null for requirement types not backed by an onboarding step', () => {
    // I-9 sections: live on `worker_onboarding.steps[]`, not externalOnboardingSteps.
    expect(requirementTypeToOnboardingStepKey('i9_section_1')).toBeNull();
    expect(requirementTypeToOnboardingStepKey('i9_section_2')).toBeNull();
    // Vendor-driven items: live on their own collections.
    expect(requirementTypeToOnboardingStepKey('background_check')).toBeNull();
    expect(requirementTypeToOnboardingStepKey('drug_screen')).toBeNull();
    expect(requirementTypeToOnboardingStepKey('e_verify')).toBeNull();
    // Profile basics: live on the user doc.
    expect(requirementTypeToOnboardingStepKey('profile_photo')).toBeNull();
    expect(requirementTypeToOnboardingStepKey('phone_verified')).toBeNull();
    expect(requirementTypeToOnboardingStepKey('emergency_contact')).toBeNull();
    expect(requirementTypeToOnboardingStepKey('address_confirmed')).toBeNull();
    // Custom escape hatch.
    expect(requirementTypeToOnboardingStepKey('custom')).toBeNull();
  });
});
