import { deriveWorkerComplianceSignals } from './workerComplianceActionDerivers';

describe('deriveWorkerComplianceSignals — AccuSource applicant portal action', () => {
  const baseBg = {
    requestedPackageName: 'CORT Basic',
    hrxStatus: 'awaiting_applicant',
    applicantPortalLink: 'https://myaccusourcedirect.com/setup?token=abc',
  };

  it('sets backgroundApplicantAction when awaiting_applicant and portal CTA still relevant', () => {
    const s = deriveWorkerComplianceSignals([baseBg], []);
    expect(s.backgroundApplicantAction).toBe(true);
  });

  it('clears backgroundApplicantAction when applicant flow is no longer gated (order completed)', () => {
    const s = deriveWorkerComplianceSignals([{ ...baseBg, orderCompleted: true }], []);
    expect(s.backgroundApplicantAction).toBe(false);
  });

  it('clears backgroundApplicantAction when HRX status advances past awaiting_applicant', () => {
    const s = deriveWorkerComplianceSignals(
      [{ ...baseBg, hrxStatus: 'in_progress', applicantPortalLink: baseBg.applicantPortalLink }],
      [],
    );
    expect(s.backgroundApplicantAction).toBe(false);
  });
});
