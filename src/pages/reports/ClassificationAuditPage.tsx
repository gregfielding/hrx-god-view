/**
 * /reports/classification-audit — Classification Verification (Greg
 * 2026-09-01): every payroll dollar and invoice line in range is either
 * CONFIRMED by structural evidence (per-payment human answer, JO# note
 * tag, dated notes × timesheets, assignment coverage) or FLAGGED for
 * manual review — no silent middle. Flags are resolved inline: assigning
 * a class writes a payment-kind override (trumps every heuristic) and
 * refreezes the attribution ledger, so each answer is permanent.
 *
 * Also surfaces the two structural health checks that caught the
 * Governors Ball / FIFA NY incidents: job orders whose timesheets run
 * past their class's billing window (a crew rolled but the JO wasn't
 * switched), and per-class revenue/labor ratios outside the healthy
 * staffing band (~1.2–1.8 — under-billing or missing labor).
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Snackbar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const todayIso = (): string => new Date().toISOString().slice(0, 10);

interface TierRow { tier: string; amount: number }
interface PayrollFlag {
  paymentId: string; worker: string; fundingDate: string; amount: number;
  label: string; qboClass: string; method: string; tier: string; reason: string;
}
interface InvoiceFlag { date: string; doc: string; customer: string; amount: number; cls: string; reason: string }
interface RatioRow { cls: string; revenue: number; labor: number; ratio: number | null; verdict: string }
interface UnhealthyJo { jobOrderId: string; jobOrderName: string; timesheetsTo: string; billingEnds: string; cls: string }
interface AuditData {
  startDate: string; endDate: string;
  tiers: TierRow[];
  payrollFlags: PayrollFlag[];
  invoiceFlags: InvoiceFlag[];
  ratios: RatioRow[];
  unhealthyJos: UnhealthyJo[];
  invoiceLineCount: number;
  activeClasses: string[];
}

const TIER_META: Record<string, { label: string; color: 'success' | 'info' | 'warning' | 'error' }> = {
  CONFIRMED: { label: 'Confirmed', color: 'success' },
  CORROBORATED: { label: 'Corroborated', color: 'info' },
  FLAG_WEAK: { label: 'Weak evidence', color: 'warning' },
  FLAG_UNKNOWN: { label: 'Unknown', color: 'error' },
};

const VERDICT_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  OK: 'success',
  'UNDER-BILLED?': 'error',
  'LABOR-MISSING?': 'warning',
  'LABOR-NO-REVENUE': 'error',
  'REVENUE-NO-LABOR': 'warning',
};

const ClassificationAuditPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [startDate, setStartDate] = useState('2026-05-15');
  const [endDate, setEndDate] = useState(todayIso());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AuditData | null>(null);
  const [tab, setTab] = useState(0);
  // per-flag pending class picks + rows already resolved this session
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // "Apply to all" toast (Greg 2026-09-01): after one save, offer the same
  // class to every other flagged row sharing the same current guess —
  // the timesheet-layout pattern.
  const [bulkOffer, setBulkOffer] = useState<{ cls: string; guess: string; rows: PayrollFlag[] } | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);

  const run = async (): Promise<void> => {
    if (!tenantId) return;
    setRunning(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping', { timeout: 540000 });
      const res = await fn({ tenantId, action: 'classificationAudit', startDate, endDate });
      setData(res.data as AuditData);
      setPicks({});
      setResolved({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const resolveFlag = async (flag: PayrollFlag): Promise<void> => {
    if (!tenantId) return;
    const key = `${flag.paymentId}|${flag.label}`;
    const cls = picks[key];
    if (!cls) return;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping', { timeout: 60000 });
      await fn({ tenantId, action: 'resolveClassificationFlag', paymentId: flag.paymentId, class: cls, worker: flag.worker });
      setResolved((r) => ({ ...r, [key]: cls }));
      if (data) {
        const guessOf = (f: PayrollFlag): string => f.qboClass || f.label || '';
        const guess = guessOf(flag);
        const peers = data.payrollFlags.filter((f) => {
          const k = `${f.paymentId}|${f.label}`;
          return k !== key && !resolved[k] && guessOf(f) === guess && guess !== '';
        });
        setBulkOffer(peers.length > 0 ? { cls, guess, rows: peers } : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const applyBulk = async (): Promise<void> => {
    if (!tenantId || !bulkOffer) return;
    setBulkApplying(true);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping', { timeout: 120000 });
      await fn({
        tenantId, action: 'resolveClassificationFlags', class: bulkOffer.cls,
        rows: bulkOffer.rows.map((f) => ({ paymentId: f.paymentId, worker: f.worker })),
      });
      setResolved((r) => {
        const next = { ...r };
        for (const f of bulkOffer.rows) next[`${f.paymentId}|${f.label}`] = bulkOffer.cls;
        return next;
      });
      setBulkOffer(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkApplying(false);
    }
  };

  const tierTotal = useMemo(
    () => (data ? data.tiers.reduce((s, t) => s + t.amount, 0) : 0),
    [data],
  );
  const flaggedTotal = useMemo(
    () => (data ? data.tiers.filter((t) => t.tier.startsWith('FLAG')).reduce((s, t) => s + t.amount, 0) : 0),
    [data],
  );
  const badRatios = useMemo(() => (data ? data.ratios.filter((r) => r.verdict !== 'OK') : []), [data]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton onClick={() => navigate('/reports')} size="small">
          <ArrowBackIcon />
        </IconButton>
        <FactCheckOutlinedIcon color="primary" />
        <PageHeader title="Classification Verification" showDivider={false} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
        Every payroll dollar in range is either confirmed by structural evidence or flagged for manual review —
        no silent middle. Assigning a class to a flagged payment writes a permanent per-payment override.
        Invoice lines are checked for class-family consistency; classes are sanity-checked on their
        revenue-to-labor ratio (healthy staffing bills ≈ 1.2–1.8× wages).
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <TextField
              label="Start (funding date)" type="date" size="small" value={startDate}
              onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End (funding date)" type="date" size="small" value={endDate}
              onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" onClick={() => void run()} disabled={running || !tenantId}>
              {running ? 'Auditing… (takes a few minutes)' : 'Run audit'}
            </Button>
            {running && <CircularProgress size={22} />}
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            {data.tiers.map((t) => {
              const meta = TIER_META[t.tier] ?? { label: t.tier, color: 'default' as const };
              return (
                <Card key={t.tier} sx={{ minWidth: 180, flex: 1 }}>
                  <CardContent>
                    <Chip size="small" color={meta.color} label={meta.label} sx={{ mb: 1 }} />
                    <Typography variant="h6">{usd(t.amount)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tierTotal > 0 ? `${((100 * t.amount) / tierTotal).toFixed(1)}% of payroll` : ''}
                    </Typography>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
            <Tab label={`Flagged payroll (${data.payrollFlags.length} · ${usd(flaggedTotal)})`} />
            <Tab label={`Invoice flags (${data.invoiceFlags.length} of ${data.invoiceLineCount})`} />
            <Tab label={`Class health (${badRatios.length} flagged)`} />
            <Tab label={`Job-order health (${data.unhealthyJos.length})`} />
          </Tabs>

          {tab === 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Funded</TableCell>
                    <TableCell>Worker</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Current guess</TableCell>
                    <TableCell>Why flagged</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>Assign class</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.payrollFlags.map((f) => {
                    const key = `${f.paymentId}|${f.label}`;
                    const done = resolved[key];
                    return (
                      <TableRow key={key} sx={done ? { opacity: 0.5 } : undefined}>
                        <TableCell>{f.fundingDate}</TableCell>
                        <TableCell>{f.worker}</TableCell>
                        <TableCell align="right">{usd(f.amount)}</TableCell>
                        <TableCell>
                          {f.qboClass || f.label || <em>none</em>}{' '}
                          <Chip
                            size="small"
                            color={(TIER_META[f.tier] ?? { color: 'default' as const }).color}
                            label={f.method}
                          />
                        </TableCell>
                        <TableCell>{f.reason}</TableCell>
                        <TableCell>
                          {done ? (
                            <Chip size="small" color="success" label={`saved → ${done}`} />
                          ) : (
                            <Autocomplete
                              size="small"
                              options={data.activeClasses}
                              value={picks[key] ?? null}
                              onChange={(_, v) => setPicks((p) => ({ ...p, [key]: v ?? '' }))}
                              renderInput={(params) => <TextField {...params} placeholder="Pick QBO class…" />}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {!done && (
                            <Button
                              size="small" variant="outlined"
                              disabled={!picks[key] || saving[key]}
                              onClick={() => void resolveFlag(f)}
                            >
                              {saving[key] ? 'Saving…' : 'Save'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {tab === 1 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Invoice</TableCell>
                    <TableCell>Customer</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Class</TableCell>
                    <TableCell>Reason</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.invoiceFlags.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography variant="body2" color="text.secondary">
                          No invoice flags — every line in range is classed and family-consistent.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {data.invoiceFlags.map((f, i) => (
                    <TableRow key={`${f.doc}-${i}`}>
                      <TableCell>{f.date}</TableCell>
                      <TableCell>{f.doc}</TableCell>
                      <TableCell>{f.customer}</TableCell>
                      <TableCell align="right">{usd(f.amount)}</TableCell>
                      <TableCell>{f.cls || <em>none</em>}</TableCell>
                      <TableCell>{f.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {tab === 2 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Class</TableCell>
                    <TableCell align="right">Revenue</TableCell>
                    <TableCell align="right">Labor</TableCell>
                    <TableCell align="right">Rev ÷ labor</TableCell>
                    <TableCell>Verdict</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...data.ratios]
                    .sort((a, b) => Number(a.verdict === 'OK') - Number(b.verdict === 'OK') || b.labor - a.labor)
                    .map((r) => (
                      <TableRow key={r.cls}>
                        <TableCell>{r.cls}</TableCell>
                        <TableCell align="right">{usd(r.revenue)}</TableCell>
                        <TableCell align="right">{usd(r.labor)}</TableCell>
                        <TableCell align="right">{r.ratio === null ? '—' : r.ratio.toFixed(2)}</TableCell>
                        <TableCell>
                          <Chip size="small" color={VERDICT_COLOR[r.verdict] ?? 'default'} label={r.verdict} />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {tab === 3 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Job order</TableCell>
                    <TableCell>Class</TableCell>
                    <TableCell>Timesheets run to</TableCell>
                    <TableCell>Billing ends</TableCell>
                    <TableCell>What it means</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.unhealthyJos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          No job orders with timesheets past their billing window.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {data.unhealthyJos.map((j) => (
                    <TableRow key={j.jobOrderId}>
                      <TableCell>{j.jobOrderName}</TableCell>
                      <TableCell>{j.cls}</TableCell>
                      <TableCell>{j.timesheetsTo}</TableCell>
                      <TableCell>{j.billingEnds}</TableCell>
                      <TableCell>
                        Crew kept clocking after billing stopped — either the crew rolled to another event
                        (fix: a payroll_jo_date_splits doc) or these weeks were never invoiced.
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
      <Snackbar
        open={Boolean(bulkOffer)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        onClose={() => setBulkOffer(null)}
        message={bulkOffer ? `Saved. ${bulkOffer.rows.length} more flagged rows share the guess "${bulkOffer.guess}".` : ''}
        action={
          bulkOffer ? (
            <Button color="secondary" size="small" disabled={bulkApplying} onClick={() => void applyBulk()}>
              {bulkApplying ? 'Applying…' : `Apply "${bulkOffer.cls}" to all ${bulkOffer.rows.length}`}
            </Button>
          ) : undefined
        }
      />
    </Box>
  );
};

export default ClassificationAuditPage;
