/**
 * /reports/cash-flow — Cash Requirements + Cash-Flow Gap (Greg
 * 2026-08-19, Forecast & budgeting anchor):
 *  - Cash requirements: payroll APPROVED (and still-draft) but not yet
 *    sent to Everee — the cash the next submit pulls, with an
 *    adjustable burden estimate on top.
 *  - Cash-flow gap by client: paid-to-workers vs billed vs COLLECTED
 *    over the range — how much of each client's payroll C1 is floating.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, IconButton, InputAdornment, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import WaterfallChartOutlinedIcon from '@mui/icons-material/WaterfallChartOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const d91Iso = (): string => new Date(Date.now() - 91 * 86400000).toISOString().slice(0, 10);

interface CashClient {
  accountId: string | null;
  label: string;
  customerName: string | null;
  pay: number;
  billed: number;
  collected: number;
  floatBeforeBurden: number;
}

interface CashReq {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  byEntity: Array<{ entityId: string; entityName: string; approvedGross: number; approvedEntries: number; draftGross: number; draftEntries: number; workers: number }>;
  totalApprovedGross: number;
  totalDraftGross: number;
}

const CashFlowReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(d91Iso());
  const [endDate, setEndDate] = useState(todayIso());
  const [burdenPct, setBurdenPct] = useState('12');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<CashClient[] | null>(null);
  const [req, setReq] = useState<CashReq | null>(null);
  const [rangeLabel, setRangeLabel] = useState('');

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
        includeCashFlow: true,
      });
      const d = res.data as {
        billing: { cashFlowByClient: CashClient[] | null } | null;
        billingError: string | null;
        cashRequirements: CashReq | null;
      };
      if (!d.billing?.cashFlowByClient) setError(d.billingError || 'Cash-flow data unavailable.');
      setClients(d.billing?.cashFlowByClient ?? null);
      setReq(d.cashRequirements);
      setRangeLabel(`${startDate} → ${endDate}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    if (!clients) return null;
    const pay = clients.reduce((s, c) => s + c.pay, 0);
    const billed = clients.reduce((s, c) => s + c.billed, 0);
    const collected = clients.reduce((s, c) => s + c.collected, 0);
    const payBurdened = pay * (1 + burden);
    return {
      pay: Math.round(pay * 100) / 100,
      billed: Math.round(billed * 100) / 100,
      collected: Math.round(collected * 100) / 100,
      floatTotal: Math.round((payBurdened - collected) * 100) / 100,
    };
  }, [clients, burden]);

  const nextPayrollNeed = useMemo(
    () => (req ? Math.round(req.totalApprovedGross * (1 + burden) * 100) / 100 : 0),
    [req, burden],
  );

  const exportCsv = (): void => {
    if (!clients) return;
    const lines = ['Client,Paid to workers,Billed,Collected,Float (pay+burden − collected)'];
    for (const c of clients) {
      const fl = Math.round((c.pay * (1 + burden) - c.collected) * 100) / 100;
      lines.push([c.label, c.pay, c.billed, c.collected, fl].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash-flow-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <WaterfallChartOutlinedIcon fontSize="small" />
            <span>Cash Requirements &amp; Flow</span>
          </Box>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" type="date" label="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <Tooltip title="Estimated employer burden (payroll taxes + workers' comp) applied to payroll.">
              <TextField size="small" label="Burden est." value={burdenPct} onChange={(e) => setBurdenPct(e.target.value)} sx={{ width: 100 }} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
            </Tooltip>
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv} disabled={!clients}>
              Export CSV
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Cash requirements = approved-but-unsent payroll (the next Everee submit) + burden.
            Cash-flow gap = paid to workers vs billed vs collected per client over the range —
            positive float means C1&apos;s cash is covering that client&apos;s payroll.
          </Typography>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {req && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Cash requirements — next payroll
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              {[
                { label: `Approved + burden (${burdenPct}%)`, value: usd(nextPayrollNeed) },
                { label: 'Approved gross', value: usd(req.totalApprovedGross) },
                { label: 'Still in draft', value: usd(req.totalDraftGross) },
              ].map((t) => (
                <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 160 }}>
                  <Typography variant="caption" color="text.secondary">{t.label}</Typography>
                  <Typography variant="h6" fontWeight={600}>{t.value}</Typography>
                </Paper>
              ))}
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Approved gross</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>+ burden</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Draft gross</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Entries (appr/draft)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Workers</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {req.byEntity.map((g) => (
                    <TableRow key={g.entityId} hover>
                      <TableCell>{g.entityName}</TableCell>
                      <TableCell align="right">{usd(g.approvedGross)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{usd(g.approvedGross * (1 + burden))}</TableCell>
                      <TableCell align="right">{g.draftGross ? usd(g.draftGross) : '—'}</TableCell>
                      <TableCell align="right">{g.approvedEntries}/{g.draftEntries}</TableCell>
                      <TableCell align="right">{g.workers}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Work dates {req.windowStart} → {req.windowEnd}, as of {req.asOf}. Approved = ready for
              the next submit; draft = still needs review before it becomes payable.
            </Typography>
          </CardContent>
        </Card>
      )}

      {clients && totals && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Cash-flow gap by client
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              {[
                { label: 'Paid to workers', value: usd(totals.pay) },
                { label: 'Billed', value: usd(totals.billed) },
                { label: 'Collected', value: usd(totals.collected) },
                { label: `Total float (pay+${burdenPct}% − collected)`, value: usd(totals.floatTotal) },
              ].map((t) => (
                <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 150 }}>
                  <Typography variant="caption" color="text.secondary">{t.label}</Typography>
                  <Typography variant="h6" fontWeight={600}>{t.value}</Typography>
                </Paper>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {rangeLabel}
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Paid to workers</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Billed</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Collected</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Float</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {clients.map((c) => {
                    const fl = Math.round((c.pay * (1 + burden) - c.collected) * 100) / 100;
                    return (
                      <TableRow key={`${c.accountId ?? ''}|${c.label}`} hover>
                        <TableCell>
                          {c.label}
                          {c.customerName && c.customerName !== c.label && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              QBO: {c.customerName}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{c.pay ? usd(c.pay) : '—'}</TableCell>
                        <TableCell align="right">{c.billed ? usd(c.billed) : '—'}</TableCell>
                        <TableCell align="right">{c.collected ? usd(c.collected) : '—'}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, color: fl > 0 ? 'error.main' : 'success.main' }}>
                          {usd(fl)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {!clients && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick a range (defaults to trailing 91 days) and hit Load.
        </Typography>
      )}
    </Box>
  );
};

export default CashFlowReportPage;
