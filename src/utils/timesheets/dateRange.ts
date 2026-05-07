/**
 * Date helpers for the timesheet workspace.
 *
 * All functions operate in **local time** (worksite-local). Timesheet doc
 * ids are `{assignmentId}_{YYYY-MM-DD}` where the date is the workDate in
 * local time, so we never want UTC drift sneaking into period selection.
 *
 * Where possible we lean on the existing helpers in
 * `src/utils/shifts/shiftRow.ts` (`todayIsoLocal`, `parseYyyyMmDdLocal`,
 * `dateToLocalYyyyMmDd`) so the timesheet grid and the shifts dashboard
 * agree on what "today" means.
 */

import {
  addDays,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
} from 'date-fns';

import {
  dateToLocalYyyyMmDd,
  parseYyyyMmDdLocal,
  todayIsoLocal,
} from '../shifts/shiftRow';

/** YYYY-MM-DD in worksite local time. The canonical timesheet workDate. */
export type IsoDate = string;

/** A pay-period range, inclusive on both ends. */
export interface PeriodRange {
  /** YYYY-MM-DD (inclusive). */
  start: IsoDate;
  /** YYYY-MM-DD (inclusive). */
  end: IsoDate;
}

/** Day-of-week as JS Date.getDay() returns: 0=Sun ... 6=Sat. */
export type DowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/* -------------------------------------------------------------------------
 * Week boundary resolution
 *
 * A "week" is `[weekStartDOW, weekEndDOW]` inclusive on both ends, with
 * the convention that the start DOW comes before the end DOW *within the
 * same calendar week*. That mirrors the `payPeriodPolicy` shape on
 * `HiringEntity` (e.g. weekStartDOW=0, weekEndDOW=6 → Sun-Sat).
 *
 * If `weekEndDOW === weekStartDOW`, that's a 7-day week starting on
 * `weekStartDOW` (some entities label this way for clarity).
 * ------------------------------------------------------------------------- */

/** Default policy when an entity's `payPeriodPolicy` is missing or
 *  partially specified — mirrors §3.4 of the build plan. */
export const DEFAULT_WEEK_START_DOW: DowIndex = 0; // Sunday
export const DEFAULT_WEEK_END_DOW: DowIndex = 6; // Saturday

function clampDow(value: number | undefined, fallback: DowIndex): DowIndex {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 6) {
    return fallback;
  }
  return value as DowIndex;
}

/** Number of days in the week given start/end DOWs. End-inclusive. */
function weekLengthDays(startDow: DowIndex, endDow: DowIndex): number {
  const diff = endDow - startDow;
  return diff >= 0 ? diff + 1 : diff + 7 + 1;
}

/**
 * Resolve the period containing `referenceDate` for a weekly policy.
 * `referenceDate` is interpreted in local time. If `referenceDate` is
 * already the period start (i.e. its DOW equals `weekStartDOW`), the
 * returned period starts on that exact date.
 *
 * Examples (Sun–Sat policy):
 *   referenceDate=Wed 2026-05-06 → start=Sun 2026-05-03, end=Sat 2026-05-09
 *   referenceDate=Sun 2026-05-03 → start=Sun 2026-05-03, end=Sat 2026-05-09
 *   referenceDate=Sat 2026-05-09 → start=Sun 2026-05-03, end=Sat 2026-05-09
 */
export function weeklyPeriodForDate(
  referenceDate: Date,
  weekStartDow?: number,
  weekEndDow?: number,
): PeriodRange {
  const startDow = clampDow(weekStartDow, DEFAULT_WEEK_START_DOW);
  const endDow = clampDow(weekEndDow, DEFAULT_WEEK_END_DOW);
  const len = weekLengthDays(startDow, endDow);

  const ref = startOfDay(referenceDate);
  const refDow = ref.getDay();
  const daysSinceStart = (refDow - startDow + 7) % 7;

  const start = addDays(ref, -daysSinceStart);
  const end = addDays(start, len - 1);

  return {
    start: dateToLocalYyyyMmDd(start) as IsoDate,
    end: dateToLocalYyyyMmDd(end) as IsoDate,
  };
}

/** Convenience: resolve the weekly period containing `today`. */
export function currentWeeklyPeriod(
  weekStartDow?: number,
  weekEndDow?: number,
): PeriodRange {
  return weeklyPeriodForDate(new Date(), weekStartDow, weekEndDow);
}

/**
 * Shift the given weekly period by `delta` weeks. Used by the prev/next
 * arrows in `<PeriodPicker />` for `policyType: 'weekly'`.
 * Preserves the original week's length (so e.g. a Mon-Sun policy stays
 * 7-day after a shift).
 */
