/**
 * Timesheet grid row resolver — read-only data hydration for the
 * recruiter/admin timesheet workspace.
 *
 * **Algorithm (build plan §4.2):**
 *   1. Query assignments matching the filter (entity_period in P1.C.2;
 *      jobOrder/shift/worker/account scopes ride P3+).
 *   2. **Dual filter** — both must apply:
 *        a. Assignment-level date overlap with the period:
 *           `startDate <= periodEnd AND (endDate >= periodStart OR endDate
 *           is unset)`. Drops assignments whose lifecycle doesn't touch
 *           the period at all.
 *        b. Per-day `weeklySchedule[dow].enabled === true` for each
 *           date in the period. Drops days the worker isn't scheduled.
 *      The two filters compose: an assignment that overlaps the
 *      period but has no enabled DOWs in that period yields zero rows
 *      (rare but possible — e.g. a Tue/Thu schedule and a single-day
 *      Mon period). An assignment with Mon/Wed enabled but ended 2
 *      months ago yields zero rows because (a) drops it before (b)
 *      runs.
 *   3. For each surviving (assignment, workDate) tuple, look up
 *      `tenants/{t}/timesheet_entries/{assignmentId}_{workDate}`. If
 *      the doc exists, the row renders from entry data. If not, the
 *      row renders as "empty" with snapshot data from the assignment
 *      (scheduled times from `weeklySchedule[dow]`, payRate, billRate,
 *      break minutes from `shiftBreakDefaultMinutes`).
 *   4. Sort by `workerDisplayName` (or candidateId if denorm missing),
 *      then `workDate`. Stable across re-renders.
 *
 * **No writes.** P1.C.2 is purely "load and display." Empty rows stay
 * empty until P3 makes cells editable.
 *
 * **Cost.** N assignments × M days = up to NM `getDoc()` reads against
 * `timesheet_entries`. Concurrency-bounded via `Promise.all` (one batch
 * per resolution call). For typical recruiter view (≤20 workers × 7
 * days = 140 reads) this is sub-second. The P1.B denorm fields
 * eliminate the per-assignment JO/user/location/shift cascade — the
 * only round trips here are assignments-list (1) + per-tuple entry
 * lookup (NM).
 *
 * **Error handling.** Per-assignment failures are isolated and surfaced
 * via `errors[]` rather than thrown. A malformed assignment doc
 * shouldn't blank the entire grid.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

import type { Assignment } from '../../types/phase2';
import type {
  TimesheetEntryStatus,
  TimesheetEntryV2,
  TimesheetFilter,
} from '../../types/recruiter/timesheet';
import {
  type IsoDate,
  type PeriodRange,
  dowForIso,
  eachDateInPeriod,
} from '../../utils/timesheets/dateRange';

/* -------------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------------- */

/**
 * The narrow slice of `Assignment` the grid renders. Keeps the grid
 * decoupled from the full Assignment type — when the underlying
 * Assignment shape grows, only the resolver needs to know.
 */
export interface AssignmentSnapshot {
  id: string;
  jobOrderId: string;
  /**
   * Denormalized from the assignment doc — the shift this assignment
   * is tied to, when known. `null` for legacy assignments that predate
   * the Slice 5.5 denorm or for entries whose JO has multiple shifts
   * but the assignment isn't pinned to one. The timesheets page uses
   * this to narrow rows when the Shift dropdown is set.
   */
  shiftId: string | null;
  candidateId: string;
  workerId: string;
  hiringEntityId: string | null;
  workerDisplayName: string | null;
  worksiteState: string | null;
  worksiteDisplayName: string | null;
  payRate: number;
  billRate: number;
  shiftBreakDefaultMinutes: number;
}

/** A "scheduled time" extracted from `weeklySchedule[dow]` for a given
 *  workDate. Used to seed empty rows and to compute scheduled hours
 *  for entries that haven't been edited yet. */
export interface ScheduledShift {
  /** HH:mm. */
  startTime: string;
  /** HH:mm. */
  endTime: string;
  /** Minutes — sourced from `assignment.shiftBreakDefaultMinutes`. */
  breakMinutes: number;
}

export type TimesheetGridRow =
  | {
      kind: 'entry';
      key: string; // `${assignmentId}_${workDate}` — stable for React.
      assignment: AssignmentSnapshot;
      workDate: IsoDate;
      scheduled: ScheduledShift;
      entry: TimesheetEntryV2;
    }
  | {
      kind: 'empty';
      key: string;
      assignment: AssignmentSnapshot;
      workDate: IsoDate;
      scheduled: ScheduledShift;
    };

