/**
 * Indeed Flex timesheet CSV → canonical import rows.
 *
 * Phase 0 of the customer-CSV timesheet importer. This module is PURE
 * (no Firestore, no network) so it's trivially testable: it takes the
 * raw parsed CSV rows (PapaParse `header: true` output) and produces
 * normalized, classified rows for preview.
 *
 * IMPORTANT data notes for Indeed Flex exports:
 *   - `Hours` is the NET payable hours (clock-out − clock-in − unpaid
 *     break), already computed by Indeed. We use it directly.
 *   - `Charge Rate` is the BILL rate charged to the client (e.g. 24.84),
 *     NOT the worker's pay rate. Pay rate must come from HRX — never the
 *     CSV. We capture it as `billRate` for reference only.
 *   - `Timesheet Status` gates which rows are payable: Approved/Submitted
 *     are real; Upcoming/Awaiting submission are future (skip).
 *   - `Didn't work` carries an absence reason (No show, Pre approved
 *     absence, etc.) and pairs with Hours = 0 — not payable.
 *
 * Each customer has a different CSV shape; this file is the hardcoded
 * Indeed Flex mapping. A generic per-customer mapping framework comes
 * in a later phase.
 */

export type ImportRowStatus =
  | 'importable'
  | 'excluded_future'
  | 'excluded_absence'
  | 'excluded_no_email'
  | 'excluded_other';

export interface ParsedTimesheetRow {
  /** 1-based index in the source file (after the header row). */
  rowIndex: number;
  email: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD. */
  workDate: string;
  /** Net payable hours straight from the CSV `Hours` column. */
  hours: number;
  /** HH:mm scheduled/clock fields (kept for display + later epoch conversion). */
  startTime: string;
  endTime: string;
  clockIn: string;
  clockOut: string;
  /** Unpaid break in minutes (from `Break duration` HH:MM). */
  breakMinutes: number;
  paidBreak: boolean;
  site: string;
  role: string;
  companyName: string;
  /** `Charge Rate` — the client BILL rate, NOT pay. Reference only. */
  billRate: number | null;
  /** Raw `Timesheet Status` (Approved / Submitted / Upcoming / …). */
  sourceStatus: string;
  /** Absence reason from `Didn't work`, or '' when worked. */
  didntWork: string;
  /** Source identifiers — used later for idempotency/dedup + audit. */
  externalRefs: {
    jobId: string;
    agencyShiftId: string;
    agencyShiftWorkerId: string;
  };
  status: ImportRowStatus;
  /** Human-readable reason when excluded. */
  excludeReason?: string;
}

export interface ParsedImportSummary {
  total: number;
  importable: number;
  excludedFuture: number;
  excludedAbsence: number;
  excludedNoEmail: number;
  excludedOther: number;
}

export interface ParsedImport {
  rows: ParsedTimesheetRow[];
  summary: ParsedImportSummary;
}

/** Indeed Flex header → canonical field. Headers are matched case- and
 *  whitespace-insensitively so minor export drift doesn't break parsing. */
const INDEED_FLEX_HEADERS = {
  email: 'Email',
  firstName: 'First name',
  lastName: 'Last name',
  workDate: 'Date',
  hours: 'Hours',
  startTime: 'Start time',
  endTime: 'End time',
  clockIn: 'Clock in time',
  clockOut: 'Clock out time',
  breakDuration: 'Break duration',
  paidBreak: 'Paid break',
  site: 'Site',
  role: 'Role',
  companyName: 'Company Name',
  chargeRate: 'Charge Rate',
  status: 'Timesheet Status',
  didntWork: "Didn't work",
  jobId: 'Job ID',
  agencyShiftId: 'Agency Shift ID',
  agencyShiftWorkerId: 'Agency shift Worker ID',
} as const;

/** Headers that must be present for us to treat the file as Indeed Flex. */
export const INDEED_FLEX_REQUIRED_HEADERS: string[] = [
  INDEED_FLEX_HEADERS.email,
  INDEED_FLEX_HEADERS.workDate,
  INDEED_FLEX_HEADERS.hours,
  INDEED_FLEX_HEADERS.status,
];

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Build a normalized-key lookup for one parsed row. */
function rowGetter(raw: Record<string, unknown>): (header: string) => string {
  const byNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    byNorm.set(norm(k), v == null ? '' : String(v).trim());
  }
  return (header: string) => byNorm.get(norm(header)) ?? '';
}

