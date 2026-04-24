/**
 * Triggers that watch readiness item writes and keep
 * `users/{uid}.primaryRecruiterId` in sync with the highest-priority active
 * anchor (per recruiter-ownership-model.md §13b Option D).
 *
 * Two parallel triggers — one per item type — both delegating to
 * `recomputePrimaryForWorker`. The compute is cheap (2 small queries per
 * worker) so we don't bother short-circuiting on "nothing changed" at the
 * trigger layer; that's the transaction's job inside recompute.
 *
 * Retry policy: `retry: false`. The compute is idempotent — the daily
 * reconciliation backfill (separate file) catches any trigger failures.
 *
 * @see shared/workerPrimaryRecruiter.ts (pure compute)
 * @see shared/resolveOwnership.ts (per-item resolution; callable responsibility)
 * @see recruiter-ownership-model.md §13d (what this trigger does)
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { recomputePrimaryForWorker } from './recomputePrimaryForWorker';
import type { EmployeeReadinessItem } from '../shared/employeeReadinessItemV1';
import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';

const DEFAULT_REGION = 'us-central1';

/**
 * Employee Readiness items — entity-scoped, typically 8-12 active per worker.
 */
export const recomputePrimaryOnEmployeeReadinessItemWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/employeeReadinessItems/{itemId}',
    region: DEFAULT_REGION,
    maxInstances: 3,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const workerUid = extractWorkerUid<EmployeeReadinessItem>(event);
    if (!workerUid) return;

    // Only do the work when ownership or status could have changed the
    // worker's effective primary. Other field updates (ctaTarget edits, label
    // changes, etc.) don't move the scalar, so we skip the recompute for them
    // to keep write amp low.
    if (!ownershipOrStatusChanged(event)) return;

    try {
      const result = await recomputePrimaryForWorker(tenantId, workerUid);
      if (result.changed) {
        logger.info('recomputePrimaryOnEmployeeReadinessItemWrite: updated scalar', {
          tenantId,
          workerUid,
          primaryRecruiterId: result.primaryRecruiterId,
          sourceKind: result.sourceAnchor?.kind,
          sourceItemId: result.sourceAnchor?.sourceItemId,
        });
      }
    } catch (err) {
      logger.error('recomputePrimaryOnEmployeeReadinessItemWrite: failed', {
        tenantId,
        workerUid,
        err: (err as Error).message,
      });
    }
  },
);

/**
 * Assignment Readiness items — shift-scoped, lifespan = the assignment.
 */
export const recomputePrimaryOnAssignmentReadinessItemWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/assignmentReadinessItems/{itemId}',
    region: DEFAULT_REGION,
    maxInstances: 3,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const workerUid = extractWorkerUid<AssignmentReadinessItem>(event);
    if (!workerUid) return;

    if (!ownershipOrStatusChanged(event)) return;

    try {
      const result = await recomputePrimaryForWorker(tenantId, workerUid);
      if (result.changed) {
        logger.info('recomputePrimaryOnAssignmentReadinessItemWrite: updated scalar', {
          tenantId,
          workerUid,
          primaryRecruiterId: result.primaryRecruiterId,
          sourceKind: result.sourceAnchor?.kind,
          sourceItemId: result.sourceAnchor?.sourceItemId,
        });
      }
    } catch (err) {
      logger.error('recomputePrimaryOnAssignmentReadinessItemWrite: failed', {
        tenantId,
        workerUid,
        err: (err as Error).message,
      });
    }
  },
);

/**
 * Pull `workerUid` from the after-doc first, falling back to the before-doc
 * on delete. Shared by both triggers since the field name is the same on both
 * item types.
 */
function extractWorkerUid<T extends { workerUid?: string }>(event: {
  data?: { after?: { exists: boolean; data: () => unknown } | null; before?: { exists: boolean; data: () => unknown } | null };
}): string | null {
  const after = event.data?.after?.exists ? (event.data.after.data() as T) : null;
  const before = event.data?.before?.exists ? (event.data.before.data() as T) : null;
  const row = after ?? before;
  const uid = typeof row?.workerUid === 'string' ? row.workerUid.trim() : '';
  return uid || null;
}

/**
 * True when the write could have changed the worker's effective primary.
 *
 * Moves the scalar:
 *   - `ownership.primaryRecruiterId` differs before/after
 *   - `status` transitions into or out of an active state (see
 *     `ACTIVE_STATUSES` in recomputePrimaryForWorker.ts)
 *   - create or delete events (any activation / deactivation of an anchor)
 *
 * Doesn't move the scalar (skipped for perf):
 *   - pure metadata edits (ctaTarget, requirementLabel, hiringEntityName)
 */
function ownershipOrStatusChanged(event: {
  data?: { after?: { exists: boolean; data: () => unknown } | null; before?: { exists: boolean; data: () => unknown } | null };
}): boolean {
  const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
  const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;

  // Create or delete: always consider it a relevant change.
  if (!before || !after) return true;

  const beforePrimary = ((before.ownership as Record<string, unknown> | undefined)?.primaryRecruiterId ?? null) as
    | string
    | null;
  const afterPrimary = ((after.ownership as Record<string, unknown> | undefined)?.primaryRecruiterId ?? null) as
    | string
    | null;
  if (beforePrimary !== afterPrimary) return true;

  const beforeStatus = String(before.status ?? '');
  const afterStatus = String(after.status ?? '');
  if (beforeStatus !== afterStatus) return true;

  return false;
}