export interface TimesheetGridResolution {
  rows: TimesheetGridRow[];
  /** Soft, per-assignment errors. Hard errors throw. */
  errors: string[];
  /** Total assignments considered (post-overlap filter). Drives the
   *  "no scheduled work in this period" empty-state copy. */
  consideredAssignmentCount: number;
}

/* -------------------------------------------------------------------------
 * Internal helpers
 * ------------------------------------------------------------------------- */

/**
 * Lexicographic YYYY-MM-DD comparison works because the format is
 * zero-padded. Avoids parsing into Date objects for every tuple.
 */
function isoDateLte(a: string, b: string): boolean {
  return a <= b;
}
function isoDateGte(a: string, b: string): boolean {
  return a >= b;
}

/** YYYY-MM-DD format guard for Firestore date strings. Permissive on
 *  surrounding whitespace; rejects everything else (timestamps,
 *  shorthand "5/8/26", empty strings, etc.). */
function isYyyyMmDdString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * Result of the assignment-level overlap check. `overlaps: true` means
 * the assignment lifecycle touches the period and should proceed to
 * the per-day expansion. `warning` is non-null when the assignment
 * was dropped due to a malformed date — the caller surfaces these in
 * the grid's soft-errors banner so legacy docs aren't silently
 * disappearing.
 *
 * Why a discriminated result instead of a bare boolean: silently
 * dropping a malformed assignment was the failure mode flagged in the
 * P1.C.2 build review ("not silently dropped"). Surfacing the
 * `warning` lets the operator see exactly why a worker isn't
 * appearing without diving into Firestore.
 */
type OverlapCheck =
  | { overlaps: true; warning: null }
  | { overlaps: false; warning: string | null };

/**
 * Assignment-level date overlap: `startDate <= periodEnd AND (endDate >=
 * periodStart OR endDate is unset)`. Both endpoints are inclusive on
 * both sides.
 *
 * Soft-error semantics: dropped assignments return a `warning` when
 * the cause was a malformed date (`startDate` missing/bad,
 * `endDate` set but bad). True out-of-range drops return `null` —
 * those are healthy "didn't match this period" cases that don't
 * deserve a warning chip.
 */
function assignmentOverlapsPeriod(
  assignmentId: string,
  assignment: Pick<Assignment, 'startDate' | 'endDate'>,
  period: PeriodRange,
): OverlapCheck {
  const start = assignment.startDate;
  if (!isYyyyMmDdString(start)) {
    return {
      overlaps: false,
      warning: `Assignment ${assignmentId} has a missing or malformed startDate (${
        start === undefined ? 'unset' : `"${String(start)}"`
      }) — dropped from the period. Fix the assignment doc to bring it back.`,
    };
  }
  const end = assignment.endDate;
  if (end !== undefined && end !== null && end !== '' && !isYyyyMmDdString(end)) {
    return {
      overlaps: false,
      warning: `Assignment ${assignmentId} has a malformed endDate ("${String(
        end,
      )}") — dropped from the period. Expected YYYY-MM-DD or unset.`,
    };
  }

  // Both dates parsed cleanly (or endDate is intentionally unset for
  // open-ended assignments). Now do the actual overlap check.
  if (!isoDateLte(start.trim(), period.end)) {
    return { overlaps: false, warning: null };
  }
  if (isYyyyMmDdString(end)) {
    if (!isoDateGte(end.trim(), period.start)) {
      return { overlaps: false, warning: null };
    }
  }
  return { overlaps: true, warning: null };
}

/**
 * `weeklySchedule[dow]` lookup for an ISO date. Returns the scheduled
 * times if the day is enabled AND the schedule has start/end times,
 * else `null`. Uses JS `Date.getDay()` semantics (0=Sun..6=Sat) to
 * match the convention documented on `Assignment.weeklySchedule`.
 */
function scheduledShiftForDate(
  assignment: Pick<Assignment, 'weeklySchedule' | 'shiftBreakDefaultMinutes'>,
  workDate: IsoDate,
): ScheduledShift | null {
  const schedule = assignment.weeklySchedule;
  if (!schedule || typeof schedule !== 'object') return null;
  const dow = dowForIso(workDate);
  if (dow === null) return null;
  const day = (schedule as Record<string, unknown>)[String(dow)];
  if (!day || typeof day !== 'object') return null;
  const d = day as { enabled?: unknown; startTime?: unknown; endTime?: unknown };
  if (d.enabled !== true) return null;
  if (typeof d.startTime !== 'string' || typeof d.endTime !== 'string') return null;
  if (!d.startTime || !d.endTime) return null;
  return {
    startTime: d.startTime,
    endTime: d.endTime,
    breakMinutes:
      typeof assignment.shiftBreakDefaultMinutes === 'number'
        ? assignment.shiftBreakDefaultMinutes
        : 0,
  };
}

