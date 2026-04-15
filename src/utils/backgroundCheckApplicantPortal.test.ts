import {
  applicantSetupStatusSummary,
  resolveApplicantPortalUrl,
} from './backgroundCheckApplicantPortal';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';

describe('resolveApplicantPortalUrl', () => {
  it('prefers applicantPortalUrl when both set', () => {
    expect(
      resolveApplicantPortalUrl({
        applicantPortalUrl: 'https://a.example/setup?token=1',
        applicantPortalLink: 'https://b.example/',
      }),
    ).toBe('https://a.example/setup?token=1');
  });

  it('falls back to applicantPortalLink', () => {
    expect(
      resolveApplicantPortalUrl({
        applicantPortalLink: 'https://sandbox.myaccusourcedirect.construction/setup?token=x',
      }),
    ).toContain('setup?token=');
  });
});

describe('applicantSetupStatusSummary', () => {
  const base: BackgroundCheckRecord = { id: '1' };

  it('describes awaiting + link ready', () => {
    const s = applicantSetupStatusSummary({
      ...base,
      hrxStatus: 'awaiting_applicant',
      applicantPortalLink: 'https://example.com/setup?token=t',
    });
    expect(s.headline).toContain('ready');
  });

  it('describes awaiting without link', () => {
    const s = applicantSetupStatusSummary({
      ...base,
      hrxStatus: 'awaiting_applicant',
    });
    expect(s.headline).toMatch(/awaiting/i);
    expect(s.detail).toMatch(/webhook/i);
  });
});
