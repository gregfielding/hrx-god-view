/**
 * Texas pay rule set.
 *
 * **Today (v1):** federal-mirror — weekly OT after 40h, no state-
 * specific overlay. Texas has no daily OT, no spread-of-hours, no
 * meal/rest break penalties under state law. The only payroll-
 * relevant state nuances (e.g., final-pay timing) live outside the
 * rules engine.
 *
 * Kept as its own file (vs aliasing DEFAULT) so that any future
 * Texas-specific tweak (e.g., per-shift premium for a specific
 * customer's MSA) can land here without leaking into the federal
 * default.
 */

import {ComputeWeekResult, DayInput, PayRuleSet} from "../types";
import {defaultRules} from "./default";

export const txRules: PayRuleSet = {
  stateCode: "TX",
  displayName: "Texas",

  computeWeekBreakdown(
    days: DayInput[],
    workWeekStartDate: string,
  ): ComputeWeekResult {
    return defaultRules.computeWeekBreakdown(days, workWeekStartDate);
  },
};
