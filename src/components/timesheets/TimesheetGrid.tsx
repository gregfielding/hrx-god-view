/**
 * TimesheetGrid — recruiter/admin grid of timesheet rows.
 *
 * **Phasing:**
 *   - P1.C.1 — page shell + filter gating + skeleton (placeholder card).
 *   - P1.C.2 — row hydration via `useTimesheetGridRows` + totals header.
 *   - P1.D — "+ Add entry" affordance materializes draft entry rows.
 *   - **P3.A (this commit)** — inline-editable cells for actuals
 *     (start/end time), breaks, tips, bonus, notes. Save-on-blur
 *     with optimistic UI, validation chips, 150ms spinner / 300ms
 *     checkmark, auto-rollback on Firestore failure, Cmd+Z undo.
 *   - P3.B+ — bulk select + bulk approve, Excel paste, header-row
 *     apply, fill handle, variance pre-filter.
 *
 * **Tenant + filter coupling.** The page (`Timesheets.tsx`) owns both;
 * this component is purely controlled. When `filter` is `null`,
 * renders the empty state with helper copy. When `filter` is set,
 * delegates to the hook for hydration.
 *
 * **Edit path.** Each editable cell is a small standalone component
 * (`TimeCell`, `NumberCell`, `NotesCell`, `BreaksCell`) wired to
 * `useTimesheetEntryEditor`'s field handlers. The hook itself is the
 * single source of truth for the surgical Firestore patch + undo
 * registration + deferred recompute-aware refetch. No edit logic
 * lives in this component beyond rendering the cells in their slots.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { TimesheetEditorProvider } from '../../contexts/TimesheetEditorContext';
import useTimesheetEntryEditor from '../../hooks/useTimesheetEntryEditor';
import useTimesheetGridRows from '../../hooks/useTimesheetGridRows';
import type {
  TimesheetEntryV2,
  TimesheetFilter,
} from '../../types/recruiter/timesheet';
import { approveTimesheetEntries } from '../../utils/timesheets/approveTimesheetEntries';
import { createDraftTimesheetEntry } from '../../utils/timesheets/createDraftTimesheetEntry';
import { formatPeriodLabel } from '../../utils/timesheets/dateRange';
import {
  validateBonusAmount,
  validateTips,
} from '../../utils/timesheets/entryValidation';

import BreaksCell from './cells/BreaksCell';
import HoursOverrideCell from './cells/HoursOverrideCell';
import NotesCell from './cells/NotesCell';
import NumberCell from './cells/NumberCell';
import TimeCell from './cells/TimeCell';
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
  /**
   * Optional client-side narrowing — when set, only rows whose
   * `assignment.jobOrderId` is in this set are rendered. The page
   * computes the set from its Account + Job Order filter dropdowns
   * (account narrows by JO membership; JO narrows to a single id).
   *
   * `null` (the default) means "no narrowing" — render every row the
   * resolver returned. An empty set means "narrow to nothing" — render
   * zero rows. Both states are distinct from `undefined`.
   */
  narrowJobOrderIds?: Set<string> | null;
  /**
   * Optional client-side narrowing — when set, only rows whose
   * `assignment.shiftId` matches are rendered. Stacks ON TOP of the
   * job-order narrow (both filters must pass). Rows whose assignment
   * predates the `shiftId` denorm are dropped when this is set —
   * acceptable trade-off because the recruiter has explicitly asked
   * for a single shift's data.
   */
  narrowShiftId?: string | null;
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
  /** When set, click on a `draft` or `submitted` pill fires this
   *  handler. Used to approve entries from the grid without a separate
   *  bulk-select UI. Non-approvable statuses ignore the click. */
  onApprove?: () => void;
  /** Loading flag while the approve callable is in flight. */
  approving?: boolean;
}

const StatusPill: React.FC<StatusPillProps> = ({ status, onApprove, approving }) => {
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
  const isApprovable = (status === 'draft' || status === 'submitted') && !!onApprove;
  return (
    <Tooltip
      title={
        isApprovable
          ? 'Click to approve this entry (required before submit to Everee).'
          : ''
      }
    >
      <Chip
        size="small"
        color={STATUS_COLORS[status]}
        variant="filled"
        label={approving ? 'Approving…' : STATUS_LABELS[status]}
        onClick={isApprovable ? onApprove : undefined}
        clickable={isApprovable}
        sx={{
          cursor: isApprovable ? 'pointer' : 'default',
          fontWeight: 600,
        }}
      />
    </Tooltip>
  );
};

