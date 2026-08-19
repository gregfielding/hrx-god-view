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
 *  ColData[] (customer rows), Summary.ColData (total rows), or a NESTED
 *  section (Header + Rows + Summary) for a parent customer with QBO
 *  sub-customers — rendered as one family-total row named after the
 *  parent (e.g. "RS3 Hospitality"), matching how sub-customers roll up
 *  to their mapped account everywhere else (RS3=Proof, 2026-08-19).
 *  Before this, section rows were swallowed by the ^total heuristic and
 *  the table's rows silently summed short of the grand total. */
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
    if (Array.isArray(r.Rows?.Row)) {
      const name = String(r.Header?.ColData?.[0]?.value ?? '');
      const sums = Array.isArray(r.Summary?.ColData) ? r.Summary.ColData : null;
      if (sums) {
        rows.push({
          name: name || String(sums[0]?.value ?? '').replace(/^total\s*/i, ''),
          values: sums.slice(1).map((c: Record<string, any>) => Number(c.value ?? 0) || 0),
          isTotal: false,
        });
      }
      continue;
    }
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
  rows.sort((a, b) => (b.values[b.values.length - 1] ?? 0) - (a.values[a.values.length - 1] ?? 0));
  return { headers, rows, totals };
}

interface QboArDashboardCardProps {
  /** A/R report upgrade (Greg 2026-08-19): also compute DSO + payment
   *  speed per client (live QBO queries — slower load, so opt-in;
   *  the Invoicing page keeps the fast default). */
  includeDso?: boolean;
}

const QboArDashboardCard: React.FC<QboArDashboardCardProps> = ({ includeDso = false }) => {
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
      const fn = httpsCallable(functions, 'getQboDashboard', { timeout: 180000 });
      const res = await fn({ tenantId, ...(includeDso ? { includeDso: true } : {}) });
      setData((res.data ?? null) as Record<string, any> | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, includeDso]);

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

        {/* DSO & payment speed (A/R report upgrade, opt-in). */}
        {Array.isArray(data?.dso) && data.dso.length > 0 && (
          <>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
              DSO &amp; payment speed
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              DSO = open A/R ÷ billed last 91 days × 91. Payment speed compares invoices issued the
              last 91 days vs the 91 before — a red arrow means this client is paying slower.
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Open A/R</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Billed (91d)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>DSO</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Avg days to pay</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Trend</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data.dso as Array<Record<string, any>>).map((r) => (
                    <TableRow key={String(r.customerId)} hover>
                      <TableCell>{String(r.name)}</TableCell>
                      <TableCell align="right">{usd(r.openBalance)}</TableCell>
                      <TableCell align="right">{Number(r.billed91) ? usd(r.billed91) : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {r.dsoDays == null ? '—' : `${r.dsoDays}d`}
                      </TableCell>
                      <TableCell align="right">
                        {r.avgDaysToPayRecent == null
                          ? '—'
                          : `${r.avgDaysToPayRecent}d (${r.paidCountRecent} inv)`}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 600,
                          color:
                            r.trendDays == null
                              ? 'text.secondary'
                              : Number(r.trendDays) > 0
                                ? 'error.main'
                                : 'success.main',
                        }}
                      >
                        {r.trendDays == null
                          ? '—'
                          : `${Number(r.trendDays) > 0 ? '▲' : '▼'} ${Math.abs(Number(r.trendDays))}d`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
        {typeof data?.dsoError === 'string' && data.dsoError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            DSO unavailable: {data.dsoError}
          </Alert>
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
