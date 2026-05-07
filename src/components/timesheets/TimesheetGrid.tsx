/**
 * TimesheetGrid — read-only grid of timesheet rows for the
 * recruiter/admin workspace.
 *
 * **Phasing:**
 *   - P1.C.1 — page shell + filter gating + skeleton (placeholder card).
 *   - **P1.C.2 (this commit)** — wire to `useTimesheetGridRows`,
 *     render the row table + live totals header. Read-only.
 *   - P3+ — inline-editable cells; status pill flow; variance filter;
 *     batch submit / Everee dispatch.
 *
 * **Read-only contract.** This component MUST NOT write anything to
 * Firestore. Empty rows stay empty until P3 makes cells editable. The
 * status pill on empty rows shows "no entry yet" instead of "draft" —
 * critical for the operator's mental model that nothing has been
 * persisted yet.
 *
 * **Tenant + filter coupling.** The page (`Timesheets.tsx`) owns both;
 * this component is purely controlled. When `filter` is `null`,
 * renders the empty state with helper copy. When `filter` is set,
 * delegates to the hook for hydration.
 */

import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  TableChart as TableChartIcon,
} from '@mui/icons-material';
import { FirebaseError } from 'firebase/app';

import { useAuth } from '../../contexts/AuthContext';
import useTimesheetGridRows from '../../hooks/useTimesheetGridRows';
import type { TimesheetFilter } from '../../types/recruiter/timesheet';
import { createDraftTimesheetEntry } from '../../utils/timesheets/createDraftTimesheetEntry';
import { formatPeriodLabel } from '../../utils/timesheets/dateRange';

import TimesheetTotalsHeader from './TimesheetTotalsHeader';
import {
  type TimesheetGridRow,
  type TimesheetRowDisplayStatus,
  actualHoursForRow,
  displayStatusForRow,
  periodFromFilter,
  scheduledHoursForRow,
} from './timesheetGridResolver';

export interface TimesheetGridProps {
  filter: TimesheetFilter | null;
}

/* -------------------------------------------------------------------------
 * Empty / loading / error states
 * ------------------------------------------------------------------------- */

const EmptyFilterState: React.FC = () => (
  <Card variant="outlined" sx={{ mt: 2 }}>
    <CardContent>
      <Stack
        direction="row"
        alignItems="center"
        spacing={2}
        sx={{ py: 4, justifyContent: 'center' }}
      >
        <TableChartIcon color="disabled" sx={{ fontSize: 48 }} />
        <Box>
          <Typography variant="h6" fontWeight={600}>
            Pick a hiring entity and period to view timesheets
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Select a hiring entity above. The grid will load once a
            period is chosen.
          </Typography>
        </Box>
      </Stack>
    </CardContent>
  </Card>
);

const LoadingState: React.FC<{ filter: TimesheetFilter }> = ({ filter }) => {
  const period = periodFromFilter(filter);
  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading timesheet rows
            {period ? ` for ${formatPeriodLabel(period)}` : ''}…
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

interface NoRowsStateProps {
  filter: TimesheetFilter;
  consideredAssignmentCount: number;
}

const NoRowsState: React.FC<NoRowsStateProps> = ({ filter, consideredAssignmentCount }) => {
  const period = periodFromFilter(filter);
  const periodLabel = period ? formatPeriodLabel(period) : null;
  const headline =
    consideredAssignmentCount === 0
      ? 'No active assignments in this period'
      : 'No scheduled days in this period';
  const detail =
    consideredAssignmentCount === 0
      ? 'No assignments under this hiring entity overlap the selected period. Pick a different period or entity.'
      : `Found ${consideredAssignmentCount} active assignment${
          consideredAssignmentCount === 1 ? '' : 's'
        }, but none have any scheduled days inside the selected period. Check each assignment's weekly schedule.`;
  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="body1" fontWeight={600}>
          {headline}
          {periodLabel ? ` (${periodLabel})` : ''}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {detail}
        </Typography>
      </CardContent>
    </Card>
  );
};

/* -------------------------------------------------------------------------
 * Status pill
 *
 * Same vocabulary + colors as `TimesheetTotalsHeader` — by design, so
 * the header counts visually match the per-row chips beneath them.
 * ------------------------------------------------------------------------- */

