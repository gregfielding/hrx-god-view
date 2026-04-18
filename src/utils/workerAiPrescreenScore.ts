/**
 * Rules-based worker AI pre-screen scoring (client mirror for tests / previews).
 * **Keep in sync** with `functions/src/workerAiPrescreen/scoreWorkerAiPrescreen.ts`.
 */

import { prescreenTextHasConcreteDetail } from '../shared/prescreenAnswerQuality';
import {
  complianceConcernLevel,
  type ComplianceQuestionFraming,
} from './prescreenComplianceSemantics';
import {
  classifyBackgroundRiskSeverity,
  classifyDrugRiskSeverity,
  drugSeverityPenaltyFlag,
  backgroundSeverityPenaltyFlag,
  hasAnyDrugBgScreeningFlag,
  hasDrugBgComplianceReview,
  type PrescreenRiskSummary,
  type PrescreenRiskSummaryEntry,
} from './prescreenRiskSeverity';
import {
  computePrescreenReviewTriage,
  flagsOnlyLowDrugBackgroundSeverity,
  hasHighScoreReviewDrivers,
  type PrescreenReviewTriage,
} from './prescreenReviewTriage';

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
  /** Optional follow-up: misdemeanor vs felony (improves severity routing when present). */
  background_offense_class?: string;
  /** Optional follow-up: year or free-text time reference. */
  background_offense_when?: string;
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
  /** Drug/background severity + plain-language reasons (recruiter explainability). */
  riskSummary?: PrescreenRiskSummary;
  /** Present when `recommendation === 'review'` — structured triage (lane, subtype, reasons). */
  reviewTriage?: PrescreenReviewTriage;
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
  riskSummary?: PrescreenRiskSummary;
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
 * Drug/background use severity tiers (not flat “risk = max penalty”).
 */
