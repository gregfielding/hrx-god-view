/**
 * Pay rules engine — pure helpers shared across all state rule sets.
 *
 * **Three concerns split into the same file** because they're closely
 * coupled and the rule sets need all three:
 *
 *   1. Time math — HH:mm parsing, minutes-between, overnight handling.
 *   2. Workweek resolution — "what is the YYYY-MM-DD of the first day
 *      of the workweek containing this workDate?"
 *   3. Daily / weekly classification helpers — the common
 *      `splitDailyHours` and `applyWeeklyOTCascade` patterns that
 *      every state's rule set composes.
 *
 * **Inputs in minutes, outputs in minutes.** The rule sets work in
 * integer minutes throughout (no floating-point drift across folds);
 * only the orchestrator converts to hours at the very end. Mixing
 * units inside a fold is the most common bug class in payroll
 * engines we've seen elsewhere.
 *
 * Pure: no Firestore, no `Date.now()`, no I/O. Same inputs always
 * produce same outputs — the entire test suite consequently runs in
 * milliseconds without setup/teardown.
 */

/* -------------------------------------------------------------------------
 * Time math
 * ------------------------------------------------------------------------- */

/**
 * Parse `HH:mm` (24-hour) to minutes-since-midnight.
 * Returns `null` for any malformed input. Permissive on leading
 * zeros — accepts `7:00` as well as `07:00` to match the
 * `weeklySchedule` shape we see in production.
 */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (typeof hhmm !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Minutes between two HH:mm timestamps on the same conceptual shift.
 * Handles overnight by adding 24h to `endMin` when `endMin <= startMin`
 * (matches `scheduledHoursForRow` in the resolver — single source of
 * truth for "how long did this shift run").
 *
 * Returns `null` when either endpoint is malformed.
 */
export function minutesBetween(
  startHhmm: string | null | undefined,
  endHhmm: string | null | undefined,
): number | null {
  const startMin = hhmmToMinutes(startHhmm);
  const endMinRaw = hhmmToMinutes(endHhmm);
  if (startMin === null || endMinRaw === null) return null;
  let endMin = endMinRaw;
  if (endMin <= startMin) endMin += 24 * 60;
  return endMin - startMin;
}

/**
 * Sum the unpaid break minutes from a `breaks[]` array. Paid breaks
 * are NOT subtracted because the worker is on the clock during them.
 */
export function sumUnpaidBreakMinutes(
  breaks: ReadonlyArray<{ durationMins: number; paid: boolean }> | undefined,
): number {
  if (!breaks || breaks.length === 0) return 0;
  let total = 0;
  for (const b of breaks) {
    if (b.paid) continue;
    if (typeof b.durationMins === "number" && Number.isFinite(b.durationMins) && b.durationMins > 0) {
      total += b.durationMins;
    }
  }
  return total;
}

/**
 * Compute worked minutes from `actualStart` / `actualEnd` minus
 * unpaid breaks. Returns 0 when either time is missing — empty
 * entries cleanly produce 0 output, which is the steady state for
 * grids that haven't had recruiter input yet.
 *
 * Floors at 0: malformed entries (end before start AFTER overnight
 * adjustment, or unpaid breaks exceeding shift length) produce 0
 * rather than negative numbers. The trigger should ideally validate
 * before passing here, but defense-in-depth is cheap.
 */
export function workedMinutesFromActuals(
  actualStartHhmm: string | null | undefined,
  actualEndHhmm: string | null | undefined,
  breaks: ReadonlyArray<{ durationMins: number; paid: boolean }> | undefined,
): number {
  if (!actualStartHhmm || !actualEndHhmm) return 0;
  const elapsed = minutesBetween(actualStartHhmm, actualEndHhmm);
  if (elapsed === null) return 0;
  const unpaidBreak = sumUnpaidBreakMinutes(breaks);
  return Math.max(0, elapsed - unpaidBreak);
}

/* -------------------------------------------------------------------------
 * Workweek resolution
 *
 * The "workweek" for OT computation is a fixed 7-day window starting
 * on a configured day-of-week. FLSA default is Sunday. State rules
 * use this window for weekly OT cascade and for CA's 7th-consecutive-
 * day rule.
 *
 * Independent of pay period: an employer can pay biweekly but their
 * workweek is still 7 days. The trigger derives the workweek from
 * the entity's `payPeriodPolicy.weekStartDOW` when set, falling back
 * to Sunday.
 * ------------------------------------------------------------------------- */

/**
 * Parse YYYY-MM-DD to a local-time `Date` at midnight. Returns
 * `null` for malformed input. Local-time semantic mirrors the
 * resolver's `parseYyyyMmDdLocal` — UTC drift here would silently
 * shift workweek boundaries.
 */
export function parseYyyyMmDdLocal(s: string | null | undefined): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Format a local-time `Date` to YYYY-MM-DD. Mirror of the resolver's
 *  `dateToLocalYyyyMmDd`. */
export function dateToLocalYyyyMmDd(d: Date | null | undefined): string | null {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Given a `workDate` and a `weekStartDOW` (0=Sun..6=Sat), return the
 * YYYY-MM-DD of the first day of the 7-day workweek containing
 * `workDate`. Inverse of "what week does this date belong to" — the
 * trigger uses this to find sibling entries for the cascade.
 *
 * Examples (weekStartDOW=0 / Sunday):
 *   workDate=2026-05-06 (Wed) → 2026-05-03 (Sun)
 *   workDate=2026-05-03 (Sun) → 2026-05-03 (Sun, same day)
 *   workDate=2026-05-09 (Sat) → 2026-05-03 (Sun)
 *   workDate=2026-05-10 (Sun, next week) → 2026-05-10 (Sun)
 *
 * Returns `null` when `workDate` is malformed.
 */
export function workWeekStartFor(
  workDate: string,
  weekStartDOW = 0,
): string | null {
  const d = parseYyyyMmDdLocal(workDate);
  if (!d) return null;
  const startDow = ((Math.trunc(weekStartDOW) % 7) + 7) % 7; // normalize 0..6
  const refDow = d.getDay();
  const daysSinceStart = (refDow - startDow + 7) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceStart);
  return dateToLocalYyyyMmDd(start);
}

/**
 * Inclusive-on-both-sides 7-day workweek range for a `workDate`.
 * Convenience for the trigger's sibling-query bounds.
 */
export function workWeekRangeFor(
  workDate: string,
  weekStartDOW = 0,
): { start: string; end: string } | null {
  const start = workWeekStartFor(workDate, weekStartDOW);
  if (!start) return null;
  const startDate = parseYyyyMmDdLocal(start);
  if (!startDate) return null;
  const endDate = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate() + 6,
  );
  const end = dateToLocalYyyyMmDd(endDate);
  if (!end) return null;
  return {start, end};
}