const STATUS_LABELS: Record<TimesheetRowDisplayStatus, string> = {
  no_entry: '—',
  draft: 'draft',
  submitted: 'submitted',
  approved: 'approved',
  sent_to_everee: 'sent',
  paid: 'paid',
  error: 'error',
};

const STATUS_COLORS: Record<
  TimesheetRowDisplayStatus,
  'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
> = {
  no_entry: 'default',
  draft: 'default',
  submitted: 'info',
  approved: 'primary',
  sent_to_everee: 'info',
  paid: 'success',
  error: 'error',
};

interface StatusPillProps {
  status: TimesheetRowDisplayStatus;
}

const StatusPill: React.FC<StatusPillProps> = ({ status }) => {
  if (status === 'no_entry') {
    return (
      <Tooltip title="No entry yet — this day will appear in the next batch only after a recruiter saves an entry.">
        <Chip
          size="small"
          color="default"
          variant="outlined"
          label="—"
          sx={{ fontWeight: 600 }}
        />
      </Tooltip>
    );
  }
  return (
    <Chip
      size="small"
      color={STATUS_COLORS[status]}
      variant="filled"
      label={STATUS_LABELS[status]}
    />
  );
};

/* -------------------------------------------------------------------------
 * Row rendering
 * ------------------------------------------------------------------------- */

function formatHours(h: number): string {
  if (!Number.isFinite(h) || h === 0) return '0';
  if (Number.isInteger(h)) return `${h}`;
  return h.toFixed(1);
}

