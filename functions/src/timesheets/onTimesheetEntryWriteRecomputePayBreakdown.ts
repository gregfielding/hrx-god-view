/**
 * onTimesheetEntryWriteRecomputePayBreakdown — recompute pay breakdown
 * for the entry's full workweek.
 *
 * **TS.1.P2.B.** Wires the pure rules engine (`payRules/`) to the
 * `tenants/{tid}/timesheet_entries/{entryId}` write stream. Whenever
 * a recruiter edits actuals, breaks, or workDate (or an entry is
 * created/deleted), this trigger:
 *
 *   1. Gates on whether ANY compute-input field actually changed
 *      (cheap diff before any reads — saves the read budget on
 *      notes-only edits and status flips, the most common write
 *      class for approved-pending-batch entries).
 *   2. Resolves the worker × hiring entity × workweek scope. Each
 *      hiring entity tracks weekly OT independently per the
 *      staffing-industry convention — pooling C1 Events hours with
 *      C1 Select hours would over-promote regular hours to OT.
 *   3. Loads all sibling entries in that workweek, builds `DayInput`s,
 *      calls the pure `computeWeekBreakdown`, and writes back changed
 *      breakdowns ONLY (skip-when-equal per entry — same dual-guard
 *      pattern as P1.B.2).
 *
 * **Why week-scoped, not single-entry-isolated.** Adding 5h to
 * Wednesday can flip Friday from regular to OT once the worker
 * crosses 40h/wk. CA's 7th-consecutive-day rule is also cascading.
 * A single user edit can fan out to N entry writes (N = days in the
 * week with changed breakdown). Each fan-out write re-fires the
 * trigger but the self-fire guard short-circuits it before the
 * sibling read — once steady-state is reached, every sibling write
 * is a no-op.
 *
 * **Workweek vs pay period.** OT computation uses the standard 7-day
 * workweek (FLSA), starting on the entity's `payPeriodPolicy.weekStartDOW`
 * if set, falling back to Sunday otherwise. For
 * `policyType: 'per_event'` entities (C1 Events), pay BATCHES don't
 * align to calendar weeks — but daily OT and weekly OT rules still
 * apply per state. Workweek and pay-period are different concepts;
 * they happen to overlap for `policyType: 'weekly'` entities.
 *
 * **workDate/identity changes.** When an edit moves an entry to a
 * different workDate, the OLD workweek may need recomputation too
 * (one less day in the old week could un-flip an OT cascade). Same
 * for workerId / hiringEntityId changes (rare, but a recruiter
 * re-keying an entry should trigger both sides). The trigger
 * recomputes both windows when applicable.
 *
 * **Delete handling.** When an entry is deleted, the trigger reads
 * `before` for workerId/hiringEntityId/workDate and recomputes that
 * workweek (less one entry — cascade may need to un-flip).
 *
 * **Cost analysis.** Per user-driven write that changes inputs:
 *   - 1 entity-doc read (for weekStartDOW)
 *   - 1 sibling-collection query (typically 1-7 docs in a workweek)
 *   - K assignment-doc reads where K = number of distinct
 *     assignmentIds in the workweek (worker can have multiple
 *     assignments per entity per week — each entry's `workState`
 *     drives state dispatch and is already on the entry doc, so we
 *     don't actually need the assignment for the engine; we only
 *     read it if the entry is missing `workState` as a fallback)
 *   - N <= 7 entry-doc writes (only entries whose breakdown changed)
 *
 * Each fan-out re-fire is gated to ZERO reads / ZERO writes by the
 * self-fire guard.
 *
 * **Source-of-truth for state code.** The entry's denormalized
 * `workState` is the engine's state-code input. If empty/null, we
 * fall back to the assignment's `worksiteState` (P1.B denorm), and
 * finally to DEFAULT (federal) so the engine never throws.
 *
 * @see TS.1 build plan §5 — multistate pay rules
 * @see functions/src/timesheets/payRules/computeWeekBreakdown.ts
 */