/* -------------------------------------------------------------------------
 * Row rendering
 * ------------------------------------------------------------------------- */

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

/**
 * Per-row gross pay. Same formula as SubmitBatchToEvereeButton's
 * `summarizeApproved` so the row total and the batch total agree:
 *   reg * payRate + ot * payRate * 1.5 + dt * payRate * 2 + tips + bonus
 *
 * Penalties (meal/rest break) are NOT included today — they're a CA-only
 * rules-engine output that hasn't been wired into pay totals yet. Adding
 * them would require splitting the formula by entity policy.
 */
function computeEntryGrossPay(entry: TimesheetEntryV2): number {
  const payRate = Number(entry.payRate ?? 0);
  const reg = Number(entry.totalRegularHours ?? 0);
  const ot = Number(entry.totalOTHours ?? 0);
  const dt = Number(entry.totalDoubleTimeHours ?? 0);
  const tips = Number(entry.tips ?? 0);
  const bonus = Number(entry.bonusAmount ?? 0);
  return reg * payRate + ot * payRate * 1.5 + dt * payRate * 2 + tips + bonus;
}

function formatHours(h: number): string {
  if (!Number.isFinite(h) || h === 0) return '0';
  if (Number.isInteger(h)) return `${h}`;
  return h.toFixed(1);
}

interface RowCommonProps {
  row: TimesheetGridRow;
  status: TimesheetRowDisplayStatus;
  scheduledHrs: number;
  actualHrs: number;
}

interface EmptyRowProps extends RowCommonProps {
  /** Tenant scope for the create-entry callable. Required when the
   *  row is empty AND the caller has provided an `onCreated` handler. */
  tenantId?: string | null;
  /** Fires after a successful create. The grid hook's `refresh()`
   *  re-resolves the row set so the new entry replaces the empty row. */
  onCreated?: () => void;
}

interface EntryRowProps extends RowCommonProps {
  tenantId: string;
  entry: TimesheetEntryV2;
  mergeEntryUpdate: (entryId: string, patch: Partial<TimesheetEntryV2>) => void;
  refreshEntry: (entryId: string) => Promise<void>;
  /** Fired when the user clicks a `draft` or `submitted` Status pill.
   *  Calls the approve callable; on success the row's status flips to
   *  `approved` and the SubmitBatchToEveree button picks it up. */
  onApproveEntry: (entryId: string) => Promise<void>;
  /** True while an approve callable is in flight for THIS entry. */
  approvingThisEntry: boolean;
}

/**
 * Per-row local state for the "+ Add entry" affordance on empty rows.
 * Each row tracks its own `creating` / `error` independently so multiple
 * recruiters can fire creates in parallel without coupling.
 */
interface CreatingState {
  status: 'idle' | 'creating' | 'error';
  message?: string;
}

/* -------------------------------------------------------------------------
 * Worker name + site cell
 *
 * Shared between the empty and entry row variants — single source of
 * truth for the leftmost identity column so they stay visually
 * aligned no matter which kind of row is rendering.
 * ------------------------------------------------------------------------- */

const WorkerSiteCell: React.FC<{ row: TimesheetGridRow }> = ({ row }) => (
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
);

const ScheduledCell: React.FC<{ row: TimesheetGridRow }> = ({ row }) => (
  <TableCell>
    {row.scheduled.startTime}–{row.scheduled.endTime}
    {row.scheduled.breakMinutes > 0 ? (
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
        ({row.scheduled.breakMinutes}m brk)
      </Typography>
    ) : null}
  </TableCell>
);

/* -------------------------------------------------------------------------
 * Empty-row renderer (no entry doc materialized yet)
 * ------------------------------------------------------------------------- */

const EmptyRow: React.FC<EmptyRowProps> = ({
  row,
  status,
  scheduledHrs,
  tenantId,
  onCreated,
}) => {
  const [creating, setCreating] = useState<CreatingState>({ status: 'idle' });
  const canCreate = !!tenantId && !!onCreated && creating.status !== 'creating';

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
      // be replaced by an `entry` row on the next render.
      onCreated();
    } catch (err) {
      const fallback = err instanceof Error ? err.message : String(err);
      const message =
        err instanceof FirebaseError && typeof err.message === 'string'
          ? err.message
          : fallback;
      setCreating({ status: 'error', message });
    }
  };

  return (
    <TableRow hover sx={{ backgroundColor: 'action.hover' }}>
      <WorkerSiteCell row={row} />
      <TableCell>{row.workDate}</TableCell>
      <ScheduledCell row={row} />
      <TableCell align="right">{formatHours(scheduledHrs)}</TableCell>
      {/* Spans Actual / Breaks / Actual hrs / Tips / Bonus / Notes /
          Pay rate / Total — 8 columns. Bumped from 6 → 8 when the
          Pay rate + Total columns were added, so the "+ Add entry"
          link block still spans correctly to the Status cell. */}
      <TableCell colSpan={8}>
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
      </TableCell>
      <TableCell>
        <StatusPill status={status} />
      </TableCell>
    </TableRow>
  );
};

