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

import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Group as GroupIcon,
} from '@mui/icons-material';

import {
  type TimesheetGridRow,
  type TimesheetRowDisplayStatus,
  actualHoursForRow,
  displayStatusForRow,
  entryHasRecruiterData,
  scheduledHoursForRow,
} from './timesheetGridResolver';
import SubmitBatchToEvereeButton from './SubmitBatchToEvereeButton';
import type { TimesheetFilter } from '../../types/recruiter/timesheet';
import { approveTimesheetEntries } from '../../utils/timesheets/approveTimesheetEntries';

export interface TimesheetTotalsHeaderProps {
  rows: TimesheetGridRow[];
  /** Optional — when the resolver succeeded but produced 0 rows AND
   *  the period had no overlapping assignments, the empty-state copy
   *  in the grid does its own thing. The header just renders zeros
   *  consistently. */
  loading?: boolean;
  /** TS.1.P4 Slice 6b — passed through to the Submit-to-Everee
   *  button so it knows the tenant + scope for batch creation. The
   *  button hides itself when these aren't set or when there are no
   *  approved entries to submit. */
  tenantId?: string | null;
  filter?: TimesheetFilter | null;
  /** Fires after a successful batch submission so the parent can
   *  refresh the grid. */
  onSubmitted?: () => void;
  /** Optional optimistic merge passed through to the Submit button
   *  so on submit success the rows immediately flip to
   *  `sent_to_everee` without waiting for the live listener. */
  mergeEntryUpdate?: (entryId: string, patch: { status?: string }) => void;
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

/**
 * Friendly label + visual treatment for each persisted-entry status
 * chip in the header. `no_entry` is intentionally absent from this
 * map and from `STATUS_ORDER` below — empty rows aren't real entries
 * and shouldn't generate an aggregate chip in the header (per the
 * P1.C.2 spot-check feedback). Empty rows still contribute to worker
 * count and scheduled-hours totals; they just don't get a header
 * chip. The per-row status pill in the table itself still reads "—"
 * for empty rows (handled in `TimesheetGrid`'s StatusPill).
 */
type ChipStatus = Exclude<TimesheetRowDisplayStatus, 'no_entry'>;

const STATUS_LABELS: Record<ChipStatus, string> = {
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
  ChipStatus,
  'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
> = {
  draft: 'default',
  submitted: 'info',
  approved: 'primary',
  sent_to_everee: 'info',
  paid: 'success',
  error: 'error',
};

/** Stable lifecycle order. Statuses absent from `byStatus` are skipped
 *  (no zero-count chips). Reads left-to-right as the entry's natural
 *  progression: draft → submitted → approved → sent → paid → error. */
const STATUS_ORDER: ChipStatus[] = [
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
  tenantId,
  filter,
  onSubmitted,
  mergeEntryUpdate,
}) => {
  const totals = useMemo(() => deriveTotals(rows), [rows]);

  const allRowsEmpty = totals.rowCount > 0 && totals.emptyRowCount === totals.rowCount;
  const showScheduledOnlyNote = !loading && allRowsEmpty;

  /* -------------------------------------------------------------------
   * Bulk approve action.
   *
   * At production scale (e.g. 79-worker festival JO) clicking the
   * status pill on each row is prohibitive. This button counts every
   * `draft` / `submitted` entry in the current view and flips them
   * all to `approved` in one shot. Chunks at the server's 200-id cap.
   *
   * Local optimistic-merge isn't needed — the per-row pill already
   * handles single-entry merges; for bulk, we rely on `onSubmitted` /
   * the live row listener to refresh.
   * ------------------------------------------------------------------- */
  const approvableEntryIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of rows) {
      if (r.kind !== 'entry') continue;
      if (r.entry.status !== 'draft' && r.entry.status !== 'submitted') continue;
      // Skip empties — the auto-create-on-narrow path materializes a
      // draft row for every scheduled day so the cells are immediately
      // editable, but only rows where the recruiter actually entered
      // hours should ride a bulk action. Single-click on the status
      // pill still works for the rare deliberate no-show approval.
      if (!entryHasRecruiterData(r.entry)) continue;
      ids.push(r.entry.id);
    }
    return ids;
  }, [rows]);
  const [approvingAll, setApprovingAll] = useState(false);
  const handleApproveAll = useCallback(async () => {
    if (!tenantId || approvableEntryIds.length === 0) return;
    setApprovingAll(true);
    try {
      // Server caps at 200 ids per call. Chunk so 79-worker batches
      // ship in one call but 500-worker (hypothetical) would still
      // succeed in three.
      const CHUNK = 200;
      for (let i = 0; i < approvableEntryIds.length; i += CHUNK) {
        await approveTimesheetEntries({
          tenantId,
          entryIds: approvableEntryIds.slice(i, i + CHUNK),
        });
      }
      // The live row listener will pick up the status flip; calling
      // onSubmitted gives the parent grid a hint to refresh too.
      onSubmitted?.();
    } catch (err) {
      console.error('[TimesheetTotalsHeader] approve-all failed', err);
    } finally {
      setApprovingAll(false);
    }
  }, [tenantId, approvableEntryIds, onSubmitted]);

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
                variant="filled"
                label={`${count} ${STATUS_LABELS[status]}`}
              />
            );
          })}

          {/* Bulk-approve. Visible only when there's at least one
              draft/submitted row in the current view, so a fully-
              approved batch doesn't show a redundant button. */}
          {tenantId && approvableEntryIds.length > 0 && (
            <Tooltip
              title={`Flip every ${approvableEntryIds.length} draft / submitted entry in this view to approved.`}
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={
                    approvingAll ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <CheckCircleOutlineIcon fontSize="small" />
                    )
                  }
                  onClick={() => void handleApproveAll()}
                  disabled={approvingAll}
                  sx={{ textTransform: 'none' }}
                >
                  {approvingAll
                    ? 'Approving…'
                    : `Approve ${approvableEntryIds.length}`}
                </Button>
              </span>
            </Tooltip>
          )}

          {/* TS.1.P4 Slice 6b — submit-to-Everee button. Renders only
           *  when we have tenant + filter context. Internally disabled
           *  when there are 0 approved rows in the current view. */}
          {tenantId && filter && (
            <SubmitBatchToEvereeButton
              tenantId={tenantId}
              filter={filter}
              rows={rows}
              onSubmitted={onSubmitted}
              mergeEntryUpdate={mergeEntryUpdate}
            />
          )}
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
