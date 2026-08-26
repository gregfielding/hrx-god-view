/**
 * /reports/job-costing — one job order's complete P&L (Greg 2026-08-19):
 * entity → client → job order drill-down showing billing (QBO invoice
 * lines classed to the order), payroll (Everee via timesheet entries),
 * an adjustable employer-burden estimate, and non-payroll expenses (QBO
 * Purchases classed to the order — the Expensify write-back's classes;
 * Everee-vendor purchases are excluded server-side so payroll never
 * double-counts).
 *
 * One getPayrollCostReport call (includeBilling + includeExpenses) loads
 * everything for the range; the client/JO filters slice it locally.
 * Matching is class-name based — spend classed in QBO under a name that
 * doesn't resolve to a job order shows on the Gross Margin report as its
 * own row until mapped.
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
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const yearStartIso = (): string => `${todayIso().slice(0, 4)}-01-01`;

interface JcRow {
  label: string;
  accountId: string | null;
  accountName: string | null;
  attributed: boolean;
  pay: number;
  hours: number;
  workers: number;
  billed: number;
  billedClasses: string[];
  expenses: number;
  expenseClasses: string[];
}

interface ClassDetail {
  className: string;
  billed?: number;
  invoiceRefs?: Array<{ docNumber: string | null; txnDate: string | null; amount: number; customerName: string | null }>;
  expenses?: number;
  expenseLines?: Array<{ txnDate: string | null; vendor: string | null; memo: string | null; amount: number }>;
}

interface BillingData {
  byJobOrder: JcRow[];
  classDetail: Record<string, ClassDetail>;
  excludedEvereeTotal: number | null;
  unclassifiedExpenses: number | null;
}

const JobCostingReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState(yearStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [burdenPct, setBurdenPct] = useState('12');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BillingData | null>(null);
  const [client, setClient] = useState('');
  const [joLabel, setJoLabel] = useState('');

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
    setClient('');
    setJoLabel('');
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
      const res = await fn({
        tenantId,
        startDate,
        endDate,
        includeBilling: true,
        includeExpenses: true,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const d = res.data as { billing: BillingData | null; billingError: string | null };
      if (!d.billing) {
        setError(d.billingError || 'QuickBooks data unavailable — is QuickBooks connected?');
        setData(null);
      } else {
        setData(d.billing);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const clients = useMemo(() => {
    if (!data) return [] as string[];
    const names = new Set<string>();
    for (const r of data.byJobOrder) names.add(r.accountName ?? '(unmatched billing/expenses)');
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const clientRows = useMemo(() => {
    if (!data || !client) return [] as JcRow[];
    return data.byJobOrder
      .filter((r) => (r.accountName ?? '(unmatched billing/expenses)') === client)
      .sort((a, b) => b.billed + b.pay - (a.billed + a.pay));
  }, [data, client]);

  const selected = useMemo(
    () => clientRows.find((r) => r.label === joLabel) ?? null,
    [clientRows, joLabel],
  );

  const jcOf = (r: JcRow) => {
    const burdenAmt = Math.round(r.pay * burden * 100) / 100;
    const gp = Math.round((r.billed - r.pay - burdenAmt - r.expenses) * 100) / 100;
    const gpPct = r.billed > 0 ? (gp / r.billed) * 100 : null;
    return { burdenAmt, gp, gpPct };
  };

  const detail = useMemo(() => {
    if (!selected || !data) return null;
    const invoiceRefs = selected.billedClasses.flatMap(
      (c) => data.classDetail[c]?.invoiceRefs ?? [],
    );
    const expenseLines = selected.expenseClasses.flatMap(
      (c) => data.classDetail[c]?.expenseLines ?? [],
    );
    invoiceRefs.sort((a, b) => String(b.txnDate).localeCompare(String(a.txnDate)));
    expenseLines.sort((a, b) => String(b.txnDate).localeCompare(String(a.txnDate)));
    return { invoiceRefs, expenseLines };
  }, [selected, data]);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <CalculateOutlinedIcon fontSize="small" />
            <span>Job Costing</span>
          </Box>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 180 }}>
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
            <Tooltip title="Estimated employer burden (payroll taxes + workers' comp) applied to payroll.">
              <TextField
                size="small"
                label="Burden est."
                value={burdenPct}
                onChange={(e) => setBurdenPct(e.target.value)}
                sx={{ width: 100 }}
                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
              />
            </Tooltip>
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            {data && (
              <>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel>Client</InputLabel>
                  <Select
                    value={client}
                    label="Client"
                    onChange={(e) => {
                      setClient(e.target.value);
                      setJoLabel('');
                    }}
                  >
                    {clients.map((c) => (
                      <MenuItem key={c} value={c}>
                        {c}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 260 }} disabled={!client}>
                  <InputLabel>Job order</InputLabel>
                  <Select value={joLabel} label="Job order" onChange={(e) => setJoLabel(e.target.value)}>
                    <MenuItem value="">All ({clientRows.length})</MenuItem>
                    {clientRows.map((r) => (
                      <MenuItem key={r.label} value={r.label}>
                        {r.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Billing and expenses come from QuickBooks lines classed to the order (Expensify card spend
            arrives via its QBO class); payroll from Everee-sent timesheet entries; Everee wire
            purchases are excluded so payroll never double-counts. Class names that don&apos;t resolve
            to a job order appear on the Gross Margin report until mapped.
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Single job order — the full costing view. */}
      {selected && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {(() => {
              const { burdenAmt, gp, gpPct } = jcOf(selected);
              return [
                { label: 'Billed', value: usd(selected.billed) },
                { label: 'Payroll', value: usd(selected.pay) },
                { label: `Burden est. (${burdenPct}%)`, value: usd(burdenAmt) },
                { label: 'Expenses', value: usd(selected.expenses) },
                { label: 'Gross profit', value: usd(gp) },
                { label: 'GP %', value: gpPct == null ? '—' : `${gpPct.toFixed(1)}%` },
              ].map((t) => (
                <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 120 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t.label}
                  </Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {t.value}
                  </Typography>
                </Paper>
              ));
            })()}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {selected.hours ? `${selected.hours} hours · ` : ''}
            {selected.workers ? `${selected.workers} workers · ` : ''}
            {startDate} → {endDate}
            {selected.billedClasses.length > 0 && ` · billing classes: ${selected.billedClasses.join(', ')}`}
            {selected.expenseClasses.length > 0 && ` · expense classes: ${selected.expenseClasses.join(', ')}`}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Card sx={{ flex: 1, minWidth: 340 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Invoices ({detail?.invoiceRefs.length ?? 0})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Invoice</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Amount (this order)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detail?.invoiceRefs ?? []).map((inv, i) => (
                        <TableRow key={i} hover>
                          <TableCell>
                            #{inv.docNumber || '—'}
                            {inv.customerName && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {inv.customerName}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{inv.txnDate ?? '—'}</TableCell>
                          <TableCell align="right">{usd(inv.amount)}</TableCell>
                        </TableRow>
                      ))}
                      {(detail?.invoiceRefs ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3}>
                            <Typography variant="body2" color="text.secondary">
                              No invoice lines classed to this order in the range.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            <Card sx={{ flex: 1, minWidth: 340 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Expenses ({detail?.expenseLines.length ?? 0})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Vendor / memo</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detail?.expenseLines ?? []).map((l, i) => (
                        <TableRow key={i} hover>
                          <TableCell>{l.txnDate ?? '—'}</TableCell>
                          <TableCell>
                            {l.vendor || '—'}
                            {l.memo && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                                {l.memo.slice(0, 120)}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">{usd(l.amount)}</TableCell>
                        </TableRow>
                      ))}
                      {(detail?.expenseLines ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3}>
                            <Typography variant="body2" color="text.secondary">
                              No expenses classed to this order in the range.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Box>
        </>
      )}

      {/* Client overview — all its job orders, pick one to drill in. */}
      {data && client && !selected && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              {client} — job orders
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Job order</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Billed</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Payroll</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Burden est.</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Expenses</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>GP $</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>GP %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {clientRows.map((r) => {
                    const { burdenAmt, gp, gpPct } = jcOf(r);
                    return (
                      <TableRow key={r.label} hover sx={{ cursor: 'pointer' }} onClick={() => setJoLabel(r.label)}>
                        <TableCell>
                          {r.label}
                          {r.pay === 0 && (r.billed > 0 || r.expenses > 0) && (
                            <Chip label="no payroll" size="small" variant="outlined" sx={{ ml: 1 }} />
                          )}
                        </TableCell>
                        <TableCell align="right">{r.billed ? usd(r.billed) : '—'}</TableCell>
                        <TableCell align="right">{r.pay ? usd(r.pay) : '—'}</TableCell>
                        <TableCell align="right">{burdenAmt ? usd(burdenAmt) : '—'}</TableCell>
                        <TableCell align="right">{r.expenses ? usd(r.expenses) : '—'}</TableCell>
                        <TableCell align="right" sx={{ color: gp < 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                          {usd(gp)}
                        </TableCell>
                        <TableCell align="right">{gpPct == null ? '—' : `${gpPct.toFixed(1)}%`}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {data && !client && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Loaded {data.byJobOrder.length} job orders — pick a client above.
        </Typography>
      )}
      {!data && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick a range (defaults to year-to-date) and hit Load, then drill entity → client → job order.
        </Typography>
      )}
    </Box>
  );
};

export default JobCostingReportPage;
