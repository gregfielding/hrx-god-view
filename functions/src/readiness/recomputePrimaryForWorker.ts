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
import { resolveRole, type ResolveRoleUserGroup } from '../shared/resolveRole';

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

  // CSA path first — Recruiting Role Model (docs/RECRUITING_ROLE_MODEL.md §2.1
  // and §5.4). If any user group this worker belongs to has a populated
  // `roles.csaIds`, that wins and becomes the primary. Only when no group
  // has CSAs do we fall through to the legacy anchor-based computation,
  // so behavior is unchanged for tenants that haven't adopted the role
  // model yet. Earliest-created group's first CSA wins (§3.1).
  const csaResult = await tryResolveCsaForWorker(tenantId, workerUid);
  if (csaResult.primaryRecruiterId !== null) {
    const writeResult = await writePrimaryIfChanged(workerUid, csaResult.primaryRecruiterId);
    return {
      primaryRecruiterId: csaResult.primaryRecruiterId,
      changed: writeResult.changed,
      // No anchor for CSA-sourced writes — the "source" is the user group.
      sourceAnchor: null,
    };
  }

  const anchors = await loadActiveAnchors(tenantId, workerUid);
  const { primaryRecruiterId, sourceAnchor } = computePrimaryRecruiterForWorker(anchors);

  const writeResult = await writePrimaryIfChanged(workerUid, primaryRecruiterId);
  return { primaryRecruiterId, changed: writeResult.changed, sourceAnchor };
}

/**
 * Transactional write — only touches `users/{uid}` when the scalar
 * actually needs to change. Shared between the CSA path and the legacy
 * anchor path so both write behavior and timestamp semantics stay
 * identical no matter which resolver picked the winner.
 */
async function writePrimaryIfChanged(
  workerUid: string,
  next: string | null,
): Promise<{ changed: boolean }> {
  const userRef = db.doc(`users/${workerUid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = (snap.exists ? snap.data()?.primaryRecruiterId : null) as string | null | undefined;
    const before: string | null = typeof current === 'string' && current.trim() !== '' ? current : null;
    if (before === next) return { changed: false };

    const patch: Record<string, unknown> = {
      primaryRecruiterId: next,
      primaryRecruiterSince: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Clear `primaryRecruiterSince` when clearing the scalar so we don't leave
    // a stale timestamp pointing at a recruiter who no longer owns this worker.
    if (next === null) {
      patch.primaryRecruiterSince = admin.firestore.FieldValue.delete();
    }
    tx.set(userRef, patch, { merge: true });
    return { changed: true };
  });
}

/**
 * CSA tier resolver — walks the worker's user-group memberships and
 * delegates to the pure `resolveRole('candidate_success_agent', ...)`
 * resolver. Returns `null` when no group has CSAs populated so the
 * caller can fall through to the legacy anchor path.
 *
 * Performance: one query (userGroups where memberIds array-contains
 * workerUid). For a typical worker in 1-3 groups, total read budget
 * stays in single digits.
 */
async function tryResolveCsaForWorker(
  tenantId: string,
  workerUid: string,
): Promise<{ primaryRecruiterId: string | null }> {
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/userGroups`)
      .where('memberIds', 'array-contains', workerUid)
      .get();
    if (snap.empty) return { primaryRecruiterId: null };

    const groups: ResolveRoleUserGroup[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const roles = (data.roles || {}) as { csaIds?: unknown };
      const csaIds = Array.isArray(roles?.csaIds)
        ? (roles.csaIds.filter((x) => typeof x === 'string') as string[])
        : [];
      const createdAtIso =
        typeof data.createdAt === 'string'
          ? data.createdAt
          : data.createdAt && typeof (data.createdAt as { toDate?: unknown }).toDate === 'function'
            ? (() => {
                try {
                  return (data.createdAt as { toDate: () => Date }).toDate().toISOString();
                } catch {
                  return undefined;
                }
              })()
            : undefined;
      return { id: d.id, csaIds, createdAtIso };
    });

    const result = resolveRole({ role: 'candidate_success_agent', userGroups: groups });
    return { primaryRecruiterId: result.primaryUid };
  } catch (err) {
    logger.warn('recomputePrimaryForWorker: CSA tier lookup failed; falling back to legacy', {
      tenantId,
      workerUid,
      err: (err as Error).message,
    });
    return { primaryRecruiterId: null };
  }
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
