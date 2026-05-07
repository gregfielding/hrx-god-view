/**
 * TimesheetTotalsHeader — live counts + sums for the visible rows.
 *
 * Pure presentational component: takes the resolved row set and derives
 * worker count, scheduled hours, actual hours, and a per-status
 * breakdown. The grid passes the post-filter row set so totals always
 * reflect what the user is looking at (including any in-flight status /
 * variance filters that arrive in P3).
 *
 * **For read-only P1.C.2:**
 *   - Most rows will be `kind: 'empty'` (no entry yet) until P3 makes
 *     cells editable. Their actual hours are 0 by definition; the
 *     scheduled hours pull from the assignment's `weeklySchedule` +
 *     `shiftBreakDefaultMinutes`. We surface a friendly note explaining
 *     this so the operator doesn't think the grid is broken.
 *   - Status breakdown counts empty rows separately (`no entry yet`)
 *     so the operator can see how much work remains to be entered.
 */

import React, { useMemo } from 'react';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  Group as GroupIcon,
  Pending as PendingIcon,
} from '@mui/icons-material';

import {
  type TimesheetGridRow,
  type TimesheetRowDisplayStatus,
  actualHoursForRow,
  displayStatusForRow,
  scheduledHoursForRow,
} from './timesheetGridResolver';

export interface TimesheetTotalsHeaderProps {
  rows: TimesheetGridRow[];
  /** Optional — when the resolver succeeded but produced 0 rows AND
   *  the period had no overlapping assignments, the empty-state copy
   *  in the grid does its own thing. The header just renders zeros
   *  consistently. */
  loading?: boolean;
}

interface TotalsBreakdown {
  workerCount: number;
  rowCount: number;
  emptyRowCount: number;
  scheduledHours: number;
  actualHours: number;
  byStatus: Map<TimesheetRowDisplayStatus, number>;
}

function deriveTotals(rows: TimesheetGridRow[]): TotalsBreakdown {
  const workers = new Set<string>();
  const byStatus = new Map<TimesheetRowDisplayStatus, number>();
  let scheduledHours = 0;
  let actualHours = 0;
  let emptyRowCount = 0;

  for (const row of rows) {
    workers.add(row.assignment.workerId);
    scheduledHours += scheduledHoursForRow(row);
    actualHours += actualHoursForRow(row);
    const status = displayStatusForRow(row);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (row.kind === 'empty') emptyRowCount += 1;
  }

  return {
    workerCount: workers.size,
    rowCount: rows.length,
    emptyRowCount,
    scheduledHours,
    actualHours,
    byStatus,
  };
}

/** Compact "12.5 hrs" formatter — single decimal, no trailing zero
 *  for integers. */
function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours === 0) return '0';
  if (Number.isInteger(hours)) return `${hours}`;
  return hours.toFixed(1);
}

/** Friendly label for the per-status chip group. Mirrors the build
 *  plan's status vocabulary; "no_entry" reads as "no entry yet" since
 *  it's the only non-`TimesheetEntryStatus` value. */
const STATUS_LABELS: Record<TimesheetRowDisplayStatus, string> = {
  no_entry: 'no entry yet',
  draft: 'draft',
  submitted: 'submitted',
  approved: 'approved',
  sent_to_everee: 'sent to Everee',
  paid: 'paid',
  error: 'error',
};

/** Visual treatment for each status chip. Matches the in-row pill
 *  colors so the header reads as a summary of the table below it. */
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

/** Stable status order — never alphabetical; the lifecycle reads
 *  left-to-right (no_entry → draft → submitted → approved → ...).
 *  Statuses absent from `byStatus` are skipped (no zero-count chips). */
const STATUS_ORDER: TimesheetRowDisplayStatus[] = [
  'no_entry',
  'draft',
  'submitted',
  'approved',
  'sent_to_everee',
  'paid',
  'error',
];

export const TimesheetTotalsHeader: React.FC<TimesheetTotalsHeaderProps> = ({
  rows,
  loading,
}) => {
  const totals = useMemo(() => deriveTotals(rows), [rows]);

  const allRowsEmpty = totals.rowCount > 0 && totals.emptyRowCount === totals.rowCount;
  const showScheduledOnlyNote = !loading && allRowsEmpty;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <GroupIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">
            Workers
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {totals.workerCount}
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <AccessTimeIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">
            Scheduled hrs
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {formatHours(totals.scheduledHours)}
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <Tooltip title="Sum of regular + OT + double-time across saved entries. Empty rows contribute 0 until entered.">
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <AccessTimeIcon fontSize="small" color="action" sx={{ mr: 1 }} />
              <Typography variant="body2" color="text.secondary">
                Actual hrs
              </Typography>
            </span>
          </Tooltip>
          <Typography variant="body2" fontWeight={700}>
            {formatHours(totals.actualHours)}
          </Typography>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
        >
          {STATUS_ORDER.map((status) => {
            const count = totals.byStatus.get(status) ?? 0;
            if (count === 0) return null;
            return (
              <Chip
                key={status}
                size="small"
                color={STATUS_COLORS[status]}
                variant={status === 'no_entry' ? 'outlined' : 'filled'}
                icon={status === 'no_entry' ? <PendingIcon fontSize="small" /> : undefined}
                label={`${count} ${STATUS_LABELS[status]}`}
              />
            );
          })}
        </Stack>
      </Stack>

      {showScheduledOnlyNote ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          Totals reflect scheduled time — actuals will populate once
          recruiters save entries.
        </Typography>
      ) : null}
    </Paper>
  );
};

export default TimesheetTotalsHeader;
