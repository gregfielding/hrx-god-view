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
import { normalizeAssignmentStatus } from '../../utils/assignmentStatusNormalize';
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
  /** True for open-shift (standing-crew) assignments — no fixed daily
   *  times. The grid generates a blank row per calendar day and the
   *  recruiter enters total hours manually (actualHoursOverride). */
  isOpenShift: boolean;
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

/** Synthetic "no fixed times" schedule used to seed open-shift rows.
 *  Scheduled hours compute to 0; the recruiter enters the real total via
 *  the manual hours-override cell. */
const OPEN_SHIFT_SCHEDULED: ScheduledShift = { startTime: '', endTime: '', breakMinutes: 0 };

/** WC display block stamped onto each row by the resolver. Same chain
 *  the server pre-flight uses, so the grid's resolved value matches
 *  exactly what the submit would resolve to. */
export interface ResolvedWorkersComp {
  /** First non-empty value of (entry override, shift, JO legacy field,
   *  JO canonical field, JO position[0]). Undefined when nothing resolves. */
  resolvedWorkersCompCode?: string;
  resolvedWorkersCompRate?: number;
  /** True when the resolution found a value on `entry.workersCompCode`
   *  or `entry.workersCompRate` — i.e. the recruiter set this row's
   *  override via the inline cell. Lets the UI render the cell with a
   *  subtle "override" affordance vs. plain inherited values. */
  hasEntryWorkersCompOverride?: boolean;
}

export type TimesheetGridRow =
  | ({
      kind: 'entry';
      key: string; // `${assignmentId}_${workDate}` — stable for React.
      assignment: AssignmentSnapshot;
      workDate: IsoDate;
      scheduled: ScheduledShift;
      entry: TimesheetEntryV2;
      /** True for CSV-import entries (source: 'csv_import') surfaced via the
       *  resolver's second query path — they often have no assignment, carry
       *  an `import` sidecar, and render an import-specific status pill. */
      isImport?: boolean;
    } & ResolvedWorkersComp)
  | ({
      kind: 'empty';
      key: string;
      assignment: AssignmentSnapshot;
      workDate: IsoDate;
      scheduled: ScheduledShift;
    } & ResolvedWorkersComp);

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
 * "Removed" assignment check — the worker was cancelled off the shift or
 * declined the offer, so the engagement never happened. These must NOT
 * generate payable grid rows.
 *
 * Why this lives here: the grid query has no status predicate, so
 * correctness historically relied on cancelling paths *hard-deleting* the
 * assignment (placementsCancelAssignment / separateWorker /
 * swapScheduledAssignmentWorker all delete). But two server cascades —
 * a shift being cancelled and an application being withdrawn
 * (shiftAssignmentCascades.ts) — only flip `status: 'cancelled'` and
 * leave the doc in place, so a cancelled-but-not-deleted assignment that
 * still date-overlaps the period produces phantom payable rows. This
 * filter is the durable fix: any removed-status assignment is skipped
 * regardless of how it got cancelled.
 *
 * Delegates to the canonical alias map (assignmentStatusNormalize) rather
 * than a local status list — the 2026-07-17 review caught the local list
 * missing the underscore form `worker_cancelled`, which the normalizer
 * covers. `completed`/`ended` normalize to 'completed' and are kept —
 * real worked history must still show. Unknown/blank status normalizes to
 * 'pending' and is kept too — legacy docs predate the status field.
 *
 * Safety net: even for a removed assignment, a row that has a
 * materialized `timesheet_entries` doc is preserved (see the row filter
 * in resolveTimesheetGrid) so nothing already entered or paid can vanish.
 */
function isRemovedAssignmentStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    status.trim() !== '' &&
    normalizeAssignmentStatus(status) === 'cancelled'
  );
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
  // The `Assignment` interface doesn't include shiftId today, so the
  // cast goes through `unknown` to satisfy strict TS's overlap check.
  const rawAny = raw as unknown as Record<string, unknown>;
  const rawShiftId =
    rawAny.shiftId ??
    (rawAny.shift as Record<string, unknown> | undefined)?.id ??
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
    isOpenShift: rawAny.isOpenShift === true || rawAny.noFixedTimes === true,
  };
}

/**
 * Synthesize an AssignmentSnapshot for a CSV-import entry, which usually has
 * no real assignment. Pulls identity + display from the entry's `import`
 * sidecar so the grid's WorkerSiteCell shows the worker (or the CSV name when
 * unmatched) and the worksite, without an assignment doc behind it.
 */
