/**
 * Rules-based worker AI pre-screen scoring (server source of truth).
 * Algorithm: `AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md` §2–7 (v1).
 */

import { prescreenTextHasConcreteDetail } from './prescreenTextAnswerQuality';
import {
  complianceConcernLevel,
  type ComplianceQuestionFraming,
} from './prescreenComplianceSemantics';

export type WorkerAiPrescreenAnswers = {
  opening_target_work_types?: string[];
  opening_schedule_preferences?: string[];
  opening_experience_industrial?: string[];
  opening_experience_hospitality?: string[];
  opening_experience_events?: string[];
  opening_experience_clerical?: string[];
  opening_experience_healthcare?: string[];
  opening_gig_types?: string[];
  motivation?: string;
  experience_details?: string;
  pressure_situation?: string;
  work_confidence?: string[];
  attendance_issues?: string;
  attendance_explanation?: string;
  transportation_plan?: string;
  backup_transportation?: string;
  physical_comfort?: string;
  drug_screen?: string;
  /** Core path only: required when drug_screen=yes (disclosure). */
  drug_screen_detail?: string;
  background_check?: string;
  /** Core path only: required when background_check=yes (disclosure). */
  background_check_detail?: string;
  supervisor_feedback?: string;
  additional_notes?: string;
};

/** Aligns with {@link mergeDynamicDrugBackgroundIntoCoreAnswers} — drives disclosure vs ability framing. */
export type DrugBackgroundScoringMeta = {
  drugSource: 'core' | 'dynamic' | 'none';
  backgroundSource: 'core' | 'dynamic' | 'none';
};

/** Exact shape from AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md § "Scoring Output Shape". */
/** Internal only: why `review` — weaker band/answers vs screening-risk downgrade (UI may expose later). */
export type PrescreenReviewKind = 'review_quality' | 'review_risk';

export type AiPrescreenScoreResult = {
  overallScore: number;
  recommendation: 'proceed' | 'review' | 'decline';
  /** Present when `recommendation === 'review'` (distinguishes C/D weakness vs strong score + screening flags). */
  reviewKind?: PrescreenReviewKind;
  flags: string[];
  /** One-line recruiter-facing explanation (band + top flags). */
  summary: string;
  subScores: {
    experience: number;
    reliability: number;
    transportation: number;
    risk: number;
    physical: number;
  };
  /** Rules-based audit: base category sum + quality adj − calibrated flag penalties → final score. */
  scoreBreakdown?: PrescreenScoreBreakdown;
};

/** Structured penalty audit (QA / recruiters). */
export type PrescreenScoreBreakdown = {
  subScoreSum: number;
  qualityAdjustment: number;
  baseScoreBeforePenalties: number;
  flagPenalties: Array<{ flag: string; points: number }>;
  flagPenaltyTotalRaw: number;
  flagPenaltyTotalApplied: number;
  finalScore: number;
};

/** Recruiter-style letter grade from 0–100 score. */
export function prescreenLetterGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function prescreenScoreBandLabel(score: number): string {
  const g = prescreenLetterGrade(score);
  const labels: Record<string, string> = {
    A: 'Strong (90–100)',
    B: 'Good (80–89)',
    C: 'Mixed / acceptable (70–79)',
    D: 'Weak (60–69)',
    F: 'Low (0–59)',
  };
  return labels[g] ?? 'Unknown';
}

/**
 * Calibrated penalties applied after base category scores + answer-quality adjustment.
 * Caps prevent stacking every flag into automatic F while still pulling risky candidates out of A/B bands.
 */
const FLAG_SCORE_PENALTIES: Record<string, number> = {
  /** Critical compliance — calibrated with post-cap so strong profiles rarely stay above ~65 with these flags. */
  drug_risk: 41,
  background_risk: 41,
  drug_unknown: 15,
  background_unknown: 15,
  attendance_risk: 12,
  transportation_risk: 10,
  no_backup_transport: 10,
  limited_relevant_experience: 12,
  physical_mismatch: 20,
  risk_admission_detected: 10,
  /** Narrative quality (also emitted by `evaluatePrescreenAnswerQuality`; penalties stack for multiple issues). */
  vague_response: 10,
  low_effort_response: 14,
};

