/**
 * **TS.1.P1.B-FU — Going-forward write-time denormalization trigger.**
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
 *   - Pre-filter: if all five backfill-managed fields are already set on
 *     the after-snapshot, return without resolving or writing.
 *   - Otherwise, calls the same `resolveMissingDenormUpdates` helper the
 *     backfill uses (single source of truth for resolution rules) and
 *     applies the resulting patch via `set({...}, { merge: true })`.
 *
 * **Loop prevention.** This trigger writes back to the same doc, which
 * normally re-triggers itself. Bounded to two invocations per change:
 *   1. Original write lands → trigger fires → resolves fields → writes
 *      patch (now 1+ fields are set).
 *   2. Patch fires the trigger again → pre-filter sees all set →
 *      early return, no write.
 * Unresolvable fields don't loop because the resolver returns no
 * `updates` when nothing was resolvable, so step 1's write is a no-op.
 *
 * **Cost.** Each user-driven assignment write costs one trigger
 * invocation (early-return when all set) or two (when a field needed
 * resolution). The resolution path does up to 4 reads (JO + user +
 * location + shift) per invocation, but the per-invocation `Caches`
 * memoize redundant fetches inside the same call. A fresh cache per
 * invocation matches the backfill's per-page cache scope and avoids
 * cross-tenant leakage in warm containers.
 *
 * **Source of truth.** The resolution chain lives entirely in
 * `backfillAssignmentDenormFieldsCallable.ts` (`resolveMissingDenormUpdates`
 * + the per-field resolvers). Updating one resolves both the trigger
 * and the backfill — there is no parallel logic to keep in sync.
 *
 * @see functions/src/timesheets/backfillAssignmentDenormFieldsCallable.ts
 * @see TS.1 build plan §2.5 — Assignment denormalization
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  makeCaches,
  resolveMissingDenormUpdates,
} from './backfillAssignmentDenormFieldsCallable';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/** Field names this trigger manages — keep in sync with the backfill's
 *  pre-filter. `latestTimesheetStatus` is intentionally NOT in this set;
 *  it's owned by the P1.D entry-write triggers. */
const BACKFILL_MANAGED_STRING_FIELDS = [
  'hiringEntityId',
  'worksiteState',
  'worksiteDisplayName',
  'workerDisplayName',
] as const;

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

    // Pre-filter: every backfill-managed field is already set. This is
    // the loop-termination check — after this trigger writes its patch,
    // re-firing on the same doc lands here and exits.
    const allSet =
      BACKFILL_MANAGED_STRING_FIELDS.every((k) => hasNonEmptyString(afterData, k)) &&
      hasFiniteNumber(afterData, 'shiftBreakDefaultMinutes');
    if (allSet) return;

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
        '[TS.1.P1.B-FU][onAssignmentWriteEnsureDenormFields] resolver threw',
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
        '[TS.1.P1.B-FU][onAssignmentWriteEnsureDenormFields] nothing resolvable',
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
        '[TS.1.P1.B-FU][onAssignmentWriteEnsureDenormFields] stamped',
        {
          tenantId,
          assignmentId,
          stampedFields: Object.keys(resolved.updates),
          outcomes: resolved.outcomes,
        },
      );
    } catch (error) {
      logger.error(
        '[TS.1.P1.B-FU][onAssignmentWriteEnsureDenormFields] write failed',
        {
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
);
