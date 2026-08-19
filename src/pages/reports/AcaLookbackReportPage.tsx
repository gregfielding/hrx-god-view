/**
 * /reports/aca-lookback — ACA Hours / Eligibility Lookback (Compliance,
 * Greg 2026-08-19). Hours per W-2 worker per month over a measurement
 * period from timesheet entries; 130 hrs/month = ACA full-time
 * equivalency. Contractor entities are excluded server-side.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, IconButton, Paper, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const yearAgoIso = (): string => new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10);

interface AcaRow {
  workerId: string;
  workerName: string | null;
  totalHours: number;
  activeMonths: number;
  ftMonths: number;
  avgPerMonth: number;
  status: 'meets_ft' | 'near' | 'below';
}

interface AcaData {
  monthsMeasured: number;
  totals: { workers: number; meetsFt: number; near: number };
  rows: AcaRow[];
}

const AcaLookbackReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(yearAgoIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AcaData | null>(null);

  const load = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
      const res = await fn({ tenantId, startDate, endDate, includeAcaLookback: true });
      const d = res.data as { acaLookback: AcaData | null };
      if (!d.acaLookback) setError('ACA lookback unavailable.');
      else setData(d.acaLookback);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = (): void => {
    if (!data) return;
    const lines = ['Worker,Total hours,Active months,Months >=130h,Avg hours/month,Status'];
    for (const r of data.rows) {
      lines.push([r.workerName ?? r.workerId, r.totalHours, r.activeMonths, r.ftMonths, r.avgPerMonth, r.status].map((v) => String(v)).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `aca-lookback-${startDate}-to-${endDate}.csv`;
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
            <EventAvailableOutlinedIcon fontSize="small" />
            <span>ACA Hours Lookback</span>
          </Box>
        }
      />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" type="date" label="Measurement start" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="Measurement end" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv} disabled={!data}>
              Export CSV
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            W-2 hours per worker per month over the measurement period (defaults to trailing 12
            months). 130 hours/month averaged over the period = ACA full-time; 110–130 = approaching.
            Contractor entities are excluded.
          </Typography>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'Workers measured', value: data.totals.workers },
              { label: 'Meets full-time (≥130h avg)', value: data.totals.meetsFt },
              { label: 'Approaching (110–130h)', value: data.totals.near },
              { label: 'Months in period', value: data.monthsMeasured },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 150 }}>
                <Typography variant="caption" color="text.secondary">{t.label}</Typography>
                <Typography variant="h6" fontWeight={600}>{t.value}</Typography>
              </Paper>
            ))}
          </Box>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Total hours</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Active months</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Months ≥130h</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Avg h/month</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.slice(0, 500).map((r) => (
                  <TableRow key={r.workerId} hover>
                    <TableCell>{r.workerName ?? r.workerId}</TableCell>
                    <TableCell align="right">{r.totalHours}</TableCell>
                    <TableCell align="right">{r.activeMonths}</TableCell>
                    <TableCell align="right">{r.ftMonths}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{r.avgPerMonth}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={r.status === 'meets_ft' ? 'error' : r.status === 'near' ? 'warning' : 'default'}
                        label={r.status === 'meets_ft' ? 'Full-time' : r.status === 'near' ? 'Approaching' : 'Below'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {!data && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick the measurement period and hit Load.
        </Typography>
      )}
    </Box>
  );
};

export default AcaLookbackReportPage;
