/**
 * Per-job-order Google Sheet roster sync control.
 *
 * Toggle on → backend creates one spreadsheet for this JO (a tab per shift,
 * rows = placed/assigned workers with name/phone/email/status) and shares a
 * view-only link. "Sync now" re-runs a full sync; the link opens the sheet.
 *
 * Phase 1 is on-demand (toggle + Sync now). Live debounced auto-sync on
 * placement/status changes is Phase 2.
 */
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SyncIcon from '@mui/icons-material/Sync';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import {
  jobOrderSheetEnable,
  jobOrderSheetDisable,
  jobOrderSheetSyncNow,
  jobOrderSheetPullFromSheet,
} from '../../services/jobOrderSheetSync';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface JobOrderSheetSyncState {
  enabled?: boolean;
  spreadsheetUrl?: string | null;
  lastSyncedAt?: { toDate?: () => Date } | string | null;
}

interface Props {
  tenantId: string;
  jobOrderId: string;
  sync?: JobOrderSheetSyncState | null;
  /** Called after a successful enable/disable/sync so the parent can refresh the JO. */
  onChanged?: () => void;
}

function fmtTime(v: JobOrderSheetSyncState['lastSyncedAt']): string {
  try {
    const d =
      v && typeof v === 'object' && 'toDate' in v && typeof v.toDate === 'function'
        ? v.toDate()
        : typeof v === 'string'
          ? new Date(v)
          : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  } catch {
    return '';
  }
}

const JobOrderSheetSyncControl: React.FC<Props> = ({ tenantId, jobOrderId, sync, onChanged }) => {
  const [busy, setBusy] = useState<null | 'toggle' | 'sync' | 'pull'>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(sync?.spreadsheetUrl ?? null);

  const enabled = Boolean(sync?.enabled);
  const url = localUrl || sync?.spreadsheetUrl || '';
  const lastSynced = fmtTime(sync?.lastSyncedAt);

  const run = async (
    kind: 'toggle' | 'sync',
    fn: () => Promise<{ data: { url?: string } }>,
  ) => {
    setBusy(kind);
    setError(null);
    setInfo(null);
    try {
      const res = await fn();
      if (res?.data?.url) setLocalUrl(res.data.url);
      onChanged?.();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e) ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const handlePull = async () => {
    if (busy) return;
    setBusy('pull');
    setError(null);
    setInfo(null);
    try {
      const res = await jobOrderSheetPullFromSheet({ tenantId, jobOrderId });
      const { placed = 0, unmatched = 0, ambiguous = 0 } = res?.data || {};
      if (res?.data?.url) setLocalUrl(res.data.url);
      const notMatched = unmatched + ambiguous;
      setInfo(
        placed === 0 && notMatched === 0
          ? 'No new rows to pull — the sheet matches HRX.'
          : `Placed ${placed} worker${placed === 1 ? '' : 's'} from the sheet.` +
              (notMatched > 0
                ? ` ${notMatched} row${notMatched === 1 ? '' : 's'} couldn't be matched (flagged "Not in HRX").`
                : ''),
      );
      onChanged?.();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e) ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = () => {
    if (busy) return;
    if (enabled) {
      void run('toggle', () => jobOrderSheetDisable({ tenantId, jobOrderId }) as any);
    } else {
      void run('toggle', () => jobOrderSheetEnable({ tenantId, jobOrderId }));
    }
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Switch
          checked={enabled}
          onChange={handleToggle}
          disabled={busy != null}
          size="small"
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Sync roster to Google Sheets
          </Typography>
          <Typography variant="caption" color="text.secondary">
            One sheet for this job order, a tab per shift (name · phone · email · status).
          </Typography>
        </Box>
        {busy === 'toggle' ? <CircularProgress size={16} sx={{ ml: 0.5 }} /> : null}
      </Stack>

      {enabled && url ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon fontSize="small" />}
            component={Link}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open sheet
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={busy === 'sync' ? <CircularProgress size={14} /> : <SyncIcon fontSize="small" />}
            disabled={busy != null}
            onClick={() => void run('sync', () => jobOrderSheetSyncNow({ tenantId, jobOrderId }))}
          >
            Sync now
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={busy === 'pull' ? <CircularProgress size={14} /> : <MoveToInboxIcon fontSize="small" />}
            disabled={busy != null}
            onClick={() => void handlePull()}
            title="Place people you typed into the sheet (matched by phone) back into HRX"
          >
            Pull from sheet
          </Button>
          {lastSynced ? (
            <Typography variant="caption" color="text.secondary">
              Last synced {lastSynced}
            </Typography>
          ) : null}
        </Stack>
      ) : null}

      {info ? (
        <Alert severity="success" sx={{ mt: 1.25 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mt: 1.25 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
};

export default JobOrderSheetSyncControl;
