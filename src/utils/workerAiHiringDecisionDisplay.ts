/**
 * Recruiter-facing labels and chips for AI hiring decisions (read-only v1).
 * Reason codes align with `evaluateAiHiringDecision` in functions + RECRUITER_AI_DECISION_UI.md.
 */

/** Shown near Worker AI prescreen recommendation vs hiring decision chips (they may differ, e.g. Review + Advance). */
export const WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP =
  'Interview recommendation reflects answer quality and scoring signals. Hiring decision applies policy, capacity, thresholds, and automation. The two can differ (for example, Review with Advance).';

export type HiringDecisionUi = 'advance' | 'review' | 'hold' | 'reject';

const REASON_LABELS: Record<string, string> = {
  passed_all_checks: 'Passed all checks',
  failed_score_threshold: 'Score below threshold',
  below_score_threshold: 'Score below threshold',
  moderate_flags_present: 'Moderate concerns require review',
  failed_job_requirement: 'Job-specific requirement issue',
  capacity_reached: 'Hiring target already met',
  onboarding_throttled: 'Onboarding limit reached',
  gig_path_eligible: 'Eligible for gig fallback',
  critical_flag_drug: 'Drug-screen concern',
  critical_flag_background: 'Background concern',
  critical_flag_physical: 'Physical requirement concern',
  not_in_top_percent: 'Outside top percent pool',
  recommendation_decline: 'Interview recommendation: decline',
};

export function labelForAiHiringReasonCode(code: string): string {
  const k = String(code || '').trim();
  return REASON_LABELS[k] ?? k.replace(/_/g, ' ');
}

export function hiringDecisionChipColor(
  decision: string | undefined,
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  const d = String(decision || '').toLowerCase();
  if (d === 'advance') return 'success';
  if (d === 'review') return 'warning';
  if (d === 'hold') return 'default';
  if (d === 'reject') return 'error';
  return 'default';
}

/** Visual variant: hold = outlined neutral per doc (not identical to reject). */
export function hiringDecisionChipVariant(decision: string | undefined): 'filled' | 'outlined' {
  return String(decision || '').toLowerCase() === 'hold' ? 'outlined' : 'filled';
}

export function formatHiringDecisionLabel(decision: string | undefined): string {
  const d = String(decision || '').toLowerCase();
  if (d === 'advance') return 'Advance';
  if (d === 'review') return 'Review';
  if (d === 'hold') return 'Hold';
  if (d === 'reject') return 'Reject';
  return decision ? String(decision) : '—';
}

export function formatScoreRecommendationLabel(
  rec: 'proceed' | 'review' | 'caution' | 'decline' | undefined,
): string {
  if (rec === 'proceed') return 'Proceed';
  if (rec === 'review') return 'Review';
  if (rec === 'caution') return 'Caution';
  if (rec === 'decline') return 'Decline';
  return '—';
}

const FLAG_LABELS: Record<string, string> = {
  attendance_risk: 'Attendance risk',
  transportation_risk: 'Transportation risk',
  no_backup_transport: 'No backup transportation',
  drug_risk: 'Drug risk (legacy)',
  background_risk: 'Background risk (legacy)',
  drug_risk_low: 'Drug signal — low severity',
  drug_risk_moderate: 'Drug signal — moderate severity',
  drug_risk_high: 'Drug signal — high severity',
  background_risk_low: 'Background signal — low severity',
  background_risk_moderate: 'Background signal — moderate severity',
  background_risk_high: 'Background signal — high severity',
  physical_mismatch: 'Physical mismatch',
  limited_relevant_experience: 'Limited relevant experience',
  drug_unknown: 'Drug screening unknown',
  background_unknown: 'Background unknown',
  risk_admission_detected: 'Admission flagged (attendance or screening)',
};

export function labelForInterviewFlag(flag: string): string {
  const k = String(flag || '').trim();
  return FLAG_LABELS[k] ?? k.replace(/_/g, ' ');
}

const DYNAMIC_LABELS: Record<string, string> = {
  dyn_shift_punctuality: 'Shift punctuality',
  dyn_worksite_commute: 'Worksite commute',
  dyn_physical_job_fit: 'Physical job fit',
  dyn_gig_path_willing: 'Gig path willingness',
};

export function labelForDynamicAnswerKey(key: string): string {
  const k = String(key || '').trim();
  return DYNAMIC_LABELS[k] ?? k.replace(/^dyn_/i, '').replace(/_/g, ' ');
}

export function formatDynamicAnswerValue(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (s === 'yes') return 'Yes';
  if (s === 'no') return 'No';
  if (s === 'not_sure') return 'Not sure';
  return String(v ?? '—');
}

/** Pull `dynamicAnswers` from `aiInterviewContext` if present. */
export function readDynamicAnswersFromAiContext(
  ctx: Record<string, unknown> | undefined | null,
): Record<string, string> | null {
  if (!ctx || typeof ctx !== 'object') return null;
  const raw = (ctx as { dynamicAnswers?: unknown }).dynamicAnswers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = formatDynamicAnswerValue(v);
  }
  return Object.keys(out).length ? out : null;
}

export function explanationLineForHiringDecision(args: {
  decision?: HiringDecisionUi;
  reasonCodes: string[];
}): string {
  const d = args.decision;
  const codes = new Set(args.reasonCodes.map((c) => String(c).trim()));
  if (codes.has('passed_all_checks') && d === 'advance') {
    return 'Strong score and no blocking issues. Candidate may be moved forward.';
  }
  if (d === 'hold' && (codes.has('failed_job_requirement') || codes.has('gig_path_eligible'))) {
    return 'Candidate scored well, but job-specific answers suggest this role may not fit — see reasons.';
  }
  if (d === 'review' || d === 'hold') {
    return 'Candidate should be reviewed before moving forward.';
  }
  if (d === 'reject') {
    return 'Automated decision indicates this candidate should not advance on current rules.';
  }
  return 'See score recommendation and hiring decision details below.';
}
