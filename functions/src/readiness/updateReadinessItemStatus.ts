/**
 * Shared helper for the Phase A reconciliation triggers.
 *
 * Each trigger watches its source collection (backgroundChecks,
 * everify_cases, everee_workers, worker_onboarding, users), translates
 * the raw vendor / source state into a canonical
 * `EmployeeReadinessItemStatus` via the Phase E translators, and then
 * writes that status onto the matching `employee_readiness_items` doc.
 *
 * This helper handles the last leg of every trigger:
 *   - Build the deterministic doc id `${workerUid}__${hiringEntityId}__${requirementType}`
 *   - Read the current item
 *   - Compare new vs current status (no-op if unchanged — idempotency)
 *   - Atomic update with audit timestamps + a status-history append
 *
 * Why a transaction instead of a plain `update`:
 *   1. Avoids stomping on a parallel write that might have already
 *      moved the item past where we are. Triggers can race when two
 *      vendor events land in the same second.
 *   2. Lets us read the current status to short-circuit no-op writes
 *      atomically — `update` alone would still bump `updatedAt` even
 *      when nothing changed.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase A
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  buildEmployeeReadinessItemId,
  type EmployeeReadinessItem,
  type EmployeeReadinessItemStatus,
  type EmployeeReadinessRequirementType,
} from '../shared/employeeReadinessItemV1';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export interface UpdateReadinessItemStatusInput {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  requirementType: EmployeeReadinessRequirementType;
  /** Optional custom key — required only for `requirementType === 'custom'`. */
  customKey?: string;
  /** The new status produced by a Phase E translator. */
  newStatus: EmployeeReadinessItemStatus;
  /** Identifies the trigger / source for audit. e.g. `'accusource_webhook'`. */
  source: string;
  /** Optional external reference (vendor doc id, case id, etc.) for the audit trail. */
  externalRef?: string;
}

export interface UpdateReadinessItemStatusResult {
  /** `true` when the doc actually changed; `false` for no-op (status unchanged or doc missing). */
  changed: boolean;
  /** When `changed === false` and the item didn't exist, this carries the reason. */
  skippedReason?: 'doc_not_found' | 'status_unchanged';
  /** The status persisted after the call (current status if no-op; new status if updated). */
  status: EmployeeReadinessItemStatus | null;
}

/**
 * Reconcile a single `employee_readiness_items` doc with a new canonical
 * status from a Phase E translator. Idempotent. Atomic.
 *
 * Behavior:
 *   - Doc not found → no-op, log warning. Triggers are reactive; we
 *     don't create items here because the seed runner owns ownership /
 *     actor / blocking metadata that we don't have at the trigger.
 *   - Status unchanged → no-op, no write.
 *   - Status changed → atomic update with `status`, `updatedAt`, optional
 *     `completedAt` / `blockedAt` timestamps for the relevant terminal
 *     transitions, and `externalRef` if provided.
 */
export async function updateReadinessItemStatus(
  input: UpdateReadinessItemStatusInput,
): Promise<UpdateReadinessItemStatusResult> {
  const { tenantId, workerUid, hiringEntityId, requirementType, newStatus } = input;

  const itemId = buildEmployeeReadinessItemId({
    workerUid,
    hiringEntityId,
    requirementType,
    customKey: input.customKey,
  });
  const ref = db.doc(`tenants/${tenantId}/employeeReadinessItems/${itemId}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return {
        changed: false,
        skippedReason: 'doc_not_found' as const,
        status: null,
      };
    }
    const current = snap.data() as EmployeeReadinessItem;
    const currentStatus = current.status;
    if (currentStatus === newStatus) {
      return {
        changed: false,
        skippedReason: 'status_unchanged' as const,
        status: currentStatus,
      };
    }

    const nowIso = new Date().toISOString();
    const patch: Partial<EmployeeReadinessItem> & Record<string, unknown> = {
      status: newStatus,
      updatedAt: nowIso,
    };
    if (input.externalRef) patch.externalRef = input.externalRef;
    // Stamp transition timestamps for the terminal states the rest of
    // the system reports against.
    if (newStatus === 'complete_pass' && !current.completedAt) {
      patch.completedAt = nowIso;
    }
    if (newStatus === 'blocked' && !current.blockedAt) {
      patch.blockedAt = nowIso;
    }

    tx.update(ref, patch);
    return { changed: true, status: newStatus };
  });

  if (result.changed) {
    logger.info('updateReadinessItemStatus: status transition', {
      tenantId,
      workerUid,
      hiringEntityId,
      requirementType,
      newStatus,
      source: input.source,
    });
  } else if (result.skippedReason === 'doc_not_found') {
    // Warn rather than error — this can happen legitimately (e.g. a
    // background check exists for an entity the worker hasn't been
    // formally associated with yet). Recoverable: when the
    // entity_employments doc gets written, the seed runner creates the
    // readiness items, and the next trigger event reconciles them.
    logger.warn('updateReadinessItemStatus: readiness item not found — skipping', {
      tenantId,
      workerUid,
      hiringEntityId,
      requirementType,
      source: input.source,
    });
  }

  return result;
}

/**
 * Convenience for triggers that need to update the SAME requirement on
 * MULTIPLE hiring entities (e.g. Worker Profile fields are reflected on
 * every entity employment a worker has). Calls `updateReadinessItemStatus`
 * for each entity in parallel, returning per-entity results.
 */
export async function updateReadinessItemStatusForEntities(
  base: Omit<UpdateReadinessItemStatusInput, 'hiringEntityId'>,
  hiringEntityIds: string[],
): Promise<Array<UpdateReadinessItemStatusResult & { hiringEntityId: string }>> {
  if (hiringEntityIds.length === 0) return [];
  const unique = Array.from(new Set(hiringEntityIds.filter(Boolean)));
  return Promise.all(
    unique.map(async (hiringEntityId) => {
      const r = await updateReadinessItemStatus({ ...base, hiringEntityId });
      return { ...r, hiringEntityId };
    }),
  );
}
