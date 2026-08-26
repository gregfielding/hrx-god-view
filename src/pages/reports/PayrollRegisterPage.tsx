/**
 * /reports/payroll-register — the settled payroll truth from Everee
 * (Greg 2026-08-19, payroll-reports roadmap #5+#6 in one page): one row
 * per worker × pay run with gross / net / employer funding, rolled up
 * by pay run and by funding wire (each wire row = one ACH pull from the
 * bank, to the penny — the wire-recon mechanics as a standing report).
 *
 * Data: getPayrollCostReport + includeEvereeRegister:true → live Everee
 * /api/v2/payments across both entities. W-2 and 1099 combined.
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
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const monthStartIso = (): string => `${todayIso().slice(0, 7)}-01`;

interface RegisterRow {
  entityId: string;
  entityName: string;
  paymentId: string;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  workerUid: string;
  workerName: string | null;
  gross: number;
  net: number;
  funding: number;
  status: string | null;
  depositStatus: string | null;
}

interface RegisterData {
  totals: { gross: number; net: number; funding: number; payments: number; workers: number };
  truncated: boolean;
  rows: RegisterRow[];
  byPayRun: Array<{
    entityId: string;
    entityName: string;
    payDate: string | null;
    payments: number;
    workers: number;
    gross: number;
    net: number;
    funding: number;
  }>;
  byWire: Array<{
    fundingId: string;
    entityId: string;
    entityName: string;
    fundingDate: string | null;
    amount: number;
    payments: number;
  }>;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const DISPLAY_ROW_CAP = 400;

const PayrollRegisterPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RegisterData | null>(null);
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
        includeEvereeRegister: true,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const d = res.data as { evereeRegister: RegisterData | null; evereeRegisterError: string | null };
      if (!d.evereeRegister) {
        setError(d.evereeRegisterError || 'Everee register unavailable.');
        setData(null);
      } else {
        setData(d.evereeRegister);
        setRangeLabel(`${startDate} → ${endDate}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const taxesAndFees = useMemo(
    () => (data ? Math.round((data.totals.funding - data.totals.gross) * 100) / 100 : 0),
    [data],
  );

  const exportCsv = (): void => {
    if (!data) return;
    const lines: string[] = [];
    lines.push('Pay date,Worker,Entity,Period start,Period end,Gross,Net,Employer funding,Status,Deposit status,Payment id');
    for (const r of data.rows) {
      lines.push(
        [
          r.payDate,
          r.workerName ?? r.workerUid,
          r.entityName,
          r.periodStart,
          r.periodEnd,
          r.gross,
          r.net,
          r.funding,
          r.status,
          r.depositStatus,
          r.paymentId,
        ].map(csvCell).join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-register-${startDate}-to-${endDate}.csv`;
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
            <ListAltOutlinedIcon fontSize="small" />
            <span>Payroll Register</span>
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
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv} disabled={!data}>
              Export CSV
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Settled payroll straight from Everee (W-2 + 1099 combined), by pay date. Employer funding
            is the cash Everee pulled — each funding-wire row below matches one bank ACH pull to the
            penny. Taxes &amp; fees = funding − gross.
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
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
            {[
              { label: 'Gross pay', value: usd(data.totals.gross) },
              { label: 'Net pay', value: usd(data.totals.net) },
              { label: 'Employer funding', value: usd(data.totals.funding) },
              { label: 'Taxes & fees', value: usd(taxesAndFees) },
              { label: 'Payments', value: String(data.totals.payments) },
              { label: 'Workers', value: String(data.totals.workers) },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 120 }}>
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
            {rangeLabel}
            {data.truncated && ' · row list truncated — narrow the range'}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start', mb: 2 }}>
            <Card sx={{ flex: 1, minWidth: 380 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Pay runs ({data.byPayRun.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Pay date</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Workers</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Gross</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Net</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Funding</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.byPayRun.map((g) => (
                        <TableRow key={`${g.entityId}|${g.payDate}`} hover>
                          <TableCell>{g.payDate}</TableCell>
                          <TableCell>{g.entityName}</TableCell>
                          <TableCell align="right">{g.workers}</TableCell>
                          <TableCell align="right">{usd(g.gross)}</TableCell>
                          <TableCell align="right">{usd(g.net)}</TableCell>
                          <TableCell align="right">{g.funding ? usd(g.funding) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            <Card sx={{ flex: 1, minWidth: 380 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Funding wires ({data.byWire.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Funding date</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Payments</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Wire amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.byWire.map((w) => (
                        <TableRow key={w.fundingId} hover>
                          <TableCell>{w.fundingDate ?? '—'}</TableCell>
                          <TableCell>{w.entityName}</TableCell>
                          <TableCell align="right">{w.payments}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{usd(w.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Box>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Register ({data.rows.length} payments{data.rows.length > DISPLAY_ROW_CAP ? ` — showing ${DISPLAY_ROW_CAP}, CSV has all` : ''})
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Pay date</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Period</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Gross</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Net</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.rows.slice(0, DISPLAY_ROW_CAP).map((r) => (
                      <TableRow key={r.paymentId} hover>
                        <TableCell>{r.payDate}</TableCell>
                        <TableCell>{r.workerName ?? r.workerUid ?? '—'}</TableCell>
                        <TableCell>{r.entityName}</TableCell>
                        <TableCell>
                          {r.periodStart && r.periodEnd ? `${r.periodStart} → ${r.periodEnd}` : '—'}
                        </TableCell>
                        <TableCell align="right">{usd(r.gross)}</TableCell>
                        <TableCell align="right">{usd(r.net)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={r.status === 'PAID' ? 'success' : 'default'}
                            label={r.status ?? '—'}
                          />
                        </TableCell>
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
          Pick a range and hit Load.
        </Typography>
      )}
    </Box>
  );
};

export default PayrollRegisterPage;