/* -------------------------------------------------------------------------
 * Daily classification helpers
 * ------------------------------------------------------------------------- */

/**
 * Split a single day's worked minutes into `{ reg, ot, dt }` based on
 * thresholds (in minutes). Used by:
 *   - CA: `splitDailyHoursWithThresholds(workedMinutes, 8*60, 12*60)`
 *   - DEFAULT/NY/TX/MA: pass through (all minutes are reg) by setting
 *     `regCapMinutes = Infinity, otCapMinutes = Infinity`
 *
 * Invariants:
 *   - `reg + ot + dt === workedMinutes` exactly (integer math).
 *   - `regCapMinutes <= otCapMinutes` (otherwise reg eats into the
 *     ot bucket, which is nonsensical). Throws on inverted thresholds
 *     so misconfigured rule sets fail loudly in tests rather than
 *     silently shipping bad numbers.
 */
export function splitDailyHoursWithThresholds(
  workedMinutes: number,
  regCapMinutes: number,
  otCapMinutes: number,
): { reg: number; ot: number; dt: number } {
  if (
    regCapMinutes !== Infinity &&
    otCapMinutes !== Infinity &&
    regCapMinutes > otCapMinutes
  ) {
    throw new Error(
      `splitDailyHoursWithThresholds: regCap (${regCapMinutes}) cannot exceed otCap (${otCapMinutes}).`,
    );
  }
  if (!Number.isFinite(workedMinutes) || workedMinutes <= 0) {
    return {reg: 0, ot: 0, dt: 0};
  }
  const reg = Math.min(workedMinutes, regCapMinutes);
  const remainingAfterReg = workedMinutes - reg;
  const otRange =
    otCapMinutes === Infinity ? Infinity : otCapMinutes - regCapMinutes;
  const ot = Math.min(remainingAfterReg, otRange);
  const dt = remainingAfterReg - ot;
  return {reg, ot, dt};
}

