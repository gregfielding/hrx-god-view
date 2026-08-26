/**
 * /reports/gross-margin — Gross Margin by Client / Job Order (Greg
 * 2026-08-19, first build from the report-library roadmap).
 *
 * Bill side: live QBO invoices (line-level classes) for the range.
 * Pay side: the payroll cost report's own groups. Both come back from
 * one getPayrollCostReport call with includeBilling:true (level 7 —
 * the callable enforces it too). Burden is an adjustable estimate
 * applied to pay (employer taxes + WC), computed client-side so the
 * bookkeeper can tune it without re-querying.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const pctFmt = (n: number | null): string => (n == null ? '—' : `${n.toFixed(1)}%`);

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const monthStartIso = (): string => `${todayIso().slice(0, 7)}-01`;

interface GmJoRow {
  label: string;
  accountName: string | null;
  attributed: boolean;
  pay: number;
  hours: number;
  billed: number;
  billedClasses: string[];
}

interface GmAccountRow {
  accountId: string | null;
  label: string;
  customerName: string | null;
  billed: number;
  invoiceCount: number;
  openBalance: number;
  pay: number;
}

interface BillingData {
  invoiceCount: number;
  totalBilled: number;
  unclassifiedBilled: number;
  totalPay: number;
  entityFiltered?: boolean;
  byJobOrder: GmJoRow[];
  byAccount: GmAccountRow[];
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const GrossMarginReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  /** Employer-burden estimate (taxes + WC) applied to pay, in percent. */
  const [burdenPct, setBurdenPct] = useState('12');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [rangeLabel, setRangeLabel] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) =>
        setEntities(
          snap.docs
            .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
            .filter((e) => !/sandbox/i.test(e.id) && !/sandbox/i.test(e.name)),
        ),
      )
      .catch(() => setEntities([]));
  }, [tenantId]);

  const burden = useMemo(() => {
    const n = Number(burdenPct);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : 0;
  }, [burdenPct]);

  const load = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
      const res = await fn({
        tenantId,
        startDate,
        endDate,
        includeBilling: true,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const data = res.data as { billing: BillingData | null; billingError: string | null };
      if (!data.billing) {
        setError(data.billingError || 'QuickBooks billing data unavailable — is QuickBooks connected?');
        setBilling(null);
      } else {
        setBilling(data.billing);
        setRangeLabel(`${startDate} → ${endDate}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const margins = useMemo(() => {
    if (!billing) return null;
    const withMargin = <T extends { billed: number; pay: number }>(r: T) => {
      const burdenAmt = Math.round(r.pay * burden * 100) / 100;
      const gm = Math.round((r.billed - r.pay - burdenAmt) * 100) / 100;
      const gmPct = r.billed > 0 ? (gm / r.billed) * 100 : null;
      return { ...r, burdenAmt, gm, gmPct };
    };
    const byAccount = billing.byAccount.map(withMargin);
    const byJobOrder = billing.byJobOrder.map(withMargin);
    const totalBurden = Math.round(billing.totalPay * burden * 100) / 100;
    const totalGm = Math.round((billing.totalBilled - billing.totalPay - totalBurden) * 100) / 100;
    const totalGmPct = billing.totalBilled > 0 ? (totalGm / billing.totalBilled) * 100 : null;
    return { byAccount, byJobOrder, totalBurden, totalGm, totalGmPct };
  }, [billing, burden]);

  const exportCsv = (): void => {
    if (!margins) return;
    const lines: string[] = [];
    lines.push('Section,Label,Account/Customer,Billed,Payroll,Burden est,Gross margin $,Gross margin %,Invoices,Hours');
    for (const r of margins.byAccount) {
      lines.push(
        [
          'By client',
          r.label,
          r.customerName ?? '',
          r.billed,
          r.pay,
          r.burdenAmt,
          r.gm,
          r.gmPct == null ? '' : r.gmPct.toFixed(1),
          r.invoiceCount,
          '',
        ].map(csvCell).join(','),
      );
    }
    for (const r of margins.byJobOrder) {
      lines.push(
        [
          'By job order',
          r.label,
          r.accountName ?? '',
          r.billed,
          r.pay,
          r.burdenAmt,
          r.gm,
          r.gmPct == null ? '' : r.gmPct.toFixed(1),
          '',
          r.hours,
        ].map(csvCell).join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gross-margin-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const gmColor = (gm: number): string => (gm < 0 ? 'error.main' : 'success.main');

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <TrendingUpIcon fontSize="small" />
            <span>Gross Margin</span>
          </Box>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Hiring entity</InputLabel>
              <Select value={entityId} label="Hiring entity" onChange={(e) => setEntityId(e.target.value)}>
                <MenuItem value="">All entities</MenuItem>
                {entities.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="date"
              label="Start"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="End"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Tooltip title="Estimated employer burden (payroll taxes + workers' comp) applied to payroll. Adjust to your blended rate.">
              <TextField
                size="small"
                label="Burden est."
                value={burdenPct}
                onChange={(e) => setBurdenPct(e.target.value)}
                sx={{ width: 110 }}
                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
              />
            </Tooltip>
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={exportCsv}
              disabled={!margins}
            >
              Export CSV
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Billed = QuickBooks invoices dated in the range (per-class from pre-tax line amounts).
            Payroll = dollars sent to Everee for work dates in the range. Month-boundary timing can
            skew individual jobs — invoices often land after the work.
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {billing && margins && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'Billed', value: usd(billing.totalBilled) },
              { label: 'Payroll', value: usd(billing.totalPay) },
              { label: `Burden est. (${burdenPct}%)`, value: usd(margins.totalBurden) },
              { label: 'Gross margin', value: usd(margins.totalGm) },
              { label: 'Margin %', value: pctFmt(margins.totalGmPct) },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 130 }}>
                <Typography variant="caption" color="text.secondary">
                  {t.label}
                </Typography>
                <Typography variant="h6" fontWeight={600}>
                  {t.value}
                </Typography>
              </Paper>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {rangeLabel} · {billing.invoiceCount} invoices
            {billing.entityFiltered &&
              ' · entity view: only invoices tied to this entity’s payroll (invoices carry no entity of their own)'}
            {billing.unclassifiedBilled > 0 &&
              ` · ${usd(billing.unclassifiedBilled)} billed without a class (counted in client totals, missing from job-order rows)`}
          </Typography>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                By client
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Billed</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Payroll</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Burden est.</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>GM $</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>GM %</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Invoices</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {margins.byAccount.map((r) => (
                      <TableRow key={`${r.accountId ?? ''}|${r.label}`} hover>
                        <TableCell>
                          {r.label}
                          {r.customerName && r.customerName !== r.label && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              QBO: {r.customerName}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{r.billed ? usd(r.billed) : '—'}</TableCell>
                        <TableCell align="right">{r.pay ? usd(r.pay) : '—'}</TableCell>
                        <TableCell align="right">{r.burdenAmt ? usd(r.burdenAmt) : '—'}</TableCell>
                        <TableCell align="right" sx={{ color: gmColor(r.gm), fontWeight: 600 }}>
                          {usd(r.gm)}
                        </TableCell>
                        <TableCell align="right">{pctFmt(r.gmPct)}</TableCell>
                        <TableCell align="right">{r.invoiceCount || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                By job order (QBO class)
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Job order</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Billed</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Payroll</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Burden est.</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>GM $</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>GM %</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Hours</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {margins.byJobOrder.map((r) => (
                      <TableRow key={`${r.accountName ?? ''}|${r.label}`} hover>
                        <TableCell>
                          {r.label}
                          {!r.attributed && r.pay > 0 && (
                            <Chip label="unattributed pay" size="small" sx={{ ml: 1 }} variant="outlined" />
                          )}
                          {r.pay === 0 && r.billed > 0 && (
                            <Tooltip title="Invoiced in this range with no matching payroll — often month-boundary timing or a class name that doesn't match a job order.">
                              <Chip label="billed only" size="small" sx={{ ml: 1 }} variant="outlined" color="info" />
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>{r.accountName ?? '—'}</TableCell>
                        <TableCell align="right">{r.billed ? usd(r.billed) : '—'}</TableCell>
                        <TableCell align="right">{r.pay ? usd(r.pay) : '—'}</TableCell>
                        <TableCell align="right">{r.burdenAmt ? usd(r.burdenAmt) : '—'}</TableCell>
                        <TableCell align="right" sx={{ color: gmColor(r.gm), fontWeight: 600 }}>
                          {usd(r.gm)}
                        </TableCell>
                        <TableCell align="right">{pctFmt(r.gmPct)}</TableCell>
                        <TableCell align="right">{r.hours || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}

      {!billing && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick a date range and hit Load.
        </Typography>
      )}
    </Box>
  );
};

export default GrossMarginReportPage;
