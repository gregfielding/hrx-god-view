/**
 * California pay rule set — the most complex jurisdiction we
 * support. Composes daily, weekly, 7th-consecutive-day, and
 * meal/rest penalty rules into one week's breakdown.
 *
 * **Daily rules (Cal. Lab. Code §510(a)):**
 *   - First 8h of a workday → regular.
 *   - Hours 8–12 → 1.5× (OT).
 *   - Hours past 12 → 2× (DT).
 *
 * **Seventh consecutive day (Cal. Lab. Code §510(a)):**
 *   - When the worker has worked all 7 days of the workweek, the 7th
 *     day's first 8h is OT (NOT regular) and beyond 8h is DT.
 *   - "Consecutive" = consecutive worked-days inside the workweek.
 *     A day with `workedMinutes === 0` breaks the streak. Streak
 *     counting is bounded to a single workweek; it does not cross
 *     workweek boundaries (handled by the orchestrator's per-week
 *     dispatch).
 *
 * **Weekly OT (Cal. Lab. Code §510(a)):**
 *   - Once cumulative regular hours cross 40h in the workweek, the
 *     remainder of regular hours flip to OT. Daily OT/DT minutes do
 *     NOT count against the 40h regular cap (they're already
 *     classified as overtime).
 *
 * **Meal break penalty (Cal. Lab. Code §226.7, §512):**
 *   - 1 hour of regular pay if a worker logs > 5h on the day AND no
 *     meal break (≥ 30 min) was started within the first 5h of the
 *     shift.
 *   - One penalty per day, flat — not per missed break. (A second
 *     meal period for shifts > 10h is theoretically distinct under
 *     §512(a), but per §226.7 still capped at 1h/day. We collapse
 *     to the single-flat-hour model for v1.)
 *
 * **Rest break penalty (Cal. Lab. Code §226.7):**
 *   - Workers earn rest breaks per 4h "or major fraction thereof":
 *       3.5h → 1 break, 6h → 2, 10h → 3, 14h → 4.
 *   - 1 hour of regular pay if any earned rest break is missing.
 *     One flat penalty per day (not per missed break), per §226.7.
 *
 * **Why empty-breaks pessimism.** When `breaks` is `[]` and the day
 * has workedMinutes > 5h, the engine assumes no meal break was
 * taken and applies the penalty. This is the legally-correct
 * default — recruiters get to add break records (or, in Phase 3, an
 * explicit "no breaks taken" toggle vs "breaks not entered yet"
 * tri-state) to suppress the penalty. Optimism here would silently
 * hide a real wage liability.
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
  hhmmToMinutes,
  minutesToHours,
  PerDayMinutes,
  splitDailyHoursWithThresholds,
} from "../helpers";

const DAILY_REG_CAP_MINUTES = 8 * 60;
const DAILY_OT_CAP_MINUTES = 12 * 60;
const SEVENTH_DAY_OT_CAP_MINUTES = 8 * 60;
const WEEKLY_OT_THRESHOLD_MINUTES = 40 * 60;

/** Cal. Lab. Code §226.7 lookup — earned rest breaks per shift length. */
function computeEarnedRestBreaks(workedMinutes: number): number {
  if (workedMinutes <= 210) return 0; // ≤ 3.5h
  if (workedMinutes <= 360) return 1; // ≤ 6h
  if (workedMinutes <= 600) return 2; // ≤ 10h
  if (workedMinutes <= 840) return 3; // ≤ 14h
  if (workedMinutes <= 1080) return 4; // ≤ 18h
  // Theoretical only — keep formula sane for absurd shifts so a bad
  // record doesn't crash the engine.
  return Math.floor((workedMinutes + 60) / 240);
}

/**
 * 1h penalty if shift > 5h AND no meal break (≥30 min) started by
 * the 5th hour of the shift. Conservative on missing data: if
 * `actualStartTime` is missing but breaks exist, treat as compliant
 * (we can't prove non-compliance) — that matches the "no liability
 * without evidence" stance and aligns with how Phase 3's manual
 * override toggle is expected to work.
 */