/**
 * Build the display snapshot from an Assignment doc. Pulls the
 * P1.B-denorm fields when present and falls back gracefully when they
 * aren't (e.g. a brand-new assignment whose write-time hook hasn't
 * fired yet, or a tenant that hasn't run the backfill).
 *
 * `workerId` mirrors `candidateId` until v2 of the assignment shape
 * formally renames it. The grid uses `workerId` to keep the
 * vocabulary timesheet-domain consistent.
 */
function buildAssignmentSnapshot(
  raw: Assignment & { id: string },
): AssignmentSnapshot {
  // `shiftId` lives at the top level of newer assignment docs; older
  // shapes occasionally store it on a `shift` sub-object. Read both
  // defensively so this resolver doesn't fragment the read path.
  const rawShiftId =
    (raw as Record<string, unknown>).shiftId ??
    ((raw as Record<string, unknown>).shift as Record<string, unknown> | undefined)?.id ??
    null;

  return {
    id: raw.id,
    jobOrderId: raw.jobOrderId,
    shiftId:
      typeof rawShiftId === 'string' && rawShiftId.trim().length > 0
        ? rawShiftId
        : null,
    candidateId: raw.candidateId,
    workerId: raw.candidateId,
    hiringEntityId: typeof raw.hiringEntityId === 'string' ? raw.hiringEntityId : null,
    workerDisplayName:
      typeof raw.workerDisplayName === 'string' && raw.workerDisplayName.trim().length > 0
        ? raw.workerDisplayName
        : null,
    worksiteState:
      typeof raw.worksiteState === 'string' && raw.worksiteState.trim().length > 0
        ? raw.worksiteState
        : null,
    worksiteDisplayName:
      typeof raw.worksiteDisplayName === 'string' && raw.worksiteDisplayName.trim().length > 0
        ? raw.worksiteDisplayName
        : null,
    payRate: typeof raw.payRate === 'number' ? raw.payRate : 0,
    billRate: typeof raw.billRate === 'number' ? raw.billRate : 0,
    shiftBreakDefaultMinutes:
      typeof raw.shiftBreakDefaultMinutes === 'number'
        ? raw.shiftBreakDefaultMinutes
        : 0,
  };
}

/**
 * Stable sort key for grid rows. Worker name (case-insensitive) →
 * workDate. Falls back to candidateId when display name is missing so
 * rows still cluster sensibly.
 */
function rowSortKey(row: TimesheetGridRow): string {
  const nameKey = (
    row.assignment.workerDisplayName ?? row.assignment.candidateId
  ).toLowerCase();
  return `${nameKey}\u0001${row.workDate}\u0001${row.assignment.id}`;
}

/* -------------------------------------------------------------------------
 * Filter-kind dispatchers
 * ------------------------------------------------------------------------- */

/**
 * Convert a `TimesheetFilter` to the period it queries. Used by the
 * resolver and by the grid to compute the "scheduled days" denominator
 * for the totals header.
 *
 * Filters whose period is implicit (e.g. `kind: 'shift'`) return
 * `null` — those scopes will be supported in P3+ and need a
 * scope-resolver (e.g. fetch the shift, derive its period). For now
 * we throw an explicit "not yet implemented" so callers don't silently
 * render an empty grid.
 */