const FLAG_SCORE_PENALTIES: Record<string, number> = {
  drug_risk_low: 3,
  drug_risk_moderate: 8,
  drug_risk_high: 32,
  background_risk_low: 3,
  background_risk_moderate: 8,
  background_risk_high: 32,
  drug_unknown: 5,
  background_unknown: 5,
  attendance_risk: 12,
  transportation_risk: 7,
  no_backup_transport: 6,
  limited_relevant_experience: 12,
  physical_mismatch: 20,
  /** Only used for attendance admissions — no stack with drug/bg severity (see compose bundle). */
  risk_admission_detected: 8,
  /** Narrative quality (also emitted by `evaluatePrescreenAnswerQuality`; penalties stack for multiple issues). */
  vague_response: 5,
  low_effort_response: 10,
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
 * Risk sub-score + severity-based compliance flags.
 * Uses disclosure vs ability framing via {@link DrugBackgroundScoringMeta}.
 */
function scoreRiskHalf(
  raw: unknown,
  detailText: string,
  source: 'core' | 'dynamic' | 'none',
  kind: 'drug' | 'background',
  answers: WorkerAiPrescreenAnswers,
): { pts: number; flags: string[]; summary: PrescreenRiskSummaryEntry } {
  const unknownFlag = kind === 'drug' ? 'drug_unknown' : 'background_unknown';
  if (source === 'none') {
    return {
      pts: 5,
      flags: [unknownFlag],
      summary: {
        level: 'unknown',
        reason: 'Question not shown for this path; screening classification unknown.',
      },
    };
  }
  const framing: ComplianceQuestionFraming = source === 'dynamic' ? 'ability' : 'disclosure';
  const concernLevel = complianceConcernLevel(raw, framing);
  if (concernLevel === 'clean') {
    return {
      pts: 10,
      flags: [],
      summary:
        kind === 'drug'
          ? { level: 'low', reason: 'Screening answer indicates no drug-related disclosure concern.' }
          : { level: 'low', reason: 'Screening answer indicates no background disclosure concern.' },
    };
  }
  if (concernLevel === 'uncertain' || concernLevel === 'empty') {
    return {
      pts: 5,
      flags: [unknownFlag],
      summary:
        kind === 'drug'
          ? classifyDrugRiskSeverity({ concernLevel, detailText })
          : classifyBackgroundRiskSeverity({ concernLevel, detailText }),
    };
  }

  const classified =
    kind === 'drug'
      ? classifyDrugRiskSeverity({ concernLevel, detailText })
      : classifyBackgroundRiskSeverity({
          concernLevel,
          detailText,
          offenseClass: answers.background_offense_class,
          offenseYear: answers.background_offense_when,
        });
  const penaltyFlag =
    kind === 'drug' ? drugSeverityPenaltyFlag(classified.level) : backgroundSeverityPenaltyFlag(classified.level);
  const flags: string[] = [];
  if (penaltyFlag) flags.push(penaltyFlag);

  let pts = 0;
  switch (classified.level) {
    case 'low':
      pts = 6;
      break;
    case 'moderate':
      pts = 3;
      break;
    case 'high':
      pts = 0;
      break;
    case 'unknown':
    default:
      pts = 5;
      break;
  }

  return { pts, flags, summary: classified };
}

function scoreRisk(
  answers: WorkerAiPrescreenAnswers,
  meta?: DrugBackgroundScoringMeta,
): {
  pts: number;
  flags: string[];
  riskSummary: PrescreenRiskSummary;
} {
  const drugSrc = meta?.drugSource ?? 'core';
  const bgSrc = meta?.backgroundSource ?? 'core';

  const drugHalf = scoreRiskHalf(
    answers.drug_screen,
    norm(answers.drug_screen_detail),
    drugSrc,
    'drug',
    answers,
  );
  const bgHalf = scoreRiskHalf(
    answers.background_check,
    norm(answers.background_check_detail),
    bgSrc,
    'background',
    answers,
  );

  const pts = Math.min(20, drugHalf.pts + bgHalf.pts);
  const flags = [...drugHalf.flags, ...bgHalf.flags];
  const riskSummary: PrescreenRiskSummary = { drug: drugHalf.summary, background: bgHalf.summary };
  return { pts, flags, riskSummary };
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
 * Only **high** drug/background severity gets a hard ceiling; low/moderate/unknown use lighter caps.
 */
function applyRecruiterTrustScoreCaps(score: number, flags: string[]): number {
  let s = score;
  const highRisk = flags.includes('drug_risk_high') || flags.includes('background_risk_high');
  const moderateRisk = flags.includes('drug_risk_moderate') || flags.includes('background_risk_moderate');
  const screeningUnknown = flags.includes('drug_unknown') || flags.includes('background_unknown');
  if (highRisk) {
    s = Math.min(s, 65);
  } else if (moderateRisk) {
    s = Math.min(s, 88);
  } else if (screeningUnknown) {
    s = Math.min(s, 84);
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Recommendation follows recruiter grade bands (score already includes penalties + trust caps).
 * Drug/bg never force decline by themselves — only numeric band + review routing.
 *
 * **80+ with only low-severity drug/bg disclosures** (no unknown, elevated, attendance, physical, quality, transport)
 * → **proceed** — minor disclosures alone are not a high-review catch-all.
 */
function recommendationFromScoreAndFlags(
  overallScore: number,
  flags: string[],
): { recommendation: AiPrescreenScoreResult['recommendation']; reviewKind: PrescreenReviewKind | undefined } {
  const screeningUncertain = flags.includes('drug_unknown') || flags.includes('background_unknown');
  const anyDrugBg = hasAnyDrugBgScreeningFlag(flags);
  const complianceHeavy = hasDrugBgComplianceReview(flags);

  if (overallScore < 58) {
    return { recommendation: 'decline', reviewKind: undefined };
  }
  if (overallScore < 60) {
    const reviewKind: PrescreenReviewKind =
      complianceHeavy || screeningUncertain || anyDrugBg ? 'review_risk' : 'review_quality';
    return { recommendation: 'review', reviewKind };
  }

  if (overallScore >= 80) {
    /** Solely low-severity drug/bg disclosures, with no attendance/physical/quality/transport/unknown drivers. */
    const proceedLowComplianceOnly =
      flagsOnlyLowDrugBackgroundSeverity(flags) && !hasHighScoreReviewDrivers(flags);
    if (proceedLowComplianceOnly) {
      return { recommendation: 'proceed', reviewKind: undefined };
    }
    if (hasHighScoreReviewDrivers(flags) || anyDrugBg || screeningUncertain) {
      return { recommendation: 'review', reviewKind: 'review_risk' };
    }
    return { recommendation: 'proceed', reviewKind: undefined };
  }

  const reviewKind: PrescreenReviewKind =
    complianceHeavy || screeningUncertain || anyDrugBg ? 'review_risk' : 'review_quality';
  return { recommendation: 'review', reviewKind };
}

function buildRecruiterSummaryLine(
  overallScore: number,
  recommendation: AiPrescreenScoreResult['recommendation'],
  flags: string[],
  reviewKind: PrescreenReviewKind | undefined,
): string {
  const highRx = flags.includes('drug_risk_high') || flags.includes('background_risk_high');
  const modRx = flags.includes('drug_risk_moderate') || flags.includes('background_risk_moderate');
  const lowRx = flags.includes('drug_risk_low') || flags.includes('background_risk_low');
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
    if (highRx) return 'Score band is below threshold with high-severity screening signals.';
    if (modRx) return 'Score band is below threshold; moderate compliance signals — recruiter judgment if policy allows.';
    if (lowRx) return 'Overall score is below the proceed threshold (minor screening signals may still be present).';
    if (unknown) return 'Screening unknowns pull the score below a confident proceed.';
    if (vagueQ) return 'Thin or vague answers hold the score below the proceed bar.';
    return 'Overall score is below the proceed threshold.';
  }

  if (reviewKind === 'review_risk') {
    if (highRx) return 'Elevated drug or background signals — recruiter review recommended.';
    if (modRx) return 'Moderate compliance concern — recruiter review recommended.';
    if (lowRx) return 'Minor screening disclosures present — quick recruiter confirmation recommended.';
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
  const reviewTriage =
    recommendation === 'review'
      ? computePrescreenReviewTriage({
          overallScore,
          flags,
          reviewKind,
          riskSummary: risk.riskSummary,
        })
      : undefined;
  const summary =
    recommendation === 'review' && reviewTriage
      ? reviewTriage.summaryShort
      : buildRecruiterSummaryLine(overallScore, recommendation, flags, reviewKind);

  const scoreBreakdown: PrescreenScoreBreakdown = {
    subScoreSum,
    qualityAdjustment,
    baseScoreBeforePenalties: penaltyBlock.baseScoreBeforePenalties,
    flagPenalties: penaltyBlock.flagPenalties,
    flagPenaltyTotalRaw: penaltyBlock.flagPenaltyTotalRaw,
    flagPenaltyTotalApplied: penaltyBlock.flagPenaltyTotalApplied,
    finalScore: overallScore,
    riskSummary: risk.riskSummary,
  };

  return {
    overallScore,
    recommendation,
    reviewKind,
    flags,
    summary,
    riskSummary: risk.riskSummary,
    reviewTriage,
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
