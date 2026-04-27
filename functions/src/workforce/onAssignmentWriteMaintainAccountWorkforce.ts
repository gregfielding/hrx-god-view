/**
 * Workforce trigger — maintains `tenants/{tid}/account_workforce/{accountId}__{workerId}`
 * from assignment writes.
 *
 * Phase 2 of `docs/WORKFORCE_DOMAIN_MODEL.md`. Three behaviors, all idempotent:
 *
 *   1. Entry (§3.4): `pending → confirmed` creates an `active` AccountWorkforce
 *      doc if one doesn't exist for this (account, worker) pair. Doesn't
 *      touch an existing doc's status.
 *   2. Outcome rollup: any write that leaves the assignment on a terminal
 *      outcome (`completed`, `no_show`, `left_early`) bumps `totalShifts`
 *      (and `completedShifts` for `completed`) and refreshes `lastShiftAt`.
 *      Only fires on the transition INTO the terminal state so counters
 *      can't double-count when the same doc is written again.
 *   3. Safety net (§3.4(4)): `pending → confirmed` onto a doc that's already
 *      `inactive` appends a `CONFIRMED_WHILE_INACTIVE` blocker and leaves
 *      status alone. The ownership/placement gate is the primary defense
 *      against this state; this blocker is what shows up on the Inactive
 *      view when that gate fails.
 *
 * Not handled here:
 *   - Engagement-type denormalization on hiring-entity changes — lives in
 *     `onAccountHiringEntityChangeBackfillWorkforceEngagementType.ts`.
 *   - Manual deactivation / reactivation — lives in the
 *     `setAccountWorkforceStatus` callable.
 *
 * @see docs/WORKFORCE_DOMAIN_MODEL.md §3, §6.1
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  accountWorkforceDocId,
  type AccountWorkforceBlocker,
  type AccountWorkforceEngagementType,
} from '../shared/accountWorkforce';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Statuses that count as "the worker has committed." Entry point for AccountWorkforce. */
const COMMITTING_STATUSES = new Set<string>([
  'confirmed',
  'active',
  'completed',
  'no_show',
  'left_early',
  'cancelled_business',
  'cancelled_worker',
  'cancelled', // legacy bucket
]);

/** Terminal outcomes that should bump counters. `cancelled_*` do NOT count as shifts worked. */
const TERMINAL_OUTCOME_STATUSES = new Set<string>(['completed', 'no_show', 'left_early']);

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function readStatus(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  const raw = data.status;
  return typeof raw === 'string' ? raw.toLowerCase().trim() : '';
}

/**
 * Resolve the owning recruiter account for an assignment. Prefers the
 * assignment's own `recruiterAccountId` (stamped at creation), falling
 * back to a jobOrder lookup for legacy rows that never carried it.
 */
