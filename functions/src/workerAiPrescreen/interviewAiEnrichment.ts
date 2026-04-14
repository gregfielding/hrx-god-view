/**
 * Derived fields for `users/{uid}/interviews/*` → `ai` block (future AI / analytics).
 */

import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import type { AnswerQualityTier, InterviewAnswerQualityStored } from './prescreenTextAnswerQuality';
import {
  complianceRiskFactorForDrugBackground,
  normalizeDrugBackgroundAnswer,
  type DrugBackgroundAnswer,
} from './prescreenComplianceSemantics';
import type { MergeDrugBackgroundMeta } from './prescreenAnswerMerge';

export type InterviewRiskProfile = {
  /** 0 = minimal concern, 1 = high concern (normalized). */
  complianceRisk: number;
  attendanceRisk: number;
  transportationRisk: number;
};

function normLower(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Compliance: drug + background (yes = low risk, no = high risk, not_sure = medium).
 */
export function computeComplianceRisk(answers: WorkerAiPrescreenAnswers): number {
  const drug = normalizeDrugBackgroundAnswer(answers.drug_screen);
  const bg = normalizeDrugBackgroundAnswer(answers.background_check);
  const drugR = complianceRiskFactorForDrugBackground(drug);
  const bgR = complianceRiskFactorForDrugBackground(bg);
  return Math.min(1, (drugR + bgR) / 2);
}

export function computeAttendanceRisk(answers: WorkerAiPrescreenAnswers): number {
  return normLower(answers.attendance_issues) === 'yes' ? 0.78 : 0.08;
}

/**
 * Transportation reliability + backup (aligned with rule sub-score signals).
 */
export function computeTransportationRisk(answers: WorkerAiPrescreenAnswers): number {
  const plan = normLower(answers.transportation_plan);
  const backup = normLower(answers.backup_transportation);

  let planR = 0.38;
  if (plan === 'own_vehicle') planR = 0.1;
  else if (plan === 'ride_from_someone_else') planR = 0.22;
  else if (plan === 'public_transportation') planR = 0.28;
  else if (plan === 'walk_bike') planR = 0.25;
  else if (plan === 'not_sure_yet') planR = 0.68;

  const backupR = backup === 'yes' ? 0.1 : backup === 'no' ? 0.52 : 0.28;
  return Math.min(1, planR * 0.62 + backupR * 0.38);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeRiskProfile(answers: WorkerAiPrescreenAnswers): InterviewRiskProfile {
  return {
    complianceRisk: round3(computeComplianceRisk(answers)),
    attendanceRisk: round3(computeAttendanceRisk(answers)),
    transportationRisk: round3(computeTransportationRisk(answers)),
  };
}

function tierToNum(t: AnswerQualityTier): number {
  if (t === 'high') return 1;
  if (t === 'medium') return 0.55;
  return 0.22;
}

/**
 * Overall confidence in candidate reliability (0–1) from score, text tiers, risks, and flags.
 */
export function computeConfidenceScore(args: {
  overallScore: number;
  answerQuality: InterviewAnswerQualityStored;
  riskProfile: InterviewRiskProfile;
  flags: string[];
}): number {
  const { overallScore, answerQuality, riskProfile, flags } = args;
  const avgTier =
    (tierToNum(answerQuality.motivation) +
      tierToNum(answerQuality.experience) +
      tierToNum(answerQuality.communication)) /
    3;
  const avgRisk =
    (riskProfile.complianceRisk + riskProfile.attendanceRisk + riskProfile.transportationRisk) / 3;

  let c = 0.36 * (overallScore / 100) + 0.34 * avgTier + 0.3 * (1 - avgRisk);

  if (flags.includes('low_effort_response')) c -= 0.11;
  if (flags.includes('vague_response')) c -= 0.07;
  if (flags.includes('strong_candidate_signal')) c += 0.06;
  if (flags.includes('high_confidence_candidate')) c += 0.05;
  if (flags.includes('risk_admission_detected')) c -= 0.05;

  return Math.max(0, Math.min(1, Math.round(c * 1000) / 1000));
}

/**
 * Explicit “admission” for automation: disclosed attendance issues, or drug/bg **no** / **not_sure**.
 * `unknown` is treated via `drug_unknown` / `background_unknown` scores only — not double-counted here.
 */
export function shouldFlagRiskAdmission(answers: WorkerAiPrescreenAnswers): boolean {
  if (normLower(answers.attendance_issues) === 'yes') return true;
  const drug = normalizeDrugBackgroundAnswer(answers.drug_screen);
  const bg = normalizeDrugBackgroundAnswer(answers.background_check);
  if (drug === 'no' || drug === 'not_sure') return true;
  if (bg === 'no' || bg === 'not_sure') return true;
  return false;
}

export type PrescreenComplianceDebugV1 = {
  version: 2;
  rawAnswers: {
    drug: string;
    background: string;
    attendance: string;
  };
  normalizedAnswers: {
    drug: DrugBackgroundAnswer;
    background: DrugBackgroundAnswer;
    attendance: string;
  };
  complianceRiskInputs: {
    drugFactor: number;
    backgroundFactor: number;
    aggregateComplianceRisk: number;
    mergeSource?: MergeDrugBackgroundMeta;
  };
  triggeredFlags: string[];
};

/** Compact explainability for Firestore (`ai.debug`). */
export function buildPrescreenComplianceDebug(args: {
  answersEffective: WorkerAiPrescreenAnswers;
  mergeMeta?: MergeDrugBackgroundMeta;
  flags: string[];
  complianceRisk: number;
}): PrescreenComplianceDebugV1 {
  const { answersEffective, mergeMeta, flags, complianceRisk } = args;
  const drug = normalizeDrugBackgroundAnswer(answersEffective.drug_screen);
  const bg = normalizeDrugBackgroundAnswer(answersEffective.background_check);
  const att = normLower(answersEffective.attendance_issues);

  const drugFactor = complianceRiskFactorForDrugBackground(drug);
  const bgFactor = complianceRiskFactorForDrugBackground(bg);

  return {
    version: 2,
    rawAnswers: {
      drug: String(answersEffective.drug_screen ?? ''),
      background: String(answersEffective.background_check ?? ''),
      attendance: String(answersEffective.attendance_issues ?? ''),
    },
    normalizedAnswers: {
      drug,
      background: bg,
      attendance: att || '',
    },
    complianceRiskInputs: {
      drugFactor,
      backgroundFactor: bgFactor,
      aggregateComplianceRisk: complianceRisk,
      ...(mergeMeta ? { mergeSource: mergeMeta } : {}),
    },
    triggeredFlags: [...flags],
  };
}
