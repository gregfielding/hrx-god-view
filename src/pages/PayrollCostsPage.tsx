/**
 * Payroll Costs — "what did each job cost us in payroll?" (Greg 2026-07-28).
 *
 * Front-end for the `getPayrollCostReport` callable: pick a date range
 * (+ optional hiring entity), see dollars sent to Everee grouped by
 * job order and account, plus per-submission-day splits the bookkeeper
 * uses to parse funding wires across QBO classes. One-click CSV export
 * with job order + worksite columns per Greg's spec.
 *
 * Plain-English, pick-a-range, no config — per the recruiter-UX ethos.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Typography,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import WorkersCompMonthlyCard from '../components/payroll/WorkersCompMonthlyCard';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface GroupTotals {
  key: string;
  label: string;
  entries: number;
  workers: number;
  hours: number;
  total: number;
  pct: number;
  /** Name-keyed (class) groups only — absent on byAccount. */
  accountName?: string | null;
  attributed?: boolean;
  jobOrderRefs?: string[];
  poNumbers?: string[];
}

interface ReportData {
  totals: { gross: number; entries: number; workers: number; unattributed: number };
  truncated: boolean;
  byJobOrder: GroupTotals[];
  byAccount: GroupTotals[];
  byBatch: Array<{
    batchId: string;
    hiringEntityId: string;
    total: number;
    entries: number;
    dateRange: { min: string; max: string };
    byJobOrder: Array<{ label: string; total: number; pct: number }>;
  }>;
  rows: Array<Record<string, unknown>>;
  venueMappings?: Array<{
    venueLabel: string;
    jobOrderId: string;
    jobOrderName: string | null;
    jobOrderNumber: string | null;
    accountName: string | null;
  }>;
}

interface JoOption {
  id: string;
  label: string;
}

function monthStartIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const CSV_COLUMNS: Array<{ header: string; key: string }> = [
  { header: 'Worker', key: 'workerName' },
  { header: 'Work date', key: 'workDate' },
  { header: 'Hiring entity', key: 'hiringEntityId' },
  { header: 'Account', key: 'accountName' },
  { header: 'Job order #', key: 'jobOrderNumber' },
  { header: 'Customer PO', key: 'poNumber' },
  { header: 'Job order', key: 'jobOrderName' },
  { header: 'Worksite', key: 'worksiteName' },
  { header: 'Hours', key: 'hours' },
  { header: 'Gross', key: 'gross' },
  { header: 'Tips', key: 'tips' },
  { header: 'Bonus', key: 'bonus' },
  { header: 'Premiums', key: 'premiums' },
  { header: 'Total', key: 'total' },
  { header: 'Status', key: 'status' },
  { header: 'Source', key: 'source' },
  { header: 'Sent (entity · day)', key: 'batchId' },
];

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PayrollCostsPage: React.FC = () => {
  const { tenantId } = useAuth();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  // Venue → job order mapping dialog state.
  const [mapVenue, setMapVenue] = useState<string | null>(null);
  const [joOptions, setJoOptions] = useState<JoOption[] | null>(null);
  const [mapJo, setMapJo] = useState<JoOption | null>(null);
  const [mapSaving, setMapSaving] = useState(false);
  // Off-cycle payment dialog state (Mark's manual adjustment form).
  const [ocOpen, setOcOpen] = useState(false);
  const [ocWorkerQuery, setOcWorkerQuery] = useState('');
  const [ocWorkerOpts, setOcWorkerOpts] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [ocWorker, setOcWorker] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const [ocEntity, setOcEntity] = useState('');
  const [ocReason, setOcReason] = useState('missed_hours');
  const [ocDate, setOcDate] = useState(todayIso());
  const [ocHours, setOcHours] = useState('');
  const [ocRate, setOcRate] = useState('');
  const [ocGross, setOcGross] = useState('');
  const [ocGrossTouched, setOcGrossTouched] = useState(false);
  const [ocPerDiem, setOcPerDiem] = useState('');
  const [ocJo, setOcJo] = useState<JoOption | null>(null);
  const [ocNotes, setOcNotes] = useState('');
  const [ocSaving, setOcSaving] = useState(false);
  const [ocError, setOcError] = useState<string | null>(null);
  const [ocSuccess, setOcSuccess] = useState<string | null>(null);
  // Duplicate-pay guard: server found a submitted timesheet for the same
  // worker + work date — sending requires an explicit second confirm.
  const [ocDupWarning, setOcDupWarning] = useState<{
    workDate: string;
    totalHours: number;
    totalAmount: number;
  } | null>(null);

  // Debounced worker search for the off-cycle dialog.
  useEffect(() => {
    if (!ocOpen || ocWorkerQuery.trim().length < 2 || !tenantId) return;
    const t = setTimeout(() => {
      const fn = httpsCallable(functions, 'searchOffCycleWorkers');
      fn({ tenantId, query: ocWorkerQuery.trim() })
        .then((res) => {
          const d = res.data as { workers?: Array<{ id: string; name: string; email: string | null }> };
          setOcWorkerOpts(d.workers ?? []);
        })
        .catch(() => setOcWorkerOpts([]));
    }, 350);
    return () => clearTimeout(t);
  }, [ocOpen, ocWorkerQuery, tenantId]);

  // Gross auto-computes from hours × rate until the user edits it directly.
  useEffect(() => {
    if (ocGrossTouched) return;
    const h = Number(ocHours);
    const r = Number(ocRate);
    if (h > 0 && r > 0) setOcGross((Math.round(h * r * 100) / 100).toFixed(2));
  }, [ocHours, ocRate, ocGrossTouched]);

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

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport');
      const res = await fn({
        tenantId,
        startDate,
        endDate,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      setData(res.data as ReportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, startDate, endDate, entityId]);

  useEffect(() => {
    void load();
    // Initial load only — subsequent loads via the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const ensureJoOptions = useCallback(async () => {
    if (joOptions || !tenantId) return;
    const opts: JoOption[] = [];
    const seen = new Set<string>();
    for (const coll of ['job_orders', 'recruiter_jobOrders']) {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, coll));
        snap.docs.forEach((d) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          const v = d.data();
          const name = String(v.jobOrderName ?? '').trim();
          if (!name) return;
          const numPart = String(v.jobOrderNumber ?? '').trim();
          const sitePart = String(v.worksiteName ?? '').trim();
          opts.push({
            id: d.id,
            label: `${numPart ? `#${numPart} ` : ''}${name}${sitePart && sitePart !== name ? ` — ${sitePart}` : ''}`,
          });
        });
      } catch {
        // Collection may not exist for this tenant — keep going.
      }
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    setJoOptions(opts);
  }, [joOptions, tenantId]);

  const openMapDialog = async (unattributedLabel: string) => {
    setMapVenue(unattributedLabel.replace(/^Unattributed — /, ''));
    setMapJo(null);
    void ensureJoOptions();
  };

  const saveMapping = async (venueLabel: string, jobOrderId: string | null) => {
    if (!tenantId) return;
    setMapSaving(true);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({ tenantId, venueLabel, ...(jobOrderId ? { jobOrderId } : {}) });
      setMapVenue(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMapSaving(false);
    }
  };

  const openOffCycle = () => {
    setOcOpen(true);
    setOcError(null);
    setOcSuccess(null);
    setOcWorker(null);
    setOcWorkerQuery('');
    setOcWorkerOpts([]);
    setOcEntity(entityId || entities[0]?.id || '');
    setOcReason('missed_hours');
    setOcDate(todayIso());
    setOcHours('');
    setOcRate('');
    setOcGross('');
    setOcGrossTouched(false);
    setOcPerDiem('');
    setOcJo(null);
    setOcNotes('');
    setOcDupWarning(null);
    void ensureJoOptions();
  };

  const submitOffCycle = async (overrideDuplicateWarning = false) => {
    if (!tenantId || !ocWorker || !ocEntity) return;
    setOcSaving(true);
    setOcError(null);
    try {
      const fn = httpsCallable(functions, 'createOffCyclePayment');
      const res = await fn({
        tenantId,
        hiringEntityId: ocEntity,
        workerId: ocWorker.id,
        reason: ocReason,
        workDate: ocDate,
        hours: Number(ocHours) || 0,
        hourlyRate: Number(ocRate) || 0,
        grossAmount: Number(ocGross) || 0,
        perDiemAmount: Number(ocPerDiem) || 0,
        ...(ocJo ? { jobOrderId: ocJo.id } : {}),
        notes: ocNotes,
        ...(overrideDuplicateWarning ? { overrideDuplicateWarning: true } : {}),
      });
      const d = res.data as {
        total?: number;
        status?: string;
        duplicateWarning?: { workDate: string; totalHours: number; totalAmount: number };
      };
      // Duplicate-pay guard: nothing was sent — ask before paying twice.
      if (d.status === 'duplicate_warning' && d.duplicateWarning) {
        setOcDupWarning(d.duplicateWarning);
        return;
      }
      setOcDupWarning(null);
      setOcOpen(false);
      setOcSuccess(`Payment of ${usd(d.total)} for ${ocWorker.name} sent to Everee.`);
      await load();
    } catch (err) {
      setOcError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcSaving(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const lines = [
      CSV_COLUMNS.map((c) => c.header).join(','),
      ...data.rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-costs-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptLongIcon fontSize="small" />
            <span>Payroll Costs</span>
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
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={exportCsv}
              disabled={!data || data.rows.length === 0}
            >
              Export CSV
            </Button>
            <Button variant="outlined" color="secondary" onClick={openOffCycle}>
              New off-cycle payment
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Dollars sent to Everee (sent + paid entries) for work dates in the range. Rows that
            can&apos;t be tied to a job order show as &quot;Unattributed&quot; with their venue.
          </Typography>
        </CardContent>
      </Card>

      <WorkersCompMonthlyCard tenantId={tenantId} entities={entities} />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {ocSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setOcSuccess(null)}>
          {ocSuccess}
        </Alert>
      )}
      {loading && !data && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={30} />
        </Box>
      )}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'Total payroll', value: usd(data.totals.gross) },
              { label: 'Entries', value: String(data.totals.entries) },
              { label: 'Workers', value: String(data.totals.workers) },
              { label: 'Unattributed', value: usd(data.totals.unattributed) },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2.5, py: 1.5, minWidth: 140 }}>
                <Typography variant="caption" color="text.secondary">
                  {t.label}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {t.value}
                </Typography>
              </Paper>
            ))}
          </Box>
          {data.truncated && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This range has more rows than the report can return — narrow the dates for complete
              detail rows (summaries above are still complete).
            </Alert>
          )}

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                By job order (name)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Grouped by job order name — same-name orders merge into one row (the name is the
                QBO class). Internal #ids and customer POs are shown as references.
              </Typography>
              <TableContainer sx={{ maxHeight: 440 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Job order</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Refs</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">% of payroll</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byJobOrder.map((g) => (
                      <TableRow key={g.key} hover>
                        <TableCell>{g.label}</TableCell>
                        <TableCell>{g.accountName ?? '—'}</TableCell>
                        <TableCell>
                          {g.attributed === false ? (
                            <Button size="small" variant="outlined" onClick={() => void openMapDialog(g.label)}>
                              Map to job order
                            </Button>
                          ) : (
                            [
                              ...(g.poNumbers ?? []).map((p) => `PO ${p}`),
                              ...(g.jobOrderRefs ?? []),
                            ].join(', ') || '—'
                          )}
                        </TableCell>
                        <TableCell align="right">{g.workers}</TableCell>
                        <TableCell align="right">{g.hours.toFixed(1)}</TableCell>
                        <TableCell align="right">{usd(g.total)}</TableCell>
                        <TableCell align="right">{g.pct}%</TableCell>
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
                By account
              </Typography>
              <TableContainer sx={{ maxHeight: 320 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">% of payroll</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byAccount.map((g) => (
                      <TableRow key={g.key} hover>
                        <TableCell>{g.label}</TableCell>
                        <TableCell align="right">{g.workers}</TableCell>
                        <TableCell align="right">{usd(g.total)}</TableCell>
                        <TableCell align="right">{g.pct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                Wire splits — by submission day
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Each Everee funding wire maps to a submission day. Apply these percentages to the
                wire total (taxes + fees allocate pro-rata) to split it across QBO classes.
              </Typography>
              {data.byBatch.map((b) => (
                <Paper key={b.batchId} variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {b.batchId} · work {b.dateRange.min} → {b.dateRange.max} · {usd(b.total)} (
                    {b.entries} entries)
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      {b.byJobOrder.map((j) => (
                        <TableRow key={j.label}>
                          <TableCell sx={{ border: 0 }}>{j.label}</TableCell>
                          <TableCell sx={{ border: 0 }} align="right">
                            {usd(j.total)}
                          </TableCell>
                          <TableCell sx={{ border: 0 }} align="right" width={80}>
                            {j.pct}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              ))}
            </CardContent>
          </Card>

          {(data.venueMappings?.length ?? 0) > 0 && (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Venue → job order mappings
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Entries whose venue can&apos;t be tied to a job order automatically are attributed
                  using these mappings — past and future.
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Venue label</TableCell>
                      <TableCell>Job order</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Remove</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.venueMappings?.map((m) => (
                      <TableRow key={m.venueLabel} hover>
                        <TableCell>{m.venueLabel}</TableCell>
                        <TableCell>
                          {m.jobOrderNumber ? `#${m.jobOrderNumber} ` : ''}
                          {m.jobOrderName ?? m.jobOrderId}
                        </TableCell>
                        <TableCell>{m.accountName ?? '—'}</TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            disabled={mapSaving}
                            onClick={() => void saveMapping(m.venueLabel, null)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={ocOpen} onClose={() => !ocSaving && setOcOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New off-cycle payment</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sends the payment to Everee right away and records it against the job order so it shows
            in payroll costs.
          </Typography>
          {ocError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setOcError(null)}>
              {ocError}
            </Alert>
          )}
          {ocDupWarning && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This worker already has a submitted timesheet for {ocDupWarning.workDate} (
              {ocDupWarning.totalHours}h, {usd(ocDupWarning.totalAmount)}). Send anyway?
            </Alert>
          )}
          <Stack spacing={2}>
            <Autocomplete
              options={ocWorkerOpts}
              getOptionLabel={(o) => (o.email ? `${o.name} (${o.email})` : o.name)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              filterOptions={(x) => x}
              value={ocWorker}
              onChange={(_e, v) => {
                setOcWorker(v);
                setOcDupWarning(null);
              }}
              onInputChange={(_e, v) => setOcWorkerQuery(v)}
              noOptionsText={ocWorkerQuery.trim().length < 2 ? 'Type a name or email…' : 'No workers found'}
              renderInput={(params) => <TextField {...params} label="Worker" autoFocus />}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Hiring entity</InputLabel>
              <Select value={ocEntity} label="Hiring entity" onChange={(e) => setOcEntity(e.target.value)}>
                {entities.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Payment reason</InputLabel>
              <Select value={ocReason} label="Payment reason" onChange={(e) => setOcReason(e.target.value)}>
                <MenuItem value="missed_hours">Missed hours</MenuItem>
                <MenuItem value="late_timesheet">Late timesheet</MenuItem>
                <MenuItem value="forgot_bank_account">Forgot bank account</MenuItem>
                <MenuItem value="bonus">Bonus</MenuItem>
                <MenuItem value="expense_reimbursement">Expense reimbursement</MenuItem>
                <MenuItem value="payroll_correction">Payroll correction</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Work date"
              type="date"
              value={ocDate}
              onChange={(e) => {
                setOcDate(e.target.value);
                setOcDupWarning(null);
              }}
              InputLabelProps={{ shrink: true }}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                label="Hours"
                type="number"
                value={ocHours}
                onChange={(e) => setOcHours(e.target.value)}
              />
              <TextField
                size="small"
                label="Hourly rate"
                type="number"
                value={ocRate}
                onChange={(e) => setOcRate(e.target.value)}
              />
              <TextField
                size="small"
                label="Gross amount"
                type="number"
                value={ocGross}
                onChange={(e) => {
                  setOcGross(e.target.value);
                  setOcGrossTouched(true);
                }}
                helperText="Auto-fills from hours × rate"
              />
            </Stack>
            <TextField
              size="small"
              label="Per diem (optional)"
              type="number"
              value={ocPerDiem}
              onChange={(e) => setOcPerDiem(e.target.value)}
              sx={{ maxWidth: 220 }}
            />
            <Autocomplete
              options={joOptions ?? []}
              loading={joOptions === null}
              value={ocJo}
              onChange={(_e, v) => setOcJo(v)}
              renderInput={(params) => <TextField {...params} label="Job order (for cost attribution)" />}
            />
            <TextField
              size="small"
              label="Notes"
              multiline
              minRows={2}
              value={ocNotes}
              onChange={(e) => setOcNotes(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOcOpen(false)} disabled={ocSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={ocDupWarning ? 'warning' : 'primary'}
            disabled={
              ocSaving ||
              !ocWorker ||
              !ocEntity ||
              (Number(ocGross) || 0) + (Number(ocPerDiem) || 0) <= 0
            }
            onClick={() => void submitOffCycle(Boolean(ocDupWarning))}
          >
            {ocSaving
              ? 'Sending…'
              : `Send ${usd((Number(ocGross) || 0) + (Number(ocPerDiem) || 0))} ${ocDupWarning ? 'anyway' : 'to Everee'}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mapVenue !== null} onClose={() => setMapVenue(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Map “{mapVenue}” to a job order</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every payroll entry with this venue label — in this report and going forward — will be
            attributed to the job order you pick.
          </Typography>
          <Autocomplete
            options={joOptions ?? []}
            loading={joOptions === null}
            value={mapJo}
            onChange={(_e, v) => setMapJo(v)}
            renderInput={(params) => <TextField {...params} label="Job order" autoFocus />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMapVenue(null)} disabled={mapSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!mapJo || mapSaving}
            onClick={() => mapVenue && mapJo && void saveMapping(mapVenue, mapJo.id)}
          >
            {mapSaving ? 'Saving…' : 'Save mapping'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PayrollCostsPage;
