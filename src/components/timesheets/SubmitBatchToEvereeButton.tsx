/**
 * **SubmitBatchToEvereeButton** — the recruiter unlock for Slice 6b.
 *
 * Lives in `TimesheetTotalsHeader`. Enabled when the current filter
 * has ≥1 entry with status='approved'. Click opens a confirmation
 * dialog summarizing what's about to happen; confirm calls
 * `createTimesheetBatch` then `submitTimesheetBatch` in sequence:
 *
 *   1. createTimesheetBatch → server validates each entryId
 *      (exists + right entity + status='approved'), writes the
 *      `timesheet_batches` doc with status='pending', returns batchId.
 *   2. submitTimesheetBatch(batchId) → server pre-flights worker
 *      context + epoch conversion + work-location resolution, fans
 *      out one Cloud Task per entry, returns immediately.
 *   3. UI shows toast with the batch result (enqueued + pre-flight
 *      error count).
 *
 * The orchestrator's progress thereafter is observable via the
 * batch doc's `_orchestrator.pendingTaskCount` + the per-entry
 * `everee.status` fields; a richer "batch in flight" panel is
 * deferred to a follow-up slice.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import {
  createTimesheetBatch,
  submitTimesheetBatch,
  type CreateTimesheetBatchScope,
} from '../../services/timesheets/timesheetBatchCallables';
import type { TimesheetFilter } from '../../types/recruiter/timesheet';
import { entryHasRecruiterData, type TimesheetGridRow } from './timesheetGridResolver';

/** One row in the modal's per-entry error list — populated after submit when
 *  pre-flight or the Everee POST returned errors. */
interface EntryErrorDetail {
  entryId: string;
  workerName: string;
  workDate: string;
  errorCode: string;
  errorMessage: string;
}

export interface SubmitBatchToEvereeButtonProps {
  tenantId: string | null | undefined;
  filter: TimesheetFilter | null;
  rows: TimesheetGridRow[];
  /** Optional — fires after a successful submit so the parent can
   *  refresh the grid (the 'approved' rows should flip to
   *  'sent_to_everee' as the orchestrator's worker tasks complete). */
  onSubmitted?: () => void;
  /**
   * Optional optimistic local-state merge. When provided, on submit
   * success we immediately stamp `status: 'sent_to_everee'` +
   * `sentToEvereeAt: serverTimestamp` on every submitted entry so the
   * grid reflects the new state without waiting for the live listener
   * to pick up the server-side write. Without this, the row sits on
   * `approved` for the few seconds it takes the worker tasks to fire
   * and the listener to fan-in, which made the recruiter wonder
   * whether the submit had really worked (2026-05-27 Greg report).
   */
  mergeEntryUpdate?: (
    entryId: string,
    patch: { status?: string; sentToEvereeAt?: unknown },
  ) => void;
}

interface ApprovedSummary {
  entryIds: string[];
  workerIds: Set<string>;
  totalRegularHours: number;
  totalOTHours: number;
  totalGrossPay: number;
}

/** One row the open-dialog verification pass dropped because its LIVE
 *  status is no longer 'approved' (2026-08-20 Greg+Mark simultaneous
 *  submits: the grid is a snapshot, so a dialog built from it can offer
 *  entries someone else already sent — the server rejects the whole
 *  batch and the error reads like a bug). */
interface DroppedEntry {
  entryId: string;
  workerName: string;
  workDate: string;
  status: string;
}

