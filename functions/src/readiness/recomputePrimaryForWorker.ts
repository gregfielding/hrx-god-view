/**
 * Core denormalization logic: recompute `users/{uid}.primaryRecruiterId` from
 * the worker's currently active readiness items.
 *
 * Called by the `onActionItemOwnershipChange` trigger and the one-time
 * backfill callable. Factored out so both paths share the exact same query +
 * compute + write sequence.
 *
 * @see recruiter-ownership-model.md §13b (the denormalized scalar)
 * @see shared/workerPrimaryRecruiter.ts (the pure function this wraps)
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  computePrimaryRecruiterForWorker,
  type WorkerOwnershipAnchor,
} from '../shared/workerPrimaryRecruiter';
import type { EmployeeReadinessItem } from '../shared/employeeReadinessItemV1';
import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * An item status is "active" for ownership purposes when the primary recruiter
 * still has responsibility for moving it forward. Per §6e this includes:
 *   - incomplete / in_progress — not yet resolved
 *   - blocked                  — upstream issue still owned by this recruiter
 *   - needs_review             — vendor returned DISCREPANCY / TNC; recruiter adjudicates
 *   - complete_fail            — failure may be retryable; keep ownership until closed
 *   - expired                  — previously passed, now needs re-verification
 *
 * NOT active (removes the anchor from the primary computation):
 *   - complete_pass            — done cleanly; no further action from this recruiter
 *   - not_applicable           — never applied
 *   - complete (legacy)        — treat like complete_pass
 */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'incomplete',
  'in_progress',
  'blocked',
  'needs_review',
  'complete_fail',
  'expired',
]);

export type RecomputePrimaryResult = {
  /** The new scalar. `null` if the worker has no active anchors. */
  primaryRecruiterId: string | null;
  /** True when the scalar actually changed on `users/{uid}`. */
  changed: boolean;
  /** For logging / debugging — which anchor won, if any. */
  sourceAnchor: WorkerOwnershipAnchor | null;
};

/**
 * Recompute + conditionally write `users/{uid}.primaryRecruiterId` for one
 * worker. Idempotent — safe to call from any trigger path.
 *
 * Performance: two collection-group queries (one per item type) scoped to
 * this worker's tenant + uid. At 4-6 active items per worker this stays
 * under 50 reads. The trigger dedupes in-flight writes so a burst of item
 * updates collapses to a single recompute.
 */
export async function recomputePrimaryForWorker(
  tenantId: string,
  workerUid: string,
): Promise<RecomputePrimaryResult> {
  if (!tenantId || !workerUid) {
    return { primaryRecruiterId: null, changed: false, sourceAnchor: null };
  }

  const anchors = await loadActiveAnchors(tenantId, workerUid);
  const { primaryRecruiterId, sourceAnchor } = computePrimaryRecruiterForWorker(anchors);

  const userRef = db.doc(`users/${workerUid}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = (snap.exists ? snap.data()?.primaryRecruiterId : null) as string | null | undefined;

    // Normalize falsy variants (undefined / missing) to null for comparison.
    const before: string | null = typeof current === 'string' && current.trim() !== '' ? current : null;
    if (before === primaryRecruiterId) {
      return { changed: false };
    }

    const patch: Record<string, unknown> = {
      primaryRecruiterId,
      primaryRecruiterSince: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Clear `primaryRecruiterSince` when clearing the scalar so we don't leave
    // a stale timestamp pointing at a recruiter who no longer owns this worker.
    if (primaryRecruiterId === null) {
      patch.primaryRecruiterSince = admin.firestore.FieldValue.delete();
    }
    tx.set(userRef, patch, { merge: true });
    return { changed: true };
  });

  return { primaryRecruiterId, changed: result.changed, sourceAnchor };
}

/**
 * Load the worker's currently-active anchors — one subcollection query per
 * item type, filtered to active statuses. Converts Firestore docs into the
 * pure `WorkerOwnershipAnchor` shape expected by the compute function.
 */
async function loadActiveAnchors(tenantId: string, workerUid: string): Promise<WorkerOwnershipAnchor[]> {
  const anchors: WorkerOwnershipAnchor[] = [];

  // Assignment Readiness items (shift-scoped, higher priority in
  // computePrimaryRecruiterForWorker).
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/assignmentReadinessItems`)
      .where('workerUid', '==', workerUid)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() as AssignmentReadinessItem;
      if (!ACTIVE_STATUSES.has(String(data.status))) continue;
      const primaryRecruiterId = data.ownership?.primaryRecruiterId ?? null;
      anchors.push({
        kind: 'assignmentReadinessItem',
        sourceItemId: doc.id,
        primaryRecruiterId,
        activeAt: normalizeIso(data.createdAt),
      });
    }
  } catch (err) {
    logger.warn('recomputePrimaryForWorker: assignmentReadinessItems query failed', {
      tenantId,
      workerUid,
      err: (err as Error).message,
    });
  }

  // Employee Readiness items (entity-scoped).
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/employeeReadinessItems`)
      .where('workerUid', '==', workerUid)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() as EmployeeReadinessItem;
      if (!ACTIVE_STATUSES.has(String(data.status))) continue;
      const primaryRecruiterId = data.ownership?.primaryRecruiterId ?? null;
      anchors.push({
        kind: 'employeeReadinessItem',
        sourceItemId: doc.id,
        primaryRecruiterId,
        activeAt: normalizeIso(data.createdAt),
      });
    }
  } catch (err) {
    logger.warn('recomputePrimaryForWorker: employeeReadinessItems query failed', {
      tenantId,
      workerUid,
      err: (err as Error).message,
    });
  }

  return anchors;
}

/** The item's `createdAt` is written as a Firestore Timestamp by the callable; the pure compute wants ISO. */
function normalizeIso(value: unknown): string {
  if (!value) return new Date(0).toISOString();
  if (typeof value === 'string') return value;
  // Firestore Timestamp has `.toDate()`
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  }
  return new Date(0).toISOString();
}
