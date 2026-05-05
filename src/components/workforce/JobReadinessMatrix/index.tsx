/**
 * **D.4** — `JobReadinessMatrix` — Workforce → Job Readiness top-level view.
 *
 * Sister surface to the R.8 worker × hiringEntity matrix
 * (`src/components/workforce/MatrixView/`), but pivoted: rows are JOs, cells
 * are per-requirement-category chips aggregating across the workers placed
 * on that JO.
 *
 * **What v1 does** (this file):
 *
 *   - Reads paginated rows from `useJobReadinessMatrixPage`.
 *   - Renders one row per JO with the inline `JobReadinessChip` per category
 *     cell. Hover for tooltip, click for popover with contributor list.
 *   - Click the JO label → opens the JO details page in a new tab. From
 *     there the recruiter has the existing readiness drilldown.
 *   - Pagination footer + manual refresh button.
 *
 * **What v1 explicitly does NOT do** (deferred to D.4.1):
 *
 *   - **No bulk-action bar.** "Confirm uniform for everyone on this JO" is
 *     a future surface; v1 is read-only because the underlying matchers
 *     (`skill_match`, `language_match`, etc.) aren't wired yet, so most
 *     bulk targets won't have items to act on. We light up bulk actions
 *     once Layer 2 (per `READINESS_EXECUTION_MATRIX.md` §4) ships.
 *   - **No per-cell action menu.** Same reason.
 *   - **No vendor drawers.** The JO matrix has no vendor-source columns
 *     (BG / drug / E-Verify / screening package match are per-(worker ×
 *     entity), not per-JO), so there's no vendor drill-in to wire.
 *   - **No `onSnapshot`.** Refresh button is the contract — same as R.8 D3.
 *
 * **Empty-column hiding.** We compute `visibleCategories` once per page from
 * the items present in the current rows. Columns with zero items across the
 * page are hidden. As Layer 2 backfills `skill_match` / `language_match` /
 * etc., those columns will light up automatically without code changes here.
 */

import React, { useMemo } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import JobReadinessChip from '../../recruiter/readiness/JobReadinessChip';
import {
  aggregateByCategory,
  type MatrixCellAggregate,
} from '../../../utils/readinessMatrix/aggregateByCategory';
import {
  MATRIX_CATEGORIES,
  type MatrixCategoryDef,
  type MatrixCategoryKey,
} from '../../../utils/readinessMatrix/categories';
import useJobReadinessMatrixPage, {
  JOB_READINESS_MATRIX_DEFAULT_PAGE_SIZE,
  type JobReadinessMatrixRow,
  type JobReadinessMatrixScope,
} from '../../../hooks/useJobReadinessMatrixPage';

export interface JobReadinessMatrixProps {
  tenantId: string | null;
  currentUserUid: string | null;
  scope: JobReadinessMatrixScope;
  /** Free-text search; supplied by the Workforce page header. */
  search?: string;
}

/**
 * Only `source: 'assignment'` columns are eligible for the JO matrix —
 * employee-source items are per-(worker × entity), not per-JO. Computed
 * once at module scope since `MATRIX_CATEGORIES` is static.
 */
const ASSIGNMENT_CATEGORIES: ReadonlyArray<MatrixCategoryDef> = MATRIX_CATEGORIES.filter(
  (c) => c.source === 'assignment',
);

const stickyHeaderSx = {
  position: 'sticky' as const,
  left: 0,
  background: 'background.paper',
  zIndex: 3,
  minWidth: 320,
  maxWidth: 360,
  borderRight: '1px solid',
  borderColor: 'divider',
};

const stickyCellSx = {
  position: 'sticky' as const,
  left: 0,
  background: 'background.paper',
  zIndex: 2,
  minWidth: 320,
  maxWidth: 360,
  borderRight: '1px solid',
  borderColor: 'divider',
};

const matrixCellSx = {
  px: 0.5,
  py: 0.75,
  minWidth: 110,
  width: 110,
  verticalAlign: 'middle' as const,
};

