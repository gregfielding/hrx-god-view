/**
 * **TS.1.P1.B — Assignment denormalization backfill** — admin callable
 * that populates the six new optional fields on `tenants/{tid}/assignments`
 * needed by the upcoming `<TimesheetGrid />` (P1.C):
 *
 *   - `hiringEntityId`            — reused from R.4.2's resolver.
 *   - `worksiteState`             — JO chain → location doc fallback.
 *   - `worksiteDisplayName`       — JO chain → location doc fallback.
 *   - `workerDisplayName`         — `users/{userId}` doc.
 *   - `shiftBreakDefaultMinutes`  — Shift doc → JO position fallback.
 *
 * `latestTimesheetStatus` is intentionally NOT populated here — it
 * mirrors a child collection that doesn't exist yet (the V2
 * `timesheet_entries` collection ships in P1.C/P1.D). Triggers in
 * subsequent phases will keep it current as entries are written.
 *
 * **Why a backfill at all:** the grid otherwise does ~5 fetches per
 * row (assignment → JO → entity → worksite → user → shift template).
 * With these fields denormalized, it's ~2 (assignment + entries). For
 * 100-row weekly views, that's the difference between snappy and
 * sluggish.
 *
 * **Idempotency contract:**
 *   - Only writes fields that are missing on the doc. Stored values
 *     are never overridden by a re-run.
 *   - Re-running on a fully-healthy assignment is a no-op for that row
 *     (counts as `preFilteredFullyHealthy`).
 *   - Per-row failures (e.g. JO doc missing) leave the field unset; the
 *     grid does runtime lookup as a safety net.
 *
 * **Ops shape (mirrors R.4.2 backfillLegacyAssignmentsCallable):**
 *   - `dryRun: true` is the default. `dryRun: false` writes for real.
 *   - Per-page driver via doc-id cursor (`pageToken`). Default page
 *     size = 1000, max = 5000.
 *   - Caller must be HRX-staff (security level 7) on the requested
 *     tenant. CLI bypasses by design (service-account creds).
 *   - Per-page concurrency = 5. Within a page, JO/user/location/shift
 *     reads are memoized so N assignments sharing a JO only read it
 *     once.
 *
 * **Going-forward population:** TS.1.P1.B intentionally ships ONLY the
 * one-shot backfill — there is no `onAssignmentWrite` trigger that
 * populates these fields when new assignments land. New assignments
 * created after deploy time will be missing the denorm fields until the
 * next backfill run. Adding a write-time trigger is a TS.1 follow-up
 * (open question for the next phase). Until it ships, operators should
 * re-run this backfill periodically (or after the assignment-creation
 * paths are audited) to catch new rows.
 *
 * @see functions/src/jobOrders/backfillLegacyAssignmentsCallable.ts (R.4.2 — the pattern this mirrors)
 * @see src/types/phase2.ts (Assignment.hiringEntityId / worksiteState / ... — the fields written)
 * @see TS.1 build plan §2.5
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { resolveLegacyAssignmentHiringEntityId } from '../jobOrders/backfillLegacyAssignmentsCallable';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const PASS_CONCURRENCY = 5;

interface BackfillRequest {
  tenantId?: string;
  dryRun?: boolean;
  limit?: number;
  pageToken?: string | null;
}

/* -------------------------------------------------------------------------
 * Per-field outcome bucket
 * ------------------------------------------------------------------------- */

export type FieldOutcome =
  | 'already_set'
  | 'stamped'
  | 'would_stamp'
  | 'unresolvable'
  | 'skipped';

interface FieldStat {
  already_set: number;
  stamped: number;
  would_stamp: number;
  unresolvable: number;
  skipped: number;
}

const emptyFieldStat = (): FieldStat => ({
  already_set: 0,
  stamped: 0,
  would_stamp: 0,
  unresolvable: 0,
  skipped: 0,
});

