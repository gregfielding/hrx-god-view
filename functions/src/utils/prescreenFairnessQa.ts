/**
 * Calibration report: suspiciously harsh prescreen outcomes for blue-collar ops (no automatic changes).
 */

export type FairnessFlag = {
  code: string;
  message: string;
};

function num(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return Math.round(x);
}

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Inspect a stored interview `ai` map for fairness review patterns.
 */
export function analyzePrescreenFairness(args: { ai: Record<string, unknown> | null | undefined }): FairnessFlag[] {
  const ai = args.ai;
  if (!ai || typeof ai !== 'object') return [];

  const flags = Array.isArray(ai.flags) ? (ai.flags as string[]) : [];
  const hd = ai.hiringDecision as Record<string, unknown> | undefined;
  const decision = norm(hd?.decision);
  const rec = norm(ai.recommendation);
  const base = num(ai.baseInterviewScore) ?? num(ai.overallScore);
  const adj = num(ai.overrideAdjustedScore) ?? base;

  const sub = (ai.subScores as Record<string, unknown> | undefined) || {};
  const trans = num(sub.transportation);
  const rel = num(sub.reliability);
  const phys = num(sub.physical);
  const exp = num(sub.experience);

  const out: FairnessFlag[] = [];

  const noHardDrugBg =
    !flags.includes('drug_risk_high') &&
    !flags.includes('background_risk_high') &&
    !flags.includes('physical_mismatch');

  const vagueOnly =
    flags.includes('vague_response') &&
    !flags.includes('attendance_risk') &&
    !flags.includes('transportation_risk') &&
    flags.filter((f) => f === 'vague_response' || f === 'low_effort_response').length >= 1;

  if (
    decision === 'reject' &&
    adj != null &&
    adj >= 55 &&
    trans != null &&
    trans >= 14 &&
    rel != null &&
    rel >= 16 &&
    phys != null &&
    phys >= 7 &&
    noHardDrugBg &&
    !flags.includes('attendance_risk')
  ) {
    out.push({
      code: 'strong_ops_signals_reject',
      message:
        'Transport/reliability/physical sub-scores look workable and no hard screening flags, but decision is reject — fairness review',
    });
  }

  if (
    (decision === 'reject' || decision === 'review') &&
    exp != null &&
    exp >= 18 &&
    flags.every((f) => ['vague_response', 'low_effort_response', 'drug_unknown', 'background_unknown'].includes(f)) &&
    flags.length <= 4
  ) {
    out.push({
      code: 'high_experience_soft_flags_only',
      message: 'Strong experience sub-score with only soft communication / unknown-compliance flags — confirm outcome',
    });
  }

  if ((decision === 'reject' || rec === 'decline') && vagueOnly && adj != null && adj >= 62) {
    out.push({
      code: 'communication_penalty_weight',
      message: 'Decline/reject with mostly vague-response weighting — check whether communication penalties dominated real risk',
    });
  }

  if (rec === 'decline' && adj != null && adj >= 70 && noHardDrugBg && !flags.includes('attendance_risk')) {
    out.push({
      code: 'strong_operational_band_decline',
      message: 'Operational score in a strong band but recommendation decline — confirm trust override and policy gates',
    });
  }

  return out;
}

export function summarizeTransportAttendancePhysical(ai: Record<string, unknown> | undefined): string {
  if (!ai || typeof ai !== 'object') return '—';
  const sub = (ai.subScores as Record<string, unknown> | undefined) || {};
  const parts: string[] = [];
  const t = num(sub.transportation);
  const r = num(sub.reliability);
  const p = num(sub.physical);
  if (t != null) parts.push(`transport ${t}/20`);
  if (r != null) parts.push(`reliability ${r}/25`);
  if (p != null) parts.push(`physical ${p}/10`);
  return parts.length ? parts.join(' · ') : '—';
}
