import type { EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowBlocker } from './employmentOnboardingPath';
import { blockingAssignmentRequirementLines } from './assignmentRequirementsViewModel';

/**
 * Single “what to do next” line for the entity decision layer (Employment V2 header).
 */
export function deriveEntityEmploymentNextStepLine(overview: EmploymentEntityOverview): string | null {
  if (!overview.hasOpenOnboardingDemand) return null;

  const pending = overview.onboardingCompletionPendingItems?.[0];
  if (pending?.rowLabel?.trim()) {
    return pending.rowLabel.trim();
  }

  for (const g of overview.onboardingChecklistGroups ?? []) {
    for (const r of g.rows ?? []) {
      if (isOnboardingPathRowBlocker(r)) {
        const label = r.label?.trim();
        if (label) return label;
      }
    }
  }

  const assignLines = blockingAssignmentRequirementLines(overview.assignmentRequirementsViewModel);
  if (assignLines.length > 0) {
    const first = assignLines[0];
    return `${first.title} — ${first.statusLabel}`;
  }

  return null;
}