/* -------------------------------------------------------------------------
 * Weekly OT cascade
 * ------------------------------------------------------------------------- */

/**
 * Per-day classification before the weekly cascade. Used internally
 * by `applyWeeklyOTCascade` so it can reshape regular → OT in-place
 * without losing each day's prior daily-OT/DT.
 */
export interface PerDayMinutes {
  reg: number;
  ot: number;
  dt: number;
}

/**
 * Apply weekly OT cascade across the week's days, in workDate order.
 * Once cumulative `reg` minutes cross `weeklyOTThresholdMinutes`,
 * subsequent regular minutes flip to OT. Daily OT and DT minutes are
 * preserved as-is — they don't count against the weekly regular cap
 * because they're already classified as overtime.
 *
 * Returns a new array of `PerDayMinutes` in the same order.
 *
 * Example (DEFAULT, threshold 40h = 2400 min):
 *   Mon: 8h reg → 8h reg. cumulative=8h.
 *   Tue: 8h reg → 8h reg. cumulative=16h.
 *   Wed: 8h reg → 8h reg. cumulative=24h.
 *   Thu: 8h reg → 8h reg. cumulative=32h.
 *   Fri: 10h reg → 8h reg + 2h ot (cumulative crosses 40h after 8h).
 *   Sat: 4h reg → 4h ot (already past 40h).
 *
 * `weeklyOTThresholdMinutes === Infinity` → no-op (return clones).
 */
export function applyWeeklyOTCascade(
  days: ReadonlyArray<PerDayMinutes>,
  weeklyOTThresholdMinutes: number,
): PerDayMinutes[] {
  if (weeklyOTThresholdMinutes === Infinity) {
    return days.map((d) => ({reg: d.reg, ot: d.ot, dt: d.dt}));
  }
  if (!Number.isFinite(weeklyOTThresholdMinutes) || weeklyOTThresholdMinutes < 0) {
    throw new Error(
      "applyWeeklyOTCascade: weeklyOTThresholdMinutes must be a non-negative finite number or Infinity.",
    );
  }

  const out: PerDayMinutes[] = [];
  let cumulativeReg = 0;
  for (const day of days) {
    const remainingCap = Math.max(0, weeklyOTThresholdMinutes - cumulativeReg);
    const newReg = Math.min(day.reg, remainingCap);
    const flippedToOt = day.reg - newReg;
    out.push({
      reg: newReg,
      ot: day.ot + flippedToOt,
      dt: day.dt,
    });
    cumulativeReg += newReg;
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Conversion helpers
 * ------------------------------------------------------------------------- */

/**
 * Minutes → hours, rounded to two decimal places. Two decimals matches
 * payroll convention (hundredths of an hour); higher precision tends
 * to surface floating-point drift in totals headers without adding
 * value. The rule sets internally work in integer minutes, so this
 * is only called at the engine boundary.
 */
export function minutesToHours(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}
