/**
 * Phase D.1.1 — group `QueueRow[]` into per-worker × per-hiring-entity
 * buckets for the Workforce > Employee Readiness redesign.
 *
 * **Why this lives in the readiness queue utils, not the page:**
 * Spec §7 of the D.1.1 addendum: data layer impact should be near-zero.
 * The hook (`useEmployeeReadinessItems`) returns a flat list; this helper
 * turns it into the work-shaped structure the new UI consumes. Pure,
 * trivially unit-testable, no React, no Firestore.
 *
 * **Group key:** `(workerUid, hiringEntityId)`. A worker employed by
 * multiple hiring entities (Select + Workforce + Events) lands in
 * multiple groups — same row format, different entity. This matches how
 * `employeeReadinessItems` is scoped (one item per worker × entity ×
 * requirement), so a "row" in the new UI is a worker's onboarding state
 * for one specific employer.
 *
 * **What this DOES NOT do:**
 *   - It doesn't apply chip filters, search, or scope. Those are the
 *     page's responsibility — same as before. The page passes in the
 *     already-scope-filtered `allRows` from the hook.
 *   - It doesn't do per-item display annotation (status chip color,
 *     CTA hint). Items inside a group are returned as-is; presentation
 *     is the row component's concern.
 *
 * @see ./queueRow.ts for `QueueRow` shape.
 * @see ./loadWorkerNames.ts for `WorkerNameMap`.
 */

import type { QueueRow } from './queueRow';
import type { WorkerNameMap } from './loadWorkerNames';

/**
 * Per-status-family aggregate counts. Keys mirror `QueueRow['status']`
 * exactly (including the legacy `complete` synonym for `complete_pass`)
 * so callers can sum them without needing to remap.
 */
export interface WorkerGroupCounts {
  needs_review: number;
  complete_fail: number;
  expired: number;
  blocked: number;
  incomplete: number;
  in_progress: number;
  complete_pass: number;
  /** @deprecated legacy synonym for complete_pass; counted separately so the
   *  sum stays accurate even if both values exist on a stale tenant. */
  complete: number;
  not_applicable: number;
}

export type WorkerGroupStatusFamily =
  | 'needs_review' // includes complete_fail (red — CSA must act)
  | 'expired' // yellow
  | 'incomplete' // gray (waiting on worker)
  | 'in_progress' // blue (vendor-driven, system processing)
  | 'complete' // green (complete_pass + legacy complete)
  | 'not_applicable'; // hidden by default

export interface WorkerGroup {
  /** Stable key suitable for `key={...}` and Map dedupe. */
  key: string;
  workerUid: string;
  /** Falls back to `workerUid` when name lookup hasn't resolved. */
  workerName: string;
  workerAvatar?: string;
  /** Always present for employee items, but kept optional to match the
   *  `QueueRow` type which is shared with assignment items. The grouper
   *  only buckets rows that have a `hiringEntityId`. */
  hiringEntityId: string;
  hiringEntityName?: string;
  /** Primary owner of this worker × entity bundle. Resolved from the
   *  highest-priority item in the group (see {@link resolveGroupOwner}). */
  primaryRecruiterId: string | null;
  ownerName?: string;
  ownerAvatar?: string;
  /** All items belonging to this worker × entity, sorted item-priority
   *  desc so the expanded view is render-ready. */
  items: QueueRow[];
  counts: WorkerGroupCounts;
  /** Number of items where `blocking === true` AND the item isn't already
   *  passed/N-A (i.e. blocking that's still in the way of placement). */
  blockingCount: number;
  /** Max `updatedAtMs` across all items — drives sort and "last activity". */
  lastUpdatedAtMs: number;
  /** Total item count — equals sum of `counts`. Cheap pre-compute for the
   *  progress bar denominator. */
  totalItems: number;
}

/**
 * Status priorities for SORTING items inside a group's `items` list.
 * Lower = more urgent. Mirrors the queue-level sort order (see
 * `compareReadinessRowsForQueue`) but as a flat lookup so it stays cheap
 * inside the grouper.
 */
const ITEM_SORT_PRIORITY: Record<QueueRow['status'], number> = {
  needs_review: 0,
  complete_fail: 1,
  expired: 2,
  blocked: 3,
  incomplete: 4,
  in_progress: 5,
  complete_pass: 6,
  complete: 6,
  not_applicable: 7,
};

/**
 * Owner resolution: when items in a group disagree on
 * `primaryRecruiterId` (rare, but happens when ownership re-stamps lag
 * behind item creation), pick the owner of the most urgent item. This is
 * the same heuristic the per-item view used implicitly (the user always
 * saw the owner of the row they were looking at, which was the most
 * urgent). For the collapsed row, "owner of the most urgent item" is the
 * accountable CSA.
 */
function resolveGroupOwner(items: QueueRow[]): {
  primaryRecruiterId: string | null;
  ownerName?: string;
  ownerAvatar?: string;
} {
  if (items.length === 0) return { primaryRecruiterId: null };
  // Items are already sorted by urgency at insertion time, so [0] is most urgent.
  const head = items[0];
  return {
    primaryRecruiterId: head.primaryRecruiterId ?? null,
    ownerName: head.ownerName,
    ownerAvatar: head.ownerAvatar,
  };
}

function emptyCounts(): WorkerGroupCounts {
  return {
    needs_review: 0,
    complete_fail: 0,
    expired: 0,
    blocked: 0,
    incomplete: 0,
    in_progress: 0,
    complete_pass: 0,
    complete: 0,
    not_applicable: 0,
  };
}

/**
 * True when `status` represents an item that is genuinely blocking
 * placement right now. We exclude `complete_pass` / `complete` /
 * `not_applicable` because a stale `blocking: true` flag on a passed item
 * shouldn't count toward the row's red `[N BLOCKING]` badge. (Real bug
 * surfaced this in dev — a passed item kept its blocking flag and
 * inflated the count.)
 */
