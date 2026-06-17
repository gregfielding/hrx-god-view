/**
 * ImportGridSubmitBar — submit CSV-import rows to Everee from the Timesheet
 * Grid (not just the Import CSV tab).
 *
 * Import rows persist as canonical `timesheet_entries`, so the Grid can submit
 * the "Ready" ones directly: it rebuilds the same `SubmitRow` payload the
 * Import tab sends (worker + date + hours + pay + WC + worksite, all already on
 * the entry) and calls the SAME `submitImportTimesheetBatch` callable — dry-run
 * preview, then live. Rows are grouped by their source customer (one Everee
 * call per customer) since the callable keys idempotency on customer.
 *
 * This runs on its OWN track, distinct from `SubmitBatchToEvereeButton` (which
 * ships approved SCHEDULED entries via a different callable). Shows only in the
 * entity-wide view, and only when there are Ready import rows in scope.
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
  Stack,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import type { TimesheetGridRow } from './timesheetGridResolver';

interface SubmitRow {
  userId: string;
  workDate: string;
  hours: number;
  payRate: number;
  workerName?: string;
  eventLabel?: string | null;
  workersCompCode?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
}

interface SubmitResponse {
  dryRun?: boolean;
  workerType?: string;
  evereeClassifiesOt?: boolean;
  count?: number;
  skipped?: number;
  skippedNoWc?: number;
  totalAmount?: number;
  submitted?: number;
  failed?: number;
  errors?: string[];
}

export interface ImportGridSubmitBarProps {
  rows: TimesheetGridRow[];
  tenantId?: string | null;
  hiringEntityId?: string | null;
  onSubmitted?: () => void;
}

const submitCallable = () =>
  httpsCallable<
    {
      tenantId: string;
      hiringEntityId: string;
      customer: string;
      dryRun: boolean;
      rows: SubmitRow[];
    },
    SubmitResponse
  >(functions, 'submitImportTimesheetBatch', { timeout: 300000 });

/** Build the Everee `SubmitRow` for one Ready import grid row. Every field is
 *  already resolved on the entry / its import sidecar. */
function rowToSubmit(r: Extract<TimesheetGridRow, { kind: 'entry' }>): SubmitRow {
  const e = r.entry;
  const imp = e.import || ({} as NonNullable<typeof e.import>);
  const hours = Number(e.actualHoursOverride ?? e.totalRegularHours ?? 0);
  return {
    userId: e.workerId || '',
    workDate: e.workDate,
    hours,
    payRate: Number(e.payRate ?? 0),
    workerName: imp.csvWorkerName ?? r.assignment.workerDisplayName ?? '',
    eventLabel: imp.csvSite ?? null,
    // resolvedWorkersCompCode already folds in the entry's own override.
    workersCompCode: r.resolvedWorkersCompCode ?? imp.workersCompCode ?? null,
    worksiteId: imp.worksiteId ?? null,
    worksiteName: imp.worksiteName ?? null,
    worksiteAddress: imp.worksiteAddress ?? null,
  };
}