function computeMealBreakPenalty(day: DayInput): number {
  if (day.workedMinutes <= 5 * 60) return 0;

  const startMin = hhmmToMinutes(day.actualStartTime);
  // If we don't know shift start, fall through pessimistically only
  // when there are NO breaks at all — at least we know nothing was
  // taken. With breaks but no start time, treat as compliant.
  if (startMin === null) {
    return day.breaks.length === 0 ? 1 : 0;
  }
  const fifthHourBoundary = startMin + 5 * 60;

  for (const br of day.breaks) {
    if (br.durationMins < 30) continue;
    const breakStartMin = hhmmToMinutes(br.startTime);
    if (breakStartMin === null) continue;
    // Overnight handling: if the break appears to start "before" the
    // shift in clock-time, it's the next day — add 24h.
    const adjustedBreakStart =
      breakStartMin < startMin ? breakStartMin + 24 * 60 : breakStartMin;
    if (adjustedBreakStart <= fifthHourBoundary) return 0;
  }
  return 1;
}

/**
 * 1h penalty if any earned rest break is missing. Counts breaks of
 * 10–29 min as rest breaks (≥30 min counts as the meal break and
 * doesn't double-count toward rest). Flat 1h per day per §226.7,
 * not per missed break.
 */
function computeRestBreakPenalty(day: DayInput): number {
  const earned = computeEarnedRestBreaks(day.workedMinutes);
  if (earned === 0) return 0;
  let restBreaksTaken = 0;
  for (const br of day.breaks) {
    if (br.durationMins >= 10 && br.durationMins < 30) restBreaksTaken += 1;
  }
  return restBreaksTaken >= earned ? 0 : 1;
}

/**
 * Daily classification with 7th-consecutive-day override. Returns
 * minutes (not hours).
 */
function classifyDaily(
  workedMinutes: number,
  isSeventhConsecutiveDay: boolean,
): PerDayMinutes {
  if (workedMinutes <= 0) return {reg: 0, ot: 0, dt: 0};

  if (isSeventhConsecutiveDay) {
    // 7th day: first 8h OT, rest DT. No regular hours at all.
    const ot = Math.min(workedMinutes, SEVENTH_DAY_OT_CAP_MINUTES);
    const dt = Math.max(0, workedMinutes - SEVENTH_DAY_OT_CAP_MINUTES);
    return {reg: 0, ot, dt};
  }

  return splitDailyHoursWithThresholds(
    workedMinutes,
    DAILY_REG_CAP_MINUTES,
    DAILY_OT_CAP_MINUTES,
  );
}

export const caRules: PayRuleSet = {
  stateCode: "CA",
  displayName: "California",

  computeWeekBreakdown(
    days: DayInput[],
    /* eslint-disable @typescript-eslint/no-unused-vars */
    _workWeekStartDate: string,
    /* eslint-enable @typescript-eslint/no-unused-vars */
  ): ComputeWeekResult {
    // Pass 1: walk in workDate order, tracking the consecutive
    // worked-day streak. A day with workedMinutes === 0 resets the
    // streak; a 7th day in a row triggers the 7th-day override.
    const perDay: PerDayMinutes[] = [];
    let streak = 0;
    for (const day of days) {
      if (day.workedMinutes <= 0) {
        streak = 0;
        perDay.push({reg: 0, ot: 0, dt: 0});
        continue;
      }
      streak += 1;
      const isSeventh = streak === 7;
      perDay.push(classifyDaily(day.workedMinutes, isSeventh));
    }

    // Pass 2: weekly OT cascade. Only `reg` minutes count toward
    // the 40h cap — daily OT/DT and 7th-day OT/DT are already
    // classified as overtime and pass through unchanged.
    const cascaded = applyWeeklyOTCascade(perDay, WEEKLY_OT_THRESHOLD_MINUTES);

    // Pass 3: zip with penalties + hours conversion.
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
        mealBreakPenaltyHours: computeMealBreakPenalty(day),
        restBreakPenaltyHours: computeRestBreakPenalty(day),
      };
      result.set(day.entryId, breakdown);
    }
    return result;
  },
};

/* -------------------------------------------------------------------------
 * Internal exports for unit testing the constituent rules in
 * isolation (without going through the orchestrator). Kept on a
 * sub-export object so the public surface stays clean.
 * ------------------------------------------------------------------------- */
export const __caInternal = {
  computeEarnedRestBreaks,
  computeMealBreakPenalty,
  computeRestBreakPenalty,
  classifyDaily,
  DAILY_REG_CAP_MINUTES,
  DAILY_OT_CAP_MINUTES,
  WEEKLY_OT_THRESHOLD_MINUTES,
};
