/**
 * Canonical order for interview / qualification **dimension** bars (UI only).
 *
 * Order is intentionally risk-first.
 * Do not reorder without product decision.
 */

import type { NormalizedQualificationScores } from './normalizeQualificationScores';

export const QUALIFICATION_DISPLAY_ORDER = [
  'risk',
  'reliability',
  'transportation',
  'experience',
  'physical',
] as const;

export type QualificationDisplayDimension = (typeof QUALIFICATION_DISPLAY_ORDER)[number];

/** Short labels for compact rows; Physical clarifies non-primary signal for recruiters. */
export const QUALIFICATION_DISPLAY_LABEL: Record<QualificationDisplayDimension, string> = {
  risk: 'Risk / screening',
  reliability: 'Reliability',
  transportation: 'Transportation',
  experience: 'Experience',
  physical: 'Physical (non-blocking)',
};

/** Map display dimension → keys on {@link NormalizedQualificationScores} (transportation → transport). */
export function qualificationNormalizedPercent(
  normalized: NormalizedQualificationScores,
  dim: QualificationDisplayDimension,
): number {
  if (dim === 'transportation') return normalized.transport;
  return normalized[dim];
}
