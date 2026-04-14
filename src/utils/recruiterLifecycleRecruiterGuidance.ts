import { HIRING_NEXT_ACTION_LABELS, isHiringNextAction } from '../constants/hiringLifecycle';
import type { RecruiterLifecycleFilterBucket } from './recruiterApplicationLifecycleBucket';

/**
 * Copy for recruiter UI when a lifecycle bucket filter is active (table context).
 */
export const RECRUITER_LIFECYCLE_FILTER_GUIDANCE: Record<
  RecruiterLifecycleFilterBucket,
  { summary: string; suggestedCues: string[] }
> = {
  profile_incomplete: {
    summary: 'Applicants blocked by missing required profile or prescreen information.',
    suggestedCues: [
      'Ask workers to finish profile gates shown on each row',
      'Use blocker chips to see which requirements are still open',
    ],
  },
  interview_pending: {
    summary: 'Applicants waiting to complete the interview / AI prescreen step.',
    suggestedCues: [
      'Prompt workers to schedule or finish the interview',
      'Confirm prescreen is required for this role before chasing',
    ],
  },
  qualified: {
    summary: 'Applicants ready to move forward in the pipeline (offer, advance, or next hiring step).',
    suggestedCues: [
      'Advance to offer or placement when checks pass',
      'Verify job fit and compliance before confirming',
    ],
  },
  review: {
    summary: 'Applicants needing recruiter triage, manual review, or compliance follow-up.',
    suggestedCues: [
      'Triage in order of role priority and risk',
      'Resolve compliance, documentation, or policy holds as needed',
    ],
  },
  waitlisted: {
    summary: 'Viable applicants held by capacity, queue, or waitlist rules.',
    suggestedCues: [
      'Decide waitlist ordering when slots open',
      'Convert to advance or offer when headcount allows',
    ],
  },
  other: {
    summary: 'Applicants in other lifecycle stages (e.g. applied, hired, onboarding, closed).',
    suggestedCues: [
      'Use the Lifecycle column for exact stage and sub-status',
      'Cross-check Status and placement when lifecycle is sparse',
    ],
  },
  unknown_legacy: {
    summary: 'Applications without a reliable lifecycle stage yet—legacy status may be the best signal.',
    suggestedCues: [
      'Rely on the Status column and interview cells until lifecycle is backfilled',
      'Lifecycle will populate as workers progress through updated flows',
    ],
  },
};

export type NextActionSummaryRow = { key: string; label: string; count: number };

function nextActionDisplayLabel(key: string): string {
  const k = key.trim();
  if (!k || k === 'none') return 'No action';
  if (isHiringNextAction(k)) return HIRING_NEXT_ACTION_LABELS[k];
  return k.replace(/_/g, ' ');
}

/**
 * Aggregates `hiringLifecycle.nextAction` across the current filtered applicant list for recruiter cues.
 */
export function summarizeNextActionsInApplicantList(
  rows: Array<{ hiringLifecycle?: { nextAction?: string } | null }>,
): NextActionSummaryRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const na = r.hiringLifecycle?.nextAction;
    if (typeof na !== 'string' || !na.trim()) continue;
    const k = na.trim();
    if (k === 'none') continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      label: nextActionDisplayLabel(key),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