import * as admin from 'firebase-admin';
import _ from 'lodash';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { computeWeekBreakdown } from './payRules/computeWeekBreakdown';
import {
  workedMinutesFromActuals,
  workWeekRangeFor,
} from './payRules/helpers';
import {
  ComputeWeekResult,
  DayBreakdown,
  DayInput,
} from './payRules/types';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * Fields whose change can affect the engine's output. A write that
 * touches NONE of these is a no-op for pay computation (notes,
 * status flips, approver bookkeeping, etc.) and should never read
 * sibling entries.
 *
 * Includes `workDate`, `workerId`, `hiringEntityId` because they
 * change the workweek scope itself — moving an entry to a different
 * day or re-keying its identity requires recompute of both the OLD
 * and NEW workweeks.
 */
const COMPUTE_INPUT_FIELDS = [
  'actualStartTime',
  'actualEndTime',
  'breaks',
  'actualHoursOverride',
  'workDate',
  'workState',
  'workerId',
  'hiringEntityId',
] as const;

/**
 * Fields the trigger writes back to entries. Used by the self-fire
 * guard to recognize "this write came from me" and exit before the
 * sibling read.
 */
const COMPUTED_FIELDS = [
  'totalRegularHours',
  'totalOTHours',
  'totalFlsaOTHours',
  'totalNonFlsaOTHours',
  'totalDoubleTimeHours',
  'mealBreakPenaltyHours',
  'restBreakPenaltyHours',
] as const;

/**
 * Auxiliary fields the trigger touches alongside computed fields.
 * `updatedAt` always rolls forward when we patch.
 */
const ANCILLARY_FIELDS = ['updatedAt'] as const;

const SELF_FIRE_IGNORED_FIELDS = new Set<string>([
  ...COMPUTED_FIELDS,
  ...ANCILLARY_FIELDS,
]);

type EntryData = Record<string, unknown>;

/**
 * Tier-1 pre-compute gate. Returns `true` when at least one
 * compute-input field actually changed between before/after. Creates
 * always return `true` (need to compute initial breakdown).
 *
 * Cheap: pure deep-equal over a fixed 7-field whitelist. No Firestore
 * reads, runs in microseconds.
 */
function computeInputChanged(
  before: EntryData | null,
  after: EntryData | null,
): boolean {
  if (!before) return true;
  if (!after) return true;
  for (const f of COMPUTE_INPUT_FIELDS) {
    if (!_.isEqual(before[f], after[f])) return true;
  }
  return false;
}

/**
 * Tier-2 self-fire guard. Returns `true` when the write changed ONLY
 * computed/ancillary fields, indicating it's the trigger's own write
 * coming back through the stream. Exits before the sibling read.
 *
 * Distinct from `computeInputChanged === false`: a status-only flip
 * also produces `computeInputChanged === false`, but that's caught by
 * the Tier-1 gate above. This guard is specifically for re-fires of
 * the trigger's own writes, where some computed fields differ from
 * before but no inputs do.
 */
