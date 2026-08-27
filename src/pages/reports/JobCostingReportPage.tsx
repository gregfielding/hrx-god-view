/**
 * /reports/job-costing — one job order's complete P&L over its WHOLE
 * LIFE (Greg 2026-08-27: "pick an entity, then account, then job order
 * … based on job order not date").
 *
 * Cascading pickers (entity → account → job order, read straight from
 * Firestore), then one getPayrollCostReport({jobCosting:true, jobOrderId})
 * call. The server derives its own horizon from the JO's entries — no
 * date window to distort events whose invoices land months after the
 * work. Costs are real lines: payroll (Everee-sent entries), WC premium
 * (entry class-code rates), employer taxes (entity's actual Everee rate
 * for the work span), reimbursements, and QBO expenses classed to the
 * order (Expensify card spend; Everee wires excluded server-side).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface JoCosting {
  jobOrderId: string;
  jobOrderName: string;
  jobOrderNumber: number | string | null;
  status: string | null;
  accountName: string | null;
  workSpan: { start: string; end: string } | null;
  windowStart: string;
  windowEnd: string;
  entryCount: number;
  workers: number;
  hours: number;
  pay: number;
  pendingPay: number;
  tips: number;
  bonus: number;
  reimbursements: number;
  wcPremium: number;
  taxBurden: number | null;
  burdenAvailable: boolean;
  burdenByEntity: Record<string, { ratePct: number }>;
  billed: number;
  billedClasses: string[];
  invoiceRefs: Array<{ docNumber: string | null; txnDate: string | null; amount: number; customerName: string | null }>;
  expenses: number;
  expenseClasses: string[];
  expenseLines: Array<{ txnDate: string | null; vendor: string | null; memo: string | null; amount: number }>;
  grossProfit: number;
  grossProfitPct: number | null;
}

interface Opt {
  id: string;
  label: string;
}

const JobCostingReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Opt[]>([]);
  const [entityId, setEntityId] = useState('');
  const [accounts, setAccounts] = useState<Opt[]>([]);
  const [accountId, setAccountId] = useState('');
  const [jobOrders, setJobOrders] = useState<Opt[]>([]);
  const [jobOrderId, setJobOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<JoCosting | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) =>
        setEntities(
          snap.docs
            .map((d) => ({ id: d.id, label: String(d.data().name ?? d.id) }))
            .filter((e) => !/sandbox/i.test(e.id) && !/sandbox/i.test(e.label)),
        ),
      )
      .catch(() => setEntities([]));
  }, [tenantId]);

  // Entity → accounts.
  useEffect(() => {
    setAccounts([]);
    setAccountId('');
    setJobOrders([]);
    setJobOrderId('');
    setData(null);
    if (!tenantId || !entityId) return;
    getDocs(query(collection(db, 'tenants', tenantId, 'accounts'), where('hiringEntityId', '==', entityId)))
      .then((snap) =>
        setAccounts(
          snap.docs
            .map((d) => ({ id: d.id, label: String(d.data().name ?? d.id) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ),
      )
      .catch(() => setAccounts([]));
  }, [tenantId, entityId]);

  // Account → job orders.
  useEffect(() => {
    setJobOrders([]);
    setJobOrderId('');
    setData(null);
    if (!tenantId || !accountId) return;
    getDocs(query(collection(db, 'tenants', tenantId, 'job_orders'), where('recruiterAccountId', '==', accountId)))
      .then((snap) =>
        setJobOrders(
          snap.docs
            .map((d) => {
              const j = d.data();
              const num = j.jobOrderNumber != null ? `#${j.jobOrderNumber} ` : '';
              const status = j.status ? ` (${String(j.status)})` : '';
              return { id: d.id, label: `${num}${String(j.jobOrderName ?? d.id)}${status}`, sort: Number(j.jobOrderNumber ?? 0) };
            })
            .sort((a, b) => (b as { sort: number }).sort - (a as { sort: number }).sort)
            .map(({ id, label }) => ({ id, label })),
        ),
      )
      .catch(() => setJobOrders([]));
  }, [tenantId, accountId]);

  // Job order → costing.
  useEffect(() => {
    setData(null);
    setError(null);
    if (!tenantId || !jobOrderId) return;
    setLoading(true);
    const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
    fn({ tenantId, jobCosting: true, jobOrderId })
      .then((res) => setData(res.data as JoCosting))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [tenantId, jobOrderId]);

  const gpColor = (gp: number): string => (gp < 0 ? 'error.main' : 'success.main');

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
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel>Hiring entity</InputLabel>
              <Select value={entityId} label="Hiring entity" onChange={(e) => setEntityId(e.target.value)}>
                {entities.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 260 }} disabled={!entityId}>
              <InputLabel>Account</InputLabel>
              <Select value={accountId} label="Account" onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 300 }} disabled={!accountId}>
              <InputLabel>Job order</InputLabel>
              <Select value={jobOrderId} label="Job order" onChange={(e) => setJobOrderId(e.target.value)}>
                {jobOrders.map((j) => (
                  <MenuItem key={j.id} value={j.id}>
                    {j.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {loading && <CircularProgress size={22} />}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            The full life of the job order — payroll from every Everee-sent entry, billing and
            expenses from QuickBooks lines classed to the order (Everee wire purchases excluded so
            payroll never double-counts). No date window: invoices that land after the work still
            count.
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'Billed', value: usd(data.billed) },
              { label: 'Payroll', value: usd(data.pay) },
              { label: 'WC premium', value: usd(data.wcPremium) },
              {
                label: data.burdenAvailable ? 'Employer taxes (Everee)' : 'Employer taxes (est. 12%)',
                value: usd(data.taxBurden ?? Math.round(data.pay * 12) / 100),
              },
              ...(data.reimbursements > 0 ? [{ label: 'Reimbursements', value: usd(data.reimbursements) }] : []),
              { label: 'Expenses', value: usd(data.expenses) },
              { label: 'Gross profit', value: usd(data.grossProfit) },
              { label: 'GP %', value: data.grossProfitPct == null ? '—' : `${data.grossProfitPct.toFixed(1)}%` },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 120 }}>
                <Typography variant="caption" color="text.secondary">
                  {t.label}
                </Typography>
                <Typography
                  variant="h6"
                  fontWeight={600}
                  sx={t.label === 'Gross profit' ? { color: gpColor(data.grossProfit) } : undefined}
                >
                  {t.value}
                </Typography>
              </Paper>
            ))}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            {data.workSpan && (
              <Chip size="small" variant="outlined" label={`work ${data.workSpan.start} → ${data.workSpan.end}`} />
            )}
            <Chip size="small" variant="outlined" label={`${data.workers} workers · ${data.hours} hrs · ${data.entryCount} paid entries`} />
            {data.pendingPay > 0 && (
              <Tooltip title="Approved/draft entries not yet sent to Everee — cost still coming.">
                <Chip size="small" color="warning" variant="outlined" label={`pending pay ${usd(data.pendingPay)}`} />
              </Tooltip>
            )}
            {data.billedClasses.length > 0 && (
              <Chip size="small" variant="outlined" label={`billing classes: ${data.billedClasses.join(', ')}`} />
            )}
            <Tooltip title="QBO billing/expenses scanned from 45 days before the first worked day through today.">
              <Chip size="small" variant="outlined" label={`QBO window ${data.windowStart} → ${data.windowEnd}`} />
            </Tooltip>
          </Stack>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Card sx={{ flex: 1, minWidth: 340 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Invoices ({data.invoiceRefs.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Invoice</TableCell>
                        <TableCell>Customer</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.invoiceRefs.map((r, i) => (
                        <TableRow key={i} hover>
                          <TableCell>{r.txnDate ?? '—'}</TableCell>
                          <TableCell>{r.docNumber ?? '—'}</TableCell>
                          <TableCell>{r.customerName ?? '—'}</TableCell>
                          <TableCell align="right">{usd(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      {data.invoiceRefs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4}>
                            <Typography variant="caption" color="text.secondary">
                              No QBO invoice lines matched this job order's classes yet.
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
                  Expenses ({data.expenseLines.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Vendor</TableCell>
                        <TableCell>Memo</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.expenseLines.map((r, i) => (
                        <TableRow key={i} hover>
                          <TableCell>{r.txnDate ?? '—'}</TableCell>
                          <TableCell>{r.vendor ?? '—'}</TableCell>
                          <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.memo ?? '—'}
                          </TableCell>
                          <TableCell align="right">{usd(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      {data.expenseLines.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4}>
                            <Typography variant="caption" color="text.secondary">
                              No card/expense lines classed to this job order.
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

      {!data && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick entity → account → job order.
        </Typography>
      )}
    </Box>
  );
};

export default JobCostingReportPage;
