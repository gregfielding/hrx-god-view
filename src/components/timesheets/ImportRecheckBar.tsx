/**
 * ImportRecheckBar — re-evaluate stale "needs onboarding / not linked to
 * Everee" blocks on CSV-import Grid rows.
 *
 * A row's block reason is a snapshot from import time. When the worker later
 * finishes Everee onboarding, the Grid keeps showing the old block until
 * something recomputes it. This bar appears whenever the current entity view
 * holds blocked import rows with a matched worker, and re-checks them in one
 * click (server re-resolves each worker's Everee linkage); now-linked rows
 * leave the Blocked filter on the following reload.
 *
 * Only matched rows are re-checkable — unmatched "No HRX worker named X" rows
 * still need a worker pick via the row pencil, so they're excluded from the
 * count.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Button, CircularProgress, Snackbar } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import type { TimesheetGridRow } from './timesheetGridResolver';

interface RecheckSummary {
  rechecked: number;
  cleared: number;
  stillBlocked: number;
  skipped: number;
}

export interface ImportRecheckBarProps {
  rows: TimesheetGridRow[];
  tenantId?: string | null;
  hiringEntityId?: string | null;
  /** Reload the grid after a re-check so cleared rows leave the Blocked view. */
  onRechecked?: () => void;
}

const ImportRecheckBar: React.FC<ImportRecheckBarProps> = ({
  rows,
  tenantId,
  hiringEntityId,
  onRechecked,
}) => {
  // Blocked import rows that HAVE a matched worker — the only ones a linkage
  // re-check can resolve (unmatched-name rows need the worker pencil).
  const entryIds = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.kind === 'entry' &&
            r.isImport &&
            r.entry.import?.matchStatus === 'blocked' &&
            !!r.entry.workerId,
        )
        .map((r) => (r as Extract<TimesheetGridRow, { kind: 'entry' }>).entry.id),
    [rows],
  );

  const [working, setWorking] = useState(false);
  const [snack, setSnack] = useState<{ severity: 'success' | 'info' | 'error'; message: string } | null>(
    null,
  );

  if (!tenantId || !hiringEntityId || entryIds.length === 0) return null;

  const recheck = async () => {
    setWorking(true);
    try {
      const fn = httpsCallable<
        { tenantId: string; hiringEntityId: string; entryIds: string[] },
        RecheckSummary
      >(functions, 'recheckImportTimesheetBlocks', { timeout: 300000 });
      const res = await fn({ tenantId, hiringEntityId, entryIds });
      const { cleared = 0, stillBlocked = 0 } = res.data || {};
      setSnack({
        severity: cleared > 0 ? 'success' : 'info',
        message:
          cleared > 0
            ? `${cleared} ${cleared === 1 ? 'row' : 'rows'} cleared${stillBlocked > 0 ? `, ${stillBlocked} still blocked` : ''}.`
            : `No change — ${stillBlocked} still blocked (worker not linked to Everee yet).`,
      });
      onRechecked?.();
    } catch (err: any) {
      console.error('recheckImportTimesheetBlocks failed:', err);
      setSnack({ severity: 'error', message: err?.message || 'Re-check failed.' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Alert
        severity="warning"
        variant="outlined"
        icon={<RefreshIcon fontSize="small" />}
        action={
          <Button
            color="warning"
            variant="contained"
            size="small"
            onClick={recheck}
            disabled={working}
            startIcon={working ? <CircularProgress size={14} color="inherit" /> : undefined}
            sx={{ textTransform: 'none' }}
          >
            {working ? 'Re-checking…' : `Re-check ${entryIds.length} blocked`}
          </Button>
        }
      >
        {entryIds.length} matched {entryIds.length === 1 ? 'row is' : 'rows are'} blocked on Everee
        linkage. If they&apos;ve since finished onboarding, re-check to clear the block.
      </Alert>

      <Snackbar
        open={!!snack}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
};

export default ImportRecheckBar;