function onlyComputedFieldsChanged(
  before: EntryData | null,
  after: EntryData,
): boolean {
  if (!before) return false;
  const allKeys = new Set<string>([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);
  for (const k of allKeys) {
    if (SELF_FIRE_IGNORED_FIELDS.has(k)) continue;
    if (!_.isEqual(before[k], after[k])) return false;
  }
  return true;
}

/**
 * Resolve the workweek's start day-of-week (0=Sun..6=Sat) for an
 * entity. For `policyType: 'weekly'` we use the entity's
 * `weekStartDOW`. For `policyType: 'per_event'` (C1 Events) the pay
 * batches don't align to calendar weeks but OT computation still
 * needs a 7-day window — fall back to Sunday-start (FLSA convention).
 *
 * Returns `null` when the entity doc is missing or unreadable; caller
 * treats that as "use FLSA default (0)" and continues.
 */
async function resolveWeekStartDOW(
  tenantId: string,
  hiringEntityId: string,
): Promise<number | null> {
  if (!hiringEntityId) return null;
  try {
    const snap = await db
      .doc(`tenants/${tenantId}/entities/${hiringEntityId}`)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown> | undefined;
    const policy = data?.payPeriodPolicy as
      | { policyType?: string; weekStartDOW?: number }
      | undefined;
    if (!policy) return null;
    if (typeof policy.weekStartDOW === 'number' && Number.isFinite(policy.weekStartDOW)) {
      return policy.weekStartDOW;
    }
    return null;
  } catch (err) {
    logger.warn(
      '[TS.1.P2.B][onTimesheetEntryWriteRecomputePayBreakdown] entity read failed (using DOW=0 fallback)',
      {
        tenantId,
        hiringEntityId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return null;
  }
}

/**
 * Build a `DayInput` from a TimesheetEntryV2 doc snapshot. Pure-ish
 * (just data shaping, no I/O). Returns `null` when the doc is
 * missing required identity fields — those entries shouldn't be in
 * the sibling set, but defense-in-depth.
 */
function buildDayInput(entryId: string, data: EntryData): DayInput | null {
  const workDate = typeof data.workDate === 'string' ? data.workDate : null;
  if (!workDate) return null;
  const actualStart =
    typeof data.actualStartTime === 'string' && data.actualStartTime.trim()
      ? data.actualStartTime
      : null;
  const actualEnd =
    typeof data.actualEndTime === 'string' && data.actualEndTime.trim()
      ? data.actualEndTime
      : null;
  const breaksRaw = Array.isArray(data.breaks) ? data.breaks : [];
  const breaks = breaksRaw
    .filter(
      (b): b is { startTime: string; endTime: string; durationMins: number; paid: boolean } =>
        !!b &&
        typeof b === 'object' &&
        typeof (b as Record<string, unknown>).startTime === 'string' &&
        typeof (b as Record<string, unknown>).endTime === 'string' &&
        typeof (b as Record<string, unknown>).durationMins === 'number' &&
        typeof (b as Record<string, unknown>).paid === 'boolean',
    )
    .map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
      durationMins: b.durationMins,
      paid: b.paid,
    }));

  // 2026-05-26 — when the recruiter entered a manual total-hours
  // override (no start/end times — common for clients that report
  // a single "worked X.XX hrs" figure), short-circuit the workedMinutes
  // computation. The override is only honored when BOTH actualStart
  // and actualEnd are missing; if either is set, the time-based
  // computation wins (and the UI shouldn't have shown the override
  // as editable). See TimesheetEntryV2.actualHoursOverride for the
  // full semantics.
  const overrideHoursRaw = (data as Record<string, unknown>).actualHoursOverride;
  const overrideHours =
    !actualStart &&
    !actualEnd &&
    typeof overrideHoursRaw === 'number' &&
    Number.isFinite(overrideHoursRaw) &&
    overrideHoursRaw > 0
      ? overrideHoursRaw
      : null;

  const workedMinutes =
    overrideHours !== null
      ? Math.round(overrideHours * 60)
      : workedMinutesFromActuals(actualStart, actualEnd, breaks);

  return {
    entryId,
    workDate,
    workedMinutes,
    breaks: overrideHours !== null ? [] : breaks,
    // When using an override, deliberately pass null for the time-of-
    // day boundaries so daily OT rules (CA daily-8, CA 7th-consecutive)
    // skip this day. Weekly OT cascade still applies because it
    // operates on total weekly minutes regardless of source.
    actualStartTime: overrideHours !== null ? null : actualStart,
    actualEndTime: overrideHours !== null ? null : actualEnd,
  };
}

/**
 * The workweek scope key. The trigger may need to recompute one or
 * two workweeks when an entry's identity (workerId / hiringEntityId
 * / workDate) changes — we collect all the affected scopes from
 * before/after and de-dupe before fetching siblings.
 */
interface WorkweekScope {
  tenantId: string;
  workerId: string;
  hiringEntityId: string;
  /** Inclusive YYYY-MM-DD. */
  workWeekStart: string;
  workWeekEnd: string;
}

function scopeKey(s: WorkweekScope): string {
  return [s.tenantId, s.workerId, s.hiringEntityId, s.workWeekStart].join('|');
}

