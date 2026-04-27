/**
 * HRX-normalized E-Verify case status → human-readable labels and outcome classification.
 * Logic uses `public.status` / top-level `status`; display prefers ICA `public.statusDisplay` when present.
 *
 * Keep in sync with `functions/src/onboarding/loadEntityOnboardingEngineBuildContextAdmin.ts` (buildEverifySummary).
 */

/** Normalized HRX enum values from `everify_cases` / `EverifyCaseStatus`. */
export const EVERIFY_HRX_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  ready: 'Ready to submit',
  submitted: 'Submitted to E-Verify',
  pending: 'Pending',
  employment_authorized: 'Employment Authorized',
  tnc: 'Tentative Nonconfirmation',
  dhs_verification_in_process: 'DHS Verification In Progress',
  further_action_required: 'Further Action Required',
  final_nonconfirmation: 'Final Nonconfirmation',
  closed: 'Closed',
  closure_duplicate: 'Closed — Duplicate Case',
  error: 'Error',
};

export function normalizeEverifyHrxStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function titleCaseSnake(s: string): string {
  return s
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Primary human-visible line: ICA text when present, else mapped HRX label (never raw snake_case).
 */
export function everifyCaseDisplayLabel(args: {
  icaLine?: string | null;
  hrxNormalized: string;
}): string {
  const ica = String(args.icaLine ?? '').trim();
  if (ica) return ica;
  const h = args.hrxNormalized;
  if (!h) return '—';
  return EVERIFY_HRX_STATUS_LABEL[h] ?? titleCaseSnake(h);
}

/** Case still receiving updates / not in a terminal bucket. */
export function everifyHrxIsActive(hrxNorm: string): boolean {
  return (
    hrxNorm !== '' &&
    ['draft', 'ready', 'submitted', 'pending', 'tnc', 'dhs_verification_in_process', 'further_action_required'].includes(
      hrxNorm,
    )
  );
}

export function everifyHrxIsTerminal(hrxNorm: string): boolean {
  return hrxNorm !== '' && !everifyHrxIsActive(hrxNorm);
}

export type EverifyHrxOutcome =
  | 'favorable_terminal'
  | 'unfavorable_terminal'
  | 'neutral_terminal'
  | 'in_progress'
  | 'error';

export function everifyHrxOutcome(hrxNorm: string): EverifyHrxOutcome {
  if (!hrxNorm) return 'in_progress';
  if (hrxNorm === 'error') return 'error';
  if (hrxNorm === 'employment_authorized') return 'favorable_terminal';
  if (hrxNorm === 'final_nonconfirmation') return 'unfavorable_terminal';
  if (hrxNorm === 'closed' || hrxNorm === 'closure_duplicate') return 'neutral_terminal';
  if (everifyHrxIsActive(hrxNorm)) return 'in_progress';
  return 'in_progress';
}

export function everifyHrxDisplayLabelForAudit(hrxRaw: string | undefined | null): string {
  const n = normalizeEverifyHrxStatus(hrxRaw);
  return everifyCaseDisplayLabel({ icaLine: null, hrxNormalized: n });
}

/**
 * Fields derived from latest `everify_cases` doc for Select entity rollup + UI.
 */
export function computeEverifySummaryFieldsFromLatestCaseData(data: Record<string, unknown>): {
  statusDisplay: string;
  latestHrxStatus: string;
  closed: boolean;
  actionNeeded: boolean;
} {
  const pub = data.public as { status?: string; statusDisplay?: string } | undefined;
  const hrxNorm = normalizeEverifyHrxStatus(pub?.status ?? data.status);
  const ica = String(pub?.statusDisplay ?? (data as { providerStatus?: string }).providerStatus ?? '').trim();
  const statusDisplay = everifyCaseDisplayLabel({ icaLine: ica, hrxNormalized: hrxNorm });
  const closed = everifyHrxIsTerminal(hrxNorm);
  const actionNeeded = everifyHrxIsActive(hrxNorm) && !statusDisplay.includes('—');
  return { statusDisplay, latestHrxStatus: hrxNorm, closed, actionNeeded };
}
