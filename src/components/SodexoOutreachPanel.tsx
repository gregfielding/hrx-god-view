/**
 * Sodexo campus outreach panel (Greg 2026-08-06) — the per-batch control
 * surface for the send-only Gmail campaign. Nothing sends automatically:
 * Preview (dry run) is required first, then the explicit Send click is the
 * per-batch OK. Server side: functions/src/sales/sodexoOutreach.ts.
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
import { MailOutline as MailIcon } from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface OutreachStatus {
  connected: boolean;
  email: string | null;
  expectedEmail: string;
  eligible: Record<string, number>;
  recentBatches: Array<{
    id: string;
    touch?: number;
    sent?: number;
    skippedReplied?: number;
    sentAt?: { seconds?: number };
  }>;
  /** AI-drafted replies awaiting Greg's send/dismiss (reply desk, 2026-08-11). */
  pendingReplies?: Array<{
    id: string;
    name: string;
    campus: string;
    email: string;
    subject: string;
    receivedAt: string;
    body: string;
    classification: string;
    summary: string;
    aiDraft: string;
  }>;
}

interface Preview {
  count: number;
  sampleSubject: string | null;
  preview: Array<{ email: string; firstName: string; campus: string }>;
}

const SodexoOutreachPanel: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [status, setStatus] = useState<OutreachStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [touch, setTouch] = useState(1);
  const [limit, setLimit] = useState(60);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await httpsCallable(getFunctions(), 'getSodexoOutreachStatus')({ tenantId });
      setStatus(res.data as OutreachStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // OAuth popup notifies via postMessage on success.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if ((ev.data as { type?: string })?.type === 'google-auth-success') void loadStatus();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [loadStatus]);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const res = await httpsCallable(getFunctions(), 'getSalesOutreachGmailAuthUrl')({ tenantId });
      const { authUrl } = res.data as { authUrl: string };
      window.open(authUrl, '_blank', 'width=520,height=680');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Per-reply editable draft text, keyed by reply id (default = AI draft). */
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);

  const checkRepliesNow = async () => {
    setBusy('scan');
    setError(null);
    try {
      const res = await httpsCallable(getFunctions(), 'sodexoReplyScanNow', { timeout: 540000 })({ tenantId });
      const d = res.data as Record<string, number>;
      setResult(
        `Checked ${d.contactsScanned} contacts — ${d.newReplies} new repl${d.newReplies === 1 ? 'y' : 'ies'}` +
          (d.autoUnsubscribed ? `, ${d.autoUnsubscribed} unsubscribed` : ''),
      );
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Send every visible card as currently drafted/edited, one by one —
      dismiss anything you DON'T want sent before clicking. */
  const sendAllReplies = async () => {
    const replies = status?.pendingReplies ?? [];
    setBusy('sendall');
    setError(null);
    let sent = 0;
    const failed: string[] = [];
    for (const r of replies) {
      const body = (replyDrafts[r.id] ?? r.aiDraft).trim();
      if (!body) continue;
      setReplyBusy(r.id);
      try {
        await httpsCallable(getFunctions(), 'resolveSodexoReply')({ tenantId, replyId: r.id, action: 'send', body });
        sent += 1;
        setStatus((p) =>
          p ? { ...p, pendingReplies: (p.pendingReplies ?? []).filter((x) => x.id !== r.id) } : p,
        );
      } catch {
        failed.push(r.name);
      }
    }
    setReplyBusy(null);
    setBusy(null);
    setResult(`Sent ${sent} repl${sent === 1 ? 'y' : 'ies'}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`);
  };

  const resolveReply = async (replyId: string, action: 'send' | 'dismiss') => {
    setReplyBusy(replyId);
    setError(null);
    try {
      await httpsCallable(getFunctions(), 'resolveSodexoReply')({
        tenantId,
        replyId,
        action,
        ...(action === 'send' && replyDrafts[replyId] !== undefined ? { body: replyDrafts[replyId] } : {}),
      });
      setStatus((p) =>
        p ? { ...p, pendingReplies: (p.pendingReplies ?? []).filter((r) => r.id !== replyId) } : p,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplyBusy(null);
    }
  };

  const runBatch = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'send');
    setError(null);
    setResult(null);
    try {
      // A 60-email batch takes ~1-2 min server-side (human pacing between
      // sends); the SDK's default 70s deadline made the browser report
      // deadline-exceeded while the server finished fine. 9-min client
      // timeout matches the function's own limit.
      const res = await httpsCallable(getFunctions(), 'sodexoOutreachSendBatch', { timeout: 540000 })({
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
          <MailIcon color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Email Outreach
          </Typography>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            Checking mailbox + campaign status…
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <MailIcon color="action" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Email Outreach
        </Typography>
        {status?.connected ? (
          <>
            <Chip size="small" color="success" label={`Sending as ${status.email}`} />
            {/* Re-runs OAuth with the current scope list — needed when new
                capabilities (inbox triage labels/drafts) expand the grant. */}
            <Button size="small" onClick={() => void connect()} disabled={busy === 'connect'}>
              Upgrade permissions
            </Button>
          </>
        ) : (
          <>
            <Chip size="small" color="warning" label="Mailbox not connected" />
            <Button size="small" variant="contained" onClick={() => void connect()} disabled={busy === 'connect'}>
              Connect {status?.expectedEmail}
            </Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`Touch 1 ready: ${status?.eligible?.touch1 ?? 0}`} />
        <Chip size="small" label={`Touch 2 due: ${status?.eligible?.touch2 ?? 0}`} />
        <Chip size="small" label={`Touch 3 due: ${status?.eligible?.touch3 ?? 0}`} />
      </Stack>

      {status?.connected && (
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <TextField size="small" select label="Touch" value={touch} onChange={(e) => { setTouch(Number(e.target.value)); setPreview(null); }} sx={{ width: 200 }}>
            <MenuItem value={1}>1 — Fall ramp-up intro</MenuItem>
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
          <Button variant="outlined" onClick={() => void checkRepliesNow()} disabled={busy !== null}>
            {busy === 'scan' ? 'Checking…' : 'Check replies now'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => void runBatch(false)}
            // Send unlocks only after a preview of the same touch/size —
            // the preview + this click IS the per-batch OK.
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
            {preview.preview.map((p) => `${p.firstName || '?'} (${p.campus})`).slice(0, 12).join(' · ')}
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
      {(status?.pendingReplies?.length ?? 0) > 0 && (
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Replies to review ({status!.pendingReplies!.length})
            </Typography>
            {status!.pendingReplies!.length > 1 && (
              <Button size="small" variant="contained" disabled={busy !== null || replyBusy !== null} onClick={() => void sendAllReplies()}>
                {busy === 'sendall' ? 'Sending…' : `Send all ${status!.pendingReplies!.length}`}
              </Button>
            )}
          </Stack>
          <Stack spacing={1.5}>
            {status!.pendingReplies!.map((r) => (
              <Paper key={r.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {r.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {r.campus}
                  </Typography>
                  <Chip
                    size="small"
                    color={
                      r.classification === 'interested'
                        ? 'success'
                        : r.classification === 'question'
                          ? 'info'
                          : 'default'
                    }
                    label={r.classification.replace('_', ' ')}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {r.receivedAt}
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  sx={{ mt: 1, whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxHeight: 120, overflowY: 'auto' }}
                >
                  {r.body || r.summary}
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  size="small"
                  label="Your reply (AI draft — edit freely)"
                  sx={{ mt: 1.5 }}
                  value={replyDrafts[r.id] ?? r.aiDraft}
                  onChange={(e) => setReplyDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                />
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={replyBusy !== null || !(replyDrafts[r.id] ?? r.aiDraft).trim()}
                    onClick={() => void resolveReply(r.id, 'send')}
                  >
                    {replyBusy === r.id ? 'Sending…' : `Send reply to ${r.name.split(' ')[0]}`}
                  </Button>
                  <Button size="small" disabled={replyBusy !== null} onClick={() => void resolveReply(r.id, 'dismiss')}>
                    Dismiss (no reply)
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>
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

export default SodexoOutreachPanel;