/** Max total points subtracted from flag penalties (sum of per-flag penalties can exceed this). */
const MAX_FLAG_PENALTY_TOTAL = 48;

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

function normalizeWorkConfidence(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  const s = norm(raw);
  if (!s) return [];
  if (s.includes(',')) {
    return s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [s];
}

function scoreExperience(answers: WorkerAiPrescreenAnswers): { pts: number; flags: string[] } {
  const flags: string[] = [];
  let pts = 0;

  const details = norm(answers.experience_details);
  const detailsConcrete = prescreenTextHasConcreteDetail(details) || details.length >= 36;
  if (detailsConcrete) pts += 16;
  else if (details.length >= 20) pts += 11;
  else if (details.length > 0) pts += 6;
  else pts += 2;

  const pressure = norm(answers.pressure_situation);
  if (prescreenTextHasConcreteDetail(pressure) || pressure.length >= 40) pts += 6;
  else if (pressure.length >= 22) pts += 3;

  const rawConf = answers.work_confidence;
  const selections = normalizeWorkConfidence(rawConf);
  const concrete = selections.filter((x) => normLower(x) !== 'other');
  const onlyOther = selections.length > 0 && concrete.length === 0;

  let confPts = 0;
  if (onlyOther) confPts = 0;
  else if (concrete.length >= 2) confPts = 5;
  else if (concrete.length === 1) confPts = 3;
  else confPts = 0;
  pts += confPts;

  pts = Math.min(25, pts);

  const confWeak = confPts === 0;
  const detailsWeak = details.length < 20 && !prescreenTextHasConcreteDetail(details);
  if (detailsWeak && confWeak) {
    flags.push('limited_relevant_experience');
  }

  return { pts, flags };
}

function scoreReliability(answers: WorkerAiPrescreenAnswers): { pts: number; flags: string[] } {
  const flags: string[] = [];
  let pts = 0;

  const attendance = normLower(answers.attendance_issues);
  if (attendance === 'no') pts += 20;
  else if (attendance === 'yes') {
    pts += 5;
    flags.push('attendance_risk');
    const expl = norm(answers.attendance_explanation);
    if (expl.length > 10) pts += 3;
  }

  const sup = norm(answers.supervisor_feedback);
  if (sup.length > 5) pts += 2;

  pts = Math.min(25, pts);
  return { pts, flags };
}

function scoreTransportation(answers: WorkerAiPrescreenAnswers): { pts: number; flags: string[] } {
  const flags: string[] = [];
  let pts = 0;

  const plan = normLower(answers.transportation_plan);
  if (plan === 'own_vehicle') pts += 12;
  else if (plan === 'ride_from_someone_else') pts += 8;
  else if (plan === 'public_transportation') pts += 6;
  else if (plan === 'not_sure_yet') {
    pts += 2;
    flags.push('transportation_risk');
  }
  // walk_bike, other, unknown: +0 (spec lists four primary plans only)

  const backup = normLower(answers.backup_transportation);
  if (backup === 'yes') pts += 8;
  else if (backup === 'no') {
    pts += 2;
    flags.push('no_backup_transport');
  }

  pts = Math.min(20, pts);
  return { pts, flags };
}

/**
 * Risk sub-score + compliance flags.
 * Uses disclosure vs ability framing via {@link DrugBackgroundScoringMeta}.
 */
function scoreRiskHalf(
  raw: unknown,
  source: 'core' | 'dynamic' | 'none',
  riskFlag: 'drug_risk' | 'background_risk',
  unknownFlag: 'drug_unknown' | 'background_unknown',
): { pts: number; flags: string[] } {
  if (source === 'none') {
    return { pts: 5, flags: [unknownFlag] };
  }
  const framing: ComplianceQuestionFraming = source === 'dynamic' ? 'ability' : 'disclosure';
  const level = complianceConcernLevel(raw, framing);
  if (level === 'clean') {
    return { pts: 10, flags: [] };
  }
  if (level === 'concern') {
    return { pts: 0, flags: [riskFlag] };
  }
  return { pts: 5, flags: [unknownFlag] };
}

function scoreRisk(
  answers: WorkerAiPrescreenAnswers,
  meta?: DrugBackgroundScoringMeta,
): { pts: number; flags: string[] } {
  const drugSrc = meta?.drugSource ?? 'core';
  const bgSrc = meta?.backgroundSource ?? 'core';

  const drugHalf = scoreRiskHalf(answers.drug_screen, drugSrc, 'drug_risk', 'drug_unknown');
  const bgHalf = scoreRiskHalf(answers.background_check, bgSrc, 'background_risk', 'background_unknown');

  const pts = Math.min(20, drugHalf.pts + bgHalf.pts);
  const flags = [...drugHalf.flags, ...bgHalf.flags];
  return { pts, flags };
}

function scorePhysical(answers: WorkerAiPrescreenAnswers): { pts: number; flags: string[] } {
  const flags: string[] = [];
  let pts = 0;
  const ph = normLower(answers.physical_comfort);
  if (ph === 'yes') pts += 10;
  else if (ph === 'no') {
    flags.push('physical_mismatch');
  }
  pts = Math.min(10, pts);
  return { pts, flags };
}

function applyFlagPenalties(baseScore: number, flags: string[]): Omit<PrescreenScoreBreakdown, 'subScoreSum' | 'qualityAdjustment'> {
  const seen = new Set<string>();
  const flagPenalties: Array<{ flag: string; points: number }> = [];
  for (const f of flags) {
    if (seen.has(f)) continue;
    seen.add(f);
    const pts = FLAG_SCORE_PENALTIES[f];
    if (typeof pts === 'number' && pts > 0) {
      flagPenalties.push({ flag: f, points: pts });
    }
  }
  const flagPenaltyTotalRaw = flagPenalties.reduce((a, b) => a + b.points, 0);
  const flagPenaltyTotalApplied = Math.min(flagPenaltyTotalRaw, MAX_FLAG_PENALTY_TOTAL);
  const finalScore = Math.max(0, Math.min(100, Math.round(baseScore - flagPenaltyTotalApplied)));
  return {
    baseScoreBeforePenalties: baseScore,
    flagPenalties,
    flagPenaltyTotalRaw,
    flagPenaltyTotalApplied,
    finalScore,
  };
}

/**
 * Trust caps after calibrated penalties (do not change category sub-score math).
 * - Critical drug/background risk: keep numeric score aligned with F/D expectations for compliance.
 * - Screening unknown: block A/B unless everything else is exceptional (cap in high C band).
 */
function applyRecruiterTrustScoreCaps(score: number, flags: string[]): number {
  let s = score;
  const majorRisk = flags.includes('drug_risk') || flags.includes('background_risk');
  const screeningUnknown = flags.includes('drug_unknown') || flags.includes('background_unknown');
  if (majorRisk) {
    s = Math.min(s, 65);
  } else if (screeningUnknown) {
    s = Math.min(s, 79);
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Recommendation follows recruiter grade bands (score already includes penalties + trust caps).
 * - 80+: proceed unless drug/bg flags force review (never decline solely from high score).
 * - 60–79: review (weak / borderline)
 * - &lt;60: decline
 */
function recommendationFromScoreAndFlags(
  overallScore: number,
  flags: string[],
): { recommendation: AiPrescreenScoreResult['recommendation']; reviewKind: PrescreenReviewKind | undefined } {
  const screeningUncertain = flags.includes('drug_unknown') || flags.includes('background_unknown');
  const majorRisk = flags.includes('drug_risk') || flags.includes('background_risk');

  if (overallScore < 60) {
    return { recommendation: 'decline', reviewKind: undefined };
  }

  if (overallScore >= 80) {
    if (majorRisk || screeningUncertain) {
      return { recommendation: 'review', reviewKind: 'review_risk' };
    }
    return { recommendation: 'proceed', reviewKind: undefined };
  }

  const reviewKind: PrescreenReviewKind =
    majorRisk || screeningUncertain ? 'review_risk' : 'review_quality';
  return { recommendation: 'review', reviewKind };
}

function buildRecruiterSummaryLine(
  overallScore: number,
  recommendation: AiPrescreenScoreResult['recommendation'],
  flags: string[],
  reviewKind: PrescreenReviewKind | undefined,
): string {
  const majorRisk = flags.includes('drug_risk') || flags.includes('background_risk');
  const unknown = flags.includes('drug_unknown') || flags.includes('background_unknown');
  const vagueQ = flags.includes('vague_response') || flags.includes('low_effort_response');
  const limited = flags.includes('limited_relevant_experience');
  const att = flags.includes('attendance_risk');
  const trans = flags.includes('transportation_risk') || flags.includes('no_backup_transport');
  const physical = flags.includes('physical_mismatch');

  if (recommendation === 'proceed') {
    return 'Strong pre-screen; cleared for next-step consideration.';
  }
  if (recommendation === 'decline') {
    if (majorRisk) return 'Drug or background risk disclosure keeps the score in a no-go range.';
    if (unknown) return 'Screening unknowns pull the score below a confident proceed.';
    if (vagueQ) return 'Thin or vague answers hold the score below the proceed bar.';
    return 'Overall score is below the proceed threshold.';
  }

  if (reviewKind === 'review_risk') {
    if (majorRisk) return 'Strong overall, but drug or background answers need recruiter review.';
    if (unknown) return 'Solid score; confirm drug or background screening before proceeding.';
    return 'Screening flags warrant review despite a workable score.';
  }

  const parts: string[] = [];
  if (overallScore < 70) parts.push('Weaker pre-screen band');
  else parts.push('Borderline pre-screen');
  const detail: string[] = [];
  if (vagueQ) detail.push('vague or low-effort responses');
  if (limited) detail.push('limited relevant experience');
  if (att || trans) detail.push('attendance or transportation concerns');
  if (physical) detail.push('possible physical-fit limits');
  if (detail.length > 0) {
    return `${parts[0]} — ${detail.join('; ')}.`;
  }
  return `${parts[0]} — worth a quick recruiter pass on fit and details.`;
}

/**
 * Score from submitted answers (validated keys/values expected upstream).
 * Unknown enum values are scored conservatively (no throw).
 */
export function scoreWorkerAiPrescreen(
  answers: WorkerAiPrescreenAnswers,
  opts?: {
    answerQualityFlags?: string[];
    scoreAdjustment?: number;
    drugBackgroundMergeMeta?: DrugBackgroundScoringMeta;
    /** Extra signals that participate in flag penalties (e.g. risk_admission_detected). */
    extraPenaltyFlags?: string[];
  },
): AiPrescreenScoreResult {
  const exp = scoreExperience(answers);
  const rel = scoreReliability(answers);
  const trans = scoreTransportation(answers);
  const risk = scoreRisk(answers, opts?.drugBackgroundMergeMeta);
  const phys = scorePhysical(answers);

  const flagSet = [
    ...exp.flags,
    ...rel.flags,
    ...trans.flags,
    ...risk.flags,
    ...phys.flags,
    ...(opts?.answerQualityFlags ?? []),
    ...(opts?.extraPenaltyFlags ?? []),
  ];
  const flags = [...new Set(flagSet)];

  const subScoreSum = exp.pts + rel.pts + trans.pts + risk.pts + phys.pts;
  const qualityAdjustment = opts?.scoreAdjustment ?? 0;
  const baseScoreBeforePenalties = Math.max(0, Math.min(100, Math.round(subScoreSum + qualityAdjustment)));
  const penaltyBlock = applyFlagPenalties(baseScoreBeforePenalties, flags);
  const overallScore = applyRecruiterTrustScoreCaps(penaltyBlock.finalScore, flags);

  const { recommendation, reviewKind } = recommendationFromScoreAndFlags(overallScore, flags);
  const summary = buildRecruiterSummaryLine(overallScore, recommendation, flags, reviewKind);

  const scoreBreakdown: PrescreenScoreBreakdown = {
    subScoreSum,
    qualityAdjustment,
    baseScoreBeforePenalties: penaltyBlock.baseScoreBeforePenalties,
    flagPenalties: penaltyBlock.flagPenalties,
    flagPenaltyTotalRaw: penaltyBlock.flagPenaltyTotalRaw,
    flagPenaltyTotalApplied: penaltyBlock.flagPenaltyTotalApplied,
    finalScore: overallScore,
  };

  return {
    overallScore,
    recommendation,
    reviewKind,
    flags,
    summary,
    subScores: {
      experience: exp.pts,
      reliability: rel.pts,
      transportation: trans.pts,
      risk: risk.pts,
      physical: phys.pts,
    },
    scoreBreakdown,
  };
}

/** @deprecated Use AiPrescreenScoreResult */
export type WorkerAiPrescreenScoreResult = AiPrescreenScoreResult;
