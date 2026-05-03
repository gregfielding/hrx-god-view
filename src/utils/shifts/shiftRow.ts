/**
 * Pure helpers + types for the /shifts dashboard.
 *
 * Extracted from the original ShiftsActive.tsx so that both the List and
 * Calendar views can share row shape, date parsing, and status colors
 * without duplicating logic.
 *
 * No React, no Firestore — keep this file pure so it stays trivially
 * unit-testable.
 */

export type ShiftStatus = 'open' | 'closed' | 'filled' | 'cancelled';
export type ShiftMode = 'single' | 'multi';

/** Canonical shift statuses for filters and editor menus — keep in sync across `/shifts`, account tabs, and tables. */
export const SHIFT_STATUS_FILTER_ENTRIES: ReadonlyArray<{
  value: ShiftStatus;
  label: string;
}> = [
  { value: 'open', label: 'Open' },
  { value: 'filled', label: 'Filled' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export interface ShiftDoc {
  id: string;
  shiftTitle?: string;
  status?: ShiftStatus;
  shiftMode?: ShiftMode;
  shiftDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  defaultStartTime?: string; // HH:mm
  defaultEndTime?: string; // HH:mm
  defaultJobTitle?: string;
  /** Optional shift-level PO number. When set, takes precedence over
   *  the JO's `poNumber` for display — a single JO can have shifts
   *  billed against different POs. */
  poNumber?: string;
  /** External clock-in URL workers see on assignment (Indeed time
   *  capture, Cort, etc.). May be empty / blank string. */
  clockInUrl?: string;
  /** Free-form shift-specific instructions / job description shown to
   *  workers below the shift hours. Plain text. */
  shiftDescription?: string;
  totalStaffRequested?: number;
  weeklySchedule?: Record<
    string,
    { enabled?: boolean; startTime?: string; endTime?: string }
  >;
  dateSchedule?: Record<
    string,
    { startTime?: string; endTime?: string; workersNeeded?: number; overstaff?: number }
  >;
}

export interface JobOrderLite {
  id: string;
  jobOrderNumber?: string;
  jobTitle?: string;
  jobType?: 'gig' | 'career';
  status?: string;
  /** JO-level PO number. Currently only persisted for `gig` job orders
   *  (see `JobOrderForm`), but read defensively for both types so the
   *  Shifts table doesn't have to care. */
  poNumber?: string;
  /** JO-level job description (rich text from `JobOrderForm`). Used by
   *  the Shifts table to show a hover tooltip on the Job cell. May
   *  contain HTML — render through `stripHtml` before display. */
  jobDescription?: string;
  /** Hiring entity (Employer of Record) doc id. */
  hiringEntityId?: string | null;
  /** Resolved hiring entity display name (hydrated from
   *  `tenants/{tid}/entities/{id}`). Empty when the JO has no
   *  hiringEntityId or the entity doc is missing. */
  hiringEntityName?: string;
  /** AccuSource screening package name selected on the JO override
   *  (NOT the package id). When unset, the JO inherits its package
   *  from the location/account chain — the Shifts table only displays
   *  the explicit JO-level override. */
  screeningPackageName?: string;
  /** Additional screening labels selected on the JO. */
  additionalScreenings?: string[];
  /** Free-form uniform / dress-code requirements text. */
  uniformRequirements?: string;
  /** CRM company id (`tenants/{t}/crm_companies/{id}`). Used as the
   *  logo lookup key by `useActiveShifts`. Undefined for older job
   *  orders that never persisted a `companyId`. */
  companyId?: string;
  companyName?: string;
  /** Resolved company logo URL (hydrated from
   *  `crm_companies/{id}.logo` / `.logoUrl` / `.logo_url`). Empty
   *  string is treated as "no logo" — the renderer falls back to the
   *  initial of `companyName`. */
  companyLogoUrl?: string;
  worksiteName?: string;
  /**
   * Worksite address — normalized by `useActiveShifts` from whichever
   * shape the underlying job order / location doc uses. All four fields
   * are optional; older tenant data can be missing the `street` line
   * and very old job orders may resolve nothing at all.
   */
  worksiteAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  /** Top-level pay rate on the JO doc, in dollars/hr. */
  payRate?: number;
  /** Top-level bill rate on the JO doc, in dollars/hr. */
  billRate?: number;
  /** Markup % between pay and bill. Either pulled from the JO's
   *  explicit `markup` field or derived as `((bill - pay) / pay) * 100`
   *  when both rates are present. */
  markupPercent?: number;
  /** Workers-comp rate as a percentage (e.g. 2.3 means 2.3%). Sourced
   *  from `positions[0].workersCompRate` first, falling back to the
   *  top-level `workersCompRate` on the JO. */
  wcRate?: number;
  /** SUTA rate as a percentage. Sourced from `positions[0].sutaRate`. */
  sutaRate?: number;
  /** FUTA rate as a percentage. Sourced from `positions[0].futaRate`. */
  futaRate?: number;
  /** Recruiter account doc id (`tenants/{tid}/accounts/{id}`). */
  recruiterAccountId?: string;
  /** Denormalized display name for that account (JO snapshot). */
  accountName?: string;
  /** Basic Information — schedule start `YYYY-MM-DD` (career + gig). */
  startDate?: string;
  /** Basic Information — schedule end `YYYY-MM-DD`; unset = no fixed end on the JO. */
  endDate?: string;
}

export interface ShiftRow {
  shift: ShiftDoc;
  jobOrder: JobOrderLite;
  /** Sort key — earliest in-window date for the shift, or +Infinity for ongoing career shifts (sorted last). */
  sortKey: number;
  /** Pretty display for the date column. */
  dateLabel: string;
  /** Pretty display for the time column. */
  timeLabel: string;
  /** Number of applications attached to this shift with `status: 'confirmed'`.
   *  Hydrated lazily by `useActiveShifts`; `undefined` while loading. */
  confirmedCount?: number;
  /** Total unique applicants attached to this shift (across all statuses).
   *  Deduped by `userId` (falling back to `candidateId` then app doc id) so
   *  a worker who applied to multiple shifts in the same JO is counted
   *  once per shift. `undefined` while loading. */
  applicantsCount?: number;
}

/**
 * `shift` prop for `ShiftPlacementsDrawer` — built from a list/calendar
 * `ShiftRow` so every entry point stays consistent.
 */
export interface ShiftPlacementsDrawerSummary {
  id: string;
  shiftTitle?: string;
  jobTitle?: string;
  dateLabel: string;
  timeLabel: string;
  poNumber?: string;
  worksiteName?: string;
  worksiteStreet?: string;
  worksiteCityStateZip?: string;
  companyName?: string;
  companyLogoUrl?: string;
  payRate?: number | null;
  billRate?: number | null;
  markupPercent?: number | null;
  wcRate?: number | null;
  sutaRate?: number | null;
  futaRate?: number | null;
  totalStaffRequested?: number;
  confirmedCount?: number;
  /** Opens `/accounts/{id}` in a new tab from the drawer header. */
  recruiterAccountId?: string;
  /** Primary label for the Account column when present (JO denorm). */
  accountName?: string;
}

export function toShiftPlacementsDrawerSummary(
  row: ShiftRow,
): ShiftPlacementsDrawerSummary {
  const jo = row.jobOrder;
  const sh = row.shift;
  const street = jo.worksiteAddress?.street?.trim() || '';
  const city = jo.worksiteAddress?.city?.trim() || '';
  const state = jo.worksiteAddress?.state?.trim() || '';
  const zip = jo.worksiteAddress?.zipCode?.trim() || '';
  const cityStateZip = [[city, state].filter(Boolean).join(', '), zip]
    .filter(Boolean)
    .join(' ');
  return {
    id: sh.id,
    shiftTitle: sh.shiftTitle,
    jobTitle: sh.defaultJobTitle?.trim() || jo.jobTitle,
    dateLabel: row.dateLabel,
    timeLabel: row.timeLabel,
    poNumber: sh.poNumber || jo.poNumber,
    worksiteName: jo.worksiteName,
    worksiteStreet: street || undefined,
    worksiteCityStateZip: cityStateZip || undefined,
    companyName: jo.companyName,
    companyLogoUrl: jo.companyLogoUrl,
    payRate: jo.payRate ?? null,
    billRate: jo.billRate ?? null,
    markupPercent: jo.markupPercent ?? null,
    wcRate: jo.wcRate ?? null,
    sutaRate: jo.sutaRate ?? null,
    futaRate: jo.futaRate ?? null,
    totalStaffRequested: sh.totalStaffRequested,
    confirmedCount: row.confirmedCount,
    recruiterAccountId: jo.recruiterAccountId,
    accountName: jo.accountName,
  };
}

/* -------------------------------------------------------------------------
 * Date utilities — local-time YYYY-MM-DD parsing. We deliberately avoid
 * `new Date('2026-01-15')` because that's interpreted as UTC and can shift
 * a day in negative tz offsets.
 * ------------------------------------------------------------------------- */

export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight `Date` for today — default Shifts toolbar “start date” filter. */
export function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseYyyyMmDdLocal(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Local calendar date → `YYYY-MM-DD` (for toolbar date filters). */
export function dateToLocalYyyyMmDd(d: Date | null): string | null {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function trimYyyyMmDd(iso: string | undefined | null): string | undefined {
  const t = typeof iso === 'string' ? iso.trim() : '';
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  return t;
}

/**
 * True when the shift’s scheduled window matches the filter range.
 *
 * - **Neither bound**: no date restriction (`true`). Main Shifts UI defaults to
 *   start=today via parent state instead of relying on this.
 * - **Start only** (`[fs, ∞)`): gig/multi-day uses last day `wEnd >= fs`; bounded
 *   career uses `wEndCap >= fs`; open-ended career matches any `fs` on or before
 *   the ongoing schedule.
 * - **End only** (historical): gig rows where window **ends** `<= fe`; single-day
 *   gigs use `shiftDate <= fe`. Career needs an explicit **shift or JO end date**;
 *   **open-ended careers are excluded** until an end is stored.
 * - **Both bounds**: inclusive overlap `[fs, fe]`; open-ended career uses
 *   `fe >= max(fs, scheduleStart)`.
 *
 * Career recurring = `jobType === career`, multi shift, `sortKey === Infinity`.
 * `_todayIso` is kept for call-site compatibility.
 */
export function shiftRowOverlapsDateRange(
  row: ShiftRow,
  filterStartIso: string | null | undefined,
  filterEndIso: string | null | undefined,
  _todayIso: string,
): boolean {
  const rawS = filterStartIso?.trim();
  const rawE = filterEndIso?.trim();
  const hasS = Boolean(rawS);
  const hasE = Boolean(rawE);
  if (!hasS && !hasE) return true;

  const sh = row.shift;
  const jo = row.jobOrder;

  const isCareerRecurring =
    jo.jobType === 'career' &&
    sh.shiftMode === 'multi' &&
    row.sortKey === Number.POSITIVE_INFINITY;

  const careerWStart =
    trimYyyyMmDd(sh.shiftDate) ||
    trimYyyyMmDd(jo.startDate) ||
    '';
  const careerWEndCap =
    trimYyyyMmDd(sh.endDate) ||
    trimYyyyMmDd(jo.endDate) ||
    null;

  // --- End date only: ended on/before fe; open-ended careers out ---
  if (!hasS && hasE) {
    const fe = rawE!;
    if (isCareerRecurring) {
      if (!careerWEndCap) return false;
      return careerWEndCap <= fe;
    }
    const wStart = trimYyyyMmDd(sh.shiftDate);
    if (!wStart) return false;
    const wEnd =
      sh.shiftMode === 'multi' && trimYyyyMmDd(sh.endDate)
        ? trimYyyyMmDd(sh.endDate)!
        : wStart;
    return wEnd <= fe;
  }

  // --- Start only: overlap [fs, ∞) ---
  if (hasS && !hasE) {
    const fs = rawS!;
    if (isCareerRecurring) {
      if (!careerWStart) return false;
      if (careerWEndCap) {
        return careerWEndCap >= fs;
      }
      return true;
    }
    const wStart = trimYyyyMmDd(sh.shiftDate);
    if (!wStart) return false;
    const wEnd =
      sh.shiftMode === 'multi' && trimYyyyMmDd(sh.endDate)
        ? trimYyyyMmDd(sh.endDate)!
        : wStart;
    return wEnd >= fs;
  }

  // --- Both bounds: inclusive overlap ---
  let fs = rawS!;
  let fe = rawE!;
  if (fs > fe) {
    const t = fs;
    fs = fe;
    fe = t;
  }

  if (isCareerRecurring) {
    if (!careerWStart) return false;
    if (careerWEndCap) {
      return careerWStart <= fe && careerWEndCap >= fs;
    }
    return fe >= fs && fe >= careerWStart;
  }

  const wStart = trimYyyyMmDd(sh.shiftDate);
  if (!wStart) return false;
  const wEnd =
    sh.shiftMode === 'multi' && trimYyyyMmDd(sh.endDate)
      ? trimYyyyMmDd(sh.endDate)!
      : wStart;
  return wStart <= fe && wEnd >= fs;
}

export function formatDateLabel(iso: string | undefined | null): string {
  const d = parseYyyyMmDdLocal(iso);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Convert a 24h `"HH:mm"` (or `"HH:mm:ss"`) string to 12h `"h:mm AM"` /
 * `"h:mm PM"`. Returns `null` for falsy / unparseable input so callers
 * can fall back to a placeholder. Edge cases:
 *   - `"00:00"` → `"12:00 AM"`
 *   - `"12:00"` → `"12:00 PM"`
 *   - `"23:30"` → `"11:30 PM"`
 *   - `"8:00"`  → `"8:00 AM"` (single-digit hour also accepted)
 */
export function formatTime12h(time?: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (Number.isNaN(h) || h < 0 || h > 23) return null;
  const meridiem = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${meridiem}`;
}

export function formatTimeRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return '—';
  const startLabel = formatTime12h(start) ?? start ?? '—';
  const endLabel = formatTime12h(end) ?? end ?? '—';
  return `${startLabel} – ${endLabel}`;
}

/**
 * Format a `ShiftDoc.weeklySchedule` map as a compact, human-readable
 * day-of-week list for table display. Keys on the underlying map are
 * stringified day numbers `"0"`–`"6"` (Sunday=0). Labels are emitted in
 * Mon→Sun visual order so e.g. `{ "1": enabled, "3": enabled, "5":
 * enabled }` becomes `"Mon, Wed, Fri"`.
 *
 * Convenience collapses:
 *   - All 7 days enabled                → `"Daily"`
 *   - Mon-Fri (no weekends)             → `"Mon-Fri"`
 *   - Sat-Sun only                      → `"Weekends"`
 *
 * Returns `null` when no day is enabled (caller renders nothing).
 */
export function formatWeeklyScheduleDays(
  schedule: ShiftDoc['weeklySchedule'] | undefined,
): string | null {
  if (!schedule) return null;
  const enabled = new Set<number>();
  for (const [k, v] of Object.entries(schedule)) {
    if (!v?.enabled) continue;
    const n = parseInt(k, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 6) enabled.add(n);
  }
  if (enabled.size === 0) return null;
  if (enabled.size === 7) return 'Daily';

  const weekdays = [1, 2, 3, 4, 5];
  const isMonFri =
    enabled.size === 5 && weekdays.every((d) => enabled.has(d));
  if (isMonFri) return 'Mon-Fri';

  const isWeekends =
    enabled.size === 2 && enabled.has(0) && enabled.has(6);
  if (isWeekends) return 'Weekends';

  const labels: Record<number, string> = {
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
    0: 'Sun',
  };
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => enabled.has(d))
    .map((d) => labels[d])
    .join(', ');
}

/* -------------------------------------------------------------------------
 * Status → MUI Chip color mapping.
 * ------------------------------------------------------------------------- */

export function statusChipColor(
  status?: ShiftStatus,
): 'default' | 'success' | 'warning' | 'info' | 'error' {
  switch (status) {
    case 'open':
      return 'success';
    case 'filled':
      return 'info';
    case 'closed':
      return 'warning';
    case 'cancelled':
      return 'error';
    default:
      return 'default';
  }
}

/**
 * Build row metadata for the shifts list/calendar dataset. Every shift status
 * (`open` | `filled` | `closed` | `cancelled`) is included so filters can slice
 * the full set. Dated gigs include past windows so rows stay available when the
 * JO is on_hold or when filtering by date range.
 *
 * Used by both views — the List sorts/paginates by `sortKey`, the Calendar
 * uses the date strings to bucket by day.
 */
export function buildActiveRowMeta(
  shift: ShiftDoc,
  jobOrder: JobOrderLite,
  todayIso: string,
): Pick<ShiftRow, 'sortKey' | 'dateLabel' | 'timeLabel'> | null {
  const isMulti = shift.shiftMode === 'multi';
  const isCareer = jobOrder.jobType === 'career';
  const startIso = shift.shiftDate;
  const endIso = shift.endDate;

  // Career multi-day = ongoing recurring schedule. Always Active regardless
  // of dates (career shifts often have no endDate). Sort to the bottom of
  // the table behind the dated shifts so today/tomorrow stay on top.
  if (isMulti && isCareer) {
    return {
      sortKey: Number.POSITIVE_INFINITY,
      dateLabel: 'Career',
      timeLabel: formatTimeRange(shift.defaultStartTime, shift.defaultEndTime),
    };
  }

  // Otherwise: dated gig shift — needs shiftDate (single or multi window).
  // Include past windows too so gigs remain visible when the JO is on_hold
  // (often auto-set after dates pass) and when recruiters filter by date range.
  const compareEnd = isMulti ? endIso || startIso : startIso;
  if (!compareEnd) return null;

  const windowEnded = compareEnd < todayIso;

  // Sort: upcoming windows float near "today"; ended windows sort by end date.
  let sortIso: string;
  if (windowEnded) {
    sortIso = compareEnd;
  } else if (startIso && startIso >= todayIso) {
    sortIso = startIso;
  } else {
    sortIso = todayIso;
  }
  const sortDt = parseYyyyMmDdLocal(sortIso);
  return {
    sortKey: sortDt ? sortDt.getTime() : 0,
    dateLabel:
      isMulti && endIso && endIso !== startIso
        ? `${formatDateLabel(startIso)} → ${formatDateLabel(endIso)}`
        : formatDateLabel(startIso),
    timeLabel: formatTimeRange(shift.defaultStartTime, shift.defaultEndTime),
  };
}