function buildImportSnapshot(entry: TimesheetEntryV2): AssignmentSnapshot {
  const imp = entry.import;
  const displayName =
    (imp?.matchedWorkerName && imp.matchedWorkerName.trim()) ||
    (imp?.csvWorkerName && imp.csvWorkerName.trim()) ||
    (entry.workerId ? entry.workerId : null);
  return {
    id: entry.assignmentId || entry.id,
    jobOrderId: entry.jobOrderId || '',
    shiftId: entry.shiftId || null,
    candidateId: entry.workerId || '',
    workerId: entry.workerId || '',
    hiringEntityId: entry.hiringEntityId || null,
    workerDisplayName: displayName,
    worksiteState: entry.workState || null,
    worksiteDisplayName: imp?.worksiteName ?? imp?.csvSite ?? null,
    payRate: typeof entry.payRate === 'number' ? entry.payRate : 0,
    billRate: typeof entry.billRate === 'number' ? entry.billRate : 0,
    shiftBreakDefaultMinutes: 0,
    isOpenShift: false,
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
    case 'tenant_period':
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
    } else if (filter.kind === 'tenant_period') {
      // Tenant-wide week view (Who's Working report). Four single-field
      // queries — all served by Firestore's automatic indexes, no
      // composite needed:
      //   1. startDate within [period.start − 14d, period.end] — catches
      //      every per-day doc in the week (the dominant shape) plus
      //      finite multi-day docs starting up to two weeks earlier
      //      (observed max span in prod is 8 days).
      //   2. endDate within the period — belt for a finite multi-day doc
      //      that started before the look-back but ends in the week.
      //   3+4. Open-shift / standing-crew flags — those CAN run for
      //      months and would slip past both date ranges when they span
      //      the whole week.
      // The overlap filter below prunes the union to the period.
      const lookback = new Date(`${period.start}T00:00:00`);
      lookback.setDate(lookback.getDate() - 14);
      const pad = (n: number) => String(n).padStart(2, '0');
      const lookbackIso = `${lookback.getFullYear()}-${pad(lookback.getMonth() + 1)}-${pad(lookback.getDate())}`;
      const snaps = await Promise.all([
        getDocs(
          query(
            assignmentsCol,
            where('startDate', '>=', lookbackIso),
            where('startDate', '<=', period.end),
          ),
        ),
        getDocs(
          query(
            assignmentsCol,
            where('endDate', '>=', period.start),
            where('endDate', '<=', period.end),
          ),
        ),
        getDocs(query(assignmentsCol, where('isOpenShift', '==', true))),
        getDocs(query(assignmentsCol, where('noFixedTimes', '==', true))),
      ]);
      const byId = new Map<string, Assignment & { id: string }>();
      for (const snap of snaps) {
        for (const d of snap.docs) {
          byId.set(d.id, { ...(d.data() as Assignment), id: d.id });
        }
      }
      rawAssignments = Array.from(byId.values());
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
  // Assignment ids whose status marks the worker as removed (cancelled /
  // declined). They still flow through overlap + expansion so any row
  // with a real timesheet entry survives, but their *empty* rows are
  // dropped after hydration — killing phantom payable rows.
  const removedAssignmentIds = new Set<string>();

  for (const a of rawAssignments) {
    const check = assignmentOverlapsPeriod(a.id, a, period);
    if (check.overlaps) {
      overlapping.push(a);
      if (isRemovedAssignmentStatus((a as { status?: unknown }).status)) {
        removedAssignmentIds.add(a.id);
      }
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
    // Open shift = standing-crew assignment with no fixed daily times.
    // It carries no weeklySchedule, so the per-DOW expansion below would
    // yield zero rows. Instead generate a blank row for EVERY calendar
    // day in the assignment's active window ∩ the period (including days
    // ahead of today, so the grid shows the full week going forward) — the
    // recruiter enters total hours per worked day (actualHoursOverride) and
    // leaves off-days blank (no entry doc is created for an untouched row).
    const isOpen =
      (a as unknown as Record<string, unknown>).isOpenShift === true ||
      (a as unknown as Record<string, unknown>).noFixedTimes === true;
    // An assignment with no weekly pattern can't be expanded by day-of-week.
    // This covers open/standing-crew shifts AND single-/finite-day gig & event
    // shifts that are pinned by the assignment's own date window (startDate /
    // endDate) rather than a recurring schedule. For those, seed a blank "no
    // fixed times" timecard row for each day in the window ∩ period. Without
    // this they silently generate no rows and the workers can't be paid.
    const hasWeeklySchedule =
      !!a.weeklySchedule &&
      Object.keys(a.weeklySchedule as Record<string, unknown>).length > 0;
    const perDay = isOpen || !hasWeeklySchedule;

    for (const d of periodDates) {
      // Day must also be inside the assignment's own active window.
      // Otherwise, a Mon/Wed schedule on an assignment that ended on
      // Tuesday would still yield a Wed row.
      if (startStr && !isoDateGte(d, startStr)) continue;
      if (endStr && !isoDateLte(d, endStr)) continue;
      if (perDay) {
        tuples.push({ assignment: a, workDate: d, scheduled: OPEN_SHIFT_SCHEDULED });
        perAssignmentDayCount += 1;
        continue;
      }
      const scheduled = scheduledShiftForDate(a, d);
      if (!scheduled) continue;
      tuples.push({ assignment: a, workDate: d, scheduled });
      perAssignmentDayCount += 1;
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

  // Drop phantom rows from removed (cancelled/declined) assignments. An
  // *empty* row from such an assignment is a worker who was taken off the
  // shift but never hard-deleted — it must not appear as payable. A row
  // that resolved to a real entry is kept: if hours were already entered
  // (or paid) before the cancel, hiding it would lose payroll data.
  if (removedAssignmentIds.size > 0) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const r = rows[i];
      if (r.kind === 'empty' && removedAssignmentIds.has(r.assignment.id)) {
        rows.splice(i, 1);
      }
    }
  }

  // Step 3b: CSV-import entries. These are worker-anchored and usually have
  // no assignment, so the assignment-driven pass above never surfaces them.
  // Query them directly for the period and synthesize a row each, so the Grid
  // is the single source of truth — paid AND blocked import rows both show.
  // The (source, hiringEntityId, workDate) composite index requires an
  // entity-scoped query, so tenant_period enumerates its entity ids and
  // runs one query each.
  const importHiringEntityIds =
    filter.kind === 'entity_period'
      ? [filter.hiringEntityId]
      : filter.kind === 'tenant_period'
        ? filter.hiringEntityIds ?? []
        : [];
  for (const importHiringEntityId of importHiringEntityIds) {
    try {
      const importSnap = await getDocs(
        query(
          entriesCol,
          where('source', '==', 'csv_import'),
          where('hiringEntityId', '==', importHiringEntityId),
          where('workDate', '>=', period.start),
          where('workDate', '<=', period.end),
        ),
      );
      for (const d of importSnap.docs) {
        const entry = { ...(d.data() as TimesheetEntryV2), id: d.id };
        const wd = entry.workDate;
        if (!isYyyyMmDdString(wd)) continue;
        rows.push({
          kind: 'entry',
          key: d.id,
          assignment: buildImportSnapshot(entry),
          workDate: wd.trim() as IsoDate,
          scheduled: OPEN_SHIFT_SCHEDULED,
          entry,
          isImport: true,
        });
      }
    } catch (err) {
      // Isolated — a missing composite index degrades gracefully (assignment
      // rows still render) rather than blanking the grid.
      errors.push(
        `Failed to load imported timesheet rows: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Step 4a: Workers' Comp resolution (2026-06-03). Same chain the
  // server pre-flight uses — entry override → shift → JO legacy → JO
  // canonical → JO position[0]. Done client-side so the WC Code / WC
  // Rate columns can render the resolved value (and the inline editor
  // can disambiguate "set on this entry" vs "inherited from shift").
  //
  // Reads are deduped by (jobOrderId) and (jobOrderId, shiftId); typical
  // period view spans a handful of each, so a few extra reads beats
  // denormalizing the WC fields onto every entry doc.
  const uniqueJoIds = new Set<string>();
  const uniqueShifts = new Set<string>(); // `${joId}|${shiftId}`
  for (const r of rows) {
    if (r.assignment.jobOrderId) uniqueJoIds.add(r.assignment.jobOrderId);
    if (r.assignment.jobOrderId && r.assignment.shiftId) {
      uniqueShifts.add(`${r.assignment.jobOrderId}|${r.assignment.shiftId}`);
    }
  }
  const joWcCache = new Map<string, Record<string, unknown>>();
  const shiftWcCache = new Map<string, Record<string, unknown>>();
  await Promise.all([
    ...Array.from(uniqueJoIds).map(async (joId) => {
      try {
        const s = await getDoc(doc(fdb, 'tenants', tenantId, 'job_orders', joId));
        if (s.exists()) joWcCache.set(joId, s.data() as Record<string, unknown>);
      } catch {
        // Non-fatal — row falls back to entry override if the JO read fails.
      }
    }),
    ...Array.from(uniqueShifts).map(async (key) => {
      const [joId, shiftId] = key.split('|');
      if (!joId || !shiftId) return;
      try {
        const s = await getDoc(
          doc(fdb, 'tenants', tenantId, 'job_orders', joId, 'shifts', shiftId),
        );
        if (s.exists()) shiftWcCache.set(key, s.data() as Record<string, unknown>);
      } catch {
        // Non-fatal.
      }
    }),
  ]);
  for (const r of rows) {
    if (r.kind !== 'entry' && r.kind !== 'empty') continue;
    const joId = r.assignment.jobOrderId;
    const shiftId = r.assignment.shiftId;
    const jo = joId ? joWcCache.get(joId) : undefined;
    const shift = joId && shiftId ? shiftWcCache.get(`${joId}|${shiftId}`) : undefined;
    const firstGigPosition =
      jo && Array.isArray(jo.gigPositions) && jo.gigPositions.length > 0
        ? (jo.gigPositions[0] as Record<string, unknown>)
        : undefined;
    const codeOverride =
      r.kind === 'entry'
        ? typeof (r.entry as unknown as Record<string, unknown>).workersCompCode === 'string'
          ? String((r.entry as unknown as Record<string, unknown>).workersCompCode)
          : undefined
        : undefined;
    const rateOverride =
      r.kind === 'entry'
        ? typeof (r.entry as unknown as Record<string, unknown>).workersCompRate === 'number'
          ? Number((r.entry as unknown as Record<string, unknown>).workersCompRate)
          : undefined
        : undefined;
    const codeStr = pickWcDisplayStr(
      codeOverride,
      shift?.workersCompCode,
      jo?.workersCompCode,
      jo?.workersCompClassCode,
      firstGigPosition?.workersCompClassCode,
    );
    const rateNum = pickWcDisplayNum(
      rateOverride,
      shift?.workersCompRate,
      jo?.workersCompRate,
      firstGigPosition?.workersCompRate,
    );
    (r as unknown as Record<string, unknown>).resolvedWorkersCompCode = codeStr;
    (r as unknown as Record<string, unknown>).resolvedWorkersCompRate = rateNum;
    (r as unknown as Record<string, unknown>).hasEntryWorkersCompOverride =
      codeOverride != null || rateOverride != null;
  }

  // Step 4b: stable sort by worker → date → assignmentId.
  rows.sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)));

  return {
    rows,
    errors,
    // Exclude removed assignments that contributed no surviving row, so the
    // "no scheduled work in this period" empty-state copy reflects real
    // engagements rather than counting cancelled phantoms.
    consideredAssignmentCount: overlapping.length - removedWithNoRows(rows, removedAssignmentIds),
  };
}

/** Count removed assignments that left zero rows behind (all their rows
 *  were empty and got filtered). Used only to keep the considered-count
 *  honest for the empty-state copy. */
function removedWithNoRows(
  rows: TimesheetGridRow[],
  removedAssignmentIds: Set<string>,
): number {
  if (removedAssignmentIds.size === 0) return 0;
  const survivors = new Set<string>();
  for (const r of rows) survivors.add(r.assignment.id);
  let count = 0;
  for (const id of removedAssignmentIds) {
    if (!survivors.has(id)) count += 1;
  }
  return count;
}

/** Pick the first non-empty string from a list; coerce numbers to strings.
 *  Mirror of the server pre-flight's `pickWcStr`. */
function pickWcDisplayStr(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return undefined;
}

function pickWcDisplayNum(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.trim()) {
      const n = Number.parseFloat(c);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
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
/**
 * "Has the recruiter touched this entry yet?" — the predicate the
 * bulk-approve and bulk-submit affordances use to skip rows that
 * exist only because the auto-create-on-narrow path materialized
 * them. An empty draft entry is a placeholder, NOT an intentional
 * "0 hours worked" submission; bulk actions should respect that.
 *
 * Returns true iff any of:
 *   - `actualStartTime` is a non-empty string
 *   - `actualEndTime` is a non-empty string
 *   - `actualHoursOverride` is a positive number
 *
 * Tips / bonus alone don't count — those without hours are almost
 * certainly a typo the recruiter is mid-correcting, not a real
 * payable.
 *
 * Per-row click-to-approve on the status pill is intentionally NOT
 * gated by this — the recruiter may want to deliberately approve a
 * no-show entry (0 hours, archived as confirmed) and we shouldn't
 * silently block that one-off case. Only the bulk affordances
 * filter via this helper.
 */
export function entryHasRecruiterData(
  entry: Pick<TimesheetEntryV2, 'actualStartTime' | 'actualEndTime' | 'actualHoursOverride'>,
): boolean {
  const start = entry.actualStartTime;
  if (typeof start === 'string' && start.trim().length > 0) return true;
  const end = entry.actualEndTime;
  if (typeof end === 'string' && end.trim().length > 0) return true;
  const override = entry.actualHoursOverride;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return true;
  return false;
}

export function actualHoursForRow(row: TimesheetGridRow): number {
  if (row.kind !== 'entry') return 0;
  const regular = typeof row.entry.totalRegularHours === 'number' ? row.entry.totalRegularHours : 0;
  const ot = typeof row.entry.totalOTHours === 'number' ? row.entry.totalOTHours : 0;
  const dt = typeof row.entry.totalDoubleTimeHours === 'number' ? row.entry.totalDoubleTimeHours : 0;
  return regular + ot + dt;
}

/** Per-row gross pay ($) — mirrors the grid's Total column + the batch
 *  submitter: reg*rate + ot*rate*1.5 + dt*rate*2 + meal*rate + rest*rate +
 *  tips + bonus for scheduled entries (meal/rest are CA break-penalty hours
 *  paid at the regular rate — see createTimesheetBatch.ts's server-side
 *  total, which this must match or the pre-submission total under-counts
 *  what's actually sent to and paid by Everee); hours*rate + tips + bonus
 *  for CSV-import rows. Empty rows = 0. */
export function dollarAmountForRow(row: TimesheetGridRow): number {
  if (row.kind !== 'entry') return 0;
  const e = row.entry;
  const payRate = typeof e.payRate === 'number' ? e.payRate : 0;
  const tips = typeof e.tips === 'number' ? e.tips : 0;
  const bonus = typeof e.bonusAmount === 'number' ? e.bonusAmount : 0;
  if (row.isImport) {
    // Import entries now carry a real reg/OT split (FLSA weekly-40 cascade
    // in submitImportTimesheetBatch, 2026-07-06); legacy rows have
    // totalRegularHours == all hours so the formula reduces to flat.
    const iReg = typeof e.totalRegularHours === 'number' ? e.totalRegularHours : actualHoursForRow(row);
    const iOt = typeof e.totalOTHours === 'number' ? e.totalOTHours : 0;
    const gross = iReg * payRate + iOt * payRate * 1.5 + tips + bonus;
    return Number.isFinite(gross) ? gross : 0;
  }
  const reg = typeof e.totalRegularHours === 'number' ? e.totalRegularHours : 0;
  const ot = typeof e.totalOTHours === 'number' ? e.totalOTHours : 0;
  const dt = typeof e.totalDoubleTimeHours === 'number' ? e.totalDoubleTimeHours : 0;
  const meal = typeof e.mealBreakPenaltyHours === 'number' ? e.mealBreakPenaltyHours : 0;
  const rest = typeof e.restBreakPenaltyHours === 'number' ? e.restBreakPenaltyHours : 0;
  const gross =
    reg * payRate + ot * payRate * 1.5 + dt * payRate * 2 + meal * payRate + rest * payRate + tips + bonus;
  return Number.isFinite(gross) ? gross : 0;
}

/** Status string used by the row's status pill. Empty rows show the
 *  literal "—" instead of any draft state — they have no entry yet.
 *  Import rows surface their `import.matchStatus` (blocked / needs_rate /
 *  submitted / …) rather than the canonical `draft` they map to. */
export type TimesheetRowDisplayStatus =
  | TimesheetEntryStatus
  | 'no_entry'
  | 'import_ready'
  | 'import_needs_rate'
  | 'import_needs_wc'
  | 'import_blocked'
  | 'import_submitted'
  | 'import_paid'
  | 'import_voided';

export function displayStatusForRow(row: TimesheetGridRow): TimesheetRowDisplayStatus {
  if (row.kind === 'empty') return 'no_entry';
  if (row.kind === 'entry' && row.isImport) {
    const ms = row.entry.import?.matchStatus;
    if (ms) return `import_${ms}` as TimesheetRowDisplayStatus;
  }
  return row.entry.status;
}
