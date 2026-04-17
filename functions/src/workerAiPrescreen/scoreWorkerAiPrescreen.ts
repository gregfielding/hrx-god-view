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
export type AiPrescreenScoreResult = {
  overallScore: number;
  recommendation: 'proceed' | 'review' | 'decline';
  flags: string[];
  summary: string;
  subScores: {
    experience: number;
    reliability: number;
    transportation: number;
    risk: number;
    physical: number;
  };
};

const MAJOR_COMPLIANCE_FLAGS = new Set(['drug_risk', 'background_risk']);
/** Blocks `proceed` (spec §5 + §6 major flags). */
const MAJOR_HARD_FLAGS_FOR_PROCEED = new Set(['drug_risk', 'background_risk', 'physical_mismatch']);
const MODERATE_FLAGS = new Set([
  'attendance_risk',
  'transportation_risk',
  'no_backup_transport',
  'limited_relevant_experience',
  'drug_unknown',
  'background_unknown',
  'low_effort_response',
  'vague_response',
]);

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

function hasModerateFlag(flags: string[]): boolean {
  return flags.some((f) => MODERATE_FLAGS.has(f));
}

function hasMajorComplianceFlag(flags: string[]): boolean {
  return flags.some((f) => MAJOR_COMPLIANCE_FLAGS.has(f));
}

function blocksProceed(flags: string[]): boolean {
  return flags.some((f) => MAJOR_HARD_FLAGS_FOR_PROCEED.has(f)) || hasModerateFlag(flags);
}

function recommendationFromScoreAndFlags(overallScore: number, flags: string[]): AiPrescreenScoreResult['recommendation'] {
  if (hasMajorComplianceFlag(flags) || overallScore < 50) return 'decline';
  if (overallScore >= 75 && !blocksProceed(flags)) return 'proceed';
  return 'review';
}

function buildSummary(
  recommendation: AiPrescreenScoreResult['recommendation'],
  flags: string[],
): string {
  const hasDrug = flags.includes('drug_risk') || flags.includes('drug_unknown');
  const hasBg = flags.includes('background_risk') || flags.includes('background_unknown');
  const hasAtt = flags.includes('attendance_risk');
  const hasTrans = flags.includes('transportation_risk') || flags.includes('no_backup_transport');
  const hasLimited = flags.includes('limited_relevant_experience');
  const hasPhysical = flags.includes('physical_mismatch');

  if (recommendation === 'proceed') {
    return (
      'Candidate reports relevant experience, no attendance issues, and a reliable transportation plan. ' +
      'No major compliance risks were identified.'
    );
  }
  if (recommendation === 'decline') {
    if (hasDrug || hasBg) {
      return (
        'Compliance screening answers indicate uncertainty or an issue that may affect placement. ' +
        'Review before moving forward.'
      );
    }
    return (
      'Overall pre-screen score is below the threshold for proceeding without recruiter review. ' +
      'Assess fit carefully before moving forward.'
    );
  }
  // review
  if (hasAtt || hasTrans || hasLimited) {
    return (
      'Candidate appears generally placeable, but there are moderate concerns around transportation or prior attendance. ' +
      'Recruiter review is recommended.'
    );
  }
  if (hasPhysical) {
    return (
      'Candidate may have a physical-fit consideration for some roles. Recruiter review is recommended ' +
      'to confirm job match.'
    );
  }
  if (hasDrug || hasBg) {
    return 'Drug/background answers are uncertain or indicate a possible issue. Recruiter review is recommended.';
  }
  return 'Pre-screen results are borderline; recruiter review is recommended before the next step.';
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
  ];
  const flags = [...new Set(flagSet)];

  let overallScore =
    exp.pts + rel.pts + trans.pts + risk.pts + phys.pts + (opts?.scoreAdjustment ?? 0);
  overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));

  const recommendation = recommendationFromScoreAndFlags(overallScore, flags);
  const summary = buildSummary(recommendation, flags);

  return {
    overallScore,
    recommendation,
    flags,
    summary,
    subScores: {
      experience: exp.pts,
      reliability: rel.pts,
      transportation: trans.pts,
      risk: risk.pts,
      physical: phys.pts,
    },
  };
}

/** @deprecated Use AiPrescreenScoreResult */
export type WorkerAiPrescreenScoreResult = AiPrescreenScoreResult;
