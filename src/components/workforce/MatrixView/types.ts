/**
 * **R.8** — Shared types for the matrix view component tree.
 *
 * Kept minimal — the heavy lifting types live in
 * `src/hooks/useReadinessMatrixPage.ts` and
 * `src/utils/readinessMatrix/`. This file is just for the cross-component
 * action plumbing that the children pass back up to `MatrixView/index.tsx`.
 */

import type { CsaReadinessActionKind } from '../../../shared/csaReadinessActionTypes';
import type { MatrixCategoryKey } from '../../../utils/readinessMatrix/categories';

/**
 * One bulk-actionable cell — a (rowKey, categoryKey) tuple plus the
 * underlying item refs the action will fan out to.
 */
export interface MatrixCellSelection {
  rowKey: string;
  categoryKey: MatrixCategoryKey;
  itemRefs: ReadonlyArray<{
    itemId: string;
    source: 'assignment' | 'employee';
  }>;
}

/**
 * Vendor cell drill-in target — used by the matrix top-level to mount the
 * R.5 / R.6 drawers (D5.R8 routing). Each variant carries the case id and
 * the underlying item id so the post-action invalidation can re-fetch the
 * right row.
 */
export type MatrixVendorDrillIn =
  | { kind: 'everify'; caseId: string; rowKey: string }
  | { kind: 'background'; checkId: string; rowKey: string };

/**
 * Per-cell action handler exposed by MatrixView to its children. Children
 * call this when the user picks an action from the per-cell menu (NOT the
 * bulk bar — bulk has its own handler).
 */
export interface MatrixCellActionHandler {
  /** R.3 callable per-item action. */
  onCsaAction: (args: {
    rowKey: string;
    categoryKey: MatrixCategoryKey;
    kind: CsaReadinessActionKind;
    itemRef: { itemId: string; source: 'assignment' | 'employee' };
    note: string | null;
  }) => Promise<void>;
  /** Vendor drawer drill-in (E-Verify or background-check). */
  onVendorDrillIn: (target: MatrixVendorDrillIn) => void;
}
