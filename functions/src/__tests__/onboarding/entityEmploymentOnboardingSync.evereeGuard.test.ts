import { isEvereeCompleteFromDocs } from '../../onboarding/entityEmploymentOnboardingSync';

/**
 * Greg 2026-09-11: C1 Events rows that Everee finished were being downgraded back to amber
 * "Onboarding" by the engine sync on any worker_onboarding write. The guard keys on this predicate.
 */
describe('isEvereeCompleteFromDocs (C1 Events engine-sync guard)', () => {
  it('the Everee link decides it', () => {
    expect(isEvereeCompleteFromDocs({}, { status: 'onboarding_complete' })).toBe(true);
    expect(isEvereeCompleteFromDocs({}, { status: 'created', apiObservedOnboardingCompleteAt: { seconds: 1 } })).toBe(true);
  });

  it('the row\'s own stamps decide it when there is no link', () => {
    expect(isEvereeCompleteFromDocs({ evereeOnboardingStatus: 'complete' }, null)).toBe(true);
    expect(isEvereeCompleteFromDocs({ payrollOnboardingCompletedAt: { seconds: 1 } }, null)).toBe(true);
    expect(isEvereeCompleteFromDocs({ evereeOnboardingStatus: 'COMPLETE' }, null)).toBe(true);
  });

  it('an unfinished worker stays unfinished — their amber chip is correct', () => {
    expect(isEvereeCompleteFromDocs({}, null)).toBe(false);
    expect(isEvereeCompleteFromDocs({ evereeOnboardingStatus: 'in_progress', payrollStatus: 'not_started' }, { status: 'created' })).toBe(false);
  });
});
