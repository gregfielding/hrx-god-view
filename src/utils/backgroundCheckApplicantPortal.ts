import type { BackgroundCheckRecord, HrxBackgroundCheckStatus } from '../types/backgroundCheck';

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

/** HRX states where the worker no longer needs the partial-profile portal CTA. */
const HRX_NO_PORTAL_CTA: Set<HrxBackgroundCheckStatus | string> = new Set([
  'completed',
  'report_ready',
  'drug_report_ready',
  'canceled',
  'error',
]);

/**
 * Show Open / Copy / “send this link” messaging only while HRX still expects the candidate
 * to use AccuSource’s partial-profile URL. AccuSource's own status string can say “Completed”
 * for an order sub-step while HRX stays `awaiting_applicant` — use this flag + `hrxStatus`, not `providerStatus` alone.
 */
export function shouldShowApplicantPortalCta(r: BackgroundCheckRecord): boolean {
  const hrx = String(r.hrxStatus || '').toLowerCase() as HrxBackgroundCheckStatus;
  if (!hrx || hrx === 'draft' || hrx === 'queued') return false;
  if (HRX_NO_PORTAL_CTA.has(hrx)) return false;
  if (r.orderCompleted === true || r.finalReportReady === true) return false;
  // Expired setup link (stamped by the R.10 daily expiry sweep) — the URL is
  // dead, so stop offering it. The worker's action item disappears; a
  // recruiter must re-order / resend to get a fresh link.
  if (r.expired === true) return false;
  // Subject already finished the AccuSource partial-profile setup — they took
  // the action, so the CTA is moot even if HRX hasn't advanced past
  // awaiting_applicant yet (the webhook can lag).
  if (r.profileCompleted === true) return false;
  if (hrx !== 'awaiting_applicant') return false;
  return Boolean(resolveApplicantPortalUrl(r));
}

export function applicantSetupStatusSummary(r: BackgroundCheckRecord): {
  headline: string;
  detail?: string;
} {
  const url = resolveApplicantPortalUrl(r);
  const hrx = r.hrxStatus;
  const showCta = shouldShowApplicantPortalCta(r);

  if (showCta) {
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

  if (url && !showCta) {
    return {
      headline: 'Applicant setup link (reference)',
      detail:
        'HRX status is no longer “awaiting applicant,” or this order already advanced—AccuSource may still show its own sub-step as completed. Use the link only if the candidate still needs the portal; otherwise rely on HRX status and screening rows.',
    };
  }

  return { headline: '—' };
}
