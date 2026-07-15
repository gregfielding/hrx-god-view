/**
 * Expensify company-card CSV export (Invoicing page, admin-only).
 *
 * Expensify's API cannot create expenses for anyone but the credential owner,
 * so the only way spend reaches a worker's own account is an assigned company
 * card fed by an import. This emits that file from QuickBooks; the admin
 * uploads it in Expensify (Workspace → Company cards → Add cards → Import
 * transactions from file), assigns each card to a person ONCE, and confirms
 * here so the same rows never go out twice.
 *
 * Expensify does NOT dedupe imports — re-uploading overlapping rows creates
 * duplicate expenses. Hence: confirm only AFTER the upload lands.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const previewExport = httpsCallable(functions, 'previewExpensifyCardExport');
const confirmExport = httpsCallable(functions, 'confirmExpensifyCardExport');

interface CardBucket {
  count: number;
  total: number;
  cardholderName: string | null;
  email: string;
}

interface Preview {
  since: string;
  count: number;
  total: number;
  byCard: Record<string, CardBucket>;
  purchaseIds: string[];
  csv: string;
  skippedNoCard: number;
  skippedPaused: number;
  alreadyExported: number;
  unmappedCards: Array<{ last4: string; cardholderName: string | null; count: number }>;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function ExpensifyCardExportCard() {
  const { activeTenant } = useAuth();
  const tenantId: string = String(activeTenant?.id || '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await previewExport({ tenantId });
      setPreview(res.data as Preview);
    } catch (e: any) {
      // Non-admins simply don't see the card.
      if (e?.code === 'functions/permission-denied') setVisible(false);
      else setError(e?.message || 'Could not load the export.');
    } finally {
      setBusy(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDownload = () => {
    if (!preview) return;
    const blob = new Blob([preview.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expensify-cards-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const onConfirm = async () => {
    if (!preview?.purchaseIds.length) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await confirmExport({ tenantId, purchaseIds: preview.purchaseIds });
      setNote(`Marked ${res.data.confirmed} transaction(s) as exported. They won't be included again.`);
      setDownloaded(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not confirm the export.');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <CreditCardOutlinedIcon color="primary" />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Expensify card feed
        </Typography>
        {preview && (
          <Chip
            size="small"
            color={preview.count ? 'primary' : 'default'}
            label={preview.count ? `${preview.count} ready` : 'Up to date'}
          />
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Card transactions from QuickBooks that haven&apos;t been sent to Expensify yet. Download the
        file, upload it in Expensify under <strong>Company cards → Add cards → Import transactions
        from file</strong>, then confirm below so these never go out twice.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {note && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNote(null)}>
          {note}
        </Alert>
      )}

      {busy && !preview && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {preview && preview.count === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Nothing new to send. {preview.alreadyExported} transaction(s) already exported
          {preview.skippedPaused > 0 && `, ${preview.skippedPaused} held on paused cards`}.
        </Alert>
      )}

      {preview && preview.count > 0 && (
        <>
          {preview.unmappedCards.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {preview.unmappedCards.map((c) => `•${c.last4} (${c.count})`).join(', ')} —{' '}
              {preview.unmappedCards.length === 1 ? 'this card is' : 'these cards are'} not mapped to
              anyone yet. {preview.unmappedCards.length === 1 ? 'It' : 'They'} will still import;
              assign {preview.unmappedCards.length === 1 ? 'it' : 'them'} to a person in Expensify
              afterwards.
            </Alert>
          )}

          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Card</TableCell>
                <TableCell>Cardholder</TableCell>
                <TableCell align="right">Transactions</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(preview.byCard)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([last4, b]) => (
                  <TableRow key={last4}>
                    <TableCell>•{last4}</TableCell>
                    <TableCell>
                      {b.email || (
                        <Typography variant="caption" color="warning.main">
                          {b.cardholderName || 'unmapped'} — assign in Expensify
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{b.count}</TableCell>
                    <TableCell align="right">{money(b.total)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          <Divider sx={{ mb: 2 }} />

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              variant="contained"
              startIcon={<DownloadOutlinedIcon />}
              onClick={onDownload}
              disabled={busy}
            >
              Download {preview.count} transaction{preview.count === 1 ? '' : 's'} ({money(preview.total)})
            </Button>
            <Button
              variant="outlined"
              color="success"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={onConfirm}
              disabled={busy || !downloaded}
            >
              I uploaded it to Expensify
            </Button>
            {busy && <CircularProgress size={18} />}
          </Stack>
          {!downloaded && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Download the file first — confirming before it reaches Expensify would skip these
              transactions permanently.
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
}
