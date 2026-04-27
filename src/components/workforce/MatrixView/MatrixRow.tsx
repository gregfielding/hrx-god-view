/**
 * **R.8** — `MatrixRow` — one (worker × hiringEntity) row in the matrix.
 *
 * Visual shape mirrors `WorkerReadinessRow` (D.1.1a list view) for the
 * worker info column so toggling between the two views feels like the
 * same surface, not two different products. Differences:
 *
 *   - Left column is sticky-position so it stays visible while the user
 *     horizontally scrolls through wide category sets.
 *   - There's no progress bar / count chips / actions cluster on the row.
 *     Per-cell action menus (R.8 `MatrixCell`) replace the row-level
 *     action ▾ cluster.
 *   - No expand caret. The matrix's drill-in is via the per-cell menu
 *     into vendor drawers (R.5/R.6) and the R.3 confirm/waive dialog.
 *
 * **Click semantics:** unlike the list view, the row body is NOT
 * clickable. Cells own their own clicks (chip popover, action menu,
 * checkbox); a row-level click would conflict with cell selection and
 * has no useful aggregate behavior. Clicking the worker name still
 * navigates to the worker profile.
 *
 * **Itemless / loading states:**
 *   - When `itemsLoaded === false` we render the worker info column +
 *     skeleton cells. Once `itemsLoaded === true`, cells with no data
 *     render the `—` empty placeholder (handled inside `MatrixCell`).
 */

import React from 'react';
import {
  Avatar,
  Box,
  Chip,
  Skeleton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';

import MatrixCell from './MatrixCell';
import type { MatrixPageRow } from '../../../hooks/useReadinessMatrixPage';
import {
  aggregateByCategory,
  type MatrixCellAggregate,
} from '../../../utils/readinessMatrix/aggregateByCategory';
import type {
  MatrixCategoryDef,
  MatrixCategoryKey,
} from '../../../utils/readinessMatrix/categories';
import type { CsaReadinessActionKind } from '../../../shared/csaReadinessActionTypes';
import type { MatrixVendorDrillIn } from './types';

export interface MatrixRowProps {
  row: MatrixPageRow;
  /**
   * Categories the matrix is currently rendering, in column order.
   * Computed by the parent so all rows share the same column set.
   */
  visibleCategories: ReadonlyArray<MatrixCategoryDef>;
  /** Selection set for THIS row, keyed by category. */
  selection: ReadonlySet<MatrixCategoryKey>;
  /** Whether selection toggles can add MORE entries (cap reached when false). */
  canAddSelection: boolean;
  /** Per-tenant admin gate (D8.R8 — UI hint; server still re-checks). */
  canManageInTenant: boolean;
  /** Open the worker profile in a new tab. */
  onWorkerNameClick: (workerUid: string) => void;
  onToggleSelect: (args: {
    rowKey: string;
    categoryKey: MatrixCategoryKey;
    itemRefs: ReadonlyArray<{ itemId: string; source: 'assignment' | 'employee' }>;
  }) => void;
  onOpenSingleAction: (args: {
    rowKey: string;
    categoryKey: MatrixCategoryKey;
    kind: CsaReadinessActionKind;
    itemRef: { itemId: string; source: 'assignment' | 'employee' };
  }) => void;
  onVendorDrillIn: (target: MatrixVendorDrillIn) => void;
  /** Current user's uid — used to render "You" as the owner label. */
  currentUserUid: string | null;
}

const stickyCellSx = {
  position: 'sticky' as const,
  left: 0,
  background: 'background.paper',
  zIndex: 2,
  minWidth: 280,
  maxWidth: 320,
  borderRight: '1px solid',
  borderColor: 'divider',
};

const cellSx = {
  fontSize: 13,
  py: 0.75,
  verticalAlign: 'middle' as const,
};

const matrixCellSx = {
  ...cellSx,
  px: 0.5,
  minWidth: 110,
  width: 110,
};

const MatrixRow: React.FC<MatrixRowProps> = ({
  row,
  visibleCategories,
  selection,
  canAddSelection,
  canManageInTenant,
  onWorkerNameClick,
  onToggleSelect,
  onOpenSingleAction,
  onVendorDrillIn,
  currentUserUid,
}) => {
  // Compute per-category aggregates for this row in one pass — same
  // single-pass guarantee the unit tests cover. Memoize on the row's
  // (small) item arrays so re-renders that change selection only don't
  // recompute aggregates.
  const aggregates = React.useMemo(() => {
    if (!row.itemsLoaded) return null;
    return aggregateByCategory({
      assignmentItems: row.assignmentItems,
      employeeItems: row.employeeItems,
    });
  }, [row.assignmentItems, row.employeeItems, row.itemsLoaded]);

  const isMine = row.primaryRecruiterId === currentUserUid;
  const ownerLabel = row.primaryRecruiterId
    ? isMine
      ? 'You'
      : row.ownerName || row.primaryRecruiterId
    : null;

  return (
    <TableRow hover sx={{ verticalAlign: 'middle' }}>
      <TableCell sx={{ ...stickyCellSx, ...cellSx }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar
            src={row.workerAvatar || undefined}
            sx={{ width: 30, height: 30, fontSize: 14 }}
          >
            {row.workerName.slice(0, 1).toUpperCase()}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{ minWidth: 0 }}
            >
              <Typography
                variant="body2"
                onClick={() => onWorkerNameClick(row.workerUid)}
                sx={{
                  fontWeight: 600,
                  color: 'primary.main',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 200,
                  '&:hover': { textDecoration: 'underline' },
                }}
                title="Open worker profile"
              >
                {row.workerName}
              </Typography>
              {ownerLabel ? (
                <Tooltip title={`Owner: ${ownerLabel}`}>
                  <Chip
                    label={isMine ? 'You' : ownerLabel.split(' ')[0]}
                    size="small"
                    color={isMine ? 'primary' : 'default'}
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 600,
                      '& .MuiChip-label': { px: 0.75 },
                    }}
                  />
                </Tooltip>
              ) : null}
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 200,
                }}
              >
                {row.hiringEntityName || row.hiringEntityId}
              </Typography>
              {row.jobOrderIds.length > 0 ? (
                <Tooltip title={row.jobOrderIds.join(', ')}>
                  <Chip
                    label={`${row.jobOrderIds.length} JO`}
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 16,
                      fontSize: 9,
                      '& .MuiChip-label': { px: 0.5 },
                    }}
                  />
                </Tooltip>
              ) : null}
            </Stack>
          </Box>
        </Stack>
      </TableCell>

      {visibleCategories.map((cat) => {
        if (!aggregates) {
          return (
            <TableCell key={cat.key} sx={matrixCellSx}>
              <Skeleton variant="rounded" height={20} width="80%" />
            </TableCell>
          );
        }
        const aggregate: MatrixCellAggregate | undefined = aggregates.get(cat.key);
        return (
          <TableCell key={cat.key} sx={matrixCellSx}>
            <MatrixCell
              rowKey={row.key}
              aggregate={aggregate}
              selected={selection.has(cat.key)}
              canSelect={canAddSelection || selection.has(cat.key)}
              canManageInTenant={canManageInTenant}
              onToggleSelect={onToggleSelect}
              onOpenSingleAction={onOpenSingleAction}
              onVendorDrillIn={onVendorDrillIn}
            />
          </TableCell>
        );
      })}
    </TableRow>
  );
};

export default MatrixRow;