/** True if the parsed rows look like an Indeed Flex export. */
export function looksLikeIndeedFlex(rawRows: Array<Record<string, unknown>>): boolean {
  if (!rawRows.length) return false;
  const get = rowGetter(rawRows[0]);
  // A header is "present" if the getter resolves it (even to '') — we
  // check by probing the key set rather than the value.
  const keys = new Set(Object.keys(rawRows[0]).map(norm));
  return INDEED_FLEX_REQUIRED_HEADERS.every((h) => keys.has(norm(h)));
  // (get is unused here but kept for symmetry/readability)
  void get;
}

/** "HH:MM" → minutes; "" / bad → 0. */
function durationToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function toNumberOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a raw Date cell to YYYY-MM-DD (Indeed exports already use it). */
function toIsoDate(s: string): string {
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
}

const FUTURE_STATUSES = new Set(['upcoming', 'awaiting submission']);
const PAYABLE_STATUSES = new Set(['approved', 'submitted']);

/**
 * Map + classify the raw parsed Indeed Flex rows. Pure; safe to call on
 * the client. `rawRows` is PapaParse's `header:true` output.
 */
export function mapIndeedFlexRows(rawRows: Array<Record<string, unknown>>): ParsedImport {
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
    const email = get(INDEED_FLEX_HEADERS.email).toLowerCase();
    const hours = toNumberOrNull(get(INDEED_FLEX_HEADERS.hours)) ?? 0;
    const sourceStatus = get(INDEED_FLEX_HEADERS.status);
    const statusKey = norm(sourceStatus);
    const didntWork = get(INDEED_FLEX_HEADERS.didntWork);

    // Skip fully-blank trailing rows (PapaParse skipEmptyLines usually
    // handles these, but guard anyway).
    const isBlank =
      !email && !get(INDEED_FLEX_HEADERS.workDate) && !sourceStatus && !get(INDEED_FLEX_HEADERS.lastName);
    if (isBlank) return;

    summary.total += 1;

    let status: ImportRowStatus;
    let excludeReason: string | undefined;
    if (!email) {
      status = 'excluded_no_email';
      excludeReason = 'No email address — cannot match to an HRX worker.';
      summary.excludedNoEmail += 1;
    } else if (FUTURE_STATUSES.has(statusKey)) {
      status = 'excluded_future';
      excludeReason = `Not yet worked (status: ${sourceStatus}).`;
      summary.excludedFuture += 1;
    } else if (didntWork || hours <= 0) {
      status = 'excluded_absence';
      excludeReason = didntWork
        ? `Did not work: ${didntWork}`
        : 'Zero hours.';
      summary.excludedAbsence += 1;
    } else if (PAYABLE_STATUSES.has(statusKey)) {
      status = 'importable';
      summary.importable += 1;
    } else {
      status = 'excluded_other';
      excludeReason = `Unrecognized status: ${sourceStatus || '(blank)'}.`;
      summary.excludedOther += 1;
    }

    rows.push({
      rowIndex: i + 1,
      email,
      firstName: get(INDEED_FLEX_HEADERS.firstName),
      lastName: get(INDEED_FLEX_HEADERS.lastName),
      workDate: toIsoDate(get(INDEED_FLEX_HEADERS.workDate)),
      hours,
      startTime: get(INDEED_FLEX_HEADERS.startTime),
      endTime: get(INDEED_FLEX_HEADERS.endTime),
      clockIn: get(INDEED_FLEX_HEADERS.clockIn),
      clockOut: get(INDEED_FLEX_HEADERS.clockOut),
      breakMinutes: durationToMinutes(get(INDEED_FLEX_HEADERS.breakDuration)),
      paidBreak: norm(get(INDEED_FLEX_HEADERS.paidBreak)) === 'true',
      site: get(INDEED_FLEX_HEADERS.site),
      role: get(INDEED_FLEX_HEADERS.role),
      companyName: get(INDEED_FLEX_HEADERS.companyName),
      billRate: toNumberOrNull(get(INDEED_FLEX_HEADERS.chargeRate)),
      sourceStatus,
      didntWork,
      externalRefs: {
        jobId: get(INDEED_FLEX_HEADERS.jobId),
        agencyShiftId: get(INDEED_FLEX_HEADERS.agencyShiftId),
        agencyShiftWorkerId: get(INDEED_FLEX_HEADERS.agencyShiftWorkerId),
      },
      status,
      excludeReason,
    });
  });

  return { rows, summary };
}