/**
 * Extract the workweek scope from an entry's data, given a resolved
 * weekStartDOW. Returns `null` when the entry is missing identity
 * fields needed to scope the query.
 */
function extractScope(
  tenantId: string,
  data: EntryData,
  weekStartDOW: number,
): WorkweekScope | null {
  const workerId = typeof data.workerId === 'string' ? data.workerId : null;
  const hiringEntityId =
    typeof data.hiringEntityId === 'string' ? data.hiringEntityId : null;
  const workDate = typeof data.workDate === 'string' ? data.workDate : null;
  if (!workerId || !hiringEntityId || !workDate) return null;
  const range = workWeekRangeFor(workDate, weekStartDOW);
  if (!range) return null;
  return {
    tenantId,
    workerId,
    hiringEntityId,
    workWeekStart: range.start,
    workWeekEnd: range.end,
  };
}

/**
 * Compare two breakdowns for skip-when-equal write decisions. Uses
 * a small epsilon (0.005h = 18 seconds) to absorb floating-point
 * round-trip drift across multiple recomputes — without it, a
 * sequence of recomputes could write back differing 17th-decimal
 * values forever.
 */
function breakdownsEqual(a: DayBreakdown, b: DayBreakdown): boolean {
  const eps = 0.005;
  return (
    Math.abs(a.totalRegularHours - b.totalRegularHours) < eps &&
    Math.abs(a.totalOTHours - b.totalOTHours) < eps &&
    Math.abs(a.totalFlsaOTHours - b.totalFlsaOTHours) < eps &&
    Math.abs(a.totalNonFlsaOTHours - b.totalNonFlsaOTHours) < eps &&
    Math.abs(a.totalDoubleTimeHours - b.totalDoubleTimeHours) < eps &&
    Math.abs(a.mealBreakPenaltyHours - b.mealBreakPenaltyHours) < eps &&
    Math.abs(a.restBreakPenaltyHours - b.restBreakPenaltyHours) < eps
  );
}

function readBreakdown(data: EntryData): DayBreakdown {
  return {
    totalRegularHours:
      typeof data.totalRegularHours === 'number' ? data.totalRegularHours : 0,
    totalOTHours: typeof data.totalOTHours === 'number' ? data.totalOTHours : 0,
    // Default 0 for legacy entries written before P2.C — they read as
    // {flsa: 0, nonFlsa: 0} which won't match the engine's split, so
    // breakdownsEqual returns false and the entry gets re-stamped on
    // its next write. Acceptable backfill behavior.
    totalFlsaOTHours:
      typeof data.totalFlsaOTHours === 'number' ? data.totalFlsaOTHours : 0,
    totalNonFlsaOTHours:
      typeof data.totalNonFlsaOTHours === 'number'
        ? data.totalNonFlsaOTHours
        : 0,
    totalDoubleTimeHours:
      typeof data.totalDoubleTimeHours === 'number'
        ? data.totalDoubleTimeHours
        : 0,
    mealBreakPenaltyHours:
      typeof data.mealBreakPenaltyHours === 'number'
        ? data.mealBreakPenaltyHours
        : 0,
    restBreakPenaltyHours:
      typeof data.restBreakPenaltyHours === 'number'
        ? data.restBreakPenaltyHours
        : 0,
  };
}

/**
 * Pick the state code for the engine. Source-of-truth precedence:
 *   1. Entry's denormalized `workState`
 *   2. Engine's DEFAULT fallback (handled inside `computeWeekBreakdown`)
 *
 * The engine also accepts arbitrary string codes and falls through to
 * DEFAULT on unknowns, so we don't need to validate here.
 */
function pickStateCode(data: EntryData): string {
  if (typeof data.workState === 'string' && data.workState.trim().length > 0) {
    return data.workState.trim();
  }
  return 'DEFAULT';
}

/**
 * Recompute one workweek scope. Reads siblings, calls the engine,
 * writes back changed breakdowns only.
 *
 * Returns the count of entries whose breakdowns changed (for log
 * aggregation across multiple scopes).
 */