function isStillBlocking(row: QueueRow): boolean {
  if (!row.blocking) return false;
  if (row.status === 'complete_pass') return false;
  if (row.status === 'complete') return false;
  if (row.status === 'not_applicable') return false;
  return true;
}

/**
 * Group a flat list of `QueueRow` items into per-worker × per-hiring-entity
 * buckets. Pure function — same input always produces the same output.
 *
 * @param rows  The set of rows to group. Caller is responsible for any
 *              upstream filtering (scope, hiding complete, etc.); the
 *              grouper itself is faithful to whatever it receives.
 * @param nameMap  Best-effort worker uid → name/avatar lookup from
 *                 `loadWorkerNames`. Missing entries fall back to the uid.
 *                 Pass `undefined` to skip name resolution entirely
 *                 (useful in tests).
 * @returns Groups sorted by `lastUpdatedAtMs` desc, with ties broken by
 *          `workerName` asc — matches the per-item table's "most recent
 *          first, alphabetical tiebreak" sort.
 */
export function groupByWorkerEntity(
  rows: ReadonlyArray<QueueRow>,
  nameMap?: WorkerNameMap,
): WorkerGroup[] {
  if (rows.length === 0) return [];

  // Bucket by composite key. Use a Map so we keep insertion order
  // deterministic (V8 preserves it; relied on by tests).
  const buckets = new Map<string, QueueRow[]>();
  for (const row of rows) {
    // We only care about rows that target a hiring entity. Assignment-
    // kind rows (no `hiringEntityId`) get dropped here; they belong to the
    // Job Readiness tab, not Employee Readiness. Defensive: if a future
    // caller passes them in, we don't want to crash or silently mis-bucket.
    if (!row.hiringEntityId) continue;
    const key = `${row.workerUid}::${row.hiringEntityId}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const groups: WorkerGroup[] = [];
  for (const [key, items] of buckets) {
    // Sort items inside the group by urgency, then by `updatedAtMs` desc.
    // The collapsed row uses `items[0]` for owner resolution; the expanded
    // view (D.1.1b) renders the array in this order directly.
    items.sort((a, b) => {
      const pa = ITEM_SORT_PRIORITY[a.status] ?? 99;
      const pb = ITEM_SORT_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return b.updatedAtMs - a.updatedAtMs;
    });

    const head = items[0];
    const counts = emptyCounts();
    let blockingCount = 0;
    let lastUpdatedAtMs = 0;
    for (const item of items) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      if (isStillBlocking(item)) blockingCount += 1;
      if (item.updatedAtMs > lastUpdatedAtMs) lastUpdatedAtMs = item.updatedAtMs;
    }

    const workerProfile = nameMap?.get(head.workerUid);
    const owner = resolveGroupOwner(items);

    groups.push({
      key,
      workerUid: head.workerUid,
      workerName: workerProfile?.name || head.workerName || head.workerUid,
      workerAvatar: workerProfile?.avatar || head.workerAvatar,
      hiringEntityId: head.hiringEntityId as string,
      hiringEntityName: head.hiringEntityName,
      primaryRecruiterId: owner.primaryRecruiterId,
      ownerName: owner.ownerName,
      ownerAvatar: owner.ownerAvatar,
      items,
      counts,
      blockingCount,
      lastUpdatedAtMs,
      totalItems: items.length,
    });
  }

  // Sort groups: most-recent activity first, alphabetical tiebreak so the
  // order is stable across renders even when timestamps tie (which they do
  // in tests when items share an `updatedAt`).
  groups.sort((a, b) => {
    if (b.lastUpdatedAtMs !== a.lastUpdatedAtMs) {
      return b.lastUpdatedAtMs - a.lastUpdatedAtMs;
    }
    return a.workerName.localeCompare(b.workerName);
  });

  return groups;
}

/**
 * Bucket a status into one of the 6 user-facing families used by the
 * collapsed-row count chips and progress bar. Stable mapping:
 *   - `needs_review` + `complete_fail`    → 'needs_review' (red)
 *   - `expired`                           → 'expired'      (yellow)
 *   - `blocked`                           → 'incomplete'   (gray, waiting)
 *   - `incomplete`                        → 'incomplete'
 *   - `in_progress`                       → 'in_progress'  (blue)
 *   - `complete_pass` + legacy `complete` → 'complete'     (green)
 *   - `not_applicable`                    → 'not_applicable'
 *
 * Used by both the count-chip cluster and the progress-bar segments so
 * the visual encoding stays in lockstep.
 */
export function statusFamily(status: QueueRow['status']): WorkerGroupStatusFamily {
  switch (status) {
    case 'needs_review':
    case 'complete_fail':
      return 'needs_review';
    case 'expired':
      return 'expired';
    case 'blocked':
    case 'incomplete':
      return 'incomplete';
    case 'in_progress':
      return 'in_progress';
    case 'complete_pass':
    case 'complete':
      return 'complete';
    case 'not_applicable':
      return 'not_applicable';
    default:
      return 'incomplete';
  }
}

/**
 * Family-level aggregate of `WorkerGroupCounts`. Convenience for the chip
 * cluster: callers don't need to hand-sum needs_review + complete_fail
 * every render.
 */
export function familyCounts(counts: WorkerGroupCounts): Record<WorkerGroupStatusFamily, number> {
  return {
    needs_review: counts.needs_review + counts.complete_fail,
    expired: counts.expired,
    incomplete: counts.incomplete + counts.blocked,
    in_progress: counts.in_progress,
    complete: counts.complete_pass + counts.complete,
    not_applicable: counts.not_applicable,
  };
}
