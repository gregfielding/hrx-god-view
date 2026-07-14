/**
 * Compliance mailbox (P4) — connect + health card shown on the policy page.
 *
 * The compliance@ mailbox is connected ONCE per tenant (read-only Gmail
 * OAuth, tokens on tenants/{tid}/integrations/complianceMailbox); a cron
 * then matches inbound candidate replies to open adjudication cases. This
 * card shows connection health and hosts the one-click connect. It renders
 * nothing for staff who aren't compliance reviewers (the status callable
 * is reviewer-gated).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const getComplianceMailboxStatus = httpsCallable(functions, 'getComplianceMailboxStatus');
const getComplianceGmailAuthUrl = httpsCallable(functions, 'getComplianceGmailAuthUrl');

interface MailboxStatus {
  connected: boolean;
  email: string | null;
  expectedEmail: string;
  connectedAt: number | null;
  lastPollAt: number | null;
  lastPollProcessed: number;
  lastPollMatched: number;
  tokenError: string | null;
}

function agoText(ms: number | null): string {
  if (!ms) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} days ago`;
}

export default function ComplianceMailboxCard() {
  const { activeTenant } = useAuth();
  const tenantId: string = String(activeTenant?.id || '');
  const [status, setStatus] = useState<MailboxStatus | null>(null);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await getComplianceMailboxStatus({ tenantId });
      setStatus(res.data as MailboxStatus);
    } catch {
      // Not a compliance reviewer (or offline) — the policy page is broader
      // than the reviewer allowlist, so just hide the operations card.
      setVisible(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The OAuth popup posts back on success (same signal the Gmail settings use).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'google-auth-success') refresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  const handleConnect = async () => {
    if (!tenantId || busy) return;
    setBusy(true);
    try {
      const res = await getComplianceGmailAuthUrl({ tenantId });
      const { authUrl } = res.data as { authUrl: string };
      window.open(authUrl, '_blank', 'width=600,height=700');
    } finally {
      setBusy(false);
    }
  };

  if (!visible || !tenantId) return null;

  return (
    <Paper variant="outlined" sx={{ px: { xs: 2, md: 3 }, py: 2, mb: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <MarkEmailReadOutlinedIcon color={status?.connected ? 'success' : 'disabled'} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2">Compliance mailbox intake</Typography>
            {status === null ? (
              <CircularProgress size={14} />
            ) : status.connected ? (
              <Chip size="small" color="success" label={`Connected · ${status.email}`} />
            ) : (
              <Chip size="small" color="warning" label="Not connected" />
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {status?.connected
              ? `Candidate replies to ${status.email} are matched to adjudication cases automatically ` +
                `(response clock stopped, attachments filed to the case folder, reviewers notified). ` +
                `Inbox last checked ${agoText(status.lastPollAt)}.`
              : `Connect ${status?.expectedEmail || 'the compliance mailbox'} (read-only) so candidate replies ` +
                `are matched to adjudication cases automatically. Sign into that mailbox in this browser first.`}
          </Typography>
          {status?.tokenError ? (
            <Alert severity="error" sx={{ mt: 1, py: 0 }}>
              Google connection lost — replies are not being matched. Reconnect below.
            </Alert>
          ) : null}
        </Box>
        <Button
          variant={status?.connected ? 'outlined' : 'contained'}
          size="small"
          onClick={handleConnect}
          disabled={busy || status === null}
        >
          {status?.connected ? 'Reconnect' : 'Connect mailbox'}
        </Button>
      </Stack>
    </Paper>
  );
}
