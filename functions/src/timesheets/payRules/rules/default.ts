/**
 * DEFAULT pay rule set — federal FLSA only, applied as a fallback
 * for any state without a dedicated rule set, and for misconfigured
 * worksites where state code is missing or unknown.
 *
 * **Rules:**
 *   - No daily OT or DT (states like AK and CA have those; DEFAULT
 *     does not).
 *   - Weekly OT after 40 hours of regular time, per FLSA.
 *   - No meal / rest break penalties.
 *   - No 7th-consecutive-day rule.
 *
 * Used by: any state we haven't built a dedicated rule set for, plus
 * explicit aliases (TX, MA) that match federal exactly today.
 *
 * **Why a separate "DEFAULT" instead of pointing TX directly here.**
 * If FLSA changes, or if we add a federal-overlay state-specific
 * tweak (TX has none today but MA used to have Sunday/holiday
 * premium), we want the change scoped to that state — not silently
 * applied everywhere via shared module identity. Each state rule set
 * is its own file even when the rules are identical today.
 */

import {
  ComputeWeekResult,
  DayBreakdown,
  DayInput,
  EMPTY_BREAKDOWN,
  PayRuleSet,
} from "../types";
import {
  applyWeeklyOTCascade,
  minutesToHours,
  PerDayMinutes,
  splitDailyHoursWithThresholds,
} from "../helpers";

/** 40h × 60 = 2400 min — federal weekly OT threshold. */
const WEEKLY_OT_MINUTES = 40 * 60;

export const defaultRules: PayRuleSet = {
  stateCode: "DEFAULT",
  displayName: "Default (FLSA federal)",

  computeWeekBreakdown(
    days: DayInput[],
    /* eslint-disable @typescript-eslint/no-unused-vars */
    _workWeekStartDate: string,
    /* eslint-enable @typescript-eslint/no-unused-vars */
  ): ComputeWeekResult {
    // Pass 1: classify each day with no daily limits. All worked
    // minutes start as "reg"; the cascade below will demote any
    // minutes past 40h/wk to OT.
    const perDay: PerDayMinutes[] = days.map((d) =>
      splitDailyHoursWithThresholds(d.workedMinutes, Infinity, Infinity),
    );

    // Pass 2: weekly OT cascade.
    const cascaded = applyWeeklyOTCascade(perDay, WEEKLY_OT_MINUTES);

    // Pass 3: zip back to entryIds with hours conversion. No
    // penalties under DEFAULT, so those stay at 0.
    const result: ComputeWeekResult = new Map();
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const c = cascaded[i];
      if (day.workedMinutes <= 0) {
        result.set(day.entryId, {...EMPTY_BREAKDOWN});
        continue;
      }
      const breakdown: DayBreakdown = {
        totalRegularHours: minutesToHours(c.reg),
        totalOTHours: minutesToHours(c.ot),
        totalDoubleTimeHours: minutesToHours(c.dt),
        mealBreakPenaltyHours: 0,
        restBreakPenaltyHours: 0,
      };
      result.set(day.entryId, breakdown);
    }
    return result;
  },
};
