/**
 * Phase C — recompute Phase B match items on existing active assignments
 * when a worker's underlying record changes.
 *
 * Today the seed trigger (`onAssignmentCreatedAutoSeed`) computes initial
 * status at assignment creation. After that the items are frozen until the
 * worker resolves them manually. Phase C adds two refresh paths:
 *
 *   - **Write-driven** (this file's `recomputeMatchItemsForWorker`): when a
 *     worker uploads a new license / cert / etc., re-run the matchers for
 *     each of their active assignments and update items where status or
 *     expiry changed.
 *   - **Time-driven** (Phase C.2 daily reconciler): scan items past their
 *     `expiresAtMs` and flip them to `expired`.
 *
 * `recomputeMatchItemsForWorker` is generic — it re-runs ALL five wired
 * matchers (education, languages, skills, licenses, screening package).
 * Triggers narrow the *when* (only fire on licenses change, only fire on
 * cert change, etc.) but call into the same recomputation, because the cost
 * difference between "recompute all 5" and "recompute just licenses" is
 * negligible compared to the per-assignment Firestore round-trips.
 *
 * **Refresh does NOT create items** — only the seed trigger does. If a JO
 * gains a new requirement after seeding (rare but possible), the missing
 * item gets logged as `itemsMissingForExpectedSpec` and the recruiter has
 * to address it manually. Auto-creating mid-stream would require ownership
 * resolution + actor decisions that don't belong in a refresh path.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase C
 * @see jobRequirementMatcherHelpers.ts (used by both seed and refresh paths)
 * @see assignmentMatchExpiryHelpers.ts (expiry stamping shared with seed)
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  buildPhaseBMatchSpecs,
  loadScreeningEvalForJobOrder,
  loadWorkerForMatching,
  type WorkerForMatching,
} from './jobRequirementMatcherHelpers';
import { stampExpiryOnSpecs } from './assignmentMatchExpiryHelpers';
import {
  buildAssignmentReadinessItemId,
  type AssignmentReadinessItem,
} from '../shared/assignmentReadinessItemV1';
import type { RequiredLicenseV1 } from '../shared/licenseRecord';

export interface RefreshSummary {
  /** How many active assignments we looked at for this worker × tenant. */
  assignmentsScanned: number;
  /** Items we wrote a status / expiry change to. */
  itemsUpdated: number;
  /** Items the matcher re-derived but the recorded status / expiry already matched. */
  itemsUnchanged: number;
  /** Specs the matcher emitted that have no corresponding seeded item — see file doc. */
  itemsMissingForExpectedSpec: number;
}

/**
 * Active assignment statuses per the canonical Job Order model. An assignment
 * outside these statuses (`completed`, `cancelled`) is no longer placement-
 * relevant and gets skipped by the refresh.
 */
const ACTIVE_ASSIGNMENT_STATUSES = ['pending', 'confirmed', 'in_progress'] as const;

/**
 * Recompute Phase B match items across all active assignments for one worker
 * within one tenant. Idempotent — runs the matcher, updates only items where
 * `(status, expiresAtMs)` differ from what's persisted.
 *
 * Cost per call: 1 worker doc + (1 query × 2 fields) + (per-assignment: 1 JO
 * read + optional 1 BG checks query + N item reads/writes). Capped at 200
 * assignments per tenant per worker (limit on the outer query).
 *
 * Caller responsibility:
 *   - Ensure the worker actually has data worth recomputing (short-circuit
 *     on field-change in the trigger before calling).
 *   - Multi-tenant fan-out (this function is single-tenant; trigger handles
 *     tenant resolution).
 */
