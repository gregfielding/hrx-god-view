/**
 * Deterministic "solid worker" floor: weak wording alone must not auto-decline
 * when fundamentals (attendance, transport, physical, experience) look workable
 * and there is no hard-stop compliance signal.
 *
 * **Keep in sync** with `functions/src/workerAiPrescreen/operationalTrustOverride.ts`.
 */

export type PrescreenSubScores = {
  experience: number;
  reliability: number;
  transportation: number;
  risk: number;
  physical: number;
};

const HARD_STOP_FLAGS = new Set([
  'drug_risk_high',
  'background_risk_high',
  'physical_mismatch',
]);

export function computeOperationalTrustPromoteDeclineToReview(args: {
  recommendation: 'proceed' | 'review' | 'decline';
  overallScore: number;
  flags: string[];
  subScores: PrescreenSubScores;
}): boolean {
  const { recommendation, overallScore, flags, subScores } = args;
  if (recommendation !== 'decline') return false;

  if (overallScore < 52) return false;

  for (const f of flags) {
    if (HARD_STOP_FLAGS.has(f)) return false;
  }

  if (flags.includes('limited_relevant_experience') && subScores.experience < 10) {
    return false;
  }

  const attendanceOk = !flags.includes('attendance_risk');
  const transportOk = !(flags.includes('transportation_risk') && flags.includes('no_backup_transport'));
  const experienceOk = subScores.experience >= 12 || !flags.includes('limited_relevant_experience');
  const physicalOk = subScores.physical >= 8;

  return attendanceOk && transportOk && experienceOk && physicalOk;
}