const headerCellSx = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  color: 'text.secondary',
  whiteSpace: 'nowrap' as const,
};

const JobReadinessMatrix: React.FC<JobReadinessMatrixProps> = ({
  tenantId,
  currentUserUid,
  scope,
  search,
}) => {
  const {
    rows,
    totalRows,
    page,
    pageSize,
    setPage,
    isLoading,
    error,
    refresh,
    lastRefreshedAtMs,
  } = useJobReadinessMatrixPage({
    tenantId,
    currentUserUid,
    scope,
    search,
    pageSize: JOB_READINESS_MATRIX_DEFAULT_PAGE_SIZE,
  });

  // Aggregate every row up-front so we can both (a) hide empty columns
  // and (b) hand the precomputed map down to the row to avoid double work.
  // The aggregator is pure + memoizable; it is cheap.
  const aggregatesByRow = useMemo(() => {
    const out = new Map<string, ReadonlyMap<MatrixCategoryKey, MatrixCellAggregate>>();
    for (const r of rows) {
      if (!r.itemsLoaded) continue;
      out.set(
        r.key,
        aggregateByCategory({
          assignmentItems: r.assignmentItems,
          employeeItems: [],
        }),
      );
    }
    return out;
  }, [rows]);

  // Empty-column hiding: keep only categories with at least one cell on the
  // visible page. The set auto-grows as Layer 2 matchers land — no code
  // change needed here.
  const visibleCategories = useMemo(() => {
    const seen = new Set<MatrixCategoryKey>();
    for (const aggregate of aggregatesByRow.values()) {
      for (const key of aggregate.keys()) seen.add(key);
    }
    return ASSIGNMENT_CATEGORIES.filter((c) => seen.has(c.key));
  }, [aggregatesByRow]);

  const handleRefresh = (): void => {
    refresh();
  };

  // Empty-state guard. We render the table chrome only after the universe
  // has resolved at least once — otherwise the user sees a flicker between
  // "Coming in D.4" placeholder shape and the real table.
  const isEmpty = !isLoading && rows.length === 0;

  return (
    <Stack spacing={1.5}>
      {error ? (
        <Alert severity="error" variant="outlined">
          Couldn’t load Job Readiness data: {error.message}
        </Alert>
      ) : null}

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        justifyContent="space-between"
        sx={{ flexWrap: 'wrap' }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            {isLoading
              ? 'Loading…'
              : `${totalRows} active job order${totalRows === 1 ? '' : 's'}`}
          </Typography>
          {lastRefreshedAtMs ? (
            <Typography variant="caption" color="text.disabled">
              · refreshed {formatRelative(lastRefreshedAtMs)}
            </Typography>
          ) : null}
        </Stack>
        <Button
          size="small"
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={handleRefresh}
          disabled={isLoading || !tenantId}
          variant="outlined"
        >
          Refresh
        </Button>
      </Stack>

      {isEmpty ? (
        <Paper
          variant="outlined"
          sx={{
            p: 4,
            textAlign: 'center',
            bgcolor: 'rgba(0,0,0,0.015)',
            borderStyle: 'dashed',
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No active job orders match the current scope.
          </Typography>
        </Paper>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ overflowX: 'auto', maxHeight: 'calc(100vh - 240px)' }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...stickyHeaderSx, ...headerCellSx, py: 1 }}>
                  Job order
                </TableCell>
                {visibleCategories.length === 0 && rows.length > 0 ? (
                  <TableCell sx={{ ...headerCellSx, py: 1 }}>
                    Readiness
                  </TableCell>
                ) : null}
                {visibleCategories.map((cat) => (
                  <TableCell
                    key={cat.key}
                    sx={{ ...headerCellSx, ...matrixCellSx, py: 1, textAlign: 'center' }}
                  >
                    <Tooltip title={cat.description} placement="top">
                      <span>{cat.label}</span>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <JobReadinessMatrixRow
                  key={row.key}
                  row={row}
                  aggregates={aggregatesByRow.get(row.key) ?? null}
                  visibleCategories={visibleCategories}
                  showEmptyReadinessCell={visibleCategories.length === 0}
                />
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={totalRows}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[pageSize]}
            sx={{ borderTop: '1px solid', borderColor: 'divider' }}
          />
        </TableContainer>
      )}
    </Stack>
  );
};

interface JobReadinessMatrixRowProps {
  row: JobReadinessMatrixRow;
  aggregates: ReadonlyMap<MatrixCategoryKey, MatrixCellAggregate> | null;
  visibleCategories: ReadonlyArray<MatrixCategoryDef>;
  /**
   * `true` when the page has zero populated columns (e.g., a tenant with
   * only legacy items). We surface a "no data yet" cell instead of an
   * awkward empty row so the user knows the row isn't broken.
   */
  showEmptyReadinessCell: boolean;
}

const JobReadinessMatrixRow: React.FC<JobReadinessMatrixRowProps> = ({
  row,
  aggregates,
  visibleCategories,
  showEmptyReadinessCell,
}) => {
  const labelInitials = (row.jobOrderNumber || row.jobTitle || '?')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();

  const handleOpenJobOrder = (): void => {
    // Open in new tab so the matrix doesn't lose its scroll/page state.
    // The JO details page is the canonical place to drill into per-worker
    // readiness; v1 punts the in-place popover to D.4.1.
    window.open(`/job-orders/${row.jobOrderId}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <TableRow hover sx={{ verticalAlign: 'middle' }}>
      <TableCell sx={stickyCellSx}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar
            sx={{
              width: 30,
              height: 30,
              fontSize: 12,
              fontWeight: 600,
              bgcolor: 'primary.main',
            }}
          >
            {labelInitials}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                onClick={handleOpenJobOrder}
                sx={{
                  fontWeight: 600,
                  color: 'primary.main',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 220,
                  '&:hover': { textDecoration: 'underline' },
                }}
                title="Open job order"
              >
                {row.jobOrderNumber || row.jobOrderId}
              </Typography>
              <OpenInNewIcon
                fontSize="inherit"
                sx={{ fontSize: 13, color: 'text.disabled' }}
                aria-hidden
              />
              <Chip
                label={row.status}
                size="small"
                variant="outlined"
                sx={{
                  height: 18,
                  fontSize: 10,
                  fontWeight: 500,
                  textTransform: 'capitalize',
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 320,
              }}
            >
              {row.jobTitle || '—'}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }} alignItems="center">
              {row.recruiterAccountName ? (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 220,
                  }}
                >
                  {row.recruiterAccountName}
                </Typography>
              ) : null}
              <Tooltip title="Distinct workers placed on this JO">
                <Chip
                  label={`${row.workerCount} worker${row.workerCount === 1 ? '' : 's'}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    height: 16,
                    fontSize: 9,
                    '& .MuiChip-label': { px: 0.5 },
                  }}
                />
              </Tooltip>
            </Stack>
          </Box>
        </Stack>
      </TableCell>

      {showEmptyReadinessCell ? (
        <TableCell>
          <Typography variant="caption" color="text.disabled">
            No readiness items yet
          </Typography>
        </TableCell>
      ) : null}

      {visibleCategories.map((cat) => {
        if (!aggregates) {
          return (
            <TableCell key={cat.key} sx={{ ...matrixCellSx, textAlign: 'center' }}>
              <Skeleton variant="rounded" height={20} width="60%" sx={{ mx: 'auto' }} />
            </TableCell>
          );
        }
        const aggregate = aggregates.get(cat.key);
        return (
          <TableCell key={cat.key} sx={{ ...matrixCellSx, textAlign: 'center' }}>
            {aggregate ? (
              <JobReadinessChip data={aggregate.chip} size="inline" />
            ) : (
              <Typography variant="caption" color="text.disabled">
                —
              </Typography>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
};

/**
 * Lightweight relative-time formatter for the "refreshed Xs ago" line. We
 * deliberately skip a full i18n / date-fns dep here because it's a single
 * helper string that doesn't justify a bundle hit.
 */
function formatRelative(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const s = Math.round(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export default JobReadinessMatrix;
