/**
 * RD.1 — shared section wrapper for the three CSA tables.
 *
 * Standardizes:
 *   - Section title + count chip
 *   - Loading state (subtle row instead of a spinner block — matches the
 *     existing readiness queue's empty-state UX)
 *   - Empty state (MUI Alert info — matches spec acceptance criteria)
 *   - Error state
 *   - Optional pagination footer
 *
 * Doesn't render the table contents — callers pass them as `children` so
 * each section can use its own column layout. The wrapper exists to keep
 * the page-level component readable and prevent each section from
 * reinventing its own header/empty-state idioms.
 */
import React from 'react';
import {
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableContainer,
  Typography,
} from '@mui/material';

import StandardTablePagination from '../../StandardTablePagination';

export const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

export interface CsaSectionTableProps {
  /** Section title, e.g. "Workers starting their first shift in the next 72 hours". */
  title: string;
  /** Right-aligned subtle count badge — only shown when `totalCount > 0`. */
  totalCount: number;
  loading: boolean;
  error: string | null;
  /** Copy shown when there are zero rows (post-load, post-filter). */
  emptyStateCopy: string;
  /** Pagination state — omit to skip the footer (small sections). */
  pagination?: {
    page: number;
    rowsPerPage: number;
    onPageChange: (next: number) => void;
    onRowsPerPageChange: (next: number) => void;
  };
  /** The `<Table>` element rendered inside the container. */
  children: React.ReactNode;
}

const CsaSectionTable: React.FC<CsaSectionTableProps> = ({
  title,
  totalCount,
  loading,
  error,
  emptyStateCopy,
  pagination,
  children,
}) => {
  const showEmptyState = !loading && !error && totalCount === 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.25 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {totalCount > 0 && (
          <Chip
            label={totalCount}
            size="small"
            sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
          />
        )}
        {loading && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            Loading…
          </Typography>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 0.5 }}>
          {error}
        </Alert>
      )}

      {showEmptyState ? (
        <Alert severity="info" sx={{ alignItems: 'center' }}>
          {emptyStateCopy}
        </Alert>
      ) : (
        <Paper
          variant="outlined"
          sx={{
            borderRadius: 2,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <TableContainer>
            <Table size="small">{children}</Table>
          </TableContainer>
          {pagination && totalCount > 0 && (
            <StandardTablePagination
              count={totalCount}
              page={pagination.page}
              onPageChange={(_e, next) => pagination.onPageChange(next)}
              rowsPerPage={pagination.rowsPerPage}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
              onRowsPerPageChange={(e) =>
                pagination.onRowsPerPageChange(parseInt(e.target.value, 10))
              }
            />
          )}
        </Paper>
      )}
    </Box>
  );
};

export default CsaSectionTable;
