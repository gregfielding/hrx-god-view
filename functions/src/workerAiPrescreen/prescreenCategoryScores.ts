/**
 * Maps prescreen answers (+ existing subScores) into six 0–100 category snapshots.
 * Additive to `scoreWorkerAiPrescreen` — does not change overallScore / recommendation.
 *
 * Question → category (primary):
 * - Reliability: attendance_issues, attendance_explanation, supervisor_feedback (via subScores.reliability)
 * - Punctuality: transportation_plan, backup_transportation, dyn_shift_punctuality, dyn_worksite_commute
 * - Work Ethic: motivation, pressure_situation, experience_details, work_confidence (via subScores.experience)
 * - Team Fit: motivation + supervisor_feedback narratives
 * - Job Readiness: experience/physical/risk subScores, opening preferences, dynamic physical/cert/uniform
 * - Stability: blend of reliability + transportation norms + attendance history signal
 */
import { prescreenTextHasConcreteDetail } from './prescreenTextAnswerQuality';
import type { AiPrescreenScoreResult, WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';

/** @see `src/types/prescreenCategoryScores.ts` — keep field names in sync. */
export type PrescreenCategoryScoresV1 = {
  version: 1;
  reliability: number;
  punctuality: number;
  workEthic: number;
  teamFit: number;
  jobReadiness: number;
  stability: number;
};

export type PrescreenCategoryEvidenceV1 = {
  reliability: string[];
  punctuality: string[];
  workEthic: string[];
  teamFit: string[];
  jobReadiness: string[];
  stability: string[];
};

/** Mirrors `PrescreenCategoryConfidenceV1` in `src/types/prescreenCategoryScores.ts`. */
export type PrescreenCategoryConfidenceV1 = {
  version: 1;
  reliability: number;
  punctuality: number;
  workEthic: number;
  teamFit: number;
  jobReadiness: number;
  stability: number;
};

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

function roundScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scalePts(pts: number, maxPts: number): number {
  if (maxPts <= 0) return 0;
  return (pts / maxPts) * 100;
}

function normDynamic(da: Record<string, string>, id: string): string {
  return String(da[id] ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function openingRichness(answers: WorkerAiPrescreenAnswers): { score: number; tags: string[] } {
  const tags: string[] = [];
  let units = 0;
  const tw = answers.opening_target_work_types;
  const sp = answers.opening_schedule_preferences;
  if (Array.isArray(tw) && tw.length) {
    units += tw.length;
    tags.push(`opening:target_work_types:${tw.length}`);
  }
  if (Array.isArray(sp) && sp.length) {
    units += sp.length;
    tags.push(`opening:schedule_preferences:${sp.length}`);
  }
  const exKeys = [
    'opening_experience_industrial',
    'opening_experience_hospitality',
    'opening_experience_events',
    'opening_experience_clerical',
    'opening_experience_healthcare',
    'opening_gig_types',
  ] as const;
  for (const k of exKeys) {
    const arr = answers[k];
    if (Array.isArray(arr) && arr.length) {
      units += arr.length;
      tags.push(`opening:${k}:${arr.length}`);
    }
  }
  const score = Math.min(100, 10 + units * 3);
  return { score, tags };
}

function teamFitFromNarratives(answers: WorkerAiPrescreenAnswers): { score: number; tags: string[] } {
  const tags: string[] = [];
  let pts = 0;
  const sup = norm(answers.supervisor_feedback);
  const mot = norm(answers.motivation);

  if (prescreenTextHasConcreteDetail(sup) || sup.length >= 36) {
    pts += 50;
    tags.push('supervisor_feedback:strong');
  } else if (sup.length >= 12) {
    pts += 32;
    tags.push('supervisor_feedback:moderate');
  } else if (sup.length > 0) {
    pts += 14;
    tags.push('supervisor_feedback:minimal');
  }

  if (prescreenTextHasConcreteDetail(mot) || mot.length >= 40) {
    pts += 50;
    tags.push('motivation:strong');
  } else if (mot.length >= 20) {
    pts += 32;
    tags.push('motivation:moderate');
  } else if (mot.length > 0) {
    pts += 14;
    tags.push('motivation:minimal');
  }

  return { score: Math.min(100, pts), tags };
}

function punctualityWithDynamics(
  transNorm: number,
  dynamicAnswers: Record<string, string>,
): { score: number; tags: string[] } {
  const tags: string[] = [];
  let x = transNorm;
  const shift = normDynamic(dynamicAnswers, 'dyn_shift_punctuality');
  const commute = normDynamic(dynamicAnswers, 'dyn_worksite_commute');

  if (shift === 'no') {
    x = Math.min(x, 42);
    tags.push('dynamic:shift_punctuality:no');
  } else if (shift === 'not_sure') {
    x -= 12;
    tags.push('dynamic:shift_punctuality:not_sure');
  } else if (shift === 'yes') {
    tags.push('dynamic:shift_punctuality:yes');
  }

  if (commute === 'no') {
    x = Math.min(x, 42);
    tags.push('dynamic:worksite_commute:no');
  } else if (commute === 'not_sure') {
    x -= 12;
    tags.push('dynamic:worksite_commute:not_sure');
  } else if (commute === 'yes') {
    tags.push('dynamic:worksite_commute:yes');
  }

  return { score: roundScore(x), tags };
}

function jobReadinessWithDynamics(
  base: number,
  dynamicAnswers: Record<string, string>,
): { score: number; tags: string[] } {
  const tags: string[] = [];
  let x = base;
  const phys = normDynamic(dynamicAnswers, 'dyn_physical_job_fit');
  if (phys === 'no') {
    x = Math.min(x, 56);
    tags.push('dynamic:physical_job_fit:no');
  } else if (phys === 'not_sure') {
    x -= 10;
    tags.push('dynamic:physical_job_fit:not_sure');
  } else if (phys === 'yes') {
    tags.push('dynamic:physical_job_fit:yes');
  }

  const uni = normDynamic(dynamicAnswers, 'dyn_uniform_available');
  if (uni === 'no') {
    x = Math.min(x, 58);
    tags.push('dynamic:uniform:no');
  } else if (uni === 'not_sure') {
    x -= 8;
    tags.push('dynamic:uniform:not_sure');
  }

  for (const [k, v] of Object.entries(dynamicAnswers)) {
    if (!k.startsWith('dyn_cert__')) continue;
    const a = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (a === 'no') {
      x -= 10;
      tags.push(`dynamic:cert:${k}:no`);
    } else if (a === 'not_sure') {
      x -= 4;
      tags.push(`dynamic:cert:${k}:not_sure`);
    }
  }

  return { score: roundScore(x), tags };
}

function emptyEvidence(): PrescreenCategoryEvidenceV1 {
  return {
    reliability: [],
    punctuality: [],
    workEthic: [],
    teamFit: [],
    jobReadiness: [],
    stability: [],
  };
}

/** First-pass confidence: more tags + mid-range scores → higher (bounded 18–92). */
function confidenceFromEvidence(tags: string[], score: number): number {
  const density = Math.min(24, tags.length) / 24;
  const extremityPenalty =
    score <= 12 || score >= 94 ? 0.12 : score <= 22 || score >= 88 ? 0.06 : 0;
  const mid = 1 - Math.min(1, Math.abs(score - 52) / 52) * 0.15;
  const raw = 0.38 + 0.48 * density + 0.12 * mid - extremityPenalty;
  return Math.round(Math.max(18, Math.min(92, raw * 100)));
}

export type ComputePrescreenCategoryScoresArgs = {
  answers: WorkerAiPrescreenAnswers;
  scored: AiPrescreenScoreResult;
  dynamicAnswers: Record<string, string>;
};

/**
 * Produces bounded 0–100 scores per category plus short evidence tags for auditing.
 * Uses existing `scored.subScores` so category layers stay aligned with the rules prescreen.
 */
export function computePrescreenCategoryScores(args: ComputePrescreenCategoryScoresArgs): {
  categoryScores: PrescreenCategoryScoresV1;
  categoryEvidence: PrescreenCategoryEvidenceV1;
  categoryConfidence: PrescreenCategoryConfidenceV1;
} {
  const { answers, scored, dynamicAnswers } = args;
  const { subScores, flags } = scored;
  const ev = emptyEvidence();

  const relN = scalePts(subScores.reliability, 25);
  const transN = scalePts(subScores.transportation, 20);
  const expN = scalePts(subScores.experience, 25);
  const riskN = scalePts(subScores.risk, 20);
  const physN = scalePts(subScores.physical, 10);

  ev.reliability.push(`subScores:reliability:${subScores.reliability}`);
  flags.forEach((f) => {
    if (
      f === 'attendance_risk' ||
      f === 'transportation_risk' ||
      f === 'no_backup_transport' ||
      f === 'limited_relevant_experience'
    ) {
      ev.reliability.push(`flag:${f}`);
    }
  });
  const att = normLower(answers.attendance_issues);
  if (att === 'no') ev.reliability.push('attendance_issues:no');
  if (att === 'yes') ev.reliability.push('attendance_issues:yes');

  const punct = punctualityWithDynamics(transN, dynamicAnswers);
  ev.punctuality.push(`subScores:transportation:${subScores.transportation}`);
  ev.punctuality.push(...punct.tags);

  ev.workEthic.push(`subScores:experience:${subScores.experience}`);
  if (norm(answers.pressure_situation).length >= 22) ev.workEthic.push('pressure_situation:substantive');
  if (norm(answers.motivation).length >= 20) ev.workEthic.push('motivation:substantive');

  const tf = teamFitFromNarratives(answers);
  ev.teamFit.push(...tf.tags);

  const { score: openScore, tags: openTags } = openingRichness(answers);
  const jobBase = roundScore(0.34 * expN + 0.22 * physN + 0.26 * riskN + 0.18 * openScore);
  const jr = jobReadinessWithDynamics(jobBase, dynamicAnswers);
  ev.jobReadiness.push(`subScores:experience:${subScores.experience}`);
  ev.jobReadiness.push(`subScores:physical:${subScores.physical}`);
  ev.jobReadiness.push(`subScores:risk:${subScores.risk}`);
  ev.jobReadiness.push(...openTags);
  ev.jobReadiness.push(...jr.tags);

  const attStable = att === 'no' ? 100 : att === 'yes' ? Math.min(100, 38 + (norm(answers.attendance_explanation).length > 20 ? 18 : 0)) : 50;
  const stabilityScore = roundScore(0.48 * relN + 0.32 * transN + 0.2 * attStable);
  ev.stability.push(`blend:reliability_transport_attendance`);
  if (att === 'no') ev.stability.push('attendance:stable_signal');

  const categoryScores: PrescreenCategoryScoresV1 = {
    version: 1,
    reliability: roundScore(relN),
    punctuality: punct.score,
    workEthic: roundScore(expN),
    teamFit: tf.score,
    jobReadiness: jr.score,
    stability: stabilityScore,
  };

  const categoryConfidence: PrescreenCategoryConfidenceV1 = {
    version: 1,
    reliability: confidenceFromEvidence(ev.reliability, categoryScores.reliability),
    punctuality: confidenceFromEvidence(ev.punctuality, categoryScores.punctuality),
    workEthic: confidenceFromEvidence(ev.workEthic, categoryScores.workEthic),
    teamFit: confidenceFromEvidence(ev.teamFit, categoryScores.teamFit),
    jobReadiness: confidenceFromEvidence(ev.jobReadiness, categoryScores.jobReadiness),
    stability: confidenceFromEvidence(ev.stability, categoryScores.stability),
  };

  return { categoryScores, categoryEvidence: ev, categoryConfidence };
}
