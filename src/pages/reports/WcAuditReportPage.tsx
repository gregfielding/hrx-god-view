/**
 * /reports/wc-audit — WC Premium Audit Package (Greg 2026-08-19,
 * roadmap #9): the workers' comp wage report over a POLICY PERIOD
 * (multi-month range) with the breakouts a carrier auditor asks for —
 * gross, OT excess (the 0.5x/1.0x premium portions, excludable in most
 * states), tips (excludable), reimbursements/per-diem (never payroll,
 * shown for verification), and the resulting auditable payroll +
 * premium per state × class code. Includes a by-month rollup for the
 * auditor's worksheets. CSV export = the package.
 *
 * Same getWorkersCompMonthlyReport callable in range mode (startDate/
 * endDate) — codes resolve through the identical chain as the monthly
 * carrier report.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const yearStartIso = (): string => `${todayIso().slice(0, 4)}-01-01`;

interface AuditRow {
  state: string;
  code: string;
  rate: number | null;
  gross: number;
  hours: number;
  entries: number;
  workers: number;
  premium: number | null;
  otExcess: number;
  tips: number;
  reimbursements: number;
  auditable: number;
  premiumAuditable: number | null;
}

interface AuditData {
  entityName: string;
  workerType: string;
  startDate: string;
  endDate: string;
  rows: AuditRow[];
  byMonth: Array<{ month: string; gross: number; otExcess: number; tips: number; reimbursements: number; hours: number; auditable: number }>;
  unresolved: Array<{ state: string; jobTitle: string; gross: number; entries: number; workers: number }>;
  unresolvedGross: number;
  totalGross: number;
  totalOtExcess: number;
  totalTips: number;
  totalReimbursements: number;
  totalAuditable: number;
  totalPremium: number;
  totalPremiumAuditable: number;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const WcAuditReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState(yearStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AuditData | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .filter((e) => !/sandbox/i.test(e.id) && !/sandbox/i.test(e.name));
        setEntities(list);
        if (list.length > 0) setEntityId((cur) => cur || list[0].id);
      })
      .catch(() => setEntities([]));
  }, [tenantId]);

  const load = async (): Promise<void> => {
    if (!tenantId || !entityId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getWorkersCompMonthlyReport', { timeout: 300000 });
      const res = await fn({ tenantId, hiringEntityId: entityId, startDate, endDate });
      setData(res.data as AuditData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const stateGroups = useMemo(() => {
    if (!data) return [] as Array<{ state: string; rows: AuditRow[] }>;
    const m = new Map<string, AuditRow[]>();
    for (const r of data.rows) m.set(r.state, [...(m.get(r.state) ?? []), r]);
    return Array.from(m.entries())
      .map(([state, rows]) => ({ state, rows }))
      .sort((a, b) => a.state.localeCompare(b.state));
  }, [data]);

  const exportCsv = (): void => {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`WC Premium Audit Package,${data.entityName},${data.startDate} to ${data.endDate}`);
    lines.push('State,Class code,Rate,Gross payroll,OT excess,Tips,Auditable payroll,Reimbursements (excluded),Hours,Workers,Premium (gross),Premium (auditable)');
    for (const r of data.rows) {
      lines.push(
        [r.state, r.code, r.rate ?? '', r.gross, r.otExcess, r.tips, r.auditable, r.reimbursements, r.hours, r.workers, r.premium ?? '', r.premiumAuditable ?? ''].map(csvCell).join(','),
      );
    }
    lines.push('');
    lines.push('Month,Gross,OT excess,Tips,Auditable,Reimbursements (excluded),Hours');
    for (const m of data.byMonth) {
      lines.push([m.month, m.gross, m.otExcess, m.tips, m.auditable, m.reimbursements, m.hours].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wc-audit-${entityId}-${startDate}-to-${endDate}.csv`;
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
            <FactCheckOutlinedIcon fontSize="small" />
            <span>WC Premium Audit</span>
          </Box>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Hiring entity</InputLabel>
              <Select value={entityId} label="Hiring entity" onChange={(e) => setEntityId(e.target.value)}>
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
              label="Policy period start"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="Policy period end"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" onClick={() => void load()} disabled={loading || !entityId}>
              {loading ? 'Loading…' : 'Generate'}
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv} disabled={!data}>
              Export audit package (CSV)
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Payroll by state × WC class code over the policy period. Auditable payroll = gross − OT
            excess (the 0.5×/1.0× premium portion of overtime) − tips; reimbursements/per-diem are
            outside gross and shown for the auditor&apos;s verification. Exclusion rules vary by
            state — the CSV carries every column so the carrier applies their own.
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
              { label: 'Gross payroll', value: usd(data.totalGross) },
              { label: 'OT excess', value: usd(data.totalOtExcess) },
              { label: 'Tips', value: usd(data.totalTips) },
              { label: 'Auditable payroll', value: usd(data.totalAuditable) },
              { label: 'Reimb. (excluded)', value: usd(data.totalReimbursements) },
              { label: 'Premium (auditable)', value: usd(data.totalPremiumAuditable) },
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

          {data.unresolvedGross > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {usd(data.unresolvedGross)} of payroll has no WC class code — assign codes on the
              Workers&apos; Comp report before handing this package to the auditor.
            </Alert>
          )}

          {stateGroups.map(({ state, rows }) => (
            <Card key={state} sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  {state}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Class code</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Rate</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Gross</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>OT excess</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Tips</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Auditable</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Reimb.</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Hours</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Workers</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Premium (auditable)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={`${r.state}_${r.code}`} hover>
                          <TableCell>{r.code}</TableCell>
                          <TableCell align="right">{r.rate == null ? '—' : r.rate.toFixed(2)}</TableCell>
                          <TableCell align="right">{usd(r.gross)}</TableCell>
                          <TableCell align="right">{r.otExcess ? usd(r.otExcess) : '—'}</TableCell>
                          <TableCell align="right">{r.tips ? usd(r.tips) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{usd(r.auditable)}</TableCell>
                          <TableCell align="right">{r.reimbursements ? usd(r.reimbursements) : '—'}</TableCell>
                          <TableCell align="right">{r.hours}</TableCell>
                          <TableCell align="right">{r.workers}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {r.premiumAuditable == null ? '—' : usd(r.premiumAuditable)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          ))}

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                By month
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Month</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Gross</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>OT excess</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Tips</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Auditable</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Reimb.</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Hours</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byMonth.map((m) => (
                      <TableRow key={m.month} hover>
                        <TableCell>{m.month}</TableCell>
                        <TableCell align="right">{usd(m.gross)}</TableCell>
                        <TableCell align="right">{m.otExcess ? usd(m.otExcess) : '—'}</TableCell>
                        <TableCell align="right">{m.tips ? usd(m.tips) : '—'}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{usd(m.auditable)}</TableCell>
                        <TableCell align="right">{m.reimbursements ? usd(m.reimbursements) : '—'}</TableCell>
                        <TableCell align="right">{m.hours}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}

      {!data && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick an entity and the policy period, then Generate.
        </Typography>
      )}
    </Box>
  );
};

export default WcAuditReportPage;