export function shiftWeeklyPeriod(period: PeriodRange, deltaWeeks: number): PeriodRange {
  const startDate = parseYyyyMmDdLocal(period.start);
  const endDate = parseYyyyMmDdLocal(period.end);
  if (!startDate || !endDate) return period;
  const offset = deltaWeeks * 7;
  return {
    start: dateToLocalYyyyMmDd(addDays(startDate, offset)) as IsoDate,
    end: dateToLocalYyyyMmDd(addDays(endDate, offset)) as IsoDate,
  };
}

/* -------------------------------------------------------------------------
 * Period iteration + label formatting
 * ------------------------------------------------------------------------- */

/**
 * Yield each `YYYY-MM-DD` in `[period.start, period.end]` (inclusive).
 * Used by the row resolver in P1.C.2 to expand a `weeklySchedule` into
 * per-day tuples. Returns `[]` if the period is malformed or inverted.
 */
export function eachDateInPeriod(period: PeriodRange): IsoDate[] {
  const start = parseYyyyMmDdLocal(period.start);
  const end = parseYyyyMmDdLocal(period.end);
  if (!start || !end) return [];
  if (isAfter(start, end)) return [];

  const out: IsoDate[] = [];
  let cur = start;
  while (!isAfter(cur, end)) {
    out.push(dateToLocalYyyyMmDd(cur) as IsoDate);
    cur = addDays(cur, 1);
  }
  return out;
}

/** True if `iso` falls within `[period.start, period.end]` inclusive. */
export function isDateInPeriod(iso: IsoDate, period: PeriodRange): boolean {
  const d = parseYyyyMmDdLocal(iso);
  const s = parseYyyyMmDdLocal(period.start);
  const e = parseYyyyMmDdLocal(period.end);
  if (!d || !s || !e) return false;
  if (isBefore(d, s)) return false;
  if (isAfter(d, e)) return false;
  return true;
}

/**
 * Human label for the picker chip: "May 3 – May 9, 2026" (compact when
 * within the same year/month, expanded when crossing boundaries).
 */
export function formatPeriodLabel(period: PeriodRange): string {
  const start = parseYyyyMmDdLocal(period.start);
  const end = parseYyyyMmDdLocal(period.end);
  if (!start || !end) return `${period.start} – ${period.end}`;

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const sameDay =
    sameYear && sameMonth && start.getDate() === end.getDate();

  if (sameDay) return format(start, 'EEE, MMM d, yyyy');
  if (sameMonth) {
    return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`;
  }
  if (sameYear) {
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
  }
  return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`;
}

/** Compact "Week of May 3" subtitle for the weekly picker. */
export function formatWeekOfLabel(period: PeriodRange): string {
  const start = parseYyyyMmDdLocal(period.start);
  if (!start) return `Week of ${period.start}`;
  return `Week of ${format(start, 'MMM d')}`;
}

/* -------------------------------------------------------------------------
 * Day-of-week helpers
 * ------------------------------------------------------------------------- */

/** Returns the JS DOW (0=Sun..6=Sat) for a YYYY-MM-DD date. */
export function dowForIso(iso: IsoDate): DowIndex | null {
  const d = parseYyyyMmDdLocal(iso);
  if (!d) return null;
  return d.getDay() as DowIndex;
}

/** Short label for a DOW index — Sun, Mon, ... Sat. */
export function dowShortLabel(dow: DowIndex): string {
  return DOW_LABELS[dow];
}

/* -------------------------------------------------------------------------
 * Period validation
 * ------------------------------------------------------------------------- */

/** Both endpoints parse as YYYY-MM-DD AND start <= end. */
export function isValidPeriod(period: PeriodRange | null | undefined): period is PeriodRange {
  if (!period) return false;
  const s = parseYyyyMmDdLocal(period.start);
  const e = parseYyyyMmDdLocal(period.end);
  if (!s || !e) return false;
  return !isAfter(s, e);
}

/* -------------------------------------------------------------------------
 * Re-exports — keep the timesheet module self-contained
 *
 * Re-exporting `todayIsoLocal` / `parseYyyyMmDdLocal` etc. so callers can
 * `import from '../../utils/timesheets/dateRange'` without also reaching
 * into `shifts/shiftRow`.
 * ------------------------------------------------------------------------- */

export { todayIsoLocal, parseYyyyMmDdLocal, dateToLocalYyyyMmDd };

/** Parse an ISO-ish date (YYYY-MM-DD or full ISO) to a local Date.
 *  Falls back to `parseISO` for full timestamps. */
export function parseLooseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const local = parseYyyyMmDdLocal(s);
  if (local) return local;
  try {
    const dt = parseISO(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}
