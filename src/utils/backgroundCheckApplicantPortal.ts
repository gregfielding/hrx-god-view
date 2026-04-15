import type { BackgroundCheckRecord } from '../types/backgroundCheck';

/**
 * AccuSource stores the applicant self-service URL as `applicantPortalLink` (create + webhooks).
 * `applicantPortalUrl` is an optional alias written by webhooks for parity with vendor naming.
 */
export function resolveApplicantPortalUrl(
  r: Pick<BackgroundCheckRecord, 'applicantPortalUrl' | 'applicantPortalLink'>,
): string | null {
  const u = r.applicantPortalUrl ?? r.applicantPortalLink;
  return typeof u === 'string' && u.trim().length > 0 ? u.trim() : null;
}

export function applicantSetupStatusSummary(r: BackgroundCheckRecord): {
  headline: string;
  detail?: string;
} {
  const url = resolveApplicantPortalUrl(r);
  const hrx = r.hrxStatus;
  if (hrx === 'awaiting_applicant' && url) {
    return {
      headline: 'Applicant setup link ready',
      detail: 'Send this AccuSource link to the candidate so they can finish partial profile setup.',
    };
  }
  if (hrx === 'awaiting_applicant' && !url) {
    return {
      headline: 'Awaiting applicant',
      detail:
        'No applicant setup URL on file yet. AccuSource will send a partial_profile_link webhook when the link is available.',
    };
  }
  if (url) {
    return {
      headline: 'Applicant setup link',
      detail: 'AccuSource partial-profile portal URL (candidate completes setup here).',
    };
  }
  return { headline: '—' };
}
