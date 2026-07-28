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
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
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
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';

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
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Dollars sent to Everee (sent + paid entries) for work dates in the range. Rows that
            can&apos;t be tied to a job order show as &quot;Unattributed&quot; with their venue.
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
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
                          {[
                            ...(g.poNumbers ?? []).map((p) => `PO ${p}`),
                            ...(g.jobOrderRefs ?? []),
                          ].join(', ') || '—'}
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
        </>
      )}
    </Box>
  );
};

export default PayrollCostsPage;
