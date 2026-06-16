/**
 * Connect Team (Time Clock) timesheet export → canonical import rows.
 *
 * Connect Team is the time-clock app VenueSmart crews punch in/out on. The
 * "Timesheet overview" export is an .xlsx with an "All Employees" sheet
 * (one row per worker-day-shift) plus a per-employee sheet for each worker.
 * We parse the "All Employees" sheet. This module is PURE — it takes the
 * already-parsed rows (objects keyed by header, e.g. SheetJS `sheet_to_json`
 * output) and produces the same normalized {@link ParsedTimesheetRow} shape
 * the Indeed Flex mapper produces, so everything downstream is shared.
 *
 * IMPORTANT data notes for Connect Team exports:
 *   - There is NO email column. Workers must be matched to HRX by NAME
 *     (First name + Last name) — the match callable handles the no-email
 *     path. `email` is left blank.
 *   - `Daily total hours` is the NET payable hours for that day (Shift hours
 *     − the daily unpaid break). Use it directly. (Weekly/Total columns are
 *     cumulative — never use them per row or you double-count.)
 *   - `Type` is the event/venue the shift was worked (Governors Ball,
 *     Bonnaroo, KC FIFA FAN FEST WWI, …) — the closest analog to Indeed's
 *     `Site`, and what a Site→job-order mapping keys on. Account is always
 *     VenueSmart; paying entity is always C1 Events LLC (defaulted by the UI).
 *   - A row with no `Out` time is still on shift (future / in-progress); a
 *     row with `Out` but no `Daily total hours` is an overnight/partial punch
 *     that needs review — neither is auto-importable.
 *   - Connect Team has no client bill rate or timesheet-status column.
 */

import type {
  ImportRowStatus,
  ParsedImport,
  ParsedImportSummary,
  ParsedTimesheetRow,
} from './indeedFlexImport';

/** Connect Team header → canonical field (matched case/whitespace-insensitive). */
const CONNECT_TEAM_HEADERS = {
  firstName: 'First name',
  lastName: 'Last name',
  scheduledShiftTitle: 'Scheduled shift title',
  type: 'Type',
  subJob: 'Sub-job',
  startDate: 'Start Date',
  clockIn: 'In',
  endDate: 'End Date',
  clockOut: 'Out',
  shiftHours: 'Shift hours',
  dailyBreakHours: 'Daily Automatic Unpaid Break Hours',
  dailyTotalHours: 'Daily total hours',
} as const;

/** Headers that must be present for us to treat the file as Connect Team. */
export const CONNECT_TEAM_REQUIRED_HEADERS: string[] = [
  CONNECT_TEAM_HEADERS.firstName,
  CONNECT_TEAM_HEADERS.lastName,
  CONNECT_TEAM_HEADERS.startDate,
  CONNECT_TEAM_HEADERS.dailyTotalHours,
  CONNECT_TEAM_HEADERS.type,
];

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

function rowGetter(raw: Record<string, unknown>): (header: string) => string {
  const byNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    byNorm.set(norm(k), v == null ? '' : String(v).trim());
  }
  return (header: string) => byNorm.get(norm(header)) ?? '';
}

/** True if the parsed rows look like a Connect Team export. */
export function looksLikeConnectTeam(rawRows: Array<Record<string, unknown>>): boolean {
  if (!rawRows.length) return false;
  const keys = new Set(Object.keys(rawRows[0]).map(norm));
  return CONNECT_TEAM_REQUIRED_HEADERS.every((h) => keys.has(norm(h)));
}

function toNumberOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Connect Team dates are "MM/DD/YYYY Ddd" (e.g. "06/08/2026 Mon"). Normalize
 * to YYYY-MM-DD. Tolerates a plain MM/DD/YYYY or an already-ISO value.
 */
function toIsoDate(s: string): string {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }
  return t;
}

/**
 * Map + classify the raw parsed Connect Team rows. Pure; safe on the client.
 * `rawRows` is the "All Employees" sheet as objects keyed by header.
 */
export function mapConnectTeamRows(rawRows: Array<Record<string, unknown>>): ParsedImport {
  const rows: ParsedTimesheetRow[] = [];
  const summary: ParsedImportSummary = {
    total: 0,
    importable: 0,
    excludedFuture: 0,
    excludedAbsence: 0,
    excludedNoEmail: 0,
    excludedOther: 0,
  };

  rawRows.forEach((raw, i) => {
    const get = rowGetter(raw);
    const firstName = get(CONNECT_TEAM_HEADERS.firstName);
    const lastName = get(CONNECT_TEAM_HEADERS.lastName);
    const startDate = get(CONNECT_TEAM_HEADERS.startDate);
    const clockOut = get(CONNECT_TEAM_HEADERS.clockOut);
    const dailyTotal = toNumberOrNull(get(CONNECT_TEAM_HEADERS.dailyTotalHours));
    const hours = dailyTotal ?? 0;
    const event = get(CONNECT_TEAM_HEADERS.type);

    // Skip fully-blank trailing rows.
    if (!firstName && !lastName && !startDate && !event) return;

    summary.total += 1;

    let status: ImportRowStatus;
    let excludeReason: string | undefined;
    if (!clockOut) {
      // Punched in, not out yet — still on shift / not finalized.
      status = 'excluded_future';
      excludeReason = 'Still clocked in (no clock-out) — not finalized.';
      summary.excludedFuture += 1;
    } else if (dailyTotal == null) {
      // Clocked out but Connect Team didn't post a daily total (overnight /
      // partial punch). Surface for review rather than guessing the hours.
      status = 'excluded_other';
      excludeReason = 'No daily total hours (overnight or partial punch) — review.';
      summary.excludedOther += 1;
    } else if (hours <= 0) {
      status = 'excluded_absence';
      excludeReason = 'Zero hours.';
      summary.excludedAbsence += 1;
    } else {
      status = 'importable';
      summary.importable += 1;
    }

    const breakHours = toNumberOrNull(get(CONNECT_TEAM_HEADERS.dailyBreakHours)) ?? 0;
    rows.push({
      rowIndex: i + 1,
      email: '', // Connect Team exports carry no email — matched by name.
      firstName,
      lastName,
      workDate: toIsoDate(startDate),
      hours,
      startTime: get(CONNECT_TEAM_HEADERS.clockIn),
      endTime: clockOut,
      clockIn: get(CONNECT_TEAM_HEADERS.clockIn),
      clockOut,
      breakMinutes: Math.round(breakHours * 60),
      paidBreak: false,
      site: event,
      role:
        get(CONNECT_TEAM_HEADERS.scheduledShiftTitle) ||
        get(CONNECT_TEAM_HEADERS.subJob) ||
        '',
      companyName: 'VenueSmart',
      billRate: null,
      sourceStatus: clockOut ? 'Clocked out' : 'On shift',
      didntWork: '',
      externalRefs: { jobId: '', agencyShiftId: '', agencyShiftWorkerId: '' },
      status,
      excludeReason,
    });
  });

  return { rows, summary };
}
