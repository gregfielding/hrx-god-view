/**
 * QuickBooks Online connection card (Invoicing page, admin-only).
 * One QBO company connects per tenant; tokens live server-side on
 * tenants/{tid}/integrations/quickbooks. Powers the Expensify card-expense
 * pipeline and the invoicing roadmap. Hidden for callers the status
 * callable rejects (non-admins).
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
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const getQboStatus = httpsCallable(functions, 'getQboStatus');
const getQboAuthUrl = httpsCallable(functions, 'getQboAuthUrl');

interface QboStatus {
  connected: boolean;
  realmId: string | null;
  connectedAt: number | null;
  refreshTokenExpiresAt: number | null;
  tokenError: string | null;
}

export default function ConnectQuickBooksCard() {
  const { activeTenant } = useAuth();
  const tenantId: string = String(activeTenant?.id || '');
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await getQboStatus({ tenantId });
      setStatus(res.data as QboStatus);
    } catch {
      setVisible(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'qbo-auth-success') refresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  const handleConnect = async () => {
    if (!tenantId || busy) return;
    setBusy(true);
    try {
      const res = await getQboAuthUrl({ tenantId });
      const { authUrl } = res.data as { authUrl: string };
      window.open(authUrl, '_blank', 'width=700,height=750');
    } finally {
      setBusy(false);
    }
  };

  if (!visible || !tenantId) return null;

  return (
    <Paper variant="outlined" sx={{ px: { xs: 2, md: 3 }, py: 2, mt: 2, maxWidth: 640 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <AccountBalanceOutlinedIcon color={status?.connected ? 'success' : 'disabled'} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2">QuickBooks Online</Typography>
            {status === null ? (
              <CircularProgress size={14} />
            ) : status.connected ? (
              <Chip size="small" color="success" label={`Connected · company ${status.realmId}`} />
            ) : (
              <Chip size="small" color="warning" label="Not connected" />
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {status?.connected
              ? 'HRX reads bank-card transactions for the Expensify expense pipeline (and, later, invoicing).'
              : 'Connect the company QuickBooks so HRX can read bank-card transactions for the Expensify expense pipeline. Sign in as a QuickBooks admin when prompted.'}
          </Typography>
          {status?.tokenError ? (
            <Alert severity="error" sx={{ mt: 1, py: 0 }}>
              QuickBooks connection lost — reconnect below.
            </Alert>
          ) : null}
        </Box>
        <Button
          variant={status?.connected ? 'outlined' : 'contained'}
          size="small"
          onClick={handleConnect}
          disabled={busy || status === null}
        >
          {status?.connected ? 'Reconnect' : 'Connect QuickBooks'}
        </Button>
      </Stack>
    </Paper>
  );
}