export async function recomputeMatchItemsForWorker(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  workerUid: string;
  /** Today as ISO YYYY-MM-DD (passed to license expiry check). */
  todayISO: string;
  /** Today as ms since epoch (passed to screening validity window check). */
  todayMs: number;
}): Promise<RefreshSummary> {
  const { db, tenantId, workerUid, todayISO, todayMs } = args;
  const summary: RefreshSummary = {
    assignmentsScanned: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsMissingForExpectedSpec: 0,
  };

  // Load worker once; reused across all of the worker's assignments.
  const worker = await loadWorkerForMatching(db, workerUid);

  const assignments = await loadActiveAssignmentsForWorker(db, tenantId, workerUid);
  if (assignments.size === 0) {
    return summary;
  }

  const nowIso = new Date(todayMs).toISOString();

  for (const [assignmentId, assignmentData] of assignments) {
    summary.assignmentsScanned++;

    const jobOrderId =
      typeof assignmentData.jobOrderId === 'string' ? assignmentData.jobOrderId.trim() : '';
    if (!jobOrderId) continue;

    const joData = await loadJobOrder(db, tenantId, jobOrderId);
    if (joData == null) continue;

    const screeningEval = await loadScreeningEvalIfRequired(db, tenantId, workerUid, joData);

    // Recompute specs (same call shape as the seed trigger).
    const specs = buildPhaseBMatchSpecs({
      jo: joData,
      worker,
      screeningEval,
      todayISO,
      todayMs,
    });
    stampExpiryOnSpecs({
      specs,
      workerLicenses: worker.licenses,
      requiredLicensesV2: pickRequiredLicensesV2(joData.requiredLicensesV2),
      screeningEval,
    });

    // Apply per-spec diff against persisted items.
    await applySpecDiff({
      db,
      tenantId,
      assignmentId,
      worker,
      specs,
      nowIso,
      summary,
    });
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find this worker's active assignments in this tenant. Searches both
 * `userId` and `candidateId` (legacy field) and dedupes by assignment id.
 */
async function loadActiveAssignmentsForWorker(
  db: admin.firestore.Firestore,
  tenantId: string,
  workerUid: string,
): Promise<Map<string, Record<string, unknown>>> {
  const col = db.collection(`tenants/${tenantId}/assignments`);
  const statuses = Array.from(ACTIVE_ASSIGNMENT_STATUSES);

  const [byUserId, byCandidateId] = await Promise.all([
    col.where('userId', '==', workerUid).where('status', 'in', statuses).limit(200).get(),
    col.where('candidateId', '==', workerUid).where('status', 'in', statuses).limit(200).get(),
  ]);

  const out = new Map<string, Record<string, unknown>>();
  for (const snap of [byUserId, byCandidateId]) {
    for (const doc of snap.docs) {
      if (!out.has(doc.id)) {
        out.set(doc.id, doc.data() as Record<string, unknown>);
      }
    }
  }
  return out;
}

/** Load a JO by id. Returns null on lookup failure (logged at warn). */
async function loadJobOrder(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await db.doc(`tenants/${tenantId}/jobOrders/${jobOrderId}`).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  } catch (err) {
    logger.warn('recomputeMatchItemsForWorker: jobOrder lookup failed', {
      tenantId,
      jobOrderId,
      err: (err as Error).message,
    });
    return null;
  }
}

/** Conditionally load + run the screening eval — only when the JO declares a package. */
async function loadScreeningEvalIfRequired(
  db: admin.firestore.Firestore,
  tenantId: string,
  workerUid: string,
  joData: Record<string, unknown>,
) {
  const requiredPackageId =
    typeof joData.screeningPackageId === 'string' && joData.screeningPackageId.trim().length > 0
      ? joData.screeningPackageId.trim()
      : null;
  if (!requiredPackageId) return null;

  const requiredPackageName =
    typeof joData.screeningPackageName === 'string' ? joData.screeningPackageName : null;

  return loadScreeningEvalForJobOrder(db, {
    tenantId,
    workerUid,
    requiredPackageId,
    requiredPackageName,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Per-assignment diff + write
// ─────────────────────────────────────────────────────────────────────────

interface ApplyArgs {
  db: admin.firestore.Firestore;
  tenantId: string;
  assignmentId: string;
  worker: WorkerForMatching;
  specs: ReturnType<typeof buildPhaseBMatchSpecs>;
  nowIso: string;
  summary: RefreshSummary;
}

async function applySpecDiff(args: ApplyArgs): Promise<void> {
  const { db, tenantId, assignmentId, specs, nowIso, summary } = args;

  for (const spec of specs) {
    const itemId = buildAssignmentReadinessItemId({
      assignmentId,
      requirementType: spec.requirementType,
      customKey: spec.customKey,
    });
    const itemRef = db.doc(`tenants/${tenantId}/assignmentReadinessItems/${itemId}`);

    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      summary.itemsMissingForExpectedSpec++;
      continue;
    }

    const existing = itemSnap.data() as AssignmentReadinessItem;
    const newStatus = spec.status ?? 'incomplete';
    const newExpiresAtMs = spec.expiresAtMs;
    const statusChanged = existing.status !== newStatus;
    const expiryChanged = (existing.expiresAtMs ?? null) !== (newExpiresAtMs ?? null);

    if (!statusChanged && !expiryChanged) {
      summary.itemsUnchanged++;
      continue;
    }

    const patch: Record<string, unknown> = { updatedAt: nowIso };
    if (statusChanged) {
      patch.status = newStatus;
      if (newStatus === 'complete_pass' && !existing.completedAt) {
        patch.completedAt = nowIso;
      }
    }
    if (expiryChanged) {
      if (typeof newExpiresAtMs === 'number' && newExpiresAtMs > 0) {
        patch.expiresAtMs = newExpiresAtMs;
      } else {
        patch.expiresAtMs = admin.firestore.FieldValue.delete();
      }
    }

    try {
      await itemRef.update(patch);
      summary.itemsUpdated++;
      logger.info('match-refresh: item updated', {
        tenantId,
        assignmentId,
        itemId,
        oldStatus: existing.status,
        newStatus,
        statusChanged,
        expiryChanged,
      });
    } catch (err) {
      logger.warn('match-refresh: item update failed', {
        tenantId,
        assignmentId,
        itemId,
        err: (err as Error).message,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// JO field readers (defensive)
// ─────────────────────────────────────────────────────────────────────────

function pickRequiredLicensesV2(v: unknown): RequiredLicenseV1[] {
  if (!Array.isArray(v)) return [];
  const out: RequiredLicenseV1[] = [];
  for (const e of v) {
    if (e && typeof e === 'object' && typeof (e as { licenseClass?: unknown }).licenseClass === 'string') {
      out.push({ licenseClass: (e as { licenseClass: string }).licenseClass });
    }
  }
  return out;
}
