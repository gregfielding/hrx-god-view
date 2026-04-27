/**
 * Client mirror of `functions/.../prescreenComplianceSemantics.ts` — keep drug/bg interpretation aligned.
 */

export type DrugBackgroundAnswer = 'yes' | 'no' | 'not_sure' | 'unknown';

export type ComplianceQuestionFraming = 'disclosure' | 'ability';

export type ComplianceConcernLevel = 'clean' | 'concern' | 'uncertain' | 'empty';

export function normalizeDrugBackgroundAnswer(raw: unknown): DrugBackgroundAnswer {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (s === 'yes' || s === 'y' || s === 'true') return 'yes';
  if (s === 'no' || s === 'n' || s === 'false') return 'no';
  if (s === 'not_sure' || s === 'unsure' || s === 'maybe') return 'not_sure';
  return 'unknown';
}

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

export type DrugBackgroundScoringMeta = {
  drugSource: 'core' | 'dynamic' | 'none';
  backgroundSource: 'core' | 'dynamic' | 'none';
};
