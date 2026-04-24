/**
 * **Mirror of `shared/workerPrimaryRecruiter.ts`** — CRA client/jest copy.
 * Keep byte-for-byte in sync.
 *
 * Compute the denormalized `users/{uid}.primaryRecruiterId` scalar from a
 * worker's active ownership anchors.
 *
 * Per `recruiter-ownership-model.md §13b`, the scalar on the worker doc is
 * derived, never user-editable. The source of truth lives on individual action
 * items (Employee / Assignment Readiness). This function takes the already-
 * loaded list of active anchors and applies the priority rule from §12a to
 * pick the winning recruiter.
 *
 * Pure, runtime-neutral, no firebase imports. The calling trigger
 * (`onActionItemOwnershipChange`) is responsible for loading the anchors.
 *
 * Contract:
 *   - Returns `null` when the worker has no active anchors with a primary set
 *     — caller writes `users/{uid}.primaryRecruiterId = null` and the worker
 *     drops out of every "My Users" list.
 *   - Returns the winning recruiter's uid plus the anchor it came from
 *     (for debugging / audit).
 *   - Deterministic: same input list yields the same result.
 */

/** The anchor types that drive the scalar today. More may be added in future phases. */
export type WorkerOwnershipAnchorKind =
  /** An Assignment Readiness item (shift-scoped). Highest priority — a live shift is the most actionable. */
  | 'assignmentReadinessItem'
  /** An Employee Readiness item (worker × hiring entity). Lower priority than shift-level. */
  | 'employeeReadinessItem';

/**
 * A single active anchor feeding into the scalar computation.
 *
 * We don't load the full item doc — just the fields needed for priority + tie-break.
 */
export type WorkerOwnershipAnchor = {
  kind: WorkerOwnershipAnchorKind;
  /** The item doc id, for audit/debugging. */
  sourceItemId: string;
  /**
   * The anchor's own `ownership.primaryRecruiterId`. May be `null` when the
   * item currently sits in the unassigned pool; those anchors never drive the
   * worker's scalar (we skip them and move to the next candidate).
   */
  primaryRecruiterId: string | null;
  /**
   * When this anchor last became "active" — for `AssignmentReadinessItem` this is
   * the assignment's start time; for `EmployeeReadinessItem` it's the item's
   * `createdAt`. Used as a tiebreaker within the same kind. ISO-8601.
   */
  activeAt: string;
};

/** Priority map: lower number = more specific = wins. */
const ANCHOR_PRIORITY: Record<WorkerOwnershipAnchorKind, number> = {
  assignmentReadinessItem: 1,
  employeeReadinessItem: 2,
};

export type ComputePrimaryRecruiterResult = {
  primaryRecruiterId: string | null;
  /** The anchor that won — null when result is null. */
  sourceAnchor: WorkerOwnershipAnchor | null;
};

/**
 * Pick the primary recruiter for a worker from their active anchors.
 *
 * Algorithm:
 *   1. Drop anchors whose `primaryRecruiterId` is null (they're in a pool).
 *   2. Sort remaining anchors by:
 *        (a) kind priority (lower wins — assignment before employee),
 *        (b) then by `activeAt` descending (most recent wins within a kind).
 *   3. The head of the sorted list is the winner. Its `primaryRecruiterId`
 *      becomes `users/{uid}.primaryRecruiterId`.
 *   4. If no valid anchor survives, return `{ primaryRecruiterId: null, … }`.
 */
export function computePrimaryRecruiterForWorker(
  anchors: WorkerOwnershipAnchor[],
): ComputePrimaryRecruiterResult {
  if (!anchors || anchors.length === 0) {
    return { primaryRecruiterId: null, sourceAnchor: null };
  }

  const withPrimary = anchors.filter((a) => typeof a.primaryRecruiterId === 'string' && a.primaryRecruiterId.trim() !== '');
  if (withPrimary.length === 0) {
    return { primaryRecruiterId: null, sourceAnchor: null };
  }

  const sorted = [...withPrimary].sort((a, b) => {
    const byKind = ANCHOR_PRIORITY[a.kind] - ANCHOR_PRIORITY[b.kind];
    if (byKind !== 0) return byKind;
    // Same kind — newer activeAt wins. Fall back to sourceItemId so ordering is
    // fully deterministic even when two anchors share the exact same timestamp.
    const byTime = b.activeAt.localeCompare(a.activeAt);
    if (byTime !== 0) return byTime;
    return a.sourceItemId.localeCompare(b.sourceItemId);
  });

  const winner = sorted[0];
  return {
    primaryRecruiterId: winner.primaryRecruiterId,
    sourceAnchor: winner,
  };
}
