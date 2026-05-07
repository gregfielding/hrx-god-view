/**
 * TimesheetGrid — read-only grid of timesheet rows for the
 * recruiter/admin workspace.
 *
 * **P1.C.1 scope (this commit):** skeleton + filter gating only.
 *   - When `filter` is `null` (no entity + period selected on the
 *     parent page), renders an empty state with helper copy.
 *   - When `filter` is set, renders a placeholder card explaining the
 *     resolver lands in P1.C.2. The Totals header is also a stub.
 *
 * **P1.C.2 (next commit):** wire to `timesheetGridResolver` →
 * assignment query → period expansion → entry lookup → render rows +
 * live totals header. Empty rows (no entry yet for that workDate) show
 * "(no entry yet)" with a "—" status pill.
 *
 * **P3+ scope:** cells become inline-editable; status pill becomes
 * interactive (draft → submit → approve flow). The grid itself stays
 * non-virtualized for now — typical view is ≤100 rows. Re-evaluate when
 * editing makes the per-cell render cost meaningful (then reach for
 * `react-window` or similar; nothing is currently installed).
 */

import React from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  TableChart as TableChartIcon,
} from '@mui/icons-material';

import type { TimesheetFilter } from '../../types/recruiter/timesheet';
import { formatPeriodLabel } from '../../utils/timesheets/dateRange';

export interface TimesheetGridProps {
  /** Composite filter from the page filter bar. `null` when the
   *  recruiter hasn't yet selected the required entity + period. */
  filter: TimesheetFilter | null;
}

/**
 * Render a friendly start-from-zero state when the page hasn't yet
 * narrowed scope. The page is responsible for surfacing the entity +
 * period pickers above this — we just explain what happens once
 * they're set.
 */
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

/**
 * Compact human label for the filter, shown in the placeholder card to
 * confirm what the page will load once the resolver ships.
 */
function describeFilter(filter: TimesheetFilter): string {
  switch (filter.kind) {
    case 'entity_period':
      return `Entity ${filter.hiringEntityId} · ${formatPeriodLabel({
        start: filter.periodStart,
        end: filter.periodEnd,
      })}`;
    case 'jobOrder':
      return `Job order ${filter.jobOrderId}${
        filter.periodStart && filter.periodEnd
          ? ` · ${formatPeriodLabel({
              start: filter.periodStart,
              end: filter.periodEnd,
            })}`
          : ''
      }`;
    case 'shift':
      return `Shift ${filter.shiftId}`;
    case 'worker':
      return `Worker ${filter.workerId} · ${formatPeriodLabel({
        start: filter.periodStart,
        end: filter.periodEnd,
      })}`;
    case 'account':
      return `Account ${filter.accountId} · ${formatPeriodLabel({
        start: filter.periodStart,
        end: filter.periodEnd,
      })}`;
    default:
      return 'Unknown filter';
  }
}

/**
 * Stub totals header — P1.C.2 wires this to live counts/sums of
 * visible rows. Present in the skeleton so the layout doesn't shift
 * when the resolver lands.
 */
const TotalsHeaderStub: React.FC = () => (
  <Paper
    variant="outlined"
    sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 3 }}
  >
    <Stack direction="row" alignItems="center" spacing={1}>
      <AccessTimeIcon fontSize="small" color="disabled" />
      <Typography variant="body2" color="text.secondary">
        Workers
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        —
      </Typography>
    </Stack>
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography variant="body2" color="text.secondary">
        Scheduled hrs
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        —
      </Typography>
    </Stack>
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography variant="body2" color="text.secondary">
        Actual hrs
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        —
      </Typography>
    </Stack>
    <Box sx={{ flexGrow: 1 }} />
    <Typography variant="caption" color="text.secondary">
      Totals reflect scheduled time until entries are saved.
    </Typography>
  </Paper>
);

const RowsPlaceholder: React.FC<{ filter: TimesheetFilter }> = ({ filter }) => (
  <Card variant="outlined" sx={{ mt: 2 }}>
    <CardContent>
      <Alert severity="info" sx={{ mb: 2 }}>
        Rows hydrate in <strong>TS.1.P1.C.2</strong>. The filter you
        selected is wired up and will drive the grid in the next commit.
      </Alert>
      <Typography variant="body2" color="text.secondary">
        Filter: {describeFilter(filter)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        P1.C.2 will: query assignments matching this filter, expand each
        weekly schedule across the period, look up
        <code style={{ margin: '0 4px' }}>tenants/&#123;t&#125;/timesheet_entries/&#123;assignmentId&#125;_&#123;workDate&#125;</code>
        and render either the entry or an "empty" row populated from the
        assignment snapshot.
      </Typography>
    </CardContent>
  </Card>
);

export const TimesheetGrid: React.FC<TimesheetGridProps> = ({ filter }) => {
  if (!filter) {
    return <EmptyFilterState />;
  }
  return (
    <Stack spacing={2}>
      <TotalsHeaderStub />
      <RowsPlaceholder filter={filter} />
    </Stack>
  );
};

export default TimesheetGrid;