async function recomputeScope(scope: WorkweekScope): Promise<number> {
  const { tenantId, workerId, hiringEntityId, workWeekStart, workWeekEnd } = scope;

  let siblingsSnap;
  try {
    siblingsSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('timesheet_entries')
      .where('hiringEntityId', '==', hiringEntityId)
      .where('workerId', '==', workerId)
      .where('workDate', '>=', workWeekStart)
      .where('workDate', '<=', workWeekEnd)
      .get();
  } catch (err) {
    logger.error(
      '[TS.1.P2.B][onTimesheetEntryWriteRecomputePayBreakdown] sibling query failed',
      {
        tenantId,
        workerId,
        hiringEntityId,
        workWeekStart,
        workWeekEnd,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return 0;
  }

  if (siblingsSnap.empty) {
    // The triggering entry has been deleted and there are no other
    // entries this workweek. Nothing to recompute.
    return 0;
  }

  // Build the engine input. Pick the state code from the FIRST
  // entry's workState — we don't expect mixed states inside a single
  // worker × entity × week (an entity is tied to a state via its
  // worksite address; same entity → same state). If somehow mixed,
  // we go with the first encountered which is deterministic by
  // workDate ordering after sort.
  const days: DayInput[] = [];
  let stateCode = 'DEFAULT';
  let stateCodePicked = false;
  // Sort docs by workDate ascending for deterministic state pick.
  const sortedDocs = [...siblingsSnap.docs].sort((a, b) => {
    const aw = a.data().workDate as string | undefined;
    const bw = b.data().workDate as string | undefined;
    return (aw ?? '') < (bw ?? '') ? -1 : (aw ?? '') > (bw ?? '') ? 1 : 0;
  });
  for (const doc of sortedDocs) {
    const data = doc.data();
    const dayInput = buildDayInput(doc.id, data);
    if (dayInput) days.push(dayInput);
    if (!stateCodePicked) {
      stateCode = pickStateCode(data);
      stateCodePicked = true;
    }
  }

  if (days.length === 0) {
    return 0;
  }

  let result: ComputeWeekResult;
  try {
    result = computeWeekBreakdown({
      stateCode,
      days,
      workWeekStartDate: workWeekStart,
    });
  } catch (err) {
    logger.error(
      '[TS.1.P2.B][onTimesheetEntryWriteRecomputePayBreakdown] engine threw',
      {
        tenantId,
        workerId,
        hiringEntityId,
        workWeekStart,
        stateCode,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return 0;
  }

  // Per-entry skip-when-equal write-back. Each comparison is local
  // to that entry's stored breakdown vs the engine's output —
  // siblings whose breakdown didn't change get NO write, which is
  // what bounds fan-out cost.
  const batch = db.batch();
  let writeCount = 0;
  for (const doc of sortedDocs) {
    const data = doc.data();
    const computed = result.get(doc.id);
    if (!computed) continue; // shouldn't happen — engine guarantees coverage
    const current = readBreakdown(data);
    if (breakdownsEqual(current, computed)) continue;
    batch.set(
      doc.ref,
      {
        totalRegularHours: computed.totalRegularHours,
        totalOTHours: computed.totalOTHours,
        totalFlsaOTHours: computed.totalFlsaOTHours,
        totalNonFlsaOTHours: computed.totalNonFlsaOTHours,
        totalDoubleTimeHours: computed.totalDoubleTimeHours,
        mealBreakPenaltyHours: computed.mealBreakPenaltyHours,
        restBreakPenaltyHours: computed.restBreakPenaltyHours,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    writeCount += 1;
  }

  if (writeCount === 0) return 0;

  try {
    await batch.commit();
  } catch (err) {
    logger.error(
      '[TS.1.P2.B][onTimesheetEntryWriteRecomputePayBreakdown] batch write failed',
      {
        tenantId,
        workerId,
        hiringEntityId,
        workWeekStart,
        writeCount,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return 0;
  }

  return writeCount;
}

export const onTimesheetEntryWriteRecomputePayBreakdown = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/timesheet_entries/{entryId}',
    region: 'us-central1',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const entryId = event.params.entryId as string;

    const beforeData = event.data?.before?.exists
      ? (event.data.before.data() as EntryData)
      : null;
    const afterData = event.data?.after?.exists
      ? (event.data.after.data() as EntryData)
      : null;

    // Tier-1 pre-compute gate. Cheapest possible exit — runs before
    // any reads.
    if (!computeInputChanged(beforeData, afterData)) {
      return;
    }

    // Tier-2 self-fire guard. Detects the trigger's own write coming
    // back through the stream. Tier-1 catches most no-op writes (incl.
    // status-only flips); Tier-2 specifically catches recompute
    // re-fires where computed fields are the only deltas.
    if (afterData && onlyComputedFieldsChanged(beforeData, afterData)) {
      return;
    }

    // Build the set of workweek scopes to recompute. For most edits
    // this is exactly one scope. Identity changes (workDate / workerId
    // / hiringEntityId / state code change crossing a worksite) can
    // produce two: the OLD scope (from before-data) AND the NEW scope
    // (from after-data).
    const scopes: WorkweekScope[] = [];
    const seenKeys = new Set<string>();

    /** Resolve weekStartDOW for a given hiringEntityId, with caching. */
    const dowCache = new Map<string, number>();
    const getDow = async (hiringEntityId: string): Promise<number> => {
      if (dowCache.has(hiringEntityId)) return dowCache.get(hiringEntityId)!;
      const resolved = await resolveWeekStartDOW(tenantId, hiringEntityId);
      const dow = resolved ?? 0;
      dowCache.set(hiringEntityId, dow);
      return dow;
    };

    if (afterData) {
      const afterEntityId =
        typeof afterData.hiringEntityId === 'string' ? afterData.hiringEntityId : '';
      if (afterEntityId) {
        const dow = await getDow(afterEntityId);
        const scope = extractScope(tenantId, afterData, dow);
        if (scope) {
          const key = scopeKey(scope);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            scopes.push(scope);
          }
        }
      }
    }
    if (beforeData) {
      const beforeEntityId =
        typeof beforeData.hiringEntityId === 'string' ? beforeData.hiringEntityId : '';
      if (beforeEntityId) {
        const dow = await getDow(beforeEntityId);
        const scope = extractScope(tenantId, beforeData, dow);
        if (scope) {
          const key = scopeKey(scope);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            scopes.push(scope);
          }
        }
      }
    }

    if (scopes.length === 0) {
      logger.warn(
        '[TS.1.P2.B][onTimesheetEntryWriteRecomputePayBreakdown] no resolvable scope',
        { tenantId, entryId },
      );
      return;
    }

    // Recompute each scope in series. Two scopes is the worst case
    // and they're typically small (1-7 docs each); parallelism would
    // save ~50ms but could double-write the SAME entry if old and
    // new workweeks happen to overlap (rare but possible across DST
    // boundaries or entity re-keying). Series is simpler and the
    // cost is negligible.
    let totalWrites = 0;
    for (const scope of scopes) {
      const writes = await recomputeScope(scope);
      totalWrites += writes;
    }

    if (totalWrites > 0) {
      logger.debug(
        '[TS.1.P2.B][onTimesheetEntryWriteRecomputePayBreakdown] recomputed',
        {
          tenantId,
          entryId,
          scopeCount: scopes.length,
          entriesWritten: totalWrites,
        },
      );
    }
  },
);

/* -------------------------------------------------------------------------
 * Internal exports for unit testing the gate logic without spinning
 * up the Firestore emulator.
 * ------------------------------------------------------------------------- */
export const __recomputeInternal = {
  COMPUTE_INPUT_FIELDS,
  COMPUTED_FIELDS,
  ANCILLARY_FIELDS,
  computeInputChanged,
  onlyComputedFieldsChanged,
  buildDayInput,
  breakdownsEqual,
  readBreakdown,
  pickStateCode,
  extractScope,
  scopeKey,
};
