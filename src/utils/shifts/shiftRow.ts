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

/* -------------------------------------------------------------------------
 * Date utilities — local-time YYYY-MM-DD parsing. We deliberately avoid
 * `new Date('2026-01-15')` because that's interpreted as UTC and can shift
 * a day in negative tz offsets.
 * ------------------------------------------------------------------------- */

export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseYyyyMmDdLocal(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
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
 * Decide if a shift should appear in the Active dataset and, if so, return
 * the sort key + display labels. Returns `null` to drop the shift.
 *
 * Used by both views — the List sorts/paginates by `sortKey`, the Calendar
 * uses the date strings to bucket by day.
 */
export function buildActiveRowMeta(
  shift: ShiftDoc,
  jobOrder: JobOrderLite,
  todayIso: string,
): Pick<ShiftRow, 'sortKey' | 'dateLabel' | 'timeLabel'> | null {
  const status = shift.status;
  if (status === 'cancelled' || status === 'closed') return null;

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

  // Otherwise: needs a concrete date in the future or today.
  // Multi-gig: window is shiftDate..endDate; active if endDate >= today.
  // Single: active if shiftDate >= today.
  const compareEnd = isMulti ? endIso || startIso : startIso;
  if (!compareEnd || compareEnd < todayIso) return null;

  // For sort, prefer the earliest in-window date that's still upcoming:
  // if startIso is in the future, sort by startIso; if multi-window already
  // started (startIso < today <= endIso), sort by today so it floats up to
  // "happening now".
  const sortIso = startIso && startIso >= todayIso ? startIso : todayIso;
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
