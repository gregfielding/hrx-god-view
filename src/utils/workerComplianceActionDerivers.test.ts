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

  it('hides the applicant item entirely when the setup URL is stamped expired (R.10 sweep)', () => {
    const s = deriveWorkerComplianceSignals([{ ...baseBg, expired: true }], []);
    expect(s.backgroundApplicantAction).toBe(false);
    expect(s.applicantPortalLink).toBeUndefined();
  });
});

describe('deriveWorkerComplianceSignals — recency window (2026-08-23)', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('ignores an error record untouched for longer than the recency window', () => {
    const s = deriveWorkerComplianceSignals(
      [{ hrxStatus: 'error', updatedAt: daysAgo(60) }],
      [],
    );
    expect(s.backgroundIssueAction).toBe(false);
  });

  it('keeps a recent error record, but never attaches a portal link to it', () => {
    const s = deriveWorkerComplianceSignals(
      [
        {
          hrxStatus: 'error',
          updatedAt: daysAgo(3),
          applicantPortalLink: 'https://myaccusourcedirect.com/setup?token=dead',
        },
      ],
      [],
    );
    expect(s.backgroundIssueAction).toBe(true);
    expect(s.applicantPortalLink).toBeUndefined();
  });

  it('ignores an awaiting_applicant record untouched for longer than the window', () => {
    const s = deriveWorkerComplianceSignals(
      [
        {
          hrxStatus: 'awaiting_applicant',
          requestedPackageName: 'CORT Basic',
          applicantPortalLink: 'https://myaccusourcedirect.com/setup?token=old',
          updatedAt: daysAgo(53),
        },
      ],
      [],
    );
    expect(s.backgroundApplicantAction).toBe(false);
    expect(s.applicantPortalLink).toBeUndefined();
  });

  it('treats records without readable timestamps as current', () => {
    const s = deriveWorkerComplianceSignals([{ hrxStatus: 'error' }], []);
    expect(s.backgroundIssueAction).toBe(true);
  });
});
