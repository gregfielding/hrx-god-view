/**
 * New York pay rule set.
 *
 * **Today (v1):** federal-mirror — weekly OT after 40h regular hours,
 * no daily OT, no DT, no penalties. NY has a "spread of hours"
 * provision (extra 1h pay if a single shift's spread exceeds 10
 * hours), but it applies only to workers paid at exact minimum wage.
 * For the temp/staffing population we serve, almost no workers hit
 * that exact threshold — we'll add it in a follow-up if Karina's
 * audit surfaces a non-trivial population.
 *
 * Kept as its own file (vs aliasing DEFAULT) because:
 *   1. NY-specific changes can land here without affecting other
 *      states' rule sets.
 *   2. Test cases for NY can document the audit findings (e.g., "NY
 *      had 0 spread-of-hours violations in Q1 2026") even when the
 *      live rules don't add anything beyond federal.
 */

import {ComputeWeekResult, DayInput, PayRuleSet} from "../types";
import {defaultRules} from "./default";

export const nyRules: PayRuleSet = {
  stateCode: "NY",
  displayName: "New York",

  computeWeekBreakdown(
    days: DayInput[],
    workWeekStartDate: string,
  ): ComputeWeekResult {
    return defaultRules.computeWeekBreakdown(days, workWeekStartDate);
  },
};
