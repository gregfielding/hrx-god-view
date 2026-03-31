import {
  isExternalOnboardingStepVerifiedComplete,
  mapExternalOnboardingStepToPathStatus,
} from '../externalOnboardingSteps';
import { pickExternalVerificationAnchorWorkflowStepId } from '../externalOnboardingVerificationAnchor';

describe('isExternalOnboardingStepVerifiedComplete', () => {
  it('requires verifiedAt when status is completed', () => {
    const row = { status: 'completed' as const, externalSource: 'tempworks' as const };
    expect(isExternalOnboardingStepVerifiedComplete(row)).toBe(false);
    expect(
      isExternalOnboardingStepVerifiedComplete({ ...row, verifiedAt: new Date('2026-01-01T12:00:00Z') })
    ).toBe(true);
  });

  it('maps completed-without-verifiedAt to in_progress labels', () => {
    const m = mapExternalOnboardingStepToPathStatus(
      { status: 'completed', externalSource: 'tempworks' },
      'admin'
    );
    expect(m.status).toBe('in_progress');
    expect(m.statusLabel).toContain('pending');
  });
});

describe('pickExternalVerificationAnchorWorkflowStepId', () => {
  it('prefers payroll_setup_complete over payroll_invite_sent', () => {
    expect(
      pickExternalVerificationAnchorWorkflowStepId('payroll_onboarding', [
        'payroll_invite_sent',
        'payroll_setup_complete',
      ])
    ).toBe('payroll_setup_complete');
  });

  it('prefers i9_completed over i9_sent', () => {
    expect(
      pickExternalVerificationAnchorWorkflowStepId('i9_employee_section', ['i9_sent', 'i9_completed'])
    ).toBe('i9_completed');
  });

  it('uses earliest catalog id when no completion id is visible', () => {
    expect(
      pickExternalVerificationAnchorWorkflowStepId('payroll_onboarding', ['payroll_invite_sent'])
    ).toBe('payroll_invite_sent');
  });

  it('for W-9 external key picks earliest completion-style id in catalog order among visible', () => {
    expect(
      pickExternalVerificationAnchorWorkflowStepId('contractor_tax_form_w9', ['1099_sent', '1099_completed'])
    ).toBe('1099_completed');
  });
});
