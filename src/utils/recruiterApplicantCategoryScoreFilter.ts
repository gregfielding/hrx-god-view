/**
 * Client-side category score filter/sort for recruiter applicant rows (current profile first, then interview snapshot).
 */

import type { PrescreenCategoryScoresV1, PrescreenCategoryId } from '../types/prescreenCategoryScores';
import { averageCategoryScore, parsePrescreenCategoryScoresFromFirestore } from './parseRecruiterCategoryScores';

export type CategoryScoreFilterBasis = 'current' | 'snapshot' | 'none';

export type EffectiveCategoryScoresForRow = {
  scores: PrescreenCategoryScoresV1 | null;
  /** Which data was used for filter/sort for this row. */
  basis: CategoryScoreFilterBasis;
};

/**
 * Current profile scores from batch map when present; else interview snapshot on the application doc.
 */
export function getEffectiveCategoryScoresForApplicantRow(
  uid: string,
  applicationData: Record<string, unknown> | undefined | null,
  categoryScoresCurrentByUserId: Record<string, PrescreenCategoryScoresV1 | null | undefined>,
): EffectiveCategoryScoresForRow {
  const current = categoryScoresCurrentByUserId[uid];
  if (current) return { scores: current, basis: 'current' };
  const snap = parsePrescreenCategoryScoresFromFirestore(applicationData?.aiAutomation).scores;
  if (snap) return { scores: snap, basis: 'snapshot' };
  return { scores: null, basis: 'none' };
}

export const CATEGORY_SCORE_FILTER_THRESHOLDS = [50, 60, 70, 80] as const;

export function applicantPassesCategoryScoreFilters(
  uid: string,
  applicationData: Record<string, unknown> | undefined | null,
  categoryScoresCurrentByUserId: Record<string, PrescreenCategoryScoresV1 | null | undefined>,
  args: {
    minAvg: number | null;
    filterCategoryId: PrescreenCategoryId | null;
    filterCategoryMin: number | null;
  },
): boolean {
  const { minAvg, filterCategoryId, filterCategoryMin } = args;
  const hasAvg = minAvg != null;
  const hasCat = filterCategoryId != null && filterCategoryMin != null;
  if (!hasAvg && !hasCat) return true;

  const { scores } = getEffectiveCategoryScoresForApplicantRow(uid, applicationData, categoryScoresCurrentByUserId);
  if (!scores) return false;

  if (hasAvg && averageCategoryScore(scores) < minAvg!) return false;
  if (hasCat && scores[filterCategoryId!] < filterCategoryMin!) return false;
  return true;
}

/** Sort: higher scores first; missing effective scores last. */
export function compareApplicantsByCategoryScore(
  aVal: number | null,
  bVal: number | null,
  direction: 'asc' | 'desc',
): number {
  const aMiss = aVal == null || Number.isNaN(aVal);
  const bMiss = bVal == null || Number.isNaN(bVal);
  if (aMiss && bMiss) return 0;
  if (aMiss) return 1;
  if (bMiss) return -1;
  const diff = aVal! - bVal!;
  return direction === 'asc' ? diff : -diff;
}
