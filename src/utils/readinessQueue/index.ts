/**
 * Shared primitives for the readiness queue surfaces (Workforce + the
 * legacy `RecruiterMyQueue` redirect target).
 *
 * Most of these are extracted directly from `RecruiterMyQueue.tsx` per
 * Greg's 2026-04-25 D.1 directive: don't reinvent shapes, lift the in-
 * production ones (spec §11 hard rule). Anything new (sort priority, status
 * filter chip ids) is Workforce-specific UX scaffolding on top of those
 * shared shapes.
 */

export {
  contextLabel,
  normalizeAssignmentItem,
  normalizeEmployeeItem,
  normalizeOwnershipHistory,
  queueRowKey,
  toMs,
} from './queueRow';
export type { QueueRow, QueueRowKind } from './queueRow';

export { humanizeRequirementType } from './humanizeRequirementType';
export { formatAge, formatAbsoluteTime } from './formatAge';

export { loadWorkerNames } from './loadWorkerNames';
export type { WorkerNameInfo, WorkerNameMap } from './loadWorkerNames';

export {
  ACTIVE_WORKFORCE_STATUSES,
  COMPLETE_WORKFORCE_STATUSES,
  DEFAULT_WORKFORCE_STATUS_FILTERS,
  WORKFORCE_STATUS_FILTER_LABELS,
  compareReadinessRowsForQueue,
  expandStatusFilters,
  statusPriority,
} from './statusPriority';
export type {
  WorkforceItemStatus,
  WorkforceStatusFilterId,
} from './statusPriority';

export {
  claimQueueItem,
  reassignQueueItem,
  releaseQueueItem,
} from './queueMutations';
export type {
  ClaimItemArgs,
  ReassignItemArgs,
  ReleaseItemArgs,
} from './queueMutations';

export {
  familyCounts,
  groupByWorkerEntity,
  statusFamily,
} from './groupByWorkerEntity';
export type {
  WorkerGroup,
  WorkerGroupCounts,
  WorkerGroupStatusFamily,
} from './groupByWorkerEntity';
