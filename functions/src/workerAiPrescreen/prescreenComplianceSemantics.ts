/**
 * Drug / background prescreen answers — canonical semantics for scoring and risk.
 *
 * Questions (worker-facing):
 * - "Are you able to complete/pass a drug screen?"
 * - "Are you able to pass/complete a background check?"
 *
 * Stored values: yes | no | not_sure
 *
 * - yes   → worker reports they CAN pass / complete → LOW compliance concern
 * - no    → HIGH concern (may not pass / something would show up)
 * - not_sure → MEDIUM concern
 */

export type DrugBackgroundAnswer = 'yes' | 'no' | 'not_sure' | 'unknown';

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
 * Contribution to aggregate compliance risk (0 = best, 1 = worst).
 * Aligns with interview enrichment `complianceRisk` averaging.
 */
export function complianceRiskFactorForDrugBackground(answer: DrugBackgroundAnswer): number {
  switch (answer) {
    case 'yes':
      return 0.08;
    case 'not_sure':
    case 'unknown':
      return 0.48;
    case 'no':
      return 0.92;
    default:
      return 0.48;
  }
}
