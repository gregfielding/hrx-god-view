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
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  DeleteOutline as DeleteIcon,
  Edit as EditIcon,
  TableChart as TableChartIcon,
} from '@mui/icons-material';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { TimesheetEditorProvider } from '../../contexts/TimesheetEditorContext';
import useTimesheetEntryEditor from '../../hooks/useTimesheetEntryEditor';
import useTimesheetGridRows from '../../hooks/useTimesheetGridRows';
import type {
  TimesheetEntryV2,
  TimesheetFilter,
} from '../../types/recruiter/timesheet';
import { approveTimesheetEntries } from '../../utils/timesheets/approveTimesheetEntries';
import { revertTimesheetEntriesToDraft } from '../../utils/timesheets/revertTimesheetEntriesToDraft';
import { createDraftTimesheetEntry } from '../../utils/timesheets/createDraftTimesheetEntry';
import { formatPeriodLabel } from '../../utils/timesheets/dateRange';
import {
  validateBonusAmount,
  validatePayRate,
  validateTips,
} from '../../utils/timesheets/entryValidation';

import BreaksCell from './cells/BreaksCell';
import HoursOverrideCell from './cells/HoursOverrideCell';
import NotesCell from './cells/NotesCell';
import NumberCell from './cells/NumberCell';
import TimeCell from './cells/TimeCell';
import EditWorkersCompDialog from './EditWorkersCompDialog';
import ImportRowWorkerPicker from './ImportRowWorkerPicker';
import ImportRowWorksitePicker from './ImportRowWorksitePicker';
import ImportGridSubmitBar from './ImportGridSubmitBar';
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
  /**
   * Bumping this number triggers an in-place data refresh — same effect
   * as the user clicking a refresh button. Used by Timesheets.tsx after
   * the Add Worker modal completes, so the grid picks up the new rows
   * without re-mounting (and without resetting any in-row edit state).
   */
  refreshSignal?: number;
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
  // Longer label so recruiters can see at a glance that the row is
  // done and shouldn't be touched again. The "→ Everee" suffix
  // disambiguates from the worker-side `submitted` status (Section 1
  // analog). Mirrors the same upgrade in the totals-header chip.
  sent_to_everee: '✓ Sent to Everee',
  paid: '✓ Paid',
  error: 'error',
  // CSV-import rows (surfaced from the Import tab; resolved/fixed there).
  import_ready: 'Ready (import)',
  import_needs_rate: 'Needs rate (import)',
  import_needs_wc: 'Needs WC (import)',
  import_blocked: 'Blocked (import)',
  import_submitted: '✓ Submitted (import)',
  import_paid: '✓ Paid (import)',
  import_voided: 'Voided (import)',
};

const STATUS_COLORS: Record<
  TimesheetRowDisplayStatus,
  'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
> = {
  no_entry: 'default',
  draft: 'default',
  submitted: 'info',
  approved: 'primary',
  // `sent_to_everee` was `info` (blue outline) which read as "in
  // progress" — but on the row it really means "done from our side,
  // awaiting Everee's pay-run completion". Bump to `success` so it
  // visually matches `paid` (also success) and the recruiter sees
  // "row is done" at a glance.
  sent_to_everee: 'success',
  paid: 'success',
  error: 'error',
  import_ready: 'success',
  import_needs_rate: 'info',
  import_needs_wc: 'info',
  import_blocked: 'warning',
  import_submitted: 'success',
  import_paid: 'success',
  import_voided: 'default',
};

interface StatusPillProps {
  status: TimesheetRowDisplayStatus;
  /** When set, click on a `draft` or `submitted` pill fires this
   *  handler. Used to approve entries from the grid without a separate
   *  bulk-select UI. Non-approvable statuses ignore the click. */
  onApprove?: () => void;
  /** When set, click on an `approved` pill fires this handler — flips
   *  the row back to `draft` so it falls out of the next Submit-to-
   *  Everee batch. Powers the recruiter workflow of "approved-all then
   *  noticed a zero-hour row that shouldn't ship". `sent_to_everee` /
   *  `paid` rows are NOT clickable — those need the adjustment path. */
  onRevert?: () => void;
  /** Loading flag while the approve callable is in flight. */
  approving?: boolean;
  /** Loading flag while the revert callable is in flight. */
  reverting?: boolean;
  /** When `status === 'error'`, the precise reason from `entry.everee.errorMessage`
   *  — surfaced in the tooltip so the recruiter knows WHY it failed without
   *  having to re-open the submit modal. */
  errorMessage?: string;
  /** Optional short code (`missing_workers_comp_code`, `submission_failed`, etc.)
   *  shown before the message for quick scanning. */
  errorCode?: string;
}

