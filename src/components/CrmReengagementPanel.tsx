/**
 * CRM re-engagement campaign panel (Greg 2026-08-11) — the Sodexo outreach
 * rails pointed at the rest of the book (~1,549 eligible: everyone with an
 * email except active-customer companies, Sodexo-campaign contacts, and
 * internals). Preview (dry run) is required before every Send; nothing sends
 * without the click. Replies from this campaign land in the shared reply
 * desk on the Sodexo Campuses tab. Server: functions/src/sales/crmReengagement.ts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ForwardToInbox as ReengageIcon } from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface ReengagementStatus {
  connected: boolean;
  email: string | null;
  expectedEmail: string;
  eligible: Record<string, number>;
  autopilot?: { enabled: boolean; dailyLimit: number };
  recentBatches: Array<{
    id: string;
    touch?: number;
    sent?: number;
    skippedReplied?: number;
    sentAt?: { seconds?: number };
  }>;
}

interface Preview {
  count: number;
  sampleSubject: string | null;
  preview: Array<{ email: string; firstName: string; campus: string }>;
}

const CrmReengagementPanel: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [status, setStatus] = useState<ReengagementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [touch, setTouch] = useState(1);
  const [limit, setLimit] = useState(60);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await httpsCallable(getFunctions(), 'getCrmReengagementStatus', { timeout: 120000 })({ tenantId });
      setStatus(res.data as ReengagementStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const toggleAutopilot = async () => {
    const next = !(status?.autopilot?.enabled === true);
    setBusy('autopilot');
    setError(null);
    try {
      await httpsCallable(getFunctions(), 'setCrmReengagementAutopilot')({
        tenantId,
        enabled: next,
        dailyLimit: status?.autopilot?.dailyLimit ?? 60,
      });
      setStatus((p) => (p ? { ...p, autopilot: { enabled: next, dailyLimit: p.autopilot?.dailyLimit ?? 60 } } : p));
      setResult(next ? 'Autopilot ON — 60 emails every business day at 9am PT, touch 1 first.' : 'Autopilot paused — nothing sends until you resume.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runBatch = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'send');
    setError(null);
    setResult(null);
    try {
      // Same client-timeout lesson as the Sodexo panel: a 60-email batch
      // outlives the SDK's 70s default.
      const res = await httpsCallable(getFunctions(), 'crmReengagementSendBatch', { timeout: 540000 })({
        tenantId,
        touch,
        limit,
        dryRun,
      });
      const data = res.data as Record<string, unknown>;
      if (dryRun) {
        setPreview({
          count: Number(data.count) || 0,
          sampleSubject: (data.sampleSubject as string) ?? null,
          preview: (data.preview as Preview['preview']) ?? [],
        });
      } else {
        setPreview(null);
        setResult(
          `Sent ${data.sent} email${Number(data.sent) === 1 ? '' : 's'}` +
            (Number(data.skippedReplied) > 0 ? ` · ${data.skippedReplied} skipped (already replied)` : '') +
            ((data.errors as unknown[])?.length ? ` · ${(data.errors as unknown[]).length} failed` : ''),
        );
        void loadStatus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <ReengageIcon color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            CRM Re-engagement
          </Typography>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            Sizing the eligible pool…
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <ReengageIcon color="action" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          CRM Re-engagement
        </Typography>
        {status?.connected ? (
          <Chip size="small" color="success" label={`Sending as ${status.email}`} />
        ) : (
          <Chip size="small" color="warning" label="Mailbox not connected — connect it on the Sodexo Campuses tab" />
        )}
        {status?.connected && (
          <>
            <Chip
              size="small"
              color={status?.autopilot?.enabled ? 'success' : 'default'}
              label={status?.autopilot?.enabled ? `Autopilot: ${status.autopilot.dailyLimit}/business day` : 'Autopilot: off'}
            />
            <Button size="small" variant="outlined" onClick={() => void toggleAutopilot()} disabled={busy !== null}>
              {busy === 'autopilot' ? 'Saving…' : status?.autopilot?.enabled ? 'Pause autopilot' : 'Turn on autopilot'}
            </Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`Touch 1 ready: ${status?.eligible?.touch1 ?? 0}`} />
        <Chip size="small" label={`Touch 2 due: ${status?.eligible?.touch2 ?? 0}`} />
        <Chip size="small" label={`Touch 3 due: ${status?.eligible?.touch3 ?? 0}`} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Everyone in the CRM except active customers (Indeed Flex, Monument, Venuesmart, Proof of the
        Pudding, RS3, Contigo, G6), Sodexo-campaign contacts, and unsubscribes. Replies land in the
        reply desk on the Sodexo Campuses tab — &quot;not interested&quot; answers itself.
      </Typography>

      {status?.connected && (
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <TextField size="small" select label="Touch" value={touch} onChange={(e) => { setTouch(Number(e.target.value)); setPreview(null); }} sx={{ width: 220 }}>
            <MenuItem value={1}>1 — Reconnect intro</MenuItem>
            <MenuItem value={2}>2 — One shift, zero risk</MenuItem>
            <MenuItem value={3}>3 — Last note</MenuItem>
          </TextField>
          <TextField
            size="small"
            type="number"
            label="Batch size"
            value={limit}
            onChange={(e) => { setLimit(Math.max(1, Math.min(150, Number(e.target.value) || 60))); setPreview(null); }}
            sx={{ width: 110 }}
          />
          <Button variant="outlined" onClick={() => void runBatch(true)} disabled={busy !== null}>
            {busy === 'preview' ? 'Previewing…' : 'Preview batch'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => void runBatch(false)}
            disabled={busy !== null || !preview || preview.count === 0}
          >
            {busy === 'send' ? 'Sending…' : preview ? `Send ${preview.count} emails` : 'Preview first'}
          </Button>
        </Stack>
      )}

      {preview && (
        <Alert severity="info" sx={{ mt: 2 }} onClose={() => setPreview(null)}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {preview.count} recipient{preview.count === 1 ? '' : 's'} eligible for touch {touch}
            {preview.sampleSubject ? ` — sample subject: “${preview.sampleSubject}”` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {preview.preview.map((p) => `${p.firstName || '?'}${p.campus ? ` (${p.campus})` : ''}`).slice(0, 12).join(' · ')}
            {preview.count > 12 ? ` · +${preview.count - 12} more` : ''}
          </Typography>
        </Alert>
      )}
      {result && (
        <Alert severity="success" sx={{ mt: 2 }} onClose={() => setResult(null)}>
          {result}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {(status?.recentBatches?.length ?? 0) > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Recent:{' '}
          {status!.recentBatches
            .slice(0, 5)
            .map((b) => `touch ${b.touch} → ${b.sent} sent${b.skippedReplied ? ` (${b.skippedReplied} replied)` : ''}`)
            .join(' · ')}
        </Typography>
      )}
    </Paper>
  );
};

export default CrmReengagementPanel;
