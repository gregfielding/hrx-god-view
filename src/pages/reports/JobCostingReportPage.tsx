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
  Autocomplete,
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

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
  rolled?: { pay: number; hours: number; entries: number; byClass: Record<string, number> } | null;
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
  /** Billing under a bare account-named class (e.g. "Black Caviar") that
   *  cannot be attributed to a specific job order. */
  accountLevelBilled?: number;
  accountLevelClasses?: string[];
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

interface AcctOpt {
  id: string;
  label: string;
  /** 0 = parent/standalone, 1 = child location (indented). */
  depth: number;
  /** Child account ids — picking a parent pulls JOs across all of them. */
  childIds: string[];
}

const JobCostingReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Opt[]>([]);
  const [entityId, setEntityId] = useState('');
  const [accounts, setAccounts] = useState<AcctOpt[]>([]);
  const [accountId, setAccountId] = useState('');
  const [jobOrders, setJobOrders] = useState<Opt[]>([]);
  const [selectedJos, setSelectedJos] = useState<Opt[]>([]);
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

  // Entity → accounts, nested: national/parent accounts first, their
  // child locations indented beneath (Greg 2026-08-27: "Oakland is a
  // location within Legends"). Picking a parent pulls JOs across all of
  // its children; picking a child narrows to that location.
  useEffect(() => {
    setAccounts([]);
    setAccountId('');
    setJobOrders([]);
    setSelectedJos([]);
    setData(null);
    if (!tenantId || !entityId) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'accounts'), where('hiringEntityId', '==', entityId)),
        );
        const rows = snap.docs.map((d) => ({
          id: d.id,
          name: String(d.data().name ?? d.id),
          parentId: String(d.data().parentAccountId ?? '').trim(),
        }));
        const byId = new Map(rows.map((r) => [r.id, r]));
        // A child may point at a parent outside this entity's list —
        // fetch those so the group header still renders.
        const missing = Array.from(
          new Set(rows.map((r) => r.parentId).filter((p) => p && !byId.has(p))),
        );
        const fetched = await Promise.all(
          missing.map(async (id) => {
            try {
              const s = await getDoc(doc(db, 'tenants', tenantId, 'accounts', id));
              return s.exists() ? { id, name: String(s.data().name ?? id), parentId: '' } : null;
            } catch {
              return null;
            }
          }),
        );
        for (const f of fetched) if (f) byId.set(f.id, f);
        const children = new Map<string, typeof rows>();
        const tops: typeof rows = [];
        for (const r of byId.values()) {
          if (r.parentId && byId.has(r.parentId)) {
            if (!children.has(r.parentId)) children.set(r.parentId, []);
            children.get(r.parentId)!.push(r);
          } else {
            tops.push(r);
          }
        }
        tops.sort((a, b) => a.name.localeCompare(b.name));
        const opts: AcctOpt[] = [];
        for (const t of tops) {
          const kids = (children.get(t.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
          opts.push({ id: t.id, label: t.name, depth: 0, childIds: kids.map((k) => k.id) });
          for (const k of kids) opts.push({ id: k.id, label: k.name, depth: 1, childIds: [] });
        }
        setAccounts(opts);
      } catch {
        setAccounts([]);
      }
    })();
  }, [tenantId, entityId]);

  // Account → job orders (a parent account includes its children's JOs).
  useEffect(() => {
    setJobOrders([]);
    setSelectedJos([]);
    setData(null);
    if (!tenantId || !accountId) return;
    const acct = accounts.find((a) => a.id === accountId);
    const ids = [accountId, ...(acct?.childIds ?? [])];
    Promise.all(
      ids.map((id) =>
        getDocs(query(collection(db, 'tenants', tenantId, 'job_orders'), where('recruiterAccountId', '==', id))).catch(
          () => null,
        ),
      ),
    )
      .then((snaps) => {
        const seen = new Set<string>();
        const rows: Array<{ id: string; label: string; sort: number }> = [];
        for (const snap of snaps) {
          if (!snap) continue;
          for (const d of snap.docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            const j = d.data();
            const num = j.jobOrderNumber != null ? `#${j.jobOrderNumber} ` : '';
            const status = j.status ? ` (${String(j.status)})` : '';
            rows.push({
              id: d.id,
              label: `${num}${String(j.jobOrderName ?? d.id)}${status}`,
              sort: Number(j.jobOrderNumber ?? 0),
            });
          }
        }
        rows.sort((a, b) => b.sort - a.sort);
        setJobOrders(rows.map(({ id, label }) => ({ id, label })));
      })
      .catch(() => setJobOrders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, accountId]);

  // Job order(s) → costing. Multi-select combines successor/companion JOs
  // that share billing classes (MN Yacht Club #315 + Country Club #209)
  // into one whole-engagement P&L.
  const selectedIds = selectedJos.map((j) => j.id).join(',');
  useEffect(() => {
    setData(null);
    setError(null);
    if (!tenantId || selectedJos.length === 0) return;
    setLoading(true);
    const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
    fn({ tenantId, jobCosting: true, jobOrderIds: selectedJos.map((j) => j.id) })
      .then((res) => setData(res.data as JoCosting))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, selectedIds]);

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
                  <MenuItem key={a.id} value={a.id} sx={a.depth > 0 ? { pl: 4 } : { fontWeight: a.childIds.length > 0 ? 600 : 400 }}>
                    {a.label}
                    {a.childIds.length > 0 && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        all {a.childIds.length + 1} locations
                      </Typography>
                    )}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Autocomplete
              multiple
              size="small"
              sx={{ minWidth: 360, maxWidth: 640 }}
              disabled={!accountId}
              options={jobOrders}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              value={selectedJos}
              onChange={(_, v) => setSelectedJos(v)}
              renderInput={(params) => (
                <TextField {...params} label="Job order(s)" placeholder={selectedJos.length === 0 ? 'Type to search — pick one or combine several' : ''} />
              )}
            />
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
            {data.rolled && (
              <Tooltip title="Work clocked under this JO but re-attributed to another event's class by a crew-roll date split — excluded from this JO's payroll so P&L matches QBO's class view.">
                <Chip
                  size="small"
                  color="info"
                  variant="outlined"
                  label={`rolled to ${Object.keys(data.rolled.byClass).join(', ')}: ${usd(data.rolled.pay)} (${data.rolled.entries} entries)`}
                />
              </Tooltip>
            )}
            {data.pendingPay > 0 && (
              <Tooltip title="Approved/draft entries not yet sent to Everee — cost still coming.">
                <Chip size="small" color="warning" variant="outlined" label={`pending pay ${usd(data.pendingPay)}`} />
              </Tooltip>
            )}
            {data.billedClasses.length > 0 && (
              <Chip size="small" variant="outlined" label={`billing classes: ${data.billedClasses.join(', ')}`} />
            )}
            {(data.accountLevelBilled ?? 0) > 0 && (
              <Tooltip title={`Invoices under ${data.accountLevelClasses?.join(', ')} describe the whole account, not one event — HRX cannot tell which job order they belong to. To attribute: bill per-event classes in QBO (like Venue Smart does), or map the class to a job order on the QBO Classes report.`}>
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={`${usd(data.accountLevelBilled)} account-level billing not attributed`}
                />
              </Tooltip>
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
