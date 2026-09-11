import {
  claimNeedsSetup,
  evaluateClaimReadiness,
  eventsSetupSteps,
  isEventsSetupComplete,
  isHeadshotReadyForClaim,
  isPayrollReadyForClaim,
} from '../claimReadiness';

const EVENTS = 'c1_events_llc';
const SELECT = 'c1_select_llc';

describe('claimReadiness — payroll (mirror of claimShiftPolicy)', () => {
  it('engine-active or any payroll-done field is ready', () => {
    expect(isPayrollReadyForClaim([{ status: 'active' }], null)).toBe(true);
    expect(isPayrollReadyForClaim([{ status: 'onboarding', evereeOnboardingStatus: 'complete' }], null)).toBe(true);
    expect(isPayrollReadyForClaim([{ status: 'onboarding', payrollOnboardingCompletedAt: { seconds: 1 } }], null)).toBe(true);
    expect(isPayrollReadyForClaim([{ status: 'onboarding' }], { status: 'onboarding_complete' })).toBe(true);
  });

  it('in progress at Everee and ended rows are not ready', () => {
    expect(isPayrollReadyForClaim([{ status: 'onboarding', payrollStatus: 'in_progress' }], { status: 'created' })).toBe(false);
    expect(isPayrollReadyForClaim([{ status: 'terminated', payrollStatus: 'complete' }], null)).toBe(false);
  });

  it('evaluates the same five outcomes as the server', () => {
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [{ status: 'active' }], link: null })).toBe('ready');
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [], link: null })).toBe('start_onboarding');
    expect(evaluateClaimReadiness({ entityId: SELECT, employments: [], link: null })).toBe('not_hired');
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [{ status: 'onboarding' }], link: null })).toBe('setup_in_progress');
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [{ status: 'inactive' }], link: { status: 'onboarding_complete' } })).toBe('employment_ended');
  });

  it('only start_onboarding and setup_in_progress need setup', () => {
    expect(claimNeedsSetup('start_onboarding')).toBe(true);
    expect(claimNeedsSetup('setup_in_progress')).toBe(true);
    for (const k of ['ready', 'not_hired', 'employment_ended', null] as const) expect(claimNeedsSetup(k)).toBe(false);
  });
});

describe('eventsSetupSteps — photo · direct deposit · 1099 tax form', () => {
  it('finished payroll marks both payroll steps done without per-step mirror stamps', () => {
    expect(
      eventsSetupSteps({ photoReady: true, payrollReady: true, link: { status: 'onboarding_complete', readinessMirror: { w9SignedAt: null } } }),
    ).toEqual({ photo: true, directDeposit: true, taxForm: true });
  });

  it('mid-setup steps follow the readiness mirror', () => {
    expect(eventsSetupSteps({ photoReady: false, payrollReady: false, link: { readinessMirror: { directDepositReady: true } } })).toEqual({
      photo: false,
      directDeposit: true,
      taxForm: false,
    });
    expect(eventsSetupSteps({ photoReady: true, payrollReady: false, link: { readinessMirror: { w9SignedAt: { seconds: 1 } } } })).toEqual({
      photo: true,
      directDeposit: false,
      taxForm: true,
    });
    expect(eventsSetupSteps({ photoReady: true, payrollReady: false, link: { readinessMirror: { bankAccountCount: 1 } } }).directDeposit).toBe(true);
    expect(eventsSetupSteps({ photoReady: true, payrollReady: false, link: { readinessMirror: { directDepositVerifiedAt: { seconds: 1 } } } }).directDeposit).toBe(true);
  });

  it('no link or mirror leaves both payroll steps open', () => {
    expect(eventsSetupSteps({ photoReady: true, payrollReady: false, link: null })).toEqual({ photo: true, directDeposit: false, taxForm: false });
    expect(eventsSetupSteps({ photoReady: true, payrollReady: false, link: { status: 'created' } })).toEqual({ photo: true, directDeposit: false, taxForm: false });
  });

  it('complete only when all three are done', () => {
    expect(isEventsSetupComplete({ photo: true, directDeposit: true, taxForm: true })).toBe(true);
    expect(isEventsSetupComplete({ photo: false, directDeposit: true, taxForm: true })).toBe(false);
    expect(isEventsSetupComplete({ photo: true, directDeposit: true, taxForm: false })).toBe(false);
  });
});

describe('claimReadiness — headshot (mirror of evaluateHeadshotGate, no grace)', () => {
  it('no photo is not ready', () => {
    expect(isHeadshotReadyForClaim({})).toBe(false);
    expect(isHeadshotReadyForClaim(null)).toBe(false);
  });

  it('approved, pending, error, unverified, quality rejections and stale verdicts are ready', () => {
    const avatar = 'https://x/a.jpg';
    expect(isHeadshotReadyForClaim({ avatar })).toBe(true);
    for (const status of ['approved', 'pending', 'error']) {
      expect(isHeadshotReadyForClaim({ avatar, avatarVerification: { status } })).toBe(true);
    }
    expect(isHeadshotReadyForClaim({ avatar, avatarVerification: { status: 'rejected', rejectionReason: 'too_blurry' } })).toBe(true);
    expect(
      isHeadshotReadyForClaim({ avatar, avatarVerification: { status: 'rejected', rejectionReason: 'multiple_faces', sourceAvatarUrl: 'https://x/old.jpg' } }),
    ).toBe(true);
  });

  it('not-a-headshot rejections on the current photo are not ready', () => {
    const avatar = 'https://x/a.jpg';
    for (const rejectionReason of ['no_face', 'multiple_faces', 'inappropriate', 'manual_override']) {
      expect(isHeadshotReadyForClaim({ avatar, avatarVerification: { status: 'rejected', rejectionReason, sourceAvatarUrl: avatar } })).toBe(false);
    }
  });
});
