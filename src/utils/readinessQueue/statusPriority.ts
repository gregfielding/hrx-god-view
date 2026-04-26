/**
 * Sort + filter helpers for the readiness queue.
 *
 * **What's new vs. RecruiterMyQueue:** the legacy "My Queue" surface sorts
 * blocking-first then oldest-createdAt-first. Phase D explicitly moves
 * blocking to a row badge (not a sort key) so the table matches recruiters'
 * "what is most likely to need my attention" mental model rather than
 * "what is oldest." Within a status bucket we sort by `updatedAt` desc — the
 * most recent state change is usually the most informative.
 *
 *   Sort priority (lower = higher priority, surfaces first):
 *     needs_review > complete_fail > expired > blocked > incomplete
 *     > in_progress > complete_pass > not_applicable
 *
 * The status filter chips collapse the 9-status raw vocabulary into a
 * 5-chip user-facing set (see `WorkforceStatusFilterId`). `not_applicable`
 * is intentionally hidden from the queue — by definition the CSA can't act
 * on it, and surfacing N/A items is just noise.
 */

import type { QueueRow } from './queueRow';

/** Re-exported as a convenience so consumers don't have to dig into queueRow. */
export type WorkforceItemStatus = QueueRow['status'];

/** Statuses that represent "open work" the CSA still has to deal with. */
export const ACTIVE_WORKFORCE_STATUSES: ReadonlyArray<WorkforceItemStatus> = [
  'needs_review',
  'complete_fail',
  'expired',
  'incomplete',
  'in_progress',
  'blocked',
];

/** Statuses that represent "done." `complete` is the legacy pre-§6e shorthand. */
export const COMPLETE_WORKFORCE_STATUSES: ReadonlyArray<WorkforceItemStatus> = [
  'complete_pass',
  'complete',
  'not_applicable',
];

/**
 * Status filter chip ids — the user-facing collapsed set.
 *
 *   - `needs_review` → `needs_review`
 *   - `incomplete`   → `incomplete` + `in_progress` + `blocked` (all "not done yet")
 *   - `expired`      → `expired`
 *   - `failed`       → `complete_fail`
 *   - `complete`     → `complete_pass` + `complete` (legacy)
 */
export type WorkforceStatusFilterId =
  | 'needs_review'
  | 'incomplete'
  | 'expired'
  | 'failed'
  | 'complete';

export const WORKFORCE_STATUS_FILTER_LABELS: Record<WorkforceStatusFilterId, string> = {
  needs_review: 'Needs Review',
  incomplete: 'Incomplete',
  expired: 'Expired',
  failed: 'Failed',
  complete: 'Complete',
};

/** Default chip selection on first visit (spec §3 — highest-urgency action set). */
export const DEFAULT_WORKFORCE_STATUS_FILTERS: ReadonlyArray<WorkforceStatusFilterId> = [
  'needs_review',
  'failed',
];

const FILTER_TO_RAW_STATUSES: Record<WorkforceStatusFilterId, ReadonlyArray<WorkforceItemStatus>> = {
  needs_review: ['needs_review'],
  incomplete: ['incomplete', 'in_progress', 'blocked'],
  expired: ['expired'],
  failed: ['complete_fail'],
  complete: ['complete_pass', 'complete'],
};

/** Expand a set of UI filter chip ids into the raw firestore status values they cover. */
export function expandStatusFilters(
  filters: ReadonlyArray<WorkforceStatusFilterId>,
): Set<WorkforceItemStatus> {
  const out = new Set<WorkforceItemStatus>();
  for (const id of filters) {
    for (const raw of FILTER_TO_RAW_STATUSES[id] ?? []) {
      out.add(raw);
    }
  }
  return out;
}

/**
 * Sort priority — lower number wins (sorts first / appears at top).
 * `complete` is treated identically to `complete_pass` per the QueueRow type.
 */
const STATUS_PRIORITY: Record<WorkforceItemStatus, number> = {
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

export function statusPriority(status: WorkforceItemStatus): number {
  return STATUS_PRIORITY[status] ?? 99;
}

/**
 * Total order for the queue. Status priority first; then `updatedAt` desc so
 * within a status the most-recently-changed row is at the top. Stable for
 * ties via the row id (otherwise React's reconciler is unhappy with shifting
 * keys at equal timestamps).
 */
export function compareReadinessRowsForQueue(
  a: { status: WorkforceItemStatus; updatedAtMs: number; id: string },
  b: { status: WorkforceItemStatus; updatedAtMs: number; id: string },
): number {
  const priorityDelta = statusPriority(a.status) - statusPriority(b.status);
  if (priorityDelta !== 0) return priorityDelta;
  if (a.updatedAtMs !== b.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
  return a.id.localeCompare(b.id);
}
