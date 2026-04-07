/**
 * Cross-entity **assignment** readiness signals for a future global worker banner
 * (e.g. “Not ready for upcoming assignments”).
 *
 * Employment tab intentionally stays relationship-only; consume this from Overview / dashboard / shell — not from Employment V2.
 */

import type { EmploymentEntityKey, EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS } from './employmentEntityPresentation';
import { blockingAssignmentRequirementLines } from './assignmentRequirementsViewModel';

export type GlobalAssignmentReadinessSignals = {
  /** Deduplicated-style lines suitable for a compact banner list. */
  blockingLines: string[];
  /** Entity tabs that have at least one assignment-package blocker line on the primary VM. */
  entityTabsWithAssignmentBlockers: number;
  hasAnyAssignmentBlockers: boolean;
};

const MAX_LINES = 24;

/**
 * Aggregates assignment-package blockers from each entity tab’s `assignmentRequirementsViewModel`
 * (same source previously used on the Employment worker banner before assignment UI moved to Assignments tab).
 */
export function buildGlobalAssignmentReadinessSignals(
  byEntityKey: Record<EmploymentEntityKey, EmploymentEntityOverview>
): GlobalAssignmentReadinessSignals {
  const lines: string[] = [];
  let entityTabsWithAssignmentBlockers = 0;

  EMPLOYMENT_ENTITY_KEYS.forEach((ek) => {
    const o = byEntityKey[ek];
    const blocks = blockingAssignmentRequirementLines(o.assignmentRequirementsViewModel);
    if (blocks.length === 0) return;
    entityTabsWithAssignmentBlockers += 1;
    const entityTitle = o.headerEntityName?.trim() || ek;
    blocks.forEach((b) => {
      lines.push(`${entityTitle} — ${b.title} (${b.statusLabel})`);
    });
  });

  return {
    blockingLines: lines.slice(0, MAX_LINES),
    entityTabsWithAssignmentBlockers,
    hasAnyAssignmentBlockers: lines.length > 0,
  };
}
