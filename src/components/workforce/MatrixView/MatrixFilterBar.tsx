/**
 * **R.8** — `MatrixFilterBar` — top-of-matrix client-side filter cluster.
 *
 * D7.R8 lock — filters are purely client-side post-page for MVP. The
 * filter set is intentionally narrow:
 *
 *   - **Severity**: `blockers only` / `pending Onboarding Specialist action` / `all`
 *     (matches the list-view's existing language for consistency).
 *   - **JO**: pick one of the JOs referenced by the page's rows. If the
 *     page only shows rows from one JO, this collapses to a label.
 *   - **Worksite**: same shape as JO.
 *
 * **Why not server-side?** D7.R8 explicitly defers the
 * `(tenantId, jobOrderId)` / `(tenantId, worksiteId)` indexes — pages
 * are ≤50 rows so client-side is cheap, and we don't want to ship
 * indexes we can't justify. R.8.1 follow-up if pages get big enough
 * that client-side hides too many rows.
 *
 * **Coupling:** the filter shape (`MatrixFilterState`) is exported so
 * the parent `MatrixView/index.tsx` can hold the canonical state and
 * pass it down to the row-level filter pass. The bar itself is a pure
 * controlled component — it does NOT own state.
 */

import React, { useMemo } from 'react';
import {
  Box,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { SelectChangeEvent } from '@mui/material/Select';

export type MatrixSeverityFilter = 'all' | 'pending' | 'blockers';

export interface MatrixFilterState {
  severity: MatrixSeverityFilter;
  /** `null` = all JOs. */
  jobOrderId: string | null;
  /** `null` = all worksites. */
  worksiteId: string | null;
}

export const MATRIX_FILTER_DEFAULT: MatrixFilterState = {
  severity: 'all',
  jobOrderId: null,
  worksiteId: null,
};

export interface MatrixFilterBarProps {
  state: MatrixFilterState;
  onChange: (next: MatrixFilterState) => void;
  /** All JO ids referenced by the current page's rows (deduped). */
  pageJobOrderIds: ReadonlyArray<string>;
  /** All worksite ids referenced by the current page's rows (deduped). */
  pageWorksiteIds: ReadonlyArray<string>;
  /** Total rows in the universe. Drives the "showing X of Y" label. */
  totalRows: number;
  /** Rows after the filter pass. */
  visibleAfterFilter: number;
  /** Manual refresh (re-runs the per-page assignment-side fetch). */
  onRefresh: () => void;
  /** Disable refresh while a fetch is in flight. */
  refreshDisabled: boolean;
}

const SEVERITY_OPTIONS: ReadonlyArray<{
  value: MatrixSeverityFilter;
  label: string;
  description: string;
}> = [
  {
    value: 'all',
    label: 'All',
    description: 'All workers in the workforce, including ready ones.',
  },
  {
    value: 'pending',
    label: 'Pending',
    description: 'Workers with at least one yellow or red cell — needs attention.',
  },
  {
    value: 'blockers',
    label: 'Blockers',
    description: 'Workers with at least one red (hard) blocker.',
  },
];

const MatrixFilterBar: React.FC<MatrixFilterBarProps> = ({
  state,
  onChange,
  pageJobOrderIds,
  pageWorksiteIds,
  totalRows,
  visibleAfterFilter,
  onRefresh,
  refreshDisabled,
}) => {
  const handleSeverity = (e: SelectChangeEvent<MatrixSeverityFilter>) => {
    onChange({ ...state, severity: e.target.value as MatrixSeverityFilter });
  };
  const handleJob = (e: SelectChangeEvent<string>) => {
    const v = e.target.value;
    onChange({ ...state, jobOrderId: v === '__all__' ? null : v });
  };
  const handleWorksite = (e: SelectChangeEvent<string>) => {
    const v = e.target.value;
    onChange({ ...state, worksiteId: v === '__all__' ? null : v });
  };

  const sortedJoIds = useMemo(
    () => Array.from(new Set(pageJobOrderIds)).sort(),
    [pageJobOrderIds],
  );
  const sortedWorksiteIds = useMemo(
    () => Array.from(new Set(pageWorksiteIds)).sort(),
    [pageWorksiteIds],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        flexWrap: 'wrap',
        py: 1,
      }}
    >
      <FormControl size="small" sx={{ minWidth: 140 }}>
        <InputLabel id="matrix-severity-label">Severity</InputLabel>
        <Select
          labelId="matrix-severity-label"
          label="Severity"
          value={state.severity}
          onChange={handleSeverity}
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <Tooltip key={opt.value} title={opt.description} placement="right">
              <MenuItem value={opt.value}>{opt.label}</MenuItem>
            </Tooltip>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 180 }} disabled={sortedJoIds.length === 0}>
        <InputLabel id="matrix-jo-label">Job Order</InputLabel>
        <Select
          labelId="matrix-jo-label"
          label="Job Order"
          value={state.jobOrderId ?? '__all__'}
          onChange={handleJob}
        >
          <MenuItem value="__all__">All JOs</MenuItem>
          {sortedJoIds.map((id) => (
            <MenuItem key={id} value={id}>
              {id}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl
        size="small"
        sx={{ minWidth: 180 }}
        disabled={sortedWorksiteIds.length === 0}
      >
        <InputLabel id="matrix-worksite-label">Worksite</InputLabel>
        <Select
          labelId="matrix-worksite-label"
          label="Worksite"
          value={state.worksiteId ?? '__all__'}
          onChange={handleWorksite}
        >
          <MenuItem value="__all__">All worksites</MenuItem>
          {sortedWorksiteIds.map((id) => (
            <MenuItem key={id} value={id}>
              {id}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ ml: 'auto' }}>
        <Chip
          label={`${visibleAfterFilter} of ${totalRows}`}
          size="small"
          variant="outlined"
        />
        <Tooltip title="Re-fetch readiness data for this page">
          <span>
            <IconButton size="small" onClick={onRefresh} disabled={refreshDisabled}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {state.severity !== 'all' || state.jobOrderId || state.worksiteId ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ width: '100%', mt: 0.5 }}
        >
          Filters apply to the current page only.
        </Typography>
      ) : null}
    </Box>
  );
};

export default MatrixFilterBar;
