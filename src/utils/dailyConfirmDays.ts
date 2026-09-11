/**
 * Per-workday confirmation rows for standing crews (2026-09-11).
 *
 * Daily-confirm assignments (`cortConfirmation.dailyConfirm === true`) keep
 * one state per workday in `cortConfirmationDays[YYYY-MM-DD]`. Their
 * `startDate` is the crew member's FIRST day, so date-range queries on
 * assignments never find them, and `cortConfirmation.state` only mirrors the
 * current day. Recruiter views query `cortConfirmation.dailyConfirm == true`
 * and expand each assignment into one row per day with this helper.
 * Backend source of truth: functions/src/cadence/dailyConfirm.ts.
 */

export interface DailyConfirmDayRow {
  workDate: string;
  startTime: string;
  endTime: string;
  state: string;
  /** Epoch ms of the day's start (null for days seeded without one). */
  startMs: number | null;
  entry: Record<string, unknown>;
}

export function isDailyConfirmAssignment(data: Record<string, unknown> | null | undefined): boolean {
  const cort = data?.cortConfirmation as { dailyConfirm?: unknown } | undefined;
  return cort?.dailyConfirm === true;
}

/** Days in [fromIso, toIso] (inclusive, YYYY-MM-DD), oldest first. */
export function dailyConfirmDayRows(
  data: Record<string, unknown>,
  fromIso: string,
  toIso: string,
): DailyConfirmDayRow[] {
  const raw = data.cortConfirmationDays;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(
      ([date, value]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= fromIso && date <= toIso && !!value && typeof value === 'object',
    )
    .map(([workDate, value]) => {
      const entry = value as Record<string, unknown>;
      const startAt = entry.startAt as { toMillis?: () => number } | undefined;
      return {
        workDate,
        startTime: String(entry.startTime ?? '').trim(),
        endTime: String(entry.endTime ?? '').trim(),
        state: String(entry.state ?? '').trim().toLowerCase(),
        startMs: typeof startAt?.toMillis === 'function' ? startAt.toMillis() : null,
        entry,
      };
    })
    .sort((a, b) => a.workDate.localeCompare(b.workDate));
}
