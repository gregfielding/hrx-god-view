/**
 * **TS.1.P1.B.2 — Going-forward write-time denormalization trigger.**
 *
 * Companion to `backfillAssignmentDenormFieldsCallable`. The backfill
 * is a one-shot that fixes existing rows; this trigger keeps NEW rows
 * (and rows updated after deploy) populated automatically. Without it,
 * the assignment-creation paths (`placementsApi.ts`,
 * `phase2/assignmentService.ts`, `CreateAssignment.tsx`,
 * `backfillShiftsAndAssignments.ts`, etc.) would write fresh assignments
 * missing the denorm fields and the `<TimesheetGrid />` row resolver
 * would fall back to its 5-fetch-per-row safety net for every new row
 * until the operator re-ran the backfill.
 *
 * **What it does:**
 *   - Fires on every `tenants/{tid}/assignments/{aid}` write (create or
 *     update). Skips deletes.
 *   - Two-tier loop guard (see "Loop prevention" below):
 *       1. Pre-filter on after-doc — all five managed fields set → exit.
 *       2. Diff-check before/after — only managed fields changed → exit.
 *   - Otherwise, calls the same `resolveMissingDenormUpdates` helper the
 *     backfill uses (single source of truth for resolution rules) and
 *     applies the resulting patch via `set({...}, { merge: true })`.
 *
 * **Loop prevention.** This trigger writes back to the same doc, which
 * normally re-triggers itself. Bounded to two invocations per change:
 *   1. Original user write lands → trigger fires → resolver runs →
 *      writes patch (denorm fields + `updatedAt`).
 *   2. Patch fires the trigger again → diff-check sees ONLY managed
 *      fields (+ `updatedAt`) changed → early exit, **without re-running
 *      the resolver chain.**
 *
 * The diff-check is what makes step 2 cheap. The pre-filter alone (the
 * "all five set" check) is sufficient for termination, but it would
 * re-run the resolver on the second invocation when the trigger only
 * managed to stamp 3/5 fields (with 2 unresolvable). The diff-check
 * recognizes "this write came from us — nothing changed semantically"
 * and skips the resolver entirely. ~4 Firestore reads saved per
 * unresolvable-tail assignment.
 *
 * Mirrors the cascade engine pattern (`didRelevantAssignmentFieldsChange`
 * in `functions/src/utils/`) — define the watch-set, exit when only
 * non-watch fields changed.
 *
 * **Per-field error isolation.** Each resolver call inside
 * `resolveMissingDenormUpdates` is wrapped in its own `try/catch`, so a
 * malformed location doc that throws while resolving `worksiteState`
 * doesn't prevent `workerDisplayName` from being stamped from the
 * worker user doc. Errors are logged and the field is marked
 * `unresolvable` for the row.
 *
 * **Cost.** Each user-driven assignment write costs one trigger
 * invocation (early-return when all set, or only-managed-changed) or
 * two (when a field needed resolution). The resolution path does up to
 * 4 reads (JO + user + location + shift) per invocation; the
 * per-invocation `Caches` memoize redundant fetches inside the same
 * call. A fresh cache per invocation matches the backfill's per-page
 * cache scope and avoids cross-tenant leakage in warm containers.
 *
 * **Source of truth.** The resolution chain lives entirely in
 * `backfillAssignmentDenormFieldsCallable.ts` (`resolveMissingDenormUpdates`
 * + the per-field resolvers). Updating one resolves both the trigger
 * and the backfill — there is no parallel logic to keep in sync.
 *
 * @see functions/src/timesheets/backfillAssignmentDenormFieldsCallable.ts
 * @see functions/src/utils/didRelevantAssignmentFieldsChange.ts (the cascade pattern this mirrors)
 * @see TS.1 build plan §2.5 — Assignment denormalization
 */

import * as admin from 'firebase-admin';
import _ from 'lodash';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  makeCaches,
  resolveMissingDenormUpdates,
} from './backfillAssignmentDenormFieldsCallable';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/**
 * Fields managed by this trigger (string-typed). Mirrors the backfill's
 * pre-filter. `latestTimesheetStatus` is intentionally NOT in this set;
 * it's owned by the P1.D entry-write triggers and so SHOULD be ignored
 * by the diff-check below (changes to it do not count as "user changed
 * something we care about").
 */
const TRIGGER_MANAGED_STRING_FIELDS = [
  'hiringEntityId',
  'worksiteState',
  'worksiteDisplayName',
  'workerDisplayName',
] as const;
const TRIGGER_MANAGED_NUMBER_FIELDS = ['shiftBreakDefaultMinutes'] as const;
/**
 * Auxiliary fields the trigger writes alongside its managed fields.
 * `updatedAt` always rolls forward when we patch. `latestTimesheetStatus`
 * is owned by a sibling trigger but lives in the same doc — we want
 * neither to fight the other.
 */