/* -------------------------------------------------------------------------
 * Entry-row renderer (entry doc exists; cells are inline-editable)
 * ------------------------------------------------------------------------- */

const EntryRow: React.FC<EntryRowProps> = ({
  row,
  status,
  scheduledHrs,
  actualHrs,
  tenantId,
  entry,
  mergeEntryUpdate,
  refreshEntry,
  onApproveEntry,
  approvingThisEntry,
}) => {
  const editor = useTimesheetEntryEditor({
    tenantId,
    entry,
    mergeEntryUpdate,
    refreshEntry,
  });
  const { fieldHandlers, readOnly } = editor;

  // Shift window for the breaks-inside-shift validator. Use actuals
  // when set (recruiter-edited), fall back to scheduled otherwise.
  const shiftStart = entry.actualStartTime ?? row.scheduled.startTime;
  const shiftEnd = entry.actualEndTime ?? row.scheduled.endTime;

  return (
    <TableRow hover>
      <WorkerSiteCell row={row} />
      <TableCell>{row.workDate}</TableCell>
      <ScheduledCell row={row} />
      <TableCell align="right">{formatHours(scheduledHrs)}</TableCell>

      <TableCell>
        <Stack direction="row" alignItems="center" spacing={0.25}>
          <TimeCell
            value={entry.actualStartTime ?? null}
            onSave={fieldHandlers.actualStartTime}
            disabled={readOnly}
            ariaLabel="Actual start time"
          />
          <Typography component="span" variant="body2" color="text.secondary">
            –
          </Typography>
          <TimeCell
            value={entry.actualEndTime ?? null}
            onSave={fieldHandlers.actualEndTime}
            disabled={readOnly}
            ariaLabel="Actual end time"
          />
        </Stack>
      </TableCell>

      <TableCell>
        <BreaksCell
          value={Array.isArray(entry.breaks) ? entry.breaks : []}
          onSave={fieldHandlers.breaks}
          shiftStart={shiftStart}
          shiftEnd={shiftEnd}
          disabled={readOnly}
        />
      </TableCell>

      {/* Actual hours column.
          - When the recruiter has entered start AND end times, the
            recompute trigger derives total worked hours from those —
            this cell is read-only and shows the computed value.
          - When start/end are both blank, the recruiter can enter a
            manual total directly (e.g. 6.25 for clients that report
            a single total). Writes to `actualHoursOverride`; the
            trigger honors it as the day's workedMinutes. */}
      <TableCell align="right">
        {entry.actualStartTime && entry.actualEndTime ? (
          formatHours(actualHrs)
        ) : (
          <HoursOverrideCell
            value={entry.actualHoursOverride ?? null}
            onSave={fieldHandlers.actualHoursOverride}
            disabled={readOnly}
            ariaLabel="Actual hours"
          />
        )}
      </TableCell>

      <TableCell align="right">
        <NumberCell
          value={typeof entry.tips === 'number' ? entry.tips : 0}
          onSave={fieldHandlers.tips}
          validate={(raw) => validateTips(raw)}
          disabled={readOnly}
          ariaLabel="Tips"
        />
      </TableCell>

      <TableCell align="right">
        <NumberCell
          value={typeof entry.bonusAmount === 'number' ? entry.bonusAmount : 0}
          onSave={fieldHandlers.bonusAmount}
          validate={(raw) => validateBonusAmount(raw)}
          disabled={readOnly}
          ariaLabel="Bonus"
        />
      </TableCell>

      <TableCell>
        <NotesCell
          value={typeof entry.notes === 'string' ? entry.notes : ''}
          onSave={fieldHandlers.notes}
          disabled={readOnly}
          ariaLabel="Notes"
        />
      </TableCell>

      {/* Pay rate + Total. Total uses the same formula as the
          batch submitter's gross-pay aggregation so per-row and
          batch totals stay in lockstep. */}
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(Number(entry.payRate ?? 0))}
      </TableCell>
      <TableCell
        align="right"
        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
      >
        {formatMoney(computeEntryGrossPay(entry))}
      </TableCell>

      <TableCell>
        <StatusPill
          status={status}
          onApprove={() => void onApproveEntry(entry.id)}
          approving={approvingThisEntry}
        />
      </TableCell>
    </TableRow>
  );
};