function summarizeApproved(rows: TimesheetGridRow[]): ApprovedSummary {
  const entryIds: string[] = [];
  const workerIds = new Set<string>();
  let totalRegularHours = 0;
  let totalOTHours = 0;
  let totalGrossPay = 0;
  for (const row of rows) {
    if (row.kind !== 'entry') continue;
    // CSV-import rows submit via the Import CSV tab's own Everee path.
    if (row.isImport || row.entry.source === 'csv_import') continue;
    if (row.entry.status !== 'approved') continue;
    // Defensive: skip approved-but-empty rows. The bulk-approve
    // affordance already filters these out, but a per-row pill click
    // can flip an empty row to approved (deliberate no-show). Don't
    // submit those — a $0 payable for $0 work is silly and wastes an
    // Everee shift create.
    if (!entryHasRecruiterData(row.entry)) continue;
    entryIds.push(row.entry.id);
    workerIds.add(row.assignment.workerId);
    totalRegularHours += Number(row.entry.totalRegularHours ?? 0);
    totalOTHours += Number(row.entry.totalOTHours ?? 0);
    const payRate = Number(row.entry.payRate ?? 0);
    const reg = Number(row.entry.totalRegularHours ?? 0);
    const ot = Number(row.entry.totalOTHours ?? 0);
    const dt = Number(row.entry.totalDoubleTimeHours ?? 0);
    // CA meal/rest-break penalty hours — paid at the regular rate as their
    // own premium payables (see composeTimesheetBatchPayloads.ts). Omitting
    // these made this preview under-count vs. what's actually submitted to
    // and paid by Everee (mirrors createTimesheetBatch.ts's server-side total).
    const meal = Number(row.entry.mealBreakPenaltyHours ?? 0);
    const rest = Number(row.entry.restBreakPenaltyHours ?? 0);
    const tips = Number(row.entry.tips ?? 0);
    const bonus = Number(row.entry.bonusAmount ?? 0);
    totalGrossPay +=
      reg * payRate + ot * payRate * 1.5 + dt * payRate * 2 + meal * payRate + rest * payRate + tips + bonus;
  }
  return { entryIds, workerIds, totalRegularHours, totalOTHours, totalGrossPay };
}

function filterToScope(filter: TimesheetFilter): CreateTimesheetBatchScope | null {
  if (filter.kind === 'entity_period') {
    return {
      kind: 'entity_period',
      periodStart: filter.periodStart,
      periodEnd: filter.periodEnd,
    };
  }
  if (filter.kind === 'shift') return { kind: 'shift', refId: filter.shiftId };
  if (filter.kind === 'jobOrder') {
    return {
      kind: 'jobOrder',
      refId: filter.jobOrderId,
      periodStart: filter.periodStart,
      periodEnd: filter.periodEnd,
    };
  }
  if (filter.kind === 'worker') {
    return {
      kind: 'worker',
      workerId: filter.workerId,
      periodStart: filter.periodStart,
      periodEnd: filter.periodEnd,
    };
  }
  return null;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}

