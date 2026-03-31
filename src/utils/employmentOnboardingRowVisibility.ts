/**
 * Worker vs admin visibility for Employment V2 onboarding path rows.
 * Admin UI shows all rows; worker UI should filter with these helpers.
 */

import type {
  EmploymentOnboardingRow,
  OnboardingPathGroup,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowBlocker, isOnboardingPathRowDone } from './employmentOnboardingPath';

/** Workers see `both` and `worker` audience rows; not `admin`-only or `internal`. */
export function isEmploymentOnboardingRowVisibleToWorker(row: EmploymentOnboardingRow): boolean {
  return row.audience === 'both' || row.audience === 'worker';
}

/** Recruiter/admin path: show everything (explicit for callers). */
export function isEmploymentOnboardingRowVisibleToAdmin(_row: EmploymentOnboardingRow): boolean {
  return true;
}

/**
 * Visibility filter for worker-facing path. TempWorks labels use `pathLabelAudience: 'worker'` on
 * `buildOnboardingPathFromSettings` (see `employmentOnboardingPathAudienceLabels`).
 */
export function filterOnboardingPathGroupsForWorkerUi(groups: OnboardingPathGroup[]): OnboardingPathGroup[] {
  return groups
    .map((g) => ({
      ...g,
      rows: g.rows.filter(isEmploymentOnboardingRowVisibleToWorker),
    }))
    .map((g) => ({
      ...g,
      totalCount: g.rows.length,
      doneCount: g.rows.filter((r) => isOnboardingPathRowDone(r.status)).length,
      blockerCount: g.rows.filter(isOnboardingPathRowBlocker).length,
    }))
    .filter((g) => g.rows.length > 0);
}
