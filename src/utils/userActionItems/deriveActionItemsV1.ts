import type { ActionItem } from '../../types/actionItems';
import type { ActionItemsV1Input } from './actionItemsV1Input';
import { dedupeActionItems, sortActionItemsForDisplay } from './dedupeAndPrecedence';
import {
  runApplicationsAssignmentsRules,
  runComplianceRules,
  runEntityOnboardingRules,
  runProfileRules,
  runWatchoutRules,
} from './rules';

export type { ActionItemsV1Input } from './actionItemsV1Input';

/**
 * Pure derivation of Action Items v1 — no I/O.
 */
export function deriveActionItemsV1(input: ActionItemsV1Input): ActionItem[] {
  if (!input.enabled) return [];

  const combined: ActionItem[] = [
    ...runProfileRules(input),
    ...runEntityOnboardingRules(input),
    ...runComplianceRules(input),
    ...runApplicationsAssignmentsRules(input),
    ...runWatchoutRules(input),
  ];

  const deduped = dedupeActionItems(combined);
  return sortActionItemsForDisplay(deduped);
}
