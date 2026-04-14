/**
 * Client mirror of `functions/.../prescreenComplianceSemantics.ts` — keep drug/bg interpretation aligned.
 */

export type DrugBackgroundAnswer = 'yes' | 'no' | 'not_sure' | 'unknown';

export function normalizeDrugBackgroundAnswer(raw: unknown): DrugBackgroundAnswer {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (s === 'yes') return 'yes';
  if (s === 'no') return 'no';
  if (s === 'not_sure') return 'not_sure';
  return 'unknown';
}