const StatusPill: React.FC<StatusPillProps> = ({
  status,
  onApprove,
  onRevert,
  approving,
  reverting,
  errorMessage,
  errorCode,
}) => {
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
  // Allow re-approving an `error` row — the pre-flight stamps this
  // status when the underlying data was missing (WC code, worker
  // linkage, etc.); once the recruiter fixes it, one click flips back
  // to approved so the next batch picks it up. The server callable's
  // APPROVABLE_STATUSES allows the same transition.
  const isApprovable =
    (status === 'draft' || status === 'submitted' || status === 'error') && !!onApprove;
  // Allow flipping an `approved` row back to `draft`. Symmetric with
  // approve — anyone allowed to approve is allowed to undo it. Stops
  // at `approved`: once a row is `sent_to_everee` / `paid` it's money
  // in flight and needs the adjustment path, not a status flip.
  const isRevertable = status === 'approved' && !!onRevert;

  const clickHandler = isApprovable ? onApprove : isRevertable ? onRevert : undefined;
  const clickable = isApprovable || isRevertable;

  let label: string;
  if (approving) label = 'Approving…';
  else if (reverting) label = 'Reverting…';
  else label = STATUS_LABELS[status];

  let tooltip = '';
  if (isApprovable) {
    if (status === 'error') {
      const reason = errorMessage
        ? `Reason: ${errorCode ? `[${errorCode}] ` : ''}${errorMessage}`
        : null;
      const retroNote =
        'Retroactive shifts (>10d old) are auto-sent with correction-authorized, so re-submission of a stuck older entry should succeed once the underlying data is fixed.';
      tooltip = [
        reason,
        'Click to retry — re-approves this entry so the next batch picks it up.',
        retroNote,
      ]
        .filter(Boolean)
        .join('\n\n');
    } else {
      tooltip = 'Click to approve this entry (required before submit to Everee).';
    }
  } else if (isRevertable) {
    tooltip =
      'Click to revert to draft — pulls this row out of the next Everee batch (useful for 0-hour rows that shouldn\'t ship).';
  }

  return (
    <Tooltip
      title={tooltip}
      // Multi-line tooltip for the error case — pre-wrap keeps the line breaks
      // and bumps the max-width so the precise error message isn't clipped.
      slotProps={{
        tooltip: {
          sx: {
            whiteSpace: 'pre-wrap',
            maxWidth: status === 'error' && errorMessage ? 480 : undefined,
          },
        },
      }}
    >
      <Chip
        size="small"
        color={STATUS_COLORS[status]}
        variant="filled"
        label={label}
        onClick={clickable ? clickHandler : undefined}
        clickable={clickable}
        sx={{
          cursor: clickable ? 'pointer' : 'default',
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
  /** Fired when the user clicks an `approved` Status pill. Calls the
   *  revert callable; on success the row's status flips back to
   *  `draft` and the SubmitBatchToEveree button drops it from the
   *  count. */
  onRevertEntry: (entryId: string) => Promise<void>;
  /** True while a revert callable is in flight for THIS entry. */
  revertingThisEntry: boolean;
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

const WorkerSiteCell: React.FC<{
  row: TimesheetGridRow;
  action?: React.ReactNode;
  /** Optional inline action rendered next to the worksite line (e.g. an
   *  import row's "set worksite" pencil). */
  worksiteAction?: React.ReactNode;
}> = ({ row, action, worksiteAction }) => (
  <TableCell>
    <Stack direction="row" spacing={0.25} alignItems="center">
      <Typography variant="body2" fontWeight={600}>
        {row.assignment.workerDisplayName ?? row.assignment.candidateId}
      </Typography>
      {action}
    </Stack>
    <Stack direction="row" spacing={0.25} alignItems="center">
      {row.assignment.worksiteDisplayName ? (
        <Typography variant="caption" color="text.secondary">
          {row.assignment.worksiteDisplayName}
          {row.assignment.worksiteState ? ` · ${row.assignment.worksiteState}` : ''}
        </Typography>
      ) : row.assignment.worksiteState ? (
        <Typography variant="caption" color="text.secondary">
          {row.assignment.worksiteState}
        </Typography>
      ) : (
        worksiteAction ? (
          <Typography variant="caption" color="text.disabled">
            No worksite
          </Typography>
        ) : null
      )}
      {worksiteAction}
    </Stack>
  </TableCell>
);

const ScheduledCell: React.FC<{ row: TimesheetGridRow }> = ({ row }) => (
  <TableCell>
    {row.assignment.isOpenShift ? (
      // Open shift: no fixed schedule — the recruiter enters total hours
      // manually, so there's no scheduled start/end to show.
      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        Open · enter hours
      </Typography>
    ) : (
      <>
        {row.scheduled.startTime}–{row.scheduled.endTime}
        {row.scheduled.breakMinutes > 0 ? (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            ({row.scheduled.breakMinutes}m brk)
          </Typography>
        ) : null}
      </>
    )}
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
          Pay rate / WC Code / WC Rate / Total — 10 columns. Bumped from
          8 → 10 when the WC Code + WC Rate columns were added, so the
          "+ Add entry" link block still spans correctly to the Status cell. */}
      <TableCell colSpan={10}>
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
 * Import-row renderer (CSV-import entry; READ-ONLY in the grid — the
 * recruiter resolves/fixes/submits these in the Import CSV tab, which owns
 * the worker-lookup + rate + WC tooling. The grid shows them so paid AND
 * blocked import rows are visible and never lost.)
 * ------------------------------------------------------------------------- */

const ImportRow: React.FC<{
  row: Extract<TimesheetGridRow, { kind: 'entry' }>;
  status: TimesheetRowDisplayStatus;
  actualHrs: number;
  tenantId?: string;
  hiringEntityId?: string | null;
  refreshEntry: (entryId: string) => void;
  /** Full grid reload — needed after a worker reassign because the entry's
   *  synthetic doc id changes (keyed by worker), so a single-entry refresh
   *  can't find the moved row. */
  reloadAll: () => void;
}> = ({ row, status, actualHrs, tenantId, hiringEntityId, refreshEntry, reloadAll }) => {
  const imp = row.entry.import;
  const payRate = typeof row.entry.payRate === 'number' ? row.entry.payRate : 0;
  const wcCode = row.resolvedWorkersCompCode ?? imp?.workersCompCode ?? null;
  // Fall back to the import sidecar (mirrors the wcCode fallback above) so an
  // inline WC edit shows immediately — refreshEntry refetches the entry but
  // doesn't re-run the resolver's WC chain, leaving resolvedWorkersCompRate
  // stale until a full reload.
  const wcRate =
    row.resolvedWorkersCompRate ??
    (typeof imp?.workersCompRate === 'number' ? imp.workersCompRate : undefined);
  const blocked = imp?.matchStatus === 'blocked';
  // Rows live in Everee (submitted/paid) are frozen — no WC edit, no reassign.
  const live = imp?.matchStatus === 'submitted' || imp?.matchStatus === 'paid';
  // WC is editable inline here (writes straight to the entry via the same
  // callable the regular grid uses); everything else is resolved/fixed in the
  // Import CSV tab.
  const wcEditable = !!tenantId && !live;
  const canReassign = !!tenantId && !!hiringEntityId && !live;
  const hoursEditable = !!tenantId && !live;
  const worksiteEditable = !!tenantId && !live;
  const deletable = !!tenantId && !live;
  const [wcDialogOpen, setWcDialogOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [worksitePickerOpen, setWorksitePickerOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // Delete an import row (e.g. a blocked worker who won't be onboarded). Live
  // rows are refused server-side — void them first.
  const doDelete = React.useCallback(async () => {
    if (!tenantId) return;
    setDeleting(true);
    try {
      const fn = httpsCallable<{ tenantId: string; entryId: string }, { ok: true }>(
        functions,
        'deleteImportEntry',
        { timeout: 60000 },
      );
      await fn({ tenantId, entryId: row.entry.id });
      setDeleteOpen(false);
      reloadAll();
    } catch (e) {
      console.error('deleteImportEntry failed:', e);
    } finally {
      setDeleting(false);
    }
  }, [tenantId, row.entry.id, reloadAll]);

  // Edit actual hours (e.g. zero out a day already covered by an advance).
  // A server callable keeps actualHoursOverride + totalRegularHours in sync —
  // the rules client-allowlist permits only the former, and submit reads the
  // override with a fallback to the total, so they must move together.
  const saveHours = React.useCallback(
    async (value: number | null) => {
      if (!tenantId) return;
      const fn = httpsCallable<{ tenantId: string; entryId: string; hours: number }, { ok: true }>(
        functions,
        'setImportEntryHours',
        { timeout: 60000 },
      );
      await fn({ tenantId, entryId: row.entry.id, hours: value ?? 0 });
      await refreshEntry(row.entry.id);
    },
    [tenantId, row.entry.id, refreshEntry],
  );

  // Edit pay rate inline (resolves a "needs rate" row). Server-side because
  // payRate isn't client-writable and setting it recomputes the import
  // lifecycle (needs_rate → needs_wc / ready).
  const savePayRate = React.useCallback(
    async (value: number) => {
      if (!tenantId) return;
      const fn = httpsCallable<{ tenantId: string; entryId: string; payRate: number }, { ok: true }>(
        functions,
        'setImportEntryPayRate',
        { timeout: 60000 },
      );
      await fn({ tenantId, entryId: row.entry.id, payRate: value });
      await refreshEntry(row.entry.id);
    },
    [tenantId, row.entry.id, refreshEntry],
  );
  const wcCellSx = {
    fontVariantNumeric: 'tabular-nums' as const,
    cursor: wcEditable ? 'pointer' : 'default',
    color: wcCode ? 'text.primary' : 'text.disabled',
    '&:hover': wcEditable ? { backgroundColor: 'action.hover' } : undefined,
  };
  return (
    <TableRow hover sx={{ backgroundColor: blocked ? 'warning.50' : 'action.hover' }}>
      <WorkerSiteCell
        row={row}
        action={
          canReassign ? (
            <Tooltip title="Change / fix the matched HRX worker">
              <IconButton size="small" onClick={() => setPickerOpen(true)} sx={{ p: 0.25 }}>
                <EditIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
        worksiteAction={
          worksiteEditable ? (
            <Tooltip title="Set the worksite (account → location). Everee validates the WC code against the worksite's state.">
              <IconButton size="small" onClick={() => setWorksitePickerOpen(true)} sx={{ p: 0.25 }}>
                <EditIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
      <TableCell>{row.workDate}</TableCell>
      <TableCell>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Imported
        </Typography>
      </TableCell>
      <TableCell align="right">—</TableCell>
      <TableCell>
        {blocked && imp?.blockReason ? (
          <Typography variant="caption" color="warning.main">
            {imp.blockReason}
          </Typography>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>—</TableCell>
      <TableCell align="right">
        {hoursEditable ? (
          <HoursOverrideCell
            value={actualHrs}
            onSave={saveHours}
            ariaLabel="Imported actual hours"
          />
        ) : (
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {actualHrs > 0 ? formatHours(actualHrs) : '—'}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">—</TableCell>
      <TableCell align="right">—</TableCell>
      <TableCell>{imp?.csvSite || '—'}</TableCell>
      <TableCell align="right">
        {hoursEditable ? (
          <NumberCell
            value={payRate > 0 ? payRate : null}
            onSave={savePayRate}
            validate={validatePayRate}
            emptyDisplay="+ rate"
            ariaLabel="Imported pay rate"
          />
        ) : payRate > 0 ? (
          formatMoney(payRate)
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell
        align="right"
        onClick={() => wcEditable && setWcDialogOpen(true)}
        sx={{ ...wcCellSx, fontFamily: 'monospace' }}
      >
        {wcCode || (wcEditable ? '+ WC' : '—')}
      </TableCell>
      <TableCell align="right" onClick={() => wcEditable && setWcDialogOpen(true)} sx={wcCellSx}>
        {typeof wcRate === 'number' ? wcRate.toFixed(2) : '—'}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {payRate > 0 && actualHrs > 0 ? formatMoney(actualHrs * payRate) : '—'}
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title="Imported from a CSV timesheet — resolve / submit in the Import CSV tab (WC is editable here).">
            <span>
              <StatusPill status={status} />
            </span>
          </Tooltip>
          {deletable && (
            <Tooltip title="Delete this imported row">
              <IconButton size="small" onClick={() => setDeleteOpen(true)} sx={{ p: 0.25 }}>
                <DeleteIcon sx={{ fontSize: 16 }} color="action" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </TableCell>
      {tenantId && (
        <EditWorkersCompDialog
          open={wcDialogOpen}
          onClose={() => setWcDialogOpen(false)}
          onSuccess={() => {
            setWcDialogOpen(false);
            refreshEntry(row.entry.id);
          }}
          tenantId={tenantId}
          entryId={row.entry.id}
          initialCode={wcCode}
          initialRate={wcRate}
          rowLabel={`${row.assignment.workerDisplayName ?? ''} · ${row.workDate}`.trim()}
        />
      )}
      {tenantId && hiringEntityId && (
        <ImportRowWorkerPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onReassigned={() => {
            setPickerOpen(false);
            // The doc id moved (keyed by worker) — reload the whole grid.
            reloadAll();
          }}
          tenantId={tenantId}
          hiringEntityId={hiringEntityId}
          entryId={row.entry.id}
          csvWorkerName={imp?.csvWorkerName ?? null}
          currentWorkerName={row.assignment.workerDisplayName ?? null}
        />
      )}
      {tenantId && (
        <ImportRowWorksitePicker
          open={worksitePickerOpen}
          onClose={() => setWorksitePickerOpen(false)}
          onSaved={() => {
            setWorksitePickerOpen(false);
            refreshEntry(row.entry.id);
          }}
          tenantId={tenantId}
          entryId={row.entry.id}
          currentWorksiteName={row.assignment.worksiteDisplayName ?? imp?.csvSite ?? null}
        />
      )}
      <Dialog open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete imported row?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove the imported timesheet row for{' '}
            <strong>{row.assignment.workerDisplayName ?? imp?.csvWorkerName ?? 'this worker'}</strong>{' '}
            on <strong>{row.workDate}</strong>? This deletes it from HRX. It won't affect Everee
            (this row isn't submitted).
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={doDelete}
            disabled={deleting}
            color="error"
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
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
  onRevertEntry,
  revertingThisEntry,
}) => {
  const editor = useTimesheetEntryEditor({
    tenantId,
    entry,
    mergeEntryUpdate,
    refreshEntry,
  });
  const { fieldHandlers, readOnly } = editor;

  // WC Code / Rate dialog state — opens on click of either WC cell.
  const [wcDialogOpen, setWcDialogOpen] = React.useState(false);

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
          The override field is ALWAYS editable. The trigger honors
          `actualHoursOverride` whenever it's set — regardless of
          whether start/end times are also set — so the Total column
          stays in lockstep with whatever the recruiter sees here.
          When the override is empty AND both start/end are filled,
          the computed value from the recompute trigger renders as
          the input's placeholder so the cell still shows the value
          that will be paid. (Previously the override cell was hidden
          whenever start was set, which trapped users whose start time
          had a stale or partial value — see the 2026-05-29 incident.) */}
      <TableCell align="right">
        <HoursOverrideCell
          value={entry.actualHoursOverride ?? null}
          onSave={fieldHandlers.actualHoursOverride}
          disabled={readOnly}
          ariaLabel="Actual hours"
          placeholder={
            entry.actualHoursOverride == null &&
            entry.actualStartTime &&
            entry.actualEndTime
              ? formatHours(actualHrs)
              : undefined
          }
        />
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
      {/* WC Code + WC Rate (2026-06-03). Click either cell to open the
          edit dialog. Resolved values come from
          `row.resolvedWorkersCompCode` / `row.resolvedWorkersCompRate`
          which the resolver computes via entry override → shift → JO →
          positions. Override cells are bolded so the recruiter can spot
          per-entry overrides at a glance. */}
      <TableCell
        align="right"
        onClick={() => !readOnly && setWcDialogOpen(true)}
        sx={{
          fontVariantNumeric: 'tabular-nums',
          cursor: readOnly ? 'default' : 'pointer',
          color: row.resolvedWorkersCompCode ? 'text.primary' : 'text.disabled',
          fontWeight: row.hasEntryWorkersCompOverride ? 700 : 400,
          '&:hover': readOnly
            ? undefined
            : { backgroundColor: 'action.hover' },
        }}
      >
        {row.resolvedWorkersCompCode ?? '—'}
      </TableCell>
      <TableCell
        align="right"
        onClick={() => !readOnly && setWcDialogOpen(true)}
        sx={{
          fontVariantNumeric: 'tabular-nums',
          cursor: readOnly ? 'default' : 'pointer',
          color: row.resolvedWorkersCompRate != null ? 'text.primary' : 'text.disabled',
          fontWeight: row.hasEntryWorkersCompOverride ? 700 : 400,
          '&:hover': readOnly
            ? undefined
            : { backgroundColor: 'action.hover' },
        }}
      >
        {row.resolvedWorkersCompRate != null
          ? row.resolvedWorkersCompRate.toFixed(2)
          : '—'}
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
          onRevert={() => void onRevertEntry(entry.id)}
          reverting={revertingThisEntry}
          errorMessage={(entry as any).everee?.errorMessage as string | undefined}
          errorCode={(entry as any).everee?.errorCode as string | undefined}
        />
      </TableCell>
      {/* Workers' Comp edit dialog — mounted inside the row so dialog
          state lives per-row. Renders nothing when closed. */}
      {tenantId && (
        <EditWorkersCompDialog
          open={wcDialogOpen}
          onClose={() => setWcDialogOpen(false)}
          onSuccess={() => {
            setWcDialogOpen(false);
            // Re-resolve so the row picks up the new override (and the
            // shift back-fill propagates to siblings on next render).
            void refreshEntry(entry.id);
          }}
          tenantId={tenantId}
          entryId={entry.id}
          initialCode={row.resolvedWorkersCompCode}
          initialRate={row.resolvedWorkersCompRate}
          rowLabel={`${row.assignment.workerDisplayName ?? ''} · ${row.workDate}`.trim()}
        />
      )}
    </TableRow>
  );
};

/* -------------------------------------------------------------------------
 * Top-level component
 * ------------------------------------------------------------------------- */

export const TimesheetGrid: React.FC<TimesheetGridProps> = ({
  filter,
  refreshSignal,
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

  // External refresh trigger — bump `refreshSignal` from the parent to
  // re-resolve rows without remounting. Used after the Add Worker modal
  // submits so the new per-day assignment rows appear without flickering
  // the filter bar or losing scroll position.
  React.useEffect(() => {
    if (refreshSignal === undefined) return;
    // Skip the initial mount; only react to subsequent bumps. (The
    // first paint already resolves via the hook's own initial effect.)
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

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

  // Import rows are entity-anchored — only the `entity_period` filter surfaces
  // them, and that's the only scope where reassign + import-submit make sense.
  const importHiringEntityId =
    filter?.kind === 'entity_period' ? filter.hiringEntityId : null;

  // Sortable columns. Default mirrors the resolver's worker-name ordering.
  type GridSortKey = 'worker' | 'notes';
  const [sortBy, setSortBy] = useState<GridSortKey>('worker');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: GridSortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };
  const sortedRows = useMemo(() => {
    const workerKey = (r: TimesheetGridRow) =>
      (r.assignment.workerDisplayName ?? r.assignment.candidateId ?? '').toLowerCase();
    const notesKey = (r: TimesheetGridRow) => {
      if (r.kind !== 'entry') return '';
      // Notes column shows the worksite line for import rows, the entry note
      // otherwise — sort by whatever's actually displayed.
      return (r.isImport ? r.entry.import?.csvSite ?? '' : r.entry.notes ?? '').toLowerCase();
    };
    const primary = sortBy === 'worker' ? workerKey : notesKey;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const pa = primary(a);
      const pb = primary(b);
      if (pa !== pb) return pa < pb ? -dir : dir;
      // Stable, readable tiebreak: worker then work date.
      const wa = workerKey(a);
      const wb = workerKey(b);
      if (wa !== wb) return wa < wb ? -1 : 1;
      return a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0;
    });
  }, [rows, sortBy, sortDir]);

  // Status filter — narrows the rendered rows to one display status (e.g. show
  // only blocked import rows for cleanup). 'all' = no filter.
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const displayedRows = useMemo(
    () =>
      statusFilter === 'all'
        ? sortedRows
        : sortedRows.filter((r) => displayStatusForRow(r) === statusFilter),
    [sortedRows, statusFilter],
  );
  // Options offered: the import lifecycle (the managed surface) + the common
  // scheduled statuses. Built from STATUS_LABELS so labels stay in sync.
  const STATUS_FILTER_OPTIONS: TimesheetRowDisplayStatus[] = [
    'import_blocked',
    'import_needs_rate',
    'import_needs_wc',
    'import_ready',
    'import_submitted',
    'import_paid',
    'draft',
    'approved',
    'sent_to_everee',
    'paid',
  ];

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

  /* -------------------------------------------------------------------
   * Revert action (per-row click on the approved status pill).
   *
   * Symmetric with handleApproveEntry — flips `approved` back to
   * `draft` so 0-hour or otherwise-bogus rows can be pulled out of
   * the Submit-to-Everee queue without leaving the page.
   * ------------------------------------------------------------------- */
  const [revertingEntryIds, setRevertingEntryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const handleRevertEntry = useCallback(
    async (entryId: string) => {
      if (!tenantId) return;
      setRevertingEntryIds((prev) => {
        if (prev.has(entryId)) return prev;
        const next = new Set(prev);
        next.add(entryId);
        return next;
      });
      try {
        const res = await revertTimesheetEntriesToDraft({
          tenantId,
          entryIds: [entryId],
        });
        if (res.reverted > 0) {
          // Local-merge so SubmitBatchToEvereeButton's count drops
          // immediately, without waiting for the resolver refresh.
          mergeEntryUpdate(entryId, { status: 'draft' });
        }
        // If the server skipped it (already draft, or sent_to_everee),
        // the next refresh will reflect reality — no UI rollback needed.
      } catch (err) {
        console.error('[TimesheetGrid] revert failed', { entryId, err });
      } finally {
        setRevertingEntryIds((prev) => {
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
          mergeEntryUpdate={mergeEntryUpdate}
        />

        {/* Imported (CSV) rows submit to Everee on their own track — separate
            from the approved scheduled-entry batch above. Shows only when this
            entity view holds Ready import rows. */}
        <ImportGridSubmitBar
          rows={rows}
          tenantId={tenantId}
          hiringEntityId={importHiringEntityId}
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

        {!loading && rows.length > 0 ? (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="ts-status-filter-label">Status</InputLabel>
              <Select
                labelId="ts-status-filter-label"
                label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(String(e.target.value))}
              >
                <MenuItem value="all">All statuses</MenuItem>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {STATUS_LABELS[s] ?? s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {statusFilter !== 'all' && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {displayedRows.length} of {rows.length} rows
                </Typography>
                <Button size="small" onClick={() => setStatusFilter('all')} sx={{ textTransform: 'none' }}>
                  Clear
                </Button>
              </>
            )}
          </Stack>
        ) : null}

        {loading ? (
          <LoadingState filter={filter} />
        ) : rows.length === 0 && !error ? (
          <NoRowsState
            filter={filter}
            consideredAssignmentCount={consideredAssignmentCount}
          />
        ) : displayedRows.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary" align="center">
              No rows match the “{STATUS_LABELS[statusFilter as TimesheetRowDisplayStatus] ?? statusFilter}” status filter.
            </Typography>
          </Paper>
        ) : (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sortDirection={sortBy === 'worker' ? sortDir : false}>
                      <TableSortLabel
                        active={sortBy === 'worker'}
                        direction={sortBy === 'worker' ? sortDir : 'asc'}
                        onClick={() => toggleSort('worker')}
                      >
                        Worker
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Work date</TableCell>
                    <TableCell>Scheduled</TableCell>
                    <TableCell align="right">Sched hrs</TableCell>
                    <TableCell>Actual</TableCell>
                    <TableCell>Breaks</TableCell>
                    <TableCell align="right">Actual hrs</TableCell>
                    <TableCell align="right">Tips</TableCell>
                    <TableCell align="right">Bonus</TableCell>
                    <TableCell sortDirection={sortBy === 'notes' ? sortDir : false}>
                      <TableSortLabel
                        active={sortBy === 'notes'}
                        direction={sortBy === 'notes' ? sortDir : 'asc'}
                        onClick={() => toggleSort('notes')}
                      >
                        Notes
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">Pay rate</TableCell>
                    {/* WC code / rate (2026-06-03). Read display sourced
                        from the resolver's resolution chain; click to
                        open the edit dialog (entry override + shift
                        back-fill). */}
                    <TableCell align="right">WC Code</TableCell>
                    <TableCell align="right">WC Rate</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {displayedRows.map((row) => {
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

                    // CSV-import rows are read-only here — resolved/submitted
                    // in the Import CSV tab; the grid just surfaces them.
                    if (row.kind === 'entry' && row.isImport) {
                      return (
                        <ImportRow
                          key={row.key}
                          row={row}
                          status={status}
                          actualHrs={actualHrs}
                          tenantId={tenantId}
                          hiringEntityId={importHiringEntityId}
                          refreshEntry={refreshEntry}
                          reloadAll={refresh}
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
                        onRevertEntry={handleRevertEntry}
                        revertingThisEntry={revertingEntryIds.has(row.entry.id)}
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