export function periodFromFilter(filter: TimesheetFilter): PeriodRange | null {
  switch (filter.kind) {
    case 'entity_period':
      return { start: filter.periodStart, end: filter.periodEnd };
    case 'worker':
      return { start: filter.periodStart, end: filter.periodEnd };
    case 'account':
      return { start: filter.periodStart, end: filter.periodEnd };
    case 'jobOrder':
      if (filter.periodStart && filter.periodEnd) {
        return { start: filter.periodStart, end: filter.periodEnd };
      }
      return null;
    case 'shift':
      return null;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------
 * Resolver
 * ------------------------------------------------------------------------- */

export interface ResolveTimesheetGridArgs {
  fdb: Firestore;
  tenantId: string;
  filter: TimesheetFilter;
  /** Optional concurrency cap for entry fetches. Defaults to 25 — well
   *  below Firestore's per-client connection ceiling and friendly to
   *  burst-rate limiters. */
  entryFetchConcurrency?: number;
}

const DEFAULT_ENTRY_FETCH_CONCURRENCY = 25;

export async function resolveTimesheetGrid(
  args: ResolveTimesheetGridArgs,
): Promise<TimesheetGridResolution> {
  const { fdb, tenantId, filter } = args;
  const concurrency = args.entryFetchConcurrency ?? DEFAULT_ENTRY_FETCH_CONCURRENCY;

  const period = periodFromFilter(filter);
  if (!period) {
    return {
      rows: [],
      errors: [
        `Filter kind "${filter.kind}" is not yet supported by the recruiter grid (P3+).`,
      ],
      consideredAssignmentCount: 0,
    };
  }

  // Step 1: fetch assignments. Currently only entity_period is wired —
  // the other kinds throw above. We query by the strongest single
  // index-friendly predicate and apply the rest in memory; for
  // entity-scoped views the assignment count is small enough that
  // this is preferable to forcing a composite index on every shape.
  const assignmentsCol = collection(fdb, 'tenants', tenantId, 'assignments');
  let rawAssignments: (Assignment & { id: string })[] = [];

  try {
    if (filter.kind === 'entity_period') {
      const q = query(
        assignmentsCol,
        where('hiringEntityId', '==', filter.hiringEntityId),
      );
      const snap = await getDocs(q);
      rawAssignments = snap.docs.map((d) => ({
        ...(d.data() as Assignment),
        id: d.id,
      }));
    } else if (filter.kind === 'worker') {
      const q = query(
        assignmentsCol,
        where('candidateId', '==', filter.workerId),
      );
      const snap = await getDocs(q);
      rawAssignments = snap.docs.map((d) => ({
        ...(d.data() as Assignment),
        id: d.id,
      }));
    } else if (filter.kind === 'jobOrder') {
      const q = query(
        assignmentsCol,
        where('jobOrderId', '==', filter.jobOrderId),
      );
      const snap = await getDocs(q);
      rawAssignments = snap.docs.map((d) => ({
        ...(d.data() as Assignment),
        id: d.id,
      }));
    } else {
      // account / shift — periodFromFilter already returned null for
      // shift; account filtering needs a JO→assignment join we haven't
      // wired yet. Treat as soft no-op for now.
      return {
        rows: [],
        errors: [
          `Filter kind "${filter.kind}" is not yet supported by the recruiter grid (P3+).`,
        ],
        consideredAssignmentCount: 0,
      };
    }
  } catch (err) {
    return {
      rows: [],
      errors: [
        `Failed to load assignments: ${err instanceof Error ? err.message : String(err)}`,
      ],
      consideredAssignmentCount: 0,
    };
  }

  // Step 2a: assignment-level overlap filter. Drops assignments whose
  // lifecycle doesn't touch the period at all (CRITICAL — prevents the
  // "phantom rows from a 3-month-old assignment" scenario flagged in
  // the build review).
  //
  // Soft-error pass: assignments dropped due to malformed dates
  // generate a warning the grid surfaces in its banner — silently
  // dropping them was the failure mode flagged on the P1.C.2 spot
  // check.
  const errors: string[] = [];
  const overlapping: (Assignment & { id: string })[] = [];

  for (const a of rawAssignments) {
    const check = assignmentOverlapsPeriod(a.id, a, period);
    if (check.overlaps) {
      overlapping.push(a);
    } else if (check.warning) {
      errors.push(check.warning);
    }
    // check.overlaps === false && warning === null is a healthy
    // out-of-range drop (no warning).
  }

  // Step 2b: expand each surviving assignment across the period via
  // weeklySchedule[dow], skipping disabled days. The DOW enabled flag
  // is the second leg of the dual filter — by itself it would still
  // generate phantom rows from old assignments. The composition is
  // what makes the row set tight.
  const periodDates = eachDateInPeriod(period);

  type Tuple = {
    assignment: Assignment & { id: string };
    workDate: IsoDate;
    scheduled: ScheduledShift;
  };
  const tuples: Tuple[] = [];

  for (const a of overlapping) {
    let perAssignmentDayCount = 0;
    // We've already validated a.startDate via the overlap check, so
    // this typeof guard is a defensive belt-and-suspenders rather
    // than a real branch — keeps the linter and the readers happy.
    const startStr = isYyyyMmDdString(a.startDate) ? a.startDate.trim() : null;
    const endStr =
      isYyyyMmDdString(a.endDate) ? a.endDate.trim() : null;

    for (const d of periodDates) {
      // Day must also be inside the assignment's own active window.
      // Otherwise, a Mon/Wed schedule on an assignment that ended on
      // Tuesday would still yield a Wed row.
      if (startStr && !isoDateGte(d, startStr)) continue;
      if (endStr && !isoDateLte(d, endStr)) continue;
      const scheduled = scheduledShiftForDate(a, d);
      if (!scheduled) continue;
      tuples.push({ assignment: a, workDate: d, scheduled });
      perAssignmentDayCount += 1;
    }
    if (perAssignmentDayCount === 0 && !a.weeklySchedule) {
      errors.push(
        `Assignment ${a.id} overlaps the period but has no weeklySchedule — no rows generated.`,
      );
    }
  }

  // Step 3: fetch timesheet_entries for each tuple. Bounded
  // concurrency to avoid hammering Firestore on large period views
  // (e.g. a 4-week period across 30 workers = 840 reads).
  const entriesCol = collection(fdb, 'tenants', tenantId, 'timesheet_entries');

  const fetchEntry = async (
    tuple: Tuple,
  ): Promise<TimesheetGridRow> => {
    const entryId = `${tuple.assignment.id}_${tuple.workDate}`;
    const snapshot = buildAssignmentSnapshot(tuple.assignment);
    try {
      const entrySnap = await getDoc(doc(entriesCol, entryId));
      if (entrySnap.exists()) {
        const entryData = entrySnap.data() as TimesheetEntryV2;
        return {
          kind: 'entry',
          key: entryId,
          assignment: snapshot,
          workDate: tuple.workDate,
          scheduled: tuple.scheduled,
          entry: { ...entryData, id: entrySnap.id },
        };
      }
    } catch (err) {
      // One entry-doc failure doesn't blank the row — fall through to
      // empty-row rendering and record the error for surfacing in the
      // header.
      errors.push(
        `Entry ${entryId} read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      kind: 'empty',
      key: entryId,
      assignment: snapshot,
      workDate: tuple.workDate,
      scheduled: tuple.scheduled,
    };
  };

  // Concurrency-bounded parallelism. Process in chunks of `concurrency`.
  const rows: TimesheetGridRow[] = [];
  for (let i = 0; i < tuples.length; i += concurrency) {
    const chunk = tuples.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(fetchEntry));
    rows.push(...results);
  }

  // Step 4: stable sort by worker → date → assignmentId.
  rows.sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)));

  return {
    rows,
    errors,
    consideredAssignmentCount: overlapping.length,
  };
}

/* -------------------------------------------------------------------------
 * Per-row computed helpers
 *
 * Used by the totals header AND the per-row "scheduled hrs" column.
 * Pure — exported for testing and for the totals header to share the
 * exact same math.
 * ------------------------------------------------------------------------- */

/** Parse "HH:mm" → minutes since midnight. Returns null on malformed
 *  input. Used by `scheduledHoursForRow`. */
function hhmmToMinutes(hhmm: string | undefined | null): number | null {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Scheduled hours for a single row. End-before-start (e.g. overnight
 * 22:00–06:00) treated as "next day" → adds 24h to end. Break minutes
 * subtracted; result floored at 0.
 */
export function scheduledHoursForRow(row: TimesheetGridRow): number {
  const startMin = hhmmToMinutes(row.scheduled.startTime);
  const endMinRaw = hhmmToMinutes(row.scheduled.endTime);
  if (startMin === null || endMinRaw === null) return 0;
  let endMin = endMinRaw;
  if (endMin <= startMin) endMin += 24 * 60;
  const worked = endMin - startMin - (row.scheduled.breakMinutes || 0);
  return Math.max(0, worked / 60);
}

/**
 * Actual + computed hours for a single row. Empty rows return 0;
 * entry rows return `regular + ot + doubleTime` (per build plan §5).
 * Penalty hours are NOT included — they're tracked separately in
 * the per-row tooltip and don't roll into the worker-facing "actual
 * hours" total.
 */
export function actualHoursForRow(row: TimesheetGridRow): number {
  if (row.kind !== 'entry') return 0;
  const regular = typeof row.entry.totalRegularHours === 'number' ? row.entry.totalRegularHours : 0;
  const ot = typeof row.entry.totalOTHours === 'number' ? row.entry.totalOTHours : 0;
  const dt = typeof row.entry.totalDoubleTimeHours === 'number' ? row.entry.totalDoubleTimeHours : 0;
  return regular + ot + dt;
}

/** Status string used by the row's status pill. Empty rows show the
 *  literal "—" instead of any draft state — they have no entry yet. */
export type TimesheetRowDisplayStatus = TimesheetEntryStatus | 'no_entry';

export function displayStatusForRow(row: TimesheetGridRow): TimesheetRowDisplayStatus {
  if (row.kind === 'empty') return 'no_entry';
  return row.entry.status;
}
