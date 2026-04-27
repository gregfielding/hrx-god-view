/**
 * Drug / background prescreen answers — stored as yes | no | not_sure.
 *
 * Two product framings (same tokens, different meaning):
 * - **disclosure** (core template): "Would anything show up?" → `no` = clean, `yes` = concern.
 * - **ability** (job dynamic `dyn_job_*`): "Are you able to complete?" → `yes` = clean, `no` = concern.
 *
 * Scoring and enrichment must use {@link complianceConcernLevel} with the correct framing.
 */

export type DrugBackgroundAnswer = 'yes' | 'no' | 'not_sure' | 'unknown';

/** How the yes/no options should be interpreted for compliance. */
export type ComplianceQuestionFraming = 'disclosure' | 'ability';

/** Normalized concern for scoring (independent of raw yes/no wording). */
export type ComplianceConcernLevel = 'clean' | 'concern' | 'uncertain' | 'empty';

/**
 * Canonical values: yes | no | not_sure (stored lowercased, often with underscores).
 * Also accepts booleans and common synonyms so valid affirmative answers are never `unknown`.
 */
export function normalizeDrugBackgroundAnswer(raw: unknown): DrugBackgroundAnswer {
  if (raw === true || raw === 1) return 'yes';
  if (raw === false || raw === 0) return 'no';

  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  if (s === '' || s === 'null' || s === 'undefined') return 'unknown';

  if (
    s === 'yes' ||
    s === 'y' ||
    s === 'true' ||
    s === '1' ||
    s === 'yeah' ||
    s === 'yep' ||
    s === 'yup'
  ) {
    return 'yes';
  }

  if (s === 'no' || s === 'n' || s === 'false' || s === '0' || s === 'nope') {
    return 'no';
  }

  if (
    s === 'not_sure' ||
    s === 'notsure' ||
    s === 'unsure' ||
    s === 'maybe' ||
    s === 'idk' ||
    s === 'dont_know'
  ) {
    return 'not_sure';
  }

  return 'unknown';
}

/**
 * Map raw answer + question framing → concern level.
 * - disclosure: yes = something to disclose, no = nothing to disclose.
 * - ability: yes = can pass, no = cannot / unwilling.
 */
export function complianceConcernLevel(
  raw: unknown,
  framing: ComplianceQuestionFraming,
): ComplianceConcernLevel {
  const n = normalizeDrugBackgroundAnswer(raw);
  if (n === 'unknown') return 'empty';
  if (n === 'not_sure') return 'uncertain';
  if (framing === 'disclosure') {
    if (n === 'no') return 'clean';
    if (n === 'yes') return 'concern';
  } else {
    if (n === 'yes') return 'clean';
    if (n === 'no') return 'concern';
  }
  return 'uncertain';
}

/** Risk factor 0–1 for enrichment / debug (0 = minimal concern). */
export function complianceRiskFactorFromConcern(level: ComplianceConcernLevel): number {
  switch (level) {
    case 'clean':
      return 0.08;
    case 'concern':
      return 0.92;
    case 'uncertain':
    case 'empty':
    default:
      return 0.48;
  }
}

