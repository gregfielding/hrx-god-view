/**
 * **R.8** — Per-cell aggregator for the CSA cross-worker readiness matrix.
 *
 * Given the readiness items belonging to one (worker × hiringEntity)
 * matrix row, returns a map keyed by `MatrixCategoryKey` whose values
 * are `JobReadinessChipData` shapes — exactly what the inline
 * `JobReadinessChip` component consumes.
 *
 * **Why a map, not a record per category:** absent keys mean
 * "no items for this category for this row" → the cell renders as a
 * dash, NOT as a 'computing' or red-orphan state. Per-row cells are
 * sparse — a worker may have 3 cell categories worth of data and 14
 * empty ones. Map<> lets the cell renderer ask "is this category
 * present?" without iterating.
 *
 * **Single classifier:** the chip colour rules are sourced from
 * `computeJobReadinessChip` (the R.4 aggregator) — we just hand it the
 * pre-filtered subset for one category at a time. This keeps the
 * matrix and the per-shift placement chip in lockstep on classification
 * (severity × resolutionMethod × status). Adding a new chip rule means
 * editing the R.4 helper exactly once; both surfaces pick it up.
 *
 * **`readinessSeeded` is always `true` here** because the matrix only
 * renders rows where the parent assignment had its readiness seeded
 * (the page query filters to `readinessSeededAt != null`). Per-category
 * empty subsets are skipped before they can hit the aggregator's
 * orphan-red branch — the matrix's "row exists with no items in this
 * category" semantic is "—", not red.
 *
 * Pure function: no firebase, no async, no clock. Easy to unit-test.
 *
 * @see ./categories.ts                                   — column definitions
 * @see ../../shared/jobReadinessChip/computeJobReadinessChip.ts — single-source classifier
 */

import { computeJobReadinessChip } from '../../shared/jobReadinessChip/computeJobReadinessChip';
import type { JobReadinessChipData } from '../../shared/jobReadinessChip/types';
import type { AssignmentReadinessItem } from '../../shared/assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from '../../shared/employeeReadinessItemV1';
import {
  MATRIX_CATEGORIES,
  type MatrixCategoryDef,
  type MatrixCategoryKey,
} from './categories';

export interface AggregateByCategoryArgs {
  /**
   * All assignment-side items belonging to this (worker × hiringEntity)
   * — i.e. items keyed off the worker's assignments under the entity.
   * Filtering by category happens here; callers MAY pre-filter to e.g.
   * "only items belonging to assignments under this hiring entity" but
   * the helper does not enforce.
   */
  assignmentItems: ReadonlyArray<AssignmentReadinessItem>;
  /**
   * All employee-side items for this (workerUid × hiringEntityId).
   * Filtering to JOB-level subset happens transparently via the
   * category map — types not in the map silently drop.
   */
  employeeItems: ReadonlyArray<EmployeeReadinessItem>;
}

/**
 * Result entry. The chip data is the primary payload; we ALSO surface
 * the underlying-item ids the cell aggregates over so the action menu
 * (and bulk-action machine) can target them without re-running the
 * filter loop.
 */
export interface MatrixCellAggregate {
  category: MatrixCategoryDef;
  /** Chip shape — drives the inline `JobReadinessChip` directly. */
  chip: JobReadinessChipData;
  /**
   * Item ids that fed this cell. Tagged with their source collection
   * because the R.3 callable signature requires it (`collection: 'assignment' | 'employee'`).
   */
  itemRefs: ReadonlyArray<{
    itemId: string;
    source: 'assignment' | 'employee';
  }>;
}

/** Empty-input fast path. Useful for memoization keys. */
const EMPTY_RESULT: ReadonlyMap<MatrixCategoryKey, MatrixCellAggregate> = new Map();

export function aggregateByCategory(
  args: AggregateByCategoryArgs,
): ReadonlyMap<MatrixCategoryKey, MatrixCellAggregate> {
  // No items at all → nothing to render. Callers should distinguish this
  // from "row exists but no cells populated" higher up (the matrix shows
  // a "no readiness data yet" badge for these rows).
  if (args.assignmentItems.length === 0 && args.employeeItems.length === 0) {
    return EMPTY_RESULT;
  }

  const out = new Map<MatrixCategoryKey, MatrixCellAggregate>();

  for (const cat of MATRIX_CATEGORIES) {
    const filteredAssignment =
      cat.source === 'assignment'
        ? args.assignmentItems.filter((i) => cat.requirementTypes.includes(i.requirementType))
        : [];
    const filteredEmployee =
      cat.source === 'employee'
        ? args.employeeItems.filter((i) => cat.requirementTypes.includes(i.requirementType))
        : [];

    if (filteredAssignment.length === 0 && filteredEmployee.length === 0) continue;

    // `readinessSeeded: true` — the matrix only renders rows where the
    // page query has already gated on `readinessSeededAt != null`.
    // Empty per-category subsets are skipped above, so the orphan-red
    // branch in the chip helper is unreachable from here.
    const chip = computeJobReadinessChip({
      assignmentReadinessItems: filteredAssignment,
      employeeReadinessItems: filteredEmployee,
      readinessSeeded: true,
    });

    const itemRefs: { itemId: string; source: 'assignment' | 'employee' }[] = [];
    for (const item of filteredAssignment) {
      itemRefs.push({ itemId: item.id, source: 'assignment' });
    }
    for (const item of filteredEmployee) {
      itemRefs.push({ itemId: item.id, source: 'employee' });
    }

    out.set(cat.key, {
      category: cat,
      chip,
      itemRefs,
    });
  }

  return out;
}