export interface BackfillReport {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  scanned: number;
  /** Page rows that already had every backfill-managed field set. */
  preFilteredFullyHealthy: number;
  /** Page rows that needed at least one field resolved (whether or not
   *  resolution succeeded). */
  candidatesProcessed: number;
  fieldStats: {
    hiringEntityId: FieldStat;
    worksiteState: FieldStat;
    worksiteDisplayName: FieldStat;
    workerDisplayName: FieldStat;
    shiftBreakDefaultMinutes: FieldStat;
  };
  errors: Array<{ assignmentId: string; error: string }>;
  truncated: boolean;
  nextPageToken: string | null;
  durationMs: number;
}

/* -------------------------------------------------------------------------
 * Tiny helpers — duplicated from R.4.2 to keep this module self-contained.
 * If a third backfill needs them they should move to a shared utils file.
 * ------------------------------------------------------------------------- */

function pickStringField(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function pickNumberField(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function normalizeStateCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed.length === 2) return trimmed;
  // Best-effort: take the first two chars when someone stored "California"
  // or similar. State name → code mapping lives in `safeOnCompanyLocationUpdated.ts`
  // but isn't exported; the grid does its own normalization at render time.
  return null;
}

/* -------------------------------------------------------------------------
 * Page-scoped memoized readers — multiple assignments can share a JO,
 * worker, location, or shift; cache reads to keep the per-page Firestore
 * cost bounded.
 *
 * The caches are scoped to a single page invocation, not the lifetime of
 * the function instance, so a long-lived warm container doesn't get a
 * stale view of a JO that was edited mid-backfill.
 * ------------------------------------------------------------------------- */

export type Caches = {
  jo: Map<string, Promise<Record<string, unknown> | null>>;
  user: Map<string, Promise<Record<string, unknown> | null>>;
  location: Map<string, Promise<Record<string, unknown> | null>>;
  shift: Map<string, Promise<Record<string, unknown> | null>>;
};

export function makeCaches(): Caches {
  return {
    jo: new Map(),
    user: new Map(),
    location: new Map(),
    shift: new Map(),
  };
}

async function readJoDoc(
  fdb: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
  caches: Caches,
): Promise<Record<string, unknown> | null> {
  if (!jobOrderId) return null;
  const cached = caches.jo.get(jobOrderId);
  if (cached) return cached;
  const pending = (async (): Promise<Record<string, unknown> | null> => {
    // Mirror the JO chain the R.4.2 backfill uses — same fallback order.
    const candidates = [
      `tenants/${tenantId}/job_orders/${jobOrderId}`,
      `tenants/${tenantId}/jobOrders/${jobOrderId}`,
      `tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`,
    ];
    for (const path of candidates) {
      try {
        const snap = await fdb.doc(path).get();
        if (snap.exists) return (snap.data() ?? {}) as Record<string, unknown>;
      } catch {
        // Tolerate per-doc errors and walk the next candidate.
      }
    }
    return null;
  })();
  caches.jo.set(jobOrderId, pending);
  return pending;
}

