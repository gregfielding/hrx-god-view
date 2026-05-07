/**
 * Massachusetts pay rule set.
 *
 * **Today (v1):** federal-mirror — weekly OT after 40h, no daily OT,
 * no DT, no penalties. The historical Sunday/holiday premium-pay
 * rule (Mass. Gen. Laws c. 136, §6) was phased out and fully
 * repealed effective Jan 1, 2023, so it does not apply to any
 * workdate the engine will see.
 *
 * Kept as its own file (vs aliasing DEFAULT) so that any new MA-
 * specific overlay (e.g., the Earned Sick Time accrual is a separate
 * mechanism, but if a future MA-specific premium reappears) can land
 * here in isolation.
 */

import {ComputeWeekResult, DayInput, PayRuleSet} from "../types";
import {defaultRules} from "./default";

export const maRules: PayRuleSet = {
  stateCode: "MA",
  displayName: "Massachusetts",

  computeWeekBreakdown(
    days: DayInput[],
    workWeekStartDate: string,
  ): ComputeWeekResult {
    return defaultRules.computeWeekBreakdown(days, workWeekStartDate);
  },
};
