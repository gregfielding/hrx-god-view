/**
 * Qualitative text evaluation for worker AI prescreen.
 * **Keep in sync** with `functions/src/workerAiPrescreen/prescreenTextAnswerQuality.ts`.
 */

/** Minimal shape for quality checks (no import from scoring — avoids circular deps). */
export type PrescreenAnswersForQuality = {
  motivation?: string;
  experience_details?: string;
  pressure_situation?: string;
  supervisor_feedback?: string;
  attendance_issues?: string;
  attendance_explanation?: string;
  additional_notes?: string;
};

/** Middle of the 8–10 word guidance. */
export const PRESCREEN_MIN_SUBSTANTIVE_WORDS = 9;

export type AnswerQualityTier = 'low' | 'medium' | 'high';

export type InterviewAnswerQualityStored = {
  motivation: AnswerQualityTier;
  experience: AnswerQualityTier;
  communication: AnswerQualityTier;
};

export type PrescreenAnswerQualityResult = {
  answerQuality: InterviewAnswerQualityStored;
  /** Qualitative flags (merged into interview `ai.flags`). */
  flags: string[];
  /** Applied to rules-based overall score after sub-score sum (clamped with overall 0–100). */
  scoreAdjustment: number;
};

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Enough concrete detail (company/role/duration/tasks). */
export function prescreenTextHasConcreteDetail(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (/\d{4}/.test(t)) return true;
  if (/\b\d+\s*(months?|years?|weeks?|days?|hours?|yrs?|mos?|hrs?)\b/i.test(t)) return true;
  if (/\d/.test(t) && /\b(year|month|week|day|hour|shift|deadline)\b/i.test(t)) return true;
  if (
    /\b(warehouse|retail|restaurant|hospital|clinic|office|delivery|construction|manufacturing|customer|employer|company|store|team|supervisor|manager)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(worked|responsible|managed|trained|delivered|handled|completed|deadline|pressure|rush|busy)\b/i.test(t)) {
    return true;
  }
  if (/\bat\s+[A-Z][a-zA-Z]{2,}/.test(t)) return true;
  return false;
}

function specificityScore(text: string): number {
  const t = text.trim();
  let n = 0;
  if (prescreenTextHasConcreteDetail(t)) n += 0.42;
  if (/\b(my|our|team|shift|role|position|job)\b/i.test(t)) n += 0.12;
  if (/\b\d+\s*(month|year|week|day)s?\b/i.test(t) || /\d{4}/.test(t)) n += 0.22;
  if (/\bat\s+[A-Z]/i.test(t)) n += 0.14;
  if (/\b(task|duty|responsibilit|customer|inventory|load|unload|stock)\b/i.test(t)) n += 0.1;
  return Math.min(1, n);
}

function lengthNorm(wc: number, target: number): number {
  return Math.min(1, wc / target);
}

function clarityScore(text: string): number {
  const t = text.trim();
  if (t.length < 8) return 0.12;
  const sentences = t.split(/[.!?]+/).filter((x) => x.trim().length > 6);
  const multi = sentences.length >= 2 ? 0.38 : 0.18;
  const filler = (t.match(/\b(very|just|like|um|uh|stuff|things)\b/gi) || []).length;
  const fillerPenalty = Math.min(0.22, filler * 0.06);
  return Math.max(0.12, Math.min(0.92, 0.42 + multi - fillerPenalty));
}

function motivationComposite(text: string): number {
  const wc = wordCount(text);
  const ln = lengthNorm(wc, 34);
  const spec = specificityScore(text);
  const clar = clarityScore(text);
  return 0.34 * ln + 0.36 * spec + 0.3 * clar;
}

function experienceComposite(text: string): number {
  const wc = wordCount(text);
  const ln = lengthNorm(wc, 48);
  const spec = Math.min(1, specificityScore(text) + (prescreenTextHasConcreteDetail(text) ? 0.08 : 0));
  const clar = clarityScore(text);
  return 0.28 * ln + 0.48 * spec + 0.24 * clar;
}

function narrativeComposite(text: string): number {
  const wc = wordCount(text);
  const ln = lengthNorm(wc, 40);
  const spec = specificityScore(text);
  const clar = clarityScore(text);
  return 0.3 * ln + 0.45 * spec + 0.25 * clar;
}

function tierFromComposite(s: number): AnswerQualityTier {
  if (s < 0.4) return 'low';
  if (s < 0.68) return 'medium';
  return 'high';
}

const MAX_QUALITY_PENALTY = 18;
const MAX_QUALITY_BOOST = 10;

export function evaluatePrescreenAnswerQuality(answers: PrescreenAnswersForQuality): PrescreenAnswerQualityResult {
  const motivation = String(answers.motivation ?? '');
  const experience = String(answers.experience_details ?? '');
  const pressure = String(answers.pressure_situation ?? '');
  const supervisor = String(answers.supervisor_feedback ?? '');

  const motivationTier = tierFromComposite(motivationComposite(motivation));
  const experienceTier = tierFromComposite(experienceComposite(experience));
  const communicationTier = tierFromComposite(
    (narrativeComposite(pressure) + narrativeComposite(supervisor)) / 2,
  );

  const flagSet = new Set<string>();

  const short = (s: string) => wordCount(s) < PRESCREEN_MIN_SUBSTANTIVE_WORDS;
  /** Core narrative fields only — require ≥2 short before global low_effort (reduces single-field false positives). */
  const coreNarratives = [motivation, experience, pressure, supervisor];
  const coreShortCount = coreNarratives.filter((s) => short(s)).length;
  if (coreShortCount >= 2) {
    flagSet.add('low_effort_response');
  }

  const vagueOk = (s: string) =>
    wordCount(s) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS && !prescreenTextHasConcreteDetail(s);
  const coreVagueCount = coreNarratives.filter((s) => vagueOk(s)).length;
  /** Require ≥3 thin narrative fields before global `vague_response` (reduces false positives). */
  if (coreVagueCount >= 3) {
    flagSet.add('vague_response');
  }

  const hasLowEffort = flagSet.has('low_effort_response');

  if (
    !hasLowEffort &&
    motivationTier !== 'low' &&
    experienceTier !== 'low' &&
    (motivationTier === 'high' || experienceTier === 'high')
  ) {
    flagSet.add('strong_candidate_signal');
  }

  if (
    !hasLowEffort &&
    !flagSet.has('vague_response') &&
    motivationTier === 'high' &&
    experienceTier === 'high' &&
    prescreenTextHasConcreteDetail(pressure) &&
    wordCount(supervisor) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS
  ) {
    flagSet.add('high_confidence_candidate');
  }

  const flags = [...flagSet];

  let scoreAdjustment = 0;
  /** `vague_response` / `low_effort_response` use flag penalties in `scoreWorkerAiPrescreen` (avoid double-counting). */
  if (flags.includes('strong_candidate_signal')) scoreAdjustment += 5;
  if (flags.includes('high_confidence_candidate')) scoreAdjustment += 4;
  scoreAdjustment = Math.max(-MAX_QUALITY_PENALTY, Math.min(MAX_QUALITY_BOOST, scoreAdjustment));

  return {
    answerQuality: {
      motivation: motivationTier,
      experience: experienceTier,
      communication: communicationTier,
    },
    flags,
    scoreAdjustment,
  };
}

export function collectPrescreenAnswerQualityFlags(answers: PrescreenAnswersForQuality): string[] {
  return evaluatePrescreenAnswerQuality(answers).flags;
}