const TRIGGER_ANCILLARY_FIELDS = ['updatedAt', 'latestTimesheetStatus'] as const;

const ALL_IGNORED_FOR_DIFF = new Set<string>([
  ...TRIGGER_MANAGED_STRING_FIELDS,
  ...TRIGGER_MANAGED_NUMBER_FIELDS,
  ...TRIGGER_ANCILLARY_FIELDS,
]);

function hasNonEmptyString(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  return typeof v === 'string' && v.trim().length > 0;
}

function hasFiniteNumber(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n);
  }
  return false;
}

/**
 * Returns true when the only top-level fields that differ between
 * `before` and `after` are fields this trigger writes (or auxiliary
 * fields it doesn't care about). Concretely: when `after` differs from
 * `before` only in `hiringEntityId` / `worksiteState` /
 * `worksiteDisplayName` / `workerDisplayName` / `shiftBreakDefaultMinutes`
 * / `updatedAt` / `latestTimesheetStatus`, the write almost certainly
 * came from this trigger (or a sibling denorm-only writer) and the
 * resolver would have nothing new to do.
 *
 * Used as a fast path that avoids the resolver chain on the trigger's
 * own re-fire. Without this guard, an unresolvable-tail assignment
 * (e.g. 3 stamped, 2 unresolvable) would re-run the entire 4-read
 * resolver chain on every re-fire even though we know nothing changed.
 *
 * Lodash `_.isEqual` handles the deep-equality comparison; for the
 * ~6-field shape on assignment docs this is sub-millisecond.
 */
function onlyTriggerManagedFieldsChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): boolean {
  if (!before) return false; // create — definitely not our write
  const allKeys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    if (ALL_IGNORED_FOR_DIFF.has(k)) continue;
    if (!_.isEqual(before[k], after[k])) {
      // A field outside the managed set changed — user-driven write.
      return false;
    }
  }
  return true;
}

export const onAssignmentWriteEnsureDenormFields = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/assignments/{assignmentId}',
    region: 'us-central1',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const assignmentId = event.params.assignmentId as string;

    if (!event.data?.after?.exists) {
      // Delete — nothing to denormalize.
      return;
    }

    const afterData = event.data.after.data() as Record<string, unknown>;
    const beforeData = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : undefined;

    // Tier-1 guard: every managed field is already set. Cheap doc-level
    // check; no Firestore reads, no diff. Catches the steady state
    // where existing assignments are touched for unrelated reasons.
    const allSet =
      TRIGGER_MANAGED_STRING_FIELDS.every((k) => hasNonEmptyString(afterData, k)) &&
      TRIGGER_MANAGED_NUMBER_FIELDS.every((k) => hasFiniteNumber(afterData, k));
    if (allSet) return;

    // Tier-2 guard: this write only touched fields we manage (or
    // ancillary fields like `updatedAt`). The trigger is firing on its
    // OWN previous write — exit before the resolver chain.
    if (onlyTriggerManagedFieldsChanged(beforeData, afterData)) return;

    let resolved;
    try {
      resolved = await resolveMissingDenormUpdates({
        fdb: db,
        tenantId,
        assignmentId,
        assignmentData: afterData,
        caches: makeCaches(),
      });
    } catch (error) {
      logger.error(
        '[TS.1.P1.B.2][onAssignmentWriteEnsureDenormFields] resolver threw',
        {
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }

    if (Object.keys(resolved.updates).length === 0) {
      // Some fields were missing but none could be resolved (e.g.
      // brand-new assignment whose JO doesn't have hiringEntityId yet).
      // Don't write — leave the doc untouched so the next user edit (or
      // a periodic backfill run) can re-attempt resolution.
      logger.debug(
        '[TS.1.P1.B.2][onAssignmentWriteEnsureDenormFields] nothing resolvable',
        {
          tenantId,
          assignmentId,
          outcomes: resolved.outcomes,
        },
      );
      return;
    }

    try {
      await event.data.after.ref.set(
        {
          ...resolved.updates,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      logger.info(
        '[TS.1.P1.B.2][onAssignmentWriteEnsureDenormFields] stamped',
        {
          tenantId,
          assignmentId,
          stampedFields: Object.keys(resolved.updates),
          outcomes: resolved.outcomes,
        },
      );
    } catch (error) {
      logger.error(
        '[TS.1.P1.B.2][onAssignmentWriteEnsureDenormFields] write failed',
        {
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);