async function resolveAccountIdForAssignment(
  tenantId: string,
  assignment: Record<string, unknown>,
): Promise<string | null> {
  const direct = pickString((assignment as any).recruiterAccountId);
  if (direct) return direct;
  const jobOrderId = pickString(assignment.jobOrderId);
  if (!jobOrderId) return null;
  try {
    const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (!joSnap.exists) return null;
    const joData = joSnap.data() as Record<string, unknown>;
    return pickString(joData?.recruiterAccountId);
  } catch (err) {
    logger.warn('workforce-trigger: jobOrder lookup failed', {
      tenantId,
      jobOrderId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Resolve engagement class for a new AccountWorkforce doc:
 * `account.hiringEntityId → entity.engagementType`. Best-effort —
 * failures return undefined and the field is simply omitted from the write.
 */
async function resolveEngagementType(
  tenantId: string,
  accountId: string,
): Promise<AccountWorkforceEngagementType | undefined> {
  try {
    const accountSnap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
    if (!accountSnap.exists) return undefined;
    const accountData = accountSnap.data() as Record<string, unknown>;
    const entityId = pickString(accountData?.hiringEntityId);
    if (!entityId) return undefined;

    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
    if (!entitySnap.exists) return undefined;
    const entityData = entitySnap.data() as Record<string, unknown>;
    const raw = String(entityData?.engagementType || '').toLowerCase().trim();
    if (raw === 'w2') return 'w2';
    if (raw === '1099') return '1099';
    return undefined;
  } catch (err) {
    logger.warn('workforce-trigger: engagementType resolution failed', {
      tenantId,
      accountId,
      error: (err as Error).message,
    });
    return undefined;
  }
}

function shiftDateTimestamp(
  assignment: Record<string, unknown>,
): admin.firestore.Timestamp | null {
  // Prefer endDate (when the shift finished) → startDate → the write time. Any
  // already-Timestamp value we see, we forward directly; strings and numbers
  // are coerced into Timestamps.
  const candidates: unknown[] = [
    (assignment as any).endDate,
    (assignment as any).startDate,
    (assignment as any).updatedAt,
  ];
  for (const v of candidates) {
    if (v instanceof admin.firestore.Timestamp) return v;
    if (v instanceof Date) return admin.firestore.Timestamp.fromDate(v);
    if (typeof v === 'string') {
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed)) return admin.firestore.Timestamp.fromMillis(parsed);
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return admin.firestore.Timestamp.fromMillis(v);
    }
  }
  return null;
}

export const onAssignmentWriteMaintainAccountWorkforce = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/assignments/{assignmentId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const assignmentId = String(event.params.assignmentId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    // Deletes: nothing to maintain on this side. Counter-decrement on delete is
    // not a real product requirement — cancellations are modeled via status,
    // not by deleting the assignment doc.
    if (!afterData) return;

    const afterStatus = readStatus(afterData);
    const beforeStatus = readStatus(beforeData);

    // Short-circuit: never-committed writes don't touch AccountWorkforce at all.
    if (!COMMITTING_STATUSES.has(afterStatus)) return;

    const workerId = pickString(
      afterData.userId,
      afterData.candidateId,
      (afterData as any).workerUid,
    );
    if (!workerId) {
      logger.warn('workforce-trigger: no workerId on assignment', { tenantId, assignmentId });
      return;
    }

    const accountId = await resolveAccountIdForAssignment(tenantId, afterData);
    if (!accountId) {
      // Legacy rows without a resolvable account are skipped — the Phase 1
      // backfill already logged them; live writes shouldn't hit this path
      // once all JOs carry `recruiterAccountId`.
      logger.info('workforce-trigger: no resolvable accountId — skipping', {
        tenantId,
        assignmentId,
        jobOrderId: afterData.jobOrderId,
      });
      return;
    }

    const docId = accountWorkforceDocId(accountId, workerId);
    const ref = db.doc(`tenants/${tenantId}/account_workforce/${docId}`);

    // Is this the commitment point (pending → confirmed or first-seen)?
    const transitionedToCommitting =
      !COMMITTING_STATUSES.has(beforeStatus) && COMMITTING_STATUSES.has(afterStatus);
    // Is this a new terminal outcome landing now (not a re-write of the same state)?
    const transitionedToTerminalOutcome =
      TERMINAL_OUTCOME_STATUSES.has(afterStatus) && beforeStatus !== afterStatus;
    // Undo case (Phase 4): a terminal outcome was reverted back to
    // `confirmed` / `active`. Decrement the counters that were bumped
    // when the outcome originally landed, so undoing a mistake doesn't
    // leave stale stats.
    const undidTerminalOutcome =
      TERMINAL_OUTCOME_STATUSES.has(beforeStatus) &&
      !TERMINAL_OUTCOME_STATUSES.has(afterStatus) &&
      COMMITTING_STATUSES.has(afterStatus);

    // Nothing to do if none of these fire. Avoids useless reads when,
    // say, a minor field updates while status stays `confirmed`.
    if (!transitionedToCommitting && !transitionedToTerminalOutcome && !undidTerminalOutcome) return;

    const now = admin.firestore.Timestamp.now();

    // Load existing doc (we need to branch on create-vs-update, and to check
    // for the inactive-safety-net case).
    const existingSnap = await ref.get();
    const existing = existingSnap.exists
      ? (existingSnap.data() as Record<string, unknown>)
      : null;

    // =========================================================================
    // Branch A: doc doesn't exist + the assignment just committed → create.
    // =========================================================================
    if (!existing && transitionedToCommitting) {
      const engagementType = await resolveEngagementType(tenantId, accountId);
      const confirmedAtCandidate =
        (afterData as any).confirmedAt instanceof admin.firestore.Timestamp
          ? ((afterData as any).confirmedAt as admin.firestore.Timestamp)
          : now;
      const shiftDate = transitionedToTerminalOutcome
        ? shiftDateTimestamp(afterData)
        : null;

      const payload: Record<string, unknown> = {
        tenantId,
        accountId,
        workerId,
        status: 'active',
        firstConfirmedAt: confirmedAtCandidate,
        totalShifts: transitionedToTerminalOutcome ? 1 : 0,
        completedShifts: afterStatus === 'completed' ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      };
      if (engagementType) payload.engagementType = engagementType;
      if (shiftDate) payload.lastShiftAt = shiftDate;

      await ref.set(payload, { merge: false });
      logger.info('workforce-trigger: created AccountWorkforce', {
        tenantId,
        accountId,
        workerId,
      });
      return;
    }

    // =========================================================================
    // Branch B: doc exists — update paths.
    // =========================================================================
    if (!existing) {
      // Terminal outcome on an assignment that never committed according to
      // its own history AND no AccountWorkforce doc exists. Extremely rare
      // (means a direct write of `completed` without ever going through
      // `confirmed`). Create the doc so the rollup isn't lost, but log it.
      if (transitionedToTerminalOutcome) {
        const engagementType = await resolveEngagementType(tenantId, accountId);
        const shiftDate = shiftDateTimestamp(afterData);
        const payload: Record<string, unknown> = {
          tenantId,
          accountId,
          workerId,
          status: 'active',
          firstConfirmedAt: shiftDate ?? now,
          totalShifts: 1,
          completedShifts: afterStatus === 'completed' ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        };
        if (engagementType) payload.engagementType = engagementType;
        if (shiftDate) payload.lastShiftAt = shiftDate;
        await ref.set(payload, { merge: false });
        logger.warn('workforce-trigger: created AccountWorkforce from terminal-only write', {
          tenantId,
          accountId,
          workerId,
          assignmentId,
          afterStatus,
        });
      }
      return;
    }

    // Existing doc — assemble the patch.
    const existingStatus = String(existing.status || 'active').toLowerCase();
    const patch: Record<string, unknown> = { updatedAt: now };

    if (transitionedToCommitting && existingStatus === 'inactive') {
      // Safety-net branch: confirm landed on an inactive record. Don't
      // reactivate; append a blocker (§3.4(4)). Deduplicate by assignmentId so
      // re-fires don't pile up duplicates.
      const existingBlockers = Array.isArray((existing as any).blockers)
        ? ((existing as any).blockers as AccountWorkforceBlocker[])
        : [];
      const alreadyBlocked = existingBlockers.some(
        (b) => b?.code === 'CONFIRMED_WHILE_INACTIVE' && b?.assignmentId === assignmentId,
      );
      if (!alreadyBlocked) {
        const blocker: AccountWorkforceBlocker = {
          code: 'CONFIRMED_WHILE_INACTIVE',
          assignmentId,
          at: now.toDate().toISOString(),
        };
        patch.blockers = admin.firestore.FieldValue.arrayUnion(blocker);
      }
      logger.warn('workforce-trigger: confirmed-while-inactive blocker', {
        tenantId,
        accountId,
        workerId,
        assignmentId,
      });
    }

    if (transitionedToTerminalOutcome) {
      patch.totalShifts = admin.firestore.FieldValue.increment(1);
      if (afterStatus === 'completed') {
        patch.completedShifts = admin.firestore.FieldValue.increment(1);
      }
      const shiftDate = shiftDateTimestamp(afterData);
      if (shiftDate) {
        const existingLastMs =
          existing.lastShiftAt instanceof admin.firestore.Timestamp
            ? (existing.lastShiftAt as admin.firestore.Timestamp).toMillis()
            : 0;
        if (shiftDate.toMillis() >= existingLastMs) {
          patch.lastShiftAt = shiftDate;
        }
      }
    }

    if (undidTerminalOutcome) {
      // Phase 4 — undo path. Reverse the counter bumps from when the
      // outcome originally landed. `lastShiftAt` is NOT reverted — we
      // only have a forward timestamp history; recomputing the previous
      // value would require a scan. Leave it alone and let the next
      // outcome write move it forward again.
      patch.totalShifts = admin.firestore.FieldValue.increment(-1);
      if (beforeStatus === 'completed') {
        patch.completedShifts = admin.firestore.FieldValue.increment(-1);
      }
    }

    // If the patch has nothing but `updatedAt`, skip the write — avoids an
    // infinite loop in case this trigger ever re-fires on its own writes.
    const meaningfulKeys = Object.keys(patch).filter((k) => k !== 'updatedAt');
    if (meaningfulKeys.length === 0) return;

    await ref.set(patch, { merge: true });
  },
);