const ImportGridSubmitBar: React.FC<ImportGridSubmitBarProps> = ({
  rows,
  tenantId,
  hiringEntityId,
  onSubmitted,
}) => {
  // Ready import rows, grouped by source customer (one Everee call each).
  const byCustomer = useMemo(() => {
    const m = new Map<string, Array<Extract<TimesheetGridRow, { kind: 'entry' }>>>();
    for (const r of rows) {
      if (r.kind !== 'entry' || !r.isImport) continue;
      if (r.entry.import?.matchStatus !== 'ready') continue;
      if (!r.entry.workerId) continue; // unmatched — can't submit
      // Zeroed-out rows (e.g. paid via an advance) are skipped server-side;
      // exclude them here too so the count reflects what will actually send.
      const hrs = Number(r.entry.actualHoursOverride ?? r.entry.totalRegularHours ?? 0);
      if (!(hrs > 0)) continue;
      const cust = String(r.entry.import?.customer || 'import').trim();
      const list = m.get(cust) ?? [];
      list.push(r);
      m.set(cust, list);
    }
    return m;
  }, [rows]);

  const readyCount = useMemo(
    () => [...byCustomer.values()].reduce((s, list) => s + list.length, 0),
    [byCustomer],
  );

  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ count: number; totalAmount: number; estimate: boolean } | null>(
    null,
  );
  const [result, setResult] = useState<{ submitted: number; failed: number; errors: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  if (!tenantId || !hiringEntityId || readyCount === 0) return null;

  const openPreview = async () => {
    setOpen(true);
    setWorking(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      let count = 0;
      let totalAmount = 0;
      let estimate = false;
      for (const [customer, list] of byCustomer) {
        // eslint-disable-next-line no-await-in-loop
        const res = await submitCallable()({
          tenantId,
          hiringEntityId,
          customer,
          dryRun: true,
          rows: list.map(rowToSubmit),
        });
        count += res.data?.count ?? list.length;
        totalAmount += res.data?.totalAmount ?? 0;
        if (res.data?.evereeClassifiesOt) estimate = true;
      }
      setPreview({ count, totalAmount, estimate });
    } catch (err: any) {
      console.error('submitImportTimesheetBatch (dry-run) failed:', err);
      setError(err?.message || 'Failed to preview the submission.');
    } finally {
      setWorking(false);
    }
  };

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      let submitted = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const [customer, list] of byCustomer) {
        // eslint-disable-next-line no-await-in-loop
        const res = await submitCallable()({
          tenantId,
          hiringEntityId,
          customer,
          dryRun: false,
          rows: list.map(rowToSubmit),
        });
        submitted += res.data?.submitted ?? 0;
        failed += res.data?.failed ?? 0;
        if (res.data?.errors?.length) errors.push(...res.data.errors);
      }
      setResult({ submitted, failed, errors });
      setPreview(null);
      onSubmitted?.();
    } catch (err: any) {
      console.error('submitImportTimesheetBatch (live) failed:', err);
      setError(err?.message || 'Failed to submit to Everee.');
    } finally {
      setWorking(false);
    }
  };

  const close = () => {
    if (working) return;
    setOpen(false);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <>
      <Alert
        severity="info"
        variant="outlined"
        icon={<CloudUploadIcon fontSize="small" />}
        action={
          <Button
            color="success"
            variant="contained"
            size="small"
            onClick={openPreview}
            sx={{ textTransform: 'none' }}
          >
            Submit {readyCount} imported to Everee →
          </Button>
        }
      >
        {readyCount} imported {readyCount === 1 ? 'row is' : 'rows are'} ready to submit to Everee.
        Previews first — nothing is sent until you confirm.
      </Alert>

      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>Submit imported rows to Everee</DialogTitle>
        <DialogContent>
          {working && !preview && !result ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">Composing the payload…</Typography>
            </Stack>
          ) : null}

          {preview && !result ? (
            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" gutterBottom>
                About to submit <strong>{preview.count}</strong>{' '}
                {preview.count === 1 ? 'row' : 'rows'} to Everee
                {byCustomer.size > 1 ? ` across ${byCustomer.size} customers` : ''}.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {preview.estimate ? '~' : ''}${preview.totalAmount.toFixed(2)}
                {preview.estimate ? ' straight-time (Everee adds OT/DT at the pay run)' : ''}.
              </Typography>
            </Box>
          ) : null}

          {result ? (
            <Alert severity={result.failed > 0 || result.errors.length ? 'warning' : 'success'}>
              Submitted {result.submitted} {result.submitted === 1 ? 'row' : 'rows'} to Everee.
              {result.failed > 0 ? ` ${result.failed} failed.` : ''}
              {result.errors.length > 0 ? ` ${result.errors.slice(0, 5).join('; ')}` : ''}
            </Alert>
          ) : null}

          {error ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={working} sx={{ textTransform: 'none' }}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result ? (
            <Button
              variant="contained"
              color="success"
              onClick={confirm}
              disabled={working || !preview}
              sx={{ textTransform: 'none' }}
            >
              {working ? 'Submitting…' : `Submit ${preview?.count ?? readyCount} to Everee`}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ImportGridSubmitBar;
