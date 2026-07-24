/**
 * Company-wide A/R dashboard on Global Invoicing (level 7).
 *
 * All data flows through the level-gated `getQboDashboard` callable —
 * the qbo_reports / qbo_customers caches match no firestore rule and
 * are default-denied to clients by design. The AgedReceivables report
 * is the accountant-grade truth for aging totals; the recent-activity
 * lists come from entity queries (both cached server-side by the
 * 30-minute qboRefreshCron, or on demand via the sync button here).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface AgedRow {
  name: string;
  values: number[];
  isTotal: boolean;
}

/** Defensive parse of QBO's AgedReceivables report shape:
 *  Columns.Column[].ColTitle for headers; Rows.Row[] with either
 *  ColData[] (customer rows) or Summary.ColData (total rows). */
function parseAgedReport(report: Record<string, any> | null): {
  headers: string[];
  rows: AgedRow[];
  totals: number[] | null;
} {
  if (!report) return { headers: [], rows: [], totals: null };
  const headers = (Array.isArray(report.Columns?.Column) ? report.Columns.Column : [])
    .map((c: Record<string, any>) => String(c.ColTitle ?? ''));
  const rawRows = Array.isArray(report.Rows?.Row) ? report.Rows.Row : [];
  const rows: AgedRow[] = [];
  let totals: number[] | null = null;
  for (const r of rawRows) {
    const colData = Array.isArray(r.ColData)
      ? r.ColData
      : Array.isArray(r.Summary?.ColData)
        ? r.Summary.ColData
        : null;
    if (!colData) continue;
    const name = String(colData[0]?.value ?? '');
    const values = colData.slice(1).map((c: Record<string, any>) => Number(c.value ?? 0) || 0);
    const isTotal = r.group === 'GrandTotal' || /^total/i.test(name);
    if (isTotal) totals = values;
    else rows.push({ name, values, isTotal: false });
  }
  return { headers, rows, totals };
}

const QboArDashboardCard: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getQboDashboard');
      const res = await fn({ tenantId });
      setData((res.data ?? null) as Record<string, any> | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncNow = useCallback(async () => {
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'syncQboCustomers')({ tenantId });
      await httpsCallable(functions, 'syncQboCompanyRollup')({ tenantId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [tenantId, load]);

  const aged = useMemo(
    () => parseAgedReport(data?.agedReceivables?.report ?? null),
    [data],
  );
  const recent = data?.recentActivity ?? null;
  const health = data?.mappingHealth ?? null;

  if (!data && loading) {
    return (
      <Card sx={{ mt: 2 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </CardContent>
      </Card>
    );
  }
  if (data && data.connected !== true) return null; // Connect card above handles this state.

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>Accounts receivable</Typography>
            <Typography variant="caption" color="text.secondary">
              {data?.agedReceivables?.fetchedAt
                ? `From QuickBooks AgedReceivables — updated ${new Date(Number(data.agedReceivables.fetchedAt)).toLocaleString()}`
                : 'Not synced yet'}
            </Typography>
          </Box>
          <Button size="small" variant="outlined" sx={{ textTransform: 'none' }} disabled={busy} onClick={() => void syncNow()}>
            {busy ? 'Syncing…' : 'Sync from QuickBooks'}
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Headline aging tiles from the report's grand-total row. */}
        {aged.totals && (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {aged.totals.map((v, i) => (
              <Paper key={i} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 110 }}>
                <Typography variant="caption" color="text.secondary">
                  {aged.headers[i + 1] || `Bucket ${i + 1}`}
                </Typography>
                <Typography variant={i === aged.totals!.length - 1 ? 'h6' : 'body1'} fontWeight={600}>
                  {usd(v)}
                </Typography>
              </Paper>
            ))}
          </Box>
        )}

        {/* Per-customer aging (report rows). */}
        {aged.rows.length > 0 && (
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  {aged.headers.map((h, i) => (
                    <TableCell key={i} align={i === 0 ? 'left' : 'right'} sx={{ fontWeight: 600 }}>
                      {h || 'Customer'}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {aged.rows.map((r) => (
                  <TableRow key={r.name} hover>
                    <TableCell>{r.name}</TableCell>
                    {r.values.map((v, i) => (
                      <TableCell key={i} align="right">{v ? usd(v) : '—'}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Mapping health — the onboarding to-do list. */}
        {health && (
          <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
              Mapping health
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {health.mappedAccounts?.length ?? 0} HRX account
              {(health.mappedAccounts?.length ?? 0) === 1 ? '' : 's'} mapped of{' '}
              {health.customerCount ?? 0} QuickBooks customers.
            </Typography>
            {(health.unmappedCustomersWithBalance ?? []).length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Customers with open balances not yet linked to an HRX account (map them from the
                  account's Invoicing tab):
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {health.unmappedCustomersWithBalance.slice(0, 12).map((c: Record<string, any>) => (
                    <Chip
                      key={String(c.customerId)}
                      size="small"
                      variant="outlined"
                      label={`${c.displayName} · ${usd(c.balance)}`}
                    />
                  ))}
                </Stack>
              </>
            )}
          </Paper>
        )}

        {/* Recent activity */}
        {recent && (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 280 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                Recent invoices
              </Typography>
              {(recent.invoices ?? []).slice(0, 8).map((inv: Record<string, any>) => (
                <Stack key={String(inv.invoiceId)} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
                  <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>
                    #{inv.docNumber || inv.invoiceId} · {inv.customerName || '—'}
                  </Typography>
                  <Typography variant="body2" color={Number(inv.balance) > 0 ? 'text.primary' : 'text.secondary'}>
                    {usd(inv.totalAmt)} {inv.txnDate ? `· ${inv.txnDate}` : ''}
                  </Typography>
                </Stack>
              ))}
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 280 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                Recent payments
              </Typography>
              {(recent.payments ?? []).slice(0, 8).map((p: Record<string, any>) => (
                <Stack key={String(p.paymentId)} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
                  <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>
                    {p.customerName || '—'}
                  </Typography>
                  <Typography variant="body2">
                    {usd(p.totalAmt)} {p.txnDate ? `· ${p.txnDate}` : ''}
                  </Typography>
                </Stack>
              ))}
            </Paper>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default QboArDashboardCard;