function formatRate(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

interface TimesheetGridRowViewProps {
  row: TimesheetGridRow;
  /** Tenant scope for the create-entry callable. Required when the
   *  row is empty AND the caller has provided an `onCreated` handler. */
  tenantId?: string | null;
  /** Fires after a successful create. The grid hook's `refresh()`
   *  re-resolves the row set so the new entry replaces the empty row. */
  onCreated?: () => void;
}

/**
 * Per-row local state for the "+ Add entry" affordance. Each row
 * tracks its own `creating` / `error` independently so multiple
 * recruiters can fire creates in parallel without coupling.
 *
 * Errors are inline (small caption + retry link) rather than a
 * dialog — the recruiter can see exactly which row failed and why
 * without leaving the grid context.
 */
interface CreatingState {
  status: 'idle' | 'creating' | 'error';
  message?: string;
}

const TimesheetGridRowView: React.FC<TimesheetGridRowViewProps> = ({
  row,
  tenantId,
  onCreated,
}) => {
  const scheduledHrs = scheduledHoursForRow(row);
  const actualHrs = actualHoursForRow(row);
  const status = displayStatusForRow(row);

  const isEmpty = row.kind === 'empty';

  const [creating, setCreating] = useState<CreatingState>({ status: 'idle' });

  const canCreate = isEmpty && tenantId && onCreated && creating.status !== 'creating';

  const handleAddEntry = async () => {
    if (!tenantId || !onCreated) return;
    setCreating({ status: 'creating' });
    try {
      await createDraftTimesheetEntry({
        tenantId,
        assignmentId: row.assignment.id,
        workDate: row.workDate,
      });
      // Hook refresh re-resolves the row set; the empty row will
      // be replaced by an `entry` row on the next render. We do
      // NOT setCreating to 'idle' here because the row is about to
      // unmount when refresh() lands.
      onCreated();
    } catch (err) {
      // Surface a friendly per-error message. Most callable errors
      // come back as FirebaseError with a `.code` and `.message`.
      const fallback = err instanceof Error ? err.message : String(err);
      const message =
        err instanceof FirebaseError && typeof err.message === 'string'
          ? err.message
          : fallback;
      setCreating({ status: 'error', message });
    }
  };

  return (
    <TableRow
      hover
      sx={{
        // Subtle visual cue that empty rows haven't been entered yet —
        // makes the "(no entry yet)" caption pop without screaming.
        backgroundColor: isEmpty ? 'action.hover' : undefined,
      }}
    >
      <TableCell>
        <Typography variant="body2" fontWeight={600}>
          {row.assignment.workerDisplayName ?? row.assignment.candidateId}
        </Typography>
        {row.assignment.worksiteDisplayName ? (
          <Typography variant="caption" color="text.secondary">
            {row.assignment.worksiteDisplayName}
            {row.assignment.worksiteState ? ` · ${row.assignment.worksiteState}` : ''}
          </Typography>
        ) : row.assignment.worksiteState ? (
          <Typography variant="caption" color="text.secondary">
            {row.assignment.worksiteState}
          </Typography>
        ) : null}
      </TableCell>

      <TableCell>{row.workDate}</TableCell>

      <TableCell>
        {row.scheduled.startTime}–{row.scheduled.endTime}
        {row.scheduled.breakMinutes > 0 ? (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            ({row.scheduled.breakMinutes}m brk)
          </Typography>
        ) : null}
      </TableCell>

      <TableCell align="right">{formatHours(scheduledHrs)}</TableCell>

      <TableCell>
        {isEmpty ? (
          <Stack direction="column" spacing={0.25}>
            {creating.status === 'creating' ? (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <CircularProgress size={12} />
                <Typography variant="caption" color="text.secondary">
                  Adding…
                </Typography>
              </Stack>
            ) : canCreate ? (
              <Link
                component="button"
                type="button"
                variant="caption"
                onClick={handleAddEntry}
                underline="hover"
                sx={{ textAlign: 'left', alignSelf: 'flex-start' }}
              >
                + Add entry
              </Link>
            ) : (
              // Read-only fallback (no tenantId / no onCreated handler
              // — e.g. an unauthenticated render path) — keep the
              // original caption intact.
              <Typography variant="caption" color="text.secondary">
                (no entry yet)
              </Typography>
            )}
            {creating.status === 'error' ? (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="caption" color="error">
                  {creating.message ?? 'Failed to add entry'}
                </Typography>
                <Link
                  component="button"
                  type="button"
                  variant="caption"
                  onClick={handleAddEntry}
                  underline="hover"
                >
                  retry
                </Link>
              </Stack>
            ) : null}
          </Stack>
        ) : (
          <>
            {row.entry.actualStartTime ?? '—'}–{row.entry.actualEndTime ?? '—'}
          </>
        )}
      </TableCell>

      <TableCell align="right">{isEmpty ? '0' : formatHours(actualHrs)}</TableCell>

      <TableCell align="right">{formatRate(row.assignment.payRate)}</TableCell>
      <TableCell align="right">{formatRate(row.assignment.billRate)}</TableCell>

      <TableCell>
        <StatusPill status={status} />
      </TableCell>
    </TableRow>
  );
};

/* -------------------------------------------------------------------------
 * Top-level component
 * ------------------------------------------------------------------------- */

export const TimesheetGrid: React.FC<TimesheetGridProps> = ({ filter }) => {
  const { tenantId } = useAuth();
  const { rows, loading, error, errors, consideredAssignmentCount, refresh } =
    useTimesheetGridRows(tenantId, filter);

  if (!filter) {
    return <EmptyFilterState />;
  }

  return (
    <Stack spacing={2}>
      <TimesheetTotalsHeader rows={rows} loading={loading} />

      {error ? (
        <Alert severity="error">
          <AlertTitle>Couldn’t load timesheet rows</AlertTitle>
          {error}
        </Alert>
      ) : null}

      {errors.length > 0 ? (
        <Alert severity="warning" variant="outlined">
          <AlertTitle>
            {errors.length === 1
              ? '1 assignment had an issue'
              : `${errors.length} assignments had issues`}
          </AlertTitle>
          <Stack component="ul" sx={{ pl: 2, mb: 0 }}>
            {errors.slice(0, 5).map((msg, i) => (
              <li key={i}>
                <Typography variant="body2">{msg}</Typography>
              </li>
            ))}
            {errors.length > 5 ? (
              <li>
                <Typography variant="caption" color="text.secondary">
                  …and {errors.length - 5} more.
                </Typography>
              </li>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {loading ? (
        <LoadingState filter={filter} />
      ) : rows.length === 0 && !error ? (
        <NoRowsState
          filter={filter}
          consideredAssignmentCount={consideredAssignmentCount}
        />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Worker</TableCell>
                  <TableCell>Work date</TableCell>
                  <TableCell>Scheduled</TableCell>
                  <TableCell align="right">Sched hrs</TableCell>
                  <TableCell>Actual</TableCell>
                  <TableCell align="right">Actual hrs</TableCell>
                  <TableCell align="right">Pay rate</TableCell>
                  <TableCell align="right">Bill rate</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TimesheetGridRowView
                    key={row.key}
                    row={row}
                    tenantId={tenantId}
                    onCreated={refresh}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Stack>
  );
};

export default TimesheetGrid;
