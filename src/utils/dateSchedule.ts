/**
 * Helpers for GIG multi-day shifts that use per-date schedule (dateSchedule)
 * instead of weekly recurring (weeklySchedule). Keys are YYYY-MM-DD.
 */

export type DateScheduleEntry = { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number };
export type DateSchedule = Record<string, DateScheduleEntry>;

const DAY_SHORT: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

function formatTimeHHmm(time: string): string {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return time || '';
  const [hh, mm] = time.split(':').map(Number);
  const hour = hh % 12 || 12;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  return `${hour}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/**
 * Returns true if the date has both start and end time set (i.e. "has shift hours").
 */
export function dateHasHours(entry: { startTime?: string; endTime?: string } | null): boolean {
  if (!entry) return false;
  const s = (entry.startTime || '').trim();
  const e = (entry.endTime || '').trim();
  return s.length > 0 && e.length > 0;
}

/**
 * Get list of dates in range that have shift hours, for display on worker views.
 * Each item has date (YYYY-MM-DD), dayLabel (e.g. "Fri 3/13"), startTime, endTime.
 */
export function getDateScheduleEntriesWithHours(
  dateSchedule: DateSchedule | undefined,
  shiftDate: string,
  endDate: string | undefined
): Array<{ date: string; dayLabel: string; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }> {
  if (!dateSchedule || !shiftDate) return [];
  const end = endDate && endDate >= shiftDate ? endDate : shiftDate;
  const result: Array<{ date: string; dayLabel: string; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }> = [];
  const startD = parseISO(shiftDate);
  const endD = parseISO(end);
  if (!startD || !endD || endD < startD) return [];

  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const iso = toISO(d);
    const entry = dateSchedule[iso];
    if (!dateHasHours(entry)) continue;
    const dayLabel = formatDayAndDate(iso);
    result.push({
      date: iso,
      dayLabel,
      startTime: entry!.startTime,
      endTime: entry!.endTime,
      workersNeeded: entry?.workersNeeded,
      overstaff: entry?.overstaff,
    });
  }
  return result;
}

/**
 * Human-readable summary for a single date entry, e.g. "Fri 3/13 1:00 PM–9:00 PM".
 */
export function formatDateScheduleEntry(
  date: string,
  startTime: string,
  endTime: string
): string {
  return `${formatDayAndDate(date)} ${formatTimeHHmm(startTime)}–${formatTimeHHmm(endTime)}`;
}

/**
 * Full summary string for worker display: only dates that have hours.
 * e.g. "Fri 3/13 1:00 PM–9:00 PM; Sat 3/14 1:00 PM–9:00 PM; Wed 3/18 1:00 PM–9:00 PM"
 */
export function formatDateScheduleSummary(
  dateSchedule: DateSchedule | undefined,
  shiftDate: string,
  endDate: string | undefined
): string {
  const entries = getDateScheduleEntriesWithHours(dateSchedule, shiftDate, endDate);
  return entries
    .map((e) => formatDateScheduleEntry(e.date, e.startTime, e.endTime))
    .join('; ');
}

/**
 * Format "Friday 3/13" from YYYY-MM-DD.
 */
export function formatDayAndDate(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso;
  const dayName = DAY_SHORT[d.getDay()];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${dayName} ${month}/${day}`;
}

function parseISO(iso: string): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Generate array of YYYY-MM-DD from start to end (inclusive).
 */
export function getDateRange(startISO: string, endISO: string): string[] {
  const startD = parseISO(startISO);
  const endD = parseISO(endISO);
  if (!startD || !endD || endD < startD) return [];
  const out: string[] = [];
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    out.push(toISO(d));
  }
  return out;
}

/** Normalize a shift date field (string, Date, or Firestore Timestamp) to YYYY-MM-DD. */
function toDateISO(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const iso = v.split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  }
  const d = typeof (v as { toDate?: () => Date }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate()
    : new Date(v as Date);
  if (isNaN(d.getTime())) return null;
  return toISO(d);
}

/**
 * Returns the latest date (YYYY-MM-DD) across all shifts.
 * Used to override job board post endDate in worker UI so it reflects the last shift date.
 */
export function getLastShiftDateFromShifts(shifts: Array<{ shiftDate?: unknown; endDate?: unknown; dateSchedule?: DateSchedule }>): string | null {
  let last: string | null = null;
  for (const s of shifts) {
    const startStr = toDateISO(s.shiftDate);
    const endStr = s.endDate != null ? toDateISO(s.endDate) : startStr;
    const candidate = (endStr && startStr && endStr >= startStr ? endStr : startStr) || null;
    if (candidate && (!last || candidate > last)) last = candidate;
  }
  return last;
}