async function readUserDoc(
  fdb: admin.firestore.Firestore,
  userId: string,
  caches: Caches,
): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  const cached = caches.user.get(userId);
  if (cached) return cached;
  const pending = (async (): Promise<Record<string, unknown> | null> => {
    try {
      const snap = await fdb.doc(`users/${userId}`).get();
      if (!snap.exists) return null;
      return (snap.data() ?? {}) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  caches.user.set(userId, pending);
  return pending;
}

async function readLocationDoc(
  fdb: admin.firestore.Firestore,
  tenantId: string,
  companyId: string,
  worksiteId: string,
  caches: Caches,
): Promise<Record<string, unknown> | null> {
  if (!companyId || !worksiteId) return null;
  const key = `${companyId}:${worksiteId}`;
  const cached = caches.location.get(key);
  if (cached) return cached;
  const pending = (async (): Promise<Record<string, unknown> | null> => {
    // Canonical location path (matches `useActiveShifts.fetchLocationAddress`).
    // Falls through to the `company_locations` mirror as a safety net.
    const candidates = [
      `tenants/${tenantId}/crm_companies/${companyId}/locations/${worksiteId}`,
      `tenants/${tenantId}/company_locations/${companyId}_${worksiteId}`,
      `tenants/${tenantId}/company_locations/${worksiteId}`,
    ];
    for (const path of candidates) {
      try {
        const snap = await fdb.doc(path).get();
        if (snap.exists) return (snap.data() ?? {}) as Record<string, unknown>;
      } catch {
        // Tolerate per-doc errors.
      }
    }
    return null;
  })();
  caches.location.set(key, pending);
  return pending;
}

async function readShiftDoc(
  fdb: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
  shiftId: string,
  caches: Caches,
): Promise<Record<string, unknown> | null> {
  if (!jobOrderId || !shiftId) return null;
  const key = `${jobOrderId}:${shiftId}`;
  const cached = caches.shift.get(key);
  if (cached) return cached;
  const pending = (async (): Promise<Record<string, unknown> | null> => {
    try {
      const snap = await fdb
        .doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`)
        .get();
      if (!snap.exists) return null;
      return (snap.data() ?? {}) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  caches.shift.set(key, pending);
  return pending;
}

/* -------------------------------------------------------------------------
 * Per-field resolvers — each returns either the resolved value or null
 * for "unresolvable; leave the field unset." Caller decides whether to
 * stamp.
 * ------------------------------------------------------------------------- */

interface ResolverArgs {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  assignmentData: Record<string, unknown>;
  caches: Caches;
}

async function resolveWorksiteState(args: ResolverArgs): Promise<string | null> {
  const { fdb, tenantId, assignmentData, caches } = args;

  // 1. JO `worksiteAddress.state` (most JOs persist this directly).
  const jobOrderId = pickStringField(assignmentData, ['jobOrderId']);
  const jo = await readJoDoc(fdb, tenantId, jobOrderId, caches);
  if (jo) {
    const wa = jo.worksiteAddress as Record<string, unknown> | undefined;
    const fromJo = normalizeStateCode(wa?.state ?? wa?.stateCode);
    if (fromJo) return fromJo;
    const fromTopLevel = normalizeStateCode(jo.worksiteState ?? jo.state);
    if (fromTopLevel) return fromTopLevel;
  }

  // 2. Canonical location doc fallback. Need both companyId + worksite.
  const companyId =
    pickStringField(assignmentData, ['companyId']) ||
    (jo ? pickStringField(jo, ['companyId']) : '');
  const worksiteId = pickStringField(assignmentData, ['worksite', 'worksiteId', 'locationId']);
  if (companyId && worksiteId) {
    const loc = await readLocationDoc(fdb, tenantId, companyId, worksiteId, caches);
    if (loc) {
      const addr = loc.address as Record<string, unknown> | undefined;
      const fromLoc =
        normalizeStateCode(loc.state) ??
        normalizeStateCode(addr?.state) ??
        normalizeStateCode(addr?.stateCode);
      if (fromLoc) return fromLoc;
    }
  }

  return null;
}

async function resolveWorksiteDisplayName(args: ResolverArgs): Promise<string | null> {
  const { fdb, tenantId, assignmentData, caches } = args;

  // 1. JO's worksiteName / locationName.
  const jobOrderId = pickStringField(assignmentData, ['jobOrderId']);
  const jo = await readJoDoc(fdb, tenantId, jobOrderId, caches);
  if (jo) {
    const fromJo = pickStringField(jo, ['worksiteName', 'locationName']);
    if (fromJo) return fromJo;
  }

  // 2. Location doc's nickname / name.
  const companyId =
    pickStringField(assignmentData, ['companyId']) ||
    (jo ? pickStringField(jo, ['companyId']) : '');
  const worksiteId = pickStringField(assignmentData, ['worksite', 'worksiteId', 'locationId']);
  if (companyId && worksiteId) {
    const loc = await readLocationDoc(fdb, tenantId, companyId, worksiteId, caches);
    if (loc) {
      const fromLoc = pickStringField(loc, ['nickname', 'locationName', 'name']);
      if (fromLoc) return fromLoc;
    }
  }

  return null;
}

async function resolveWorkerDisplayName(args: ResolverArgs): Promise<string | null> {
  const { fdb, assignmentData, caches } = args;
  const userId = pickStringField(assignmentData, ['userId', 'candidateId', 'workerUid']);
  if (!userId) return null;
  const user = await readUserDoc(fdb, userId, caches);
  if (!user) return null;

  const display = pickStringField(user, ['displayName', 'fullName', 'name']);
  if (display) return display;

  const first = pickStringField(user, ['firstName', 'givenName']);
  const last = pickStringField(user, ['lastName', 'familyName', 'surname']);
  const combined = `${first} ${last}`.trim();
  return combined || null;
}

async function resolveShiftBreakDefaultMinutes(args: ResolverArgs): Promise<number | null> {
  const { fdb, tenantId, assignmentData, caches } = args;

  // 1. Linked Shift doc (`assignment.shiftId`).
  const jobOrderId = pickStringField(assignmentData, ['jobOrderId']);
  const shiftId = pickStringField(assignmentData, ['shiftId']);
  if (jobOrderId && shiftId) {
    const shift = await readShiftDoc(fdb, tenantId, jobOrderId, shiftId, caches);
    if (shift) {
      const fromShift = pickNumberField(shift, [
        'breakMinutes',
        'defaultBreakMinutes',
        'scheduledBreakMinutes',
      ]);
      if (fromShift != null) return fromShift;
    }
  }

  // 2. JO position fallback — `positions[0].defaultBreakMinutes` /
  //    `gigPositions[0].defaultBreakMinutes`.
  const jo = await readJoDoc(fdb, tenantId, jobOrderId, caches);
  if (jo) {
    const positions =
      (Array.isArray(jo.positions) && (jo.positions as unknown[]).length > 0
        ? (jo.positions as unknown[])
        : Array.isArray(jo.gigPositions)
          ? (jo.gigPositions as unknown[])
          : []) as Array<Record<string, unknown>>;
    const p0 = positions[0];
    if (p0) {
      const fromPos = pickNumberField(p0, [
        'defaultBreakMinutes',
        'breakMinutes',
        'scheduledBreakMinutes',
      ]);
      if (fromPos != null) return fromPos;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------
 * Shared resolver core
 *
 * Pure-ish read-side helper that figures out which of the 5 backfill-
 * managed denorm fields are missing on a given assignment doc and
 * resolves each one. Returns the proposed `updates` patch (or empty
 * when nothing needs writing) plus a per-field `outcomes` map for
 * reporting.
 *
 * Used by:
 *   - `processOneAssignment` (this file) — the page driver applies a
 *     dryRun gate around the returned `updates`.
 *   - `onAssignmentWriteEnsureDenormFields` (sibling file) — the
 *     write-time trigger applies the same `updates` immediately.
 *
 * Both consumers pass a fresh per-invocation `Caches` object; the
 * resolver itself never writes Firestore.
 * ------------------------------------------------------------------------- */

export interface ResolveMissingArgs {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  assignmentId: string;
  assignmentData: Record<string, unknown>;
  caches: Caches;
}

export interface ResolveMissingResult {
  /** Patch the caller can `set(..., { merge: true })`. Empty when
   *  there's nothing to write. */
  updates: Record<string, unknown>;
  /** One label per backfill-managed field — for ops/audit reporting. */
  outcomes: {
    hiringEntityId: FieldOutcome;
    worksiteState: FieldOutcome;
    worksiteDisplayName: FieldOutcome;
    workerDisplayName: FieldOutcome;
    shiftBreakDefaultMinutes: FieldOutcome;
  };
  /** Whether at least one field was missing on the doc when we entered. */
  hadMissingFields: boolean;
}

export async function resolveMissingDenormUpdates(
  args: ResolveMissingArgs,
): Promise<ResolveMissingResult> {
  const { fdb, tenantId, assignmentId, assignmentData, caches } = args;
  const result: ResolveMissingResult = {
    updates: {},
    outcomes: {
      hiringEntityId: 'skipped',
      worksiteState: 'skipped',
      worksiteDisplayName: 'skipped',
      workerDisplayName: 'skipped',
      shiftBreakDefaultMinutes: 'skipped',
    },
    hadMissingFields: false,
  };

  const args0 = { fdb, tenantId, assignmentData, caches };

  // hiringEntityId — reuse R.4.2's resolver verbatim. Already-set check
  // lives inside that helper so we don't duplicate the logic.
  if (!pickStringField(assignmentData, ['hiringEntityId'])) {
    result.hadMissingFields = true;
    try {
      const hidResult = await resolveLegacyAssignmentHiringEntityId({
        fdb,
        tenantId,
        assignmentId,
        assignmentData,
      });
      if (hidResult.resolvedHiringEntityId) {
        result.updates.hiringEntityId = hidResult.resolvedHiringEntityId;
        result.outcomes.hiringEntityId = 'stamped';
      } else {
        result.outcomes.hiringEntityId = 'unresolvable';
      }
    } catch (e) {
      result.outcomes.hiringEntityId = 'unresolvable';
      logger.warn('[TS.1.P1.B] hiringEntityId resolver threw', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    result.outcomes.hiringEntityId = 'already_set';
  }

  // Per-field try/catch from here down: a malformed location doc that
  // throws while resolving `worksiteState` must not prevent
  // `workerDisplayName` from being stamped from the worker user doc
  // (and vice versa). The individual readers (`readJoDoc` etc.) already
  // tolerate per-doc read failures internally; this outer wrap is the
  // belt-and-suspenders for any unexpected throw inside a resolver.

  if (!pickStringField(assignmentData, ['worksiteState'])) {
    result.hadMissingFields = true;
    try {
      const v = await resolveWorksiteState(args0);
      if (v) {
        result.updates.worksiteState = v;
        result.outcomes.worksiteState = 'stamped';
      } else {
        result.outcomes.worksiteState = 'unresolvable';
      }
    } catch (e) {
      result.outcomes.worksiteState = 'unresolvable';
      logger.warn('[TS.1.P1.B] worksiteState resolver threw', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    result.outcomes.worksiteState = 'already_set';
  }

  if (!pickStringField(assignmentData, ['worksiteDisplayName'])) {
    result.hadMissingFields = true;
    try {
      const v = await resolveWorksiteDisplayName(args0);
      if (v) {
        result.updates.worksiteDisplayName = v;
        result.outcomes.worksiteDisplayName = 'stamped';
      } else {
        result.outcomes.worksiteDisplayName = 'unresolvable';
      }
    } catch (e) {
      result.outcomes.worksiteDisplayName = 'unresolvable';
      logger.warn('[TS.1.P1.B] worksiteDisplayName resolver threw', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    result.outcomes.worksiteDisplayName = 'already_set';
  }

  if (!pickStringField(assignmentData, ['workerDisplayName'])) {
    result.hadMissingFields = true;
    try {
      const v = await resolveWorkerDisplayName(args0);
      if (v) {
        result.updates.workerDisplayName = v;
        result.outcomes.workerDisplayName = 'stamped';
      } else {
        result.outcomes.workerDisplayName = 'unresolvable';
      }
    } catch (e) {
      result.outcomes.workerDisplayName = 'unresolvable';
      logger.warn('[TS.1.P1.B] workerDisplayName resolver threw', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    result.outcomes.workerDisplayName = 'already_set';
  }

  if (pickNumberField(assignmentData, ['shiftBreakDefaultMinutes']) == null) {
    result.hadMissingFields = true;
    try {
      const v = await resolveShiftBreakDefaultMinutes(args0);
      if (v != null) {
        result.updates.shiftBreakDefaultMinutes = v;
        result.outcomes.shiftBreakDefaultMinutes = 'stamped';
      } else {
        result.outcomes.shiftBreakDefaultMinutes = 'unresolvable';
      }
    } catch (e) {
      result.outcomes.shiftBreakDefaultMinutes = 'unresolvable';
      logger.warn('[TS.1.P1.B] shiftBreakDefaultMinutes resolver threw', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    result.outcomes.shiftBreakDefaultMinutes = 'already_set';
  }

  return result;
}

/* -------------------------------------------------------------------------
 * Per-assignment driver (page-only)
 *
 * Thin wrapper around `resolveMissingDenormUpdates`: applies the dryRun
 * gate, performs the actual Firestore write under the page's
 * concurrency budget, and adapts the outcome labels for the
 * dryRun-aware report (a `'stamped'` outcome flips to `'would_stamp'`
 * during a dry run).
 * ------------------------------------------------------------------------- */

export interface PerAssignmentResult {
  assignmentId: string;
  outcomes: ResolveMissingResult['outcomes'];
  /** Whether at least one field was missing on the doc when we entered. */
  hadMissingFields: boolean;
  error?: string;
}

async function processOneAssignment(args: {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  assignmentId: string;
  assignmentData: Record<string, unknown>;
  dryRun: boolean;
  caches: Caches;
}): Promise<PerAssignmentResult> {
  const { fdb, tenantId, assignmentId, assignmentData, dryRun, caches } = args;
  const resolved = await resolveMissingDenormUpdates({
    fdb,
    tenantId,
    assignmentId,
    assignmentData,
    caches,
  });

  const result: PerAssignmentResult = {
    assignmentId,
    outcomes: dryRun
      ? {
          hiringEntityId:
            resolved.outcomes.hiringEntityId === 'stamped'
              ? 'would_stamp'
              : resolved.outcomes.hiringEntityId,
          worksiteState:
            resolved.outcomes.worksiteState === 'stamped'
              ? 'would_stamp'
              : resolved.outcomes.worksiteState,
          worksiteDisplayName:
            resolved.outcomes.worksiteDisplayName === 'stamped'
              ? 'would_stamp'
              : resolved.outcomes.worksiteDisplayName,
          workerDisplayName:
            resolved.outcomes.workerDisplayName === 'stamped'
              ? 'would_stamp'
              : resolved.outcomes.workerDisplayName,
          shiftBreakDefaultMinutes:
            resolved.outcomes.shiftBreakDefaultMinutes === 'stamped'
              ? 'would_stamp'
              : resolved.outcomes.shiftBreakDefaultMinutes,
        }
      : resolved.outcomes,
    hadMissingFields: resolved.hadMissingFields,
  };

  if (!dryRun && Object.keys(resolved.updates).length > 0) {
    const updates = {
      ...resolved.updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await fdb
        .doc(`tenants/${tenantId}/assignments/${assignmentId}`)
        .set(updates, { merge: true });
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
  }

  return result;
}

/* -------------------------------------------------------------------------
 * Page driver
 * ------------------------------------------------------------------------- */

export interface RunBackfillPageArgs {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  pageToken: string | null;
  fdb: admin.firestore.Firestore;
}

export async function runBackfillAssignmentDenormFieldsPage(
  args: RunBackfillPageArgs,
): Promise<BackfillReport> {
  const { tenantId, dryRun, limit, pageToken, fdb } = args;
  const startMs = Date.now();

  let q = fdb
    .collection(`tenants/${tenantId}/assignments`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(limit) as admin.firestore.Query;
  if (pageToken) q = q.startAfter(pageToken);
  const snap = await q.get();

  const report: BackfillReport = {
    tenantId,
    dryRun,
    limit,
    scanned: snap.size,
    preFilteredFullyHealthy: 0,
    candidatesProcessed: 0,
    fieldStats: {
      hiringEntityId: emptyFieldStat(),
      worksiteState: emptyFieldStat(),
      worksiteDisplayName: emptyFieldStat(),
      workerDisplayName: emptyFieldStat(),
      shiftBreakDefaultMinutes: emptyFieldStat(),
    },
    errors: [],
    truncated: snap.size === limit,
    nextPageToken: snap.size === limit ? snap.docs[snap.docs.length - 1].id : null,
    durationMs: 0,
  };

  const caches = makeCaches();

  // Pre-filter: skip rows that already have all five backfill-managed
  // fields set. Cheap doc-level check; saves the resolver round-trips.
  type Candidate = { id: string; data: Record<string, unknown> };
  const candidates: Candidate[] = [];
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const allSet =
      pickStringField(data, ['hiringEntityId']) &&
      pickStringField(data, ['worksiteState']) &&
      pickStringField(data, ['worksiteDisplayName']) &&
      pickStringField(data, ['workerDisplayName']) &&
      pickNumberField(data, ['shiftBreakDefaultMinutes']) != null;
    if (allSet) {
      report.preFilteredFullyHealthy += 1;
      continue;
    }
    candidates.push({ id: doc.id, data });
  }
  report.candidatesProcessed = candidates.length;

  for (let i = 0; i < candidates.length; i += PASS_CONCURRENCY) {
    const chunk = candidates.slice(i, i + PASS_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (cand) => {
        try {
          return await processOneAssignment({
            fdb,
            tenantId,
            assignmentId: cand.id,
            assignmentData: cand.data,
            dryRun,
            caches,
          });
        } catch (e) {
          return {
            assignmentId: cand.id,
            outcomes: {
              hiringEntityId: 'unresolvable' as const,
              worksiteState: 'unresolvable' as const,
              worksiteDisplayName: 'unresolvable' as const,
              workerDisplayName: 'unresolvable' as const,
              shiftBreakDefaultMinutes: 'unresolvable' as const,
            },
            hadMissingFields: true,
            error: e instanceof Error ? e.message : String(e),
          } satisfies PerAssignmentResult;
        }
      }),
    );

    for (const row of results) {
      if (row.error) {
        report.errors.push({ assignmentId: row.assignmentId, error: row.error });
      }
      report.fieldStats.hiringEntityId[row.outcomes.hiringEntityId] += 1;
      report.fieldStats.worksiteState[row.outcomes.worksiteState] += 1;
      report.fieldStats.worksiteDisplayName[row.outcomes.worksiteDisplayName] += 1;
      report.fieldStats.workerDisplayName[row.outcomes.workerDisplayName] += 1;
      report.fieldStats.shiftBreakDefaultMinutes[row.outcomes.shiftBreakDefaultMinutes] += 1;
    }
  }

  report.durationMs = Date.now() - startMs;
  return report;
}

/* -------------------------------------------------------------------------
 * Callable wrapper
 * ------------------------------------------------------------------------- */

function normalizeSecurityLevel(level: unknown): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return Math.min(Math.max(level, 1), 7);
  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7);
}

function getSecurityLevelForActiveTenant(user: Record<string, unknown>): number {
  const activeTenantId = user.activeTenantId as string | undefined;
  if (!activeTenantId) return normalizeSecurityLevel(user.securityLevel);
  const tenantSettings = (user.tenantIds as Record<string, unknown> | undefined)?.[
    activeTenantId
  ] as Record<string, unknown> | undefined;
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }
  return normalizeSecurityLevel(user.securityLevel);
}

export const backfillAssignmentDenormFieldsCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<BackfillReport> => {
    const data = (request.data ?? {}) as BackfillRequest;
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

    const tenantId = String(data.tenantId ?? '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

    const dryRun = data.dryRun !== false; // default TRUE
    const requestedLimit = Number(data.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const pageToken =
      typeof data.pageToken === 'string' && data.pageToken.trim().length > 0
        ? data.pageToken.trim()
        : null;

    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User record not found.');
    }
    const callerUser = userSnap.data() ?? {};
    const callerSecurityLevel = getSecurityLevelForActiveTenant(callerUser);
    const callerActiveTenantId =
      typeof callerUser.activeTenantId === 'string' ? callerUser.activeTenantId : null;

    if (callerActiveTenantId !== tenantId || callerSecurityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions. TS.1.P1.B backfill requires security level 7 on the requested tenant.',
      );
    }

    const report = await runBackfillAssignmentDenormFieldsPage({
      tenantId,
      dryRun,
      limit,
      pageToken,
      fdb: db,
    });

    logger.info('[TS.1.P1.B][backfillAssignmentDenormFieldsCallable] complete', {
      tenantId,
      dryRun,
      limit,
      scanned: report.scanned,
      candidatesProcessed: report.candidatesProcessed,
      preFilteredFullyHealthy: report.preFilteredFullyHealthy,
      fieldStats: report.fieldStats,
      errorCount: report.errors.length,
      truncated: report.truncated,
      nextPageToken: report.nextPageToken,
      durationMs: report.durationMs,
      callerUid: uid,
    });

    return report;
  },
);