const SubmitBatchToEvereeButton: React.FC<SubmitBatchToEvereeButtonProps> = ({
  tenantId,
  filter,
  rows,
  onSubmitted,
  mergeEntryUpdate,
}) => {
  const summary = useMemo(() => summarizeApproved(rows), [rows]);
  const approvedCount = summary.entryIds.length;
  const canSubmit = approvedCount > 0 && !!tenantId && !!filter;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Live re-check of the selection, run when the dialog opens. null while
   *  checking or if the check failed (then we fall back to the grid's
   *  summary and let the server validate). */
  const [verified, setVerified] = useState<ApprovedSummary | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [dropped, setDropped] = useState<DroppedEntry[]>([]);
  const [result, setResult] = useState<{
    batchId: string;
    enqueued: number;
    preflightErrors: number;
    errorDetails: EntryErrorDetail[];
  } | null>(null);

  const hiringEntityId = useMemo(() => {
    if (!filter) return '';
    if (filter.kind === 'entity_period') return filter.hiringEntityId;
    // Other filter kinds (shift / jobOrder / worker) don't carry an
    // entity directly. v1 of the button only supports entity_period
    // scope; the other shapes derive the entity server-side from the
    // matched entries (not implemented yet, deferred to a follow-up).
    return '';
  }, [filter]);

  const scope = useMemo<CreateTimesheetBatchScope | null>(() => {
    if (!filter) return null;
    return filterToScope(filter);
  }, [filter]);

  const tooltipText = !tenantId
    ? 'No active tenant.'
    : !filter
      ? 'Pick an entity and period first.'
      : !hiringEntityId
        ? 'Submit is only available for entity-scoped views in v1.'
        : approvedCount === 0
          ? 'No approved entries in the current view.'
          : `Submit ${approvedCount} approved ${approvedCount === 1 ? 'entry' : 'entries'} to Everee.`;

  /**
   * Re-fetch every candidate entry's CURRENT status when the dialog
   * opens, drop anything no longer 'approved' (already sent by the
   * other operator, flipped to error, un-approved…), and rebuild the
   * totals from live data. The server still validates on create — this
   * just stops simultaneous Greg+Mark submits from reading as errors.
   */
  const verifySelection = async (entryIds: string[]): Promise<void> => {
    if (!tenantId || entryIds.length === 0) return;
    setVerifying(true);
    setVerified(null);
    setDropped([]);
    try {
      const snaps = await Promise.all(
        entryIds.map((id) =>
          getDoc(doc(db, 'tenants', tenantId, 'timesheet_entries', id)).catch(() => null),
        ),
      );
      const fresh: ApprovedSummary = {
        entryIds: [],
        workerIds: new Set<string>(),
        totalRegularHours: 0,
        totalOTHours: 0,
        totalGrossPay: 0,
      };
      const droppedNow: DroppedEntry[] = [];
      for (let i = 0; i < snaps.length; i++) {
        const s = snaps[i];
        if (!s || !s.exists()) {
          droppedNow.push({ entryId: entryIds[i], workerName: '(unknown)', workDate: '', status: 'missing' });
          continue;
        }
        const ed = s.data() as any;
        const status = String(ed?.status ?? '');
        if (status !== 'approved') {
          droppedNow.push({
            entryId: entryIds[i],
            workerName: String(ed?.workerName || ed?.userName || ed?.workerId || '(unknown)'),
            workDate: String(ed?.workDate ?? ''),
            status,
          });
          // Heal the stale grid row too — the live state is authoritative.
          if (mergeEntryUpdate) mergeEntryUpdate(entryIds[i], { status });
          continue;
        }
        fresh.entryIds.push(entryIds[i]);
        if (ed?.workerId) fresh.workerIds.add(String(ed.workerId));
        const payRate = Number(ed?.payRate ?? 0);
        const reg = Number(ed?.totalRegularHours ?? 0);
        const ot = Number(ed?.totalOTHours ?? 0);
        const dt = Number(ed?.totalDoubleTimeHours ?? 0);
        const meal = Number(ed?.mealBreakPenaltyHours ?? 0);
        const rest = Number(ed?.restBreakPenaltyHours ?? 0);
        const tips = Number(ed?.tips ?? 0);
        const bonus = Number(ed?.bonusAmount ?? 0);
        fresh.totalRegularHours += reg;
        fresh.totalOTHours += ot;
        fresh.totalGrossPay +=
          reg * payRate + ot * payRate * 1.5 + dt * payRate * 2 + meal * payRate + rest * payRate + tips + bonus;
      }
      setVerified(fresh);
      setDropped(droppedNow);
    } catch {
      // Verification is best-effort — on failure the server-side
      // validation still protects; we just lose the nicer UX.
      setVerified(null);
      setDropped([]);
    } finally {
      setVerifying(false);
    }
  };

  const handleClickOpen = (): void => {
    setError(null);
    setResult(null);
    setDialogOpen(true);
    void verifySelection(summary.entryIds);
  };
  const handleClose = (): void => {
    if (submitting) return;
    setDialogOpen(false);
  };

  /** What actually submits: the live-verified subset when available,
   *  else the grid snapshot (server validates either way). */
  const active = verified ?? summary;

  const handleConfirm = async (): Promise<void> => {
    if (!tenantId || !filter || !scope || !hiringEntityId) return;
    if (active.entryIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // Step 1 — create the batch
      const createRes = await createTimesheetBatch({
        tenantId,
        hiringEntityId,
        entryIds: active.entryIds,
        scope,
      });
      const batchId = createRes.data.batchId;

      // Step 2 — kick the orchestrator
      const submitRes = await submitTimesheetBatch({ tenantId, batchId });

      // Step 3 — read back the per-entry errors so we can show the user the
      // ACTUAL reasons instead of the generic three-cause hint. Pre-flight
      // failures stamp `everee.errorCode` + `everee.errorMessage` on the
      // entry doc; post-flight Everee POST failures stamp the same fields
      // from `submitTimesheetEntryWorker`. We fan out a small batch of reads
      // and surface anything with an active error message.
      const errorDetails: EntryErrorDetail[] = [];
      const preflightErrors = submitRes.data.preflightErrorCount ?? 0;
      if (preflightErrors > 0 || submitRes.data.enqueuedEntryCount < active.entryIds.length) {
        const snaps = await Promise.all(
          active.entryIds.map((id) =>
            getDoc(doc(db, 'tenants', tenantId, 'timesheet_entries', id)).catch(() => null),
          ),
        );
        for (let i = 0; i < snaps.length; i++) {
          const s = snaps[i];
          if (!s || !s.exists()) continue;
          const ed = s.data() as any;
          const errMsg = ed?.everee?.errorMessage;
          const errCode = ed?.everee?.errorCode;
          // Show anything with an active error OR status=error that doesn't carry a message
          if (errMsg || errCode || ed?.status === 'error') {
            errorDetails.push({
              entryId: active.entryIds[i],
              workerName: ed?.workerName || ed?.userName || ed?.workerId || '(unknown worker)',
              workDate: ed?.workDate || '',
              errorCode: String(errCode || (ed?.status === 'error' ? 'error' : '')),
              errorMessage: String(
                errMsg ||
                  (ed?.status === 'error' ? 'Entry status is error — see logs for details.' : ''),
              ),
            });
          }
        }
      }
      setResult({
        batchId,
        enqueued: submitRes.data.enqueuedEntryCount,
        preflightErrors,
        errorDetails,
      });
      // Optimistic local merge — stamp `sent_to_everee` on every
      // submitted entry so the grid reflects the new state without
      // waiting for the per-entry worker tasks + live listener to
      // fan in. Server-side the actual flip happens inside
      // `submitTimesheetEntryWorker` (status: 'sent_to_everee' +
      // sentToEvereeAt), so this is just an early UI render of
      // what's about to land in Firestore anyway.
      if (mergeEntryUpdate) {
        for (const entryId of active.entryIds) {
          mergeEntryUpdate(entryId, { status: 'sent_to_everee' });
        }
      }
      if (onSubmitted) onSubmitted();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="contained"
        color="primary"
        startIcon={<CloudUploadIcon fontSize="small" />}
        disabled={!canSubmit || !hiringEntityId}
        onClick={handleClickOpen}
        title={tooltipText}
      >
        {approvedCount > 0
          ? `Submit ${approvedCount} to Everee`
          : 'Submit to Everee'}
      </Button>

      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Submit timesheet batch</DialogTitle>
        <DialogContent dividers>
          {!result && (
            <Stack spacing={2}>
              {verifying && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                    Confirming current entry statuses…
                  </Typography>
                </Stack>
              )}
              {dropped.length > 0 && (
                <Alert severity="info">
                  <Typography variant="caption">
                    <strong>{dropped.length}</strong> entr{dropped.length === 1 ? 'y' : 'ies'} changed
                    since this page loaded and {dropped.length === 1 ? 'was' : 'were'} excluded
                    {(() => {
                      const byStatus = new Map<string, number>();
                      for (const d of dropped) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
                      return ` (${Array.from(byStatus.entries())
                        .map(([s, n]) => `${n} ${s === 'sent_to_everee' ? 'already submitted' : s}`)
                        .join(', ')})`;
                    })()}
                    . Usually this means the other operator just submitted them. The totals below
                    are only what will actually submit.
                  </Typography>
                </Alert>
              )}
              <Typography variant="body2">
                You&apos;re about to submit <strong>{active.entryIds.length}</strong> approved
                {' '}entr{active.entryIds.length === 1 ? 'y' : 'ies'} to Everee for payment processing.
              </Typography>
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  backgroundColor: 'background.default',
                }}
              >
                <Stack spacing={0.5}>
                  <SummaryLine label="Workers" value={String(active.workerIds.size)} />
                  <SummaryLine
                    label="Regular hours"
                    value={active.totalRegularHours.toFixed(2)}
                  />
                  <SummaryLine label="OT hours" value={active.totalOTHours.toFixed(2)} />
                  <Divider sx={{ my: 0.5 }} />
                  <SummaryLine
                    label="Approx gross pay"
                    value={formatMoney(active.totalGrossPay)}
                  />
                </Stack>
              </Box>
              {!verifying && active.entryIds.length === 0 && (
                <Alert severity="warning">
                  <Typography variant="caption">
                    Nothing left to submit — every selected entry has already been submitted or
                    changed status. Close this dialog; the grid has been updated.
                  </Typography>
                </Alert>
              )}
              <Alert severity="info">
                <Typography variant="caption">
                  Once submitted, entries flip to <strong>sent_to_everee</strong> and become
                  read-only until the pay run completes. Per-entry errors (missing work-comp
                  code, no Everee linkage, etc.) get stamped on the entry without aborting
                  the rest of the batch.
                </Typography>
              </Alert>
              {error && (
                <Alert severity="error" onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
            </Stack>
          )}

          {result && (
            <Stack spacing={2}>
              <Alert severity={result.preflightErrors > 0 ? 'warning' : 'success'}>
                Batch <code>{result.batchId.slice(0, 12)}…</code> created.
                {' '}<strong>{result.enqueued}</strong>{' '}
                entr{result.enqueued === 1 ? 'y' : 'ies'} sent to the orchestrator.
                {result.preflightErrors > 0 && (
                  <>
                    {' '}<strong>{result.preflightErrors}</strong> pre-flight error
                    {result.preflightErrors === 1 ? '' : 's'}.
                  </>
                )}
              </Alert>
              {result.errorDetails.length > 0 && (
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'warning.light',
                    borderRadius: 1,
                    bgcolor: 'warning.50',
                    p: 1.5,
                    maxHeight: 280,
                    overflow: 'auto',
                  }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Errors by entry
                  </Typography>
                  <Stack spacing={1.25}>
                    {result.errorDetails.map((e) => (
                      <Box key={e.entryId} sx={{ fontSize: 13, lineHeight: 1.4 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {e.workerName}
                          {e.workDate ? ` · ${e.workDate}` : ''}
                          {e.errorCode ? ` · ${e.errorCode}` : ''}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {e.errorMessage}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
              {result.errorDetails.length === 0 && result.preflightErrors === 0 && (
                <Typography variant="caption" color="text.secondary">
                  All entries enqueued. The orchestrator will flip each to{' '}
                  <code>sent_to_everee</code> as the per-worker tasks complete; the
                  reconciler will pick up <code>paid</code> once Everee finishes the pay
                  run.
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {!result && (
            <>
              <Button onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                variant="contained"
                color="primary"
                disabled={
                  submitting || verifying || !canSubmit || !hiringEntityId || active.entryIds.length === 0
                }
                startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {submitting
                  ? 'Submitting…'
                  : verifying
                    ? 'Checking…'
                    : `Submit ${active.entryIds.length > 0 ? active.entryIds.length + ' ' : ''}to Everee`}
              </Button>
            </>
          )}
          {result && (
            <Button onClick={handleClose} variant="contained">
              Close
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SubmitBatchToEvereeButton;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SummaryLine: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Stack direction="row" spacing={1} justifyContent="space-between">
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={600}>
      {value}
    </Typography>
  </Stack>
);