/* -------------------------------------------------------------------------
 * Top-level component
 * ------------------------------------------------------------------------- */

export const TimesheetGrid: React.FC<TimesheetGridProps> = ({
  filter,
  narrowJobOrderIds = null,
  narrowShiftId = null,
}) => {
  const { tenantId } = useAuth();
  const {
    rows: rawRows,
    loading,
    error,
    errors,
    consideredAssignmentCount,
    refresh,
    mergeEntryUpdate,
    refreshEntry,
  } = useTimesheetGridRows(tenantId, filter);

  // Apply client-side narrowing on top of whatever the resolver returned.
  // We do this here (vs. inside `useTimesheetGridRows`) so the underlying
  // `TimesheetFilter` shape — and the resolver's index-friendly query —
  // doesn't fragment per dropdown. Narrowing is purely a UX layer.
  //
  // Two axes can stack:
  //   - `narrowJobOrderIds`: keep rows under any JO in the set
  //   - `narrowShiftId`:     keep rows whose assignment.shiftId matches
  // Both gates are AND-ed.
  const rows = useMemo(() => {
    if (!narrowJobOrderIds && !narrowShiftId) return rawRows;
    return rawRows.filter((r) => {
      if (narrowJobOrderIds && !narrowJobOrderIds.has(r.assignment.jobOrderId)) {
        return false;
      }
      if (narrowShiftId && r.assignment.shiftId !== narrowShiftId) {
        return false;
      }
      return true;
    });
  }, [rawRows, narrowJobOrderIds, narrowShiftId]);

  /* -------------------------------------------------------------------
   * Auto-materialize draft entries on JO/shift narrow.
   *
   * Without this, every empty row requires a "+ Add entry" click
   * before the recruiter can input actual hours — for a 79-worker
   * festival JO that's 79 clicks before any data entry. Once the
   * recruiter has explicitly narrowed to a single JO or a single
   * shift, the intent is clear: they're about to fill in actuals for
   * everyone listed. We pre-create the draft entries in chunked-
   * parallel writes (8 at a time) so all rows arrive at the inline
   * editor by the time the spinner clears.
   *
   * Why gate on "narrowed-to-one" specifically:
   *   - Entity-wide views can list hundreds of empty rows across
   *     unrelated JOs. Bulk-materializing those would create a lot
   *     of noise the recruiter never asked for.
   *   - Account narrow alone (no JO) still spans many JOs — same
   *     concern.
   *   - Shift narrow is intentional + scoped — exactly one row per
   *     worker, safe to auto-create.
   *
   * Idempotency: `createDraftTimesheetEntryCallable` uses a
   * deterministic `{assignmentId}_{workDate}` id and returns
   * `created: false` for existing docs, so the second visit to the
   * same JO is a free no-op on the server.
   *
   * `autoCreatedRef` reserves keys synchronously to keep multiple
   * useEffect runs (e.g. while creates are in flight + rows[] has
   * changed) from double-firing the same callable.
   * ------------------------------------------------------------------- */
  const autoCreatedRef = useRef<Set<string>>(new Set());
  const [autoCreating, setAutoCreating] = useState(false);

  /* -------------------------------------------------------------------
   * Approval action (per-row click on the draft status pill).
   *
   * Tracks IN-FLIGHT entry ids so the clicked pill renders an
   * "Approving…" state and the user can't double-click the same row.
   * On success, the row's status flips to `approved` via the
   * mergeEntryUpdate path so the Submit-to-Everee button picks it up
   * immediately (no separate refresh round-trip).
   * ------------------------------------------------------------------- */
  const [approvingEntryIds, setApprovingEntryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const handleApproveEntry = useCallback(
    async (entryId: string) => {
      if (!tenantId) return;
      setApprovingEntryIds((prev) => {
        if (prev.has(entryId)) return prev;
        const next = new Set(prev);
        next.add(entryId);
        return next;
      });
      try {
        const res = await approveTimesheetEntries({ tenantId, entryIds: [entryId] });
        if (res.approved > 0) {
          // Local-merge the new status so SubmitBatchToEvereeButton's
          // summary count refreshes without a full grid refetch.
          mergeEntryUpdate(entryId, { status: 'approved' });
        } else {
          // The server skipped it — likely already approved or in a
          // terminal status. Either way the grid will reflect reality
          // on the next refresh; nothing to do here.
        }
      } catch (err) {
        console.error('[TimesheetGrid] approve failed', { entryId, err });
      } finally {
        setApprovingEntryIds((prev) => {
          if (!prev.has(entryId)) return prev;
          const next = new Set(prev);
          next.delete(entryId);
          return next;
        });
      }
    },
    [tenantId, mergeEntryUpdate],
  );

  useEffect(() => {
    const narrowedToOne =
      (narrowJobOrderIds !== null &&
        narrowJobOrderIds !== undefined &&
        narrowJobOrderIds.size === 1) ||
      !!narrowShiftId;
    if (!narrowedToOne || !tenantId || loading) return;

    const fresh = rows.filter(
      (r) => r.kind === 'empty' && !autoCreatedRef.current.has(r.key),
    );
    if (fresh.length === 0) return;

    // Reserve keys synchronously so a re-render mid-flight doesn't
    // duplicate the work.
    for (const r of fresh) autoCreatedRef.current.add(r.key);

    let cancelled = false;
    setAutoCreating(true);

    void (async () => {
      const chunkSize = 8;
      for (let i = 0; i < fresh.length; i += chunkSize) {
        if (cancelled) return;
        const chunk = fresh.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map((r) =>
            createDraftTimesheetEntry({
              tenantId,
              assignmentId: r.assignment.id,
              workDate: r.workDate,
            }).catch((err) => {
              // Don't fail the whole batch — log + un-reserve so a
              // later explicit "+ Add entry" click can retry.
              console.warn(
                '[TimesheetGrid] auto-create draft entry failed',
                { key: r.key, err },
              );
              autoCreatedRef.current.delete(r.key);
            }),
          ),
        );
      }
      if (cancelled) return;
      setAutoCreating(false);
      refresh();
    })();

    return () => {
      cancelled = true;
    };
    // `refresh` is stable across renders (useCallback inside the hook),
    // but include it to satisfy exhaustive-deps. Same for `tenantId`.
  }, [tenantId, rows, narrowJobOrderIds, narrowShiftId, loading, refresh]);

  // Re-arm the auto-create gate when the narrow changes — otherwise
  // switching from JO A → JO B would skip the new rows because A's
  // keys would still be reserved.
  useEffect(() => {
    autoCreatedRef.current = new Set();
  }, [narrowJobOrderIds, narrowShiftId]);

  if (!filter) {
    return <EmptyFilterState />;
  }

  return (
    <TimesheetEditorProvider>
      <Stack spacing={2}>
        <TimesheetTotalsHeader
          rows={rows}
          loading={loading}
          tenantId={tenantId}
          filter={filter}
          onSubmitted={refresh}
        />

        {autoCreating ? (
          <Alert
            severity="info"
            icon={<CircularProgress size={16} />}
            sx={{ py: 0.5 }}
          >
            Preparing rows for input… inline editing will activate as
            each row is materialized.
          </Alert>
        ) : null}

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
                    <TableCell>Breaks</TableCell>
                    <TableCell align="right">Actual hrs</TableCell>
                    <TableCell align="right">Tips</TableCell>
                    <TableCell align="right">Bonus</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell align="right">Pay rate</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const status = displayStatusForRow(row);
                    const scheduledHrs = scheduledHoursForRow(row);
                    const actualHrs = actualHoursForRow(row);

                    if (row.kind === 'empty') {
                      return (
                        <EmptyRow
                          key={row.key}
                          row={row}
                          status={status}
                          scheduledHrs={scheduledHrs}
                          actualHrs={actualHrs}
                          tenantId={tenantId}
                          onCreated={refresh}
                        />
                      );
                    }

                    if (!tenantId) {
                      // Defensive: tenantId is required for the edit
                      // path's Firestore writes. If it's somehow null
                      // we render a non-editable fallback so the
                      // grid doesn't crash mid-render.
                      return (
                        <EmptyRow
                          key={row.key}
                          row={row}
                          status={status}
                          scheduledHrs={scheduledHrs}
                          actualHrs={actualHrs}
                        />
                      );
                    }

                    return (
                      <EntryRow
                        key={row.key}
                        row={row}
                        status={status}
                        scheduledHrs={scheduledHrs}
                        actualHrs={actualHrs}
                        tenantId={tenantId}
                        entry={row.entry}
                        mergeEntryUpdate={mergeEntryUpdate}
                        refreshEntry={refreshEntry}
                        onApproveEntry={handleApproveEntry}
                        approvingThisEntry={approvingEntryIds.has(row.entry.id)}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </Stack>
    </TimesheetEditorProvider>
  );
};

export default TimesheetGrid;
