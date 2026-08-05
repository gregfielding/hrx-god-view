/**
 * Workers' Comp monthly report (WC-C, Greg 2026-08-05).
 *
 * Front-end for `getWorkersCompMonthlyReport`: pick an entity + calendar
 * month, get gross pay totals by work state + WC class code — the monthly
 * report InSource needs, generated from HRX instead of Everee's report
 * builder. Uncoded rows are shown loudly (never hidden) so classification
 * gaps are visible before the report goes out. One-click CSV export.
 */
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
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
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface WcRow {
  state: string;
  code: string;
  rate: number | null;
  gross: number;
  hours: number;
  entries: number;
  workers: number;
}

interface WcReport {
  month: string;
  hiringEntityId: string;
  entityName: string;
  workerType: 'employee' | 'contractor';
  rows: WcRow[];
  totalGross: number;
  entryCount: number;
  offCycle: Array<{ workDate: string; workerName: string; reasonLabel: string; total: number }>;
  offCycleTotal: number;
  grandTotal: number;
}

function previousMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Props {
  tenantId: string | null | undefined;
  entities: Array<{ id: string; name: string }>;
}

const WorkersCompMonthlyCard: React.FC<Props> = ({ tenantId, entities }) => {
  const [entityId, setEntityId] = useState('c1_select_llc');
  const [month, setMonth] = useState(previousMonth());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WcReport | null>(null);

  const generate = async (): Promise<void> => {
    if (!tenantId || !entityId || !month) return;
    setLoading(true);
    setError(null);
    try {
      const call = httpsCallable(functions, 'getWorkersCompMonthlyReport');
      const res = await call({ tenantId, hiringEntityId: entityId, month });
      setReport(res.data as WcReport);
    } catch (e: any) {
      setError(e?.message || 'Failed to generate report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = (): void => {
    if (!report) return;
    const lines: string[] = [];
    lines.push(`Workers' Comp Payroll Report,${report.entityName},${report.month}`);
    lines.push('');
    lines.push('State,Class code,Rate,Hours,Gross payroll,Workers');
    for (const r of report.rows) {
      lines.push(
        [r.state, r.code, r.rate ?? '', r.hours, r.gross.toFixed(2), r.workers].map(csvCell).join(','),
      );
    }
    lines.push(['TOTAL', '', '', '', report.totalGross.toFixed(2), ''].join(','));
    if (report.offCycle.length > 0) {
      lines.push('');
      lines.push('Off-cycle payments (not classified),,,,');
      lines.push('Work date,Worker,Reason,,Amount');
      for (const p of report.offCycle) {
        lines.push([p.workDate, p.workerName, p.reasonLabel, '', p.total.toFixed(2)].map(csvCell).join(','));
      }
      lines.push(['OFF-CYCLE TOTAL', '', '', '', report.offCycleTotal.toFixed(2)].join(','));
      lines.push(['GRAND TOTAL', '', '', '', report.grandTotal.toFixed(2)].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WC-Report_${report.entityName.replace(/\s+/g, '-')}_${report.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uncodedGross = report
    ? report.rows
        .filter((r) => r.code === '(no code)' || r.state === '(no state)')
        .reduce((s, r) => s + r.gross, 0)
    : 0;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <HealthAndSafetyIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" fontWeight={600}>
            Workers&apos; Comp monthly report
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ minWidth: 180 }}>
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
            type="month"
            label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Button variant="contained" onClick={() => void generate()} disabled={loading || !entityId}>
            {loading ? 'Generating…' : 'Generate'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={exportCsv}
            disabled={!report || report.rows.length === 0}
          >
            Export CSV
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Gross payroll by work state + WC class code for the calendar month (sent + paid entries).
          Use this for the carrier&apos;s monthly payroll report.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {report && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>{report.entityName}</strong> — {report.month} ·{' '}
              {report.workerType === 'contractor' ? '1099 contractors (flat-rate hours)' : 'W-2 employees'} ·{' '}
              {report.entryCount} entries
            </Typography>
            {uncodedGross > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {usd(uncodedGross)} of payroll has no WC code or work state — fix classification
                before sending this report to the carrier.
              </Alert>
            )}
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>State</TableCell>
                    <TableCell>Class code</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Gross payroll</TableCell>
                    <TableCell align="right">Workers</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.rows.map((r) => {
                    const flagged = r.code === '(no code)' || r.state === '(no state)';
                    return (
                      <TableRow key={`${r.state}_${r.code}`} sx={flagged ? { bgcolor: 'warning.50' } : undefined}>
                        <TableCell>{r.state}</TableCell>
                        <TableCell sx={flagged ? { color: 'warning.main', fontWeight: 600 } : undefined}>
                          {r.code}
                        </TableCell>
                        <TableCell align="right">{r.rate ?? '—'}</TableCell>
                        <TableCell align="right">{r.hours.toFixed(2)}</TableCell>
                        <TableCell align="right">{usd(r.gross)}</TableCell>
                        <TableCell align="right">{r.workers}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell colSpan={4} sx={{ fontWeight: 700 }}>
                      Total
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {usd(report.totalGross)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {report.offCycle.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        Off-cycle payments ({report.offCycle.length}, not classified)
                      </TableCell>
                      <TableCell align="right">{usd(report.offCycleTotal)}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkersCompMonthlyCard;
