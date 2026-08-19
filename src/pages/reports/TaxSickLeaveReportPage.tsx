/**
 * /reports/tax-liability — Tax Liability Summary + Sick-Leave Accrual by
 * State (Compliance, Greg 2026-08-19, roadmap #12 — one page, two
 * verification views over Everee-held data):
 *  - Tax liability: per month × entity from the settled Everee register —
 *    gross, employee withholding (gross − net), employer taxes + fees
 *    (funding − gross). Everee is the filer; this verifies what they held.
 *  - Sick-leave accrual basis: hours by state per worker from timesheet
 *    entries, with a 1-per-30 (CA-style) estimated accrual. Caps and
 *    local ordinances vary — this is the basis, not the balance.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, IconButton, Paper, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const yearStartIso = (): string => `${todayIso().slice(0, 4)}-01-01`;

interface RegisterRow {
  entityName: string;
  payDate: string | null;
  gross: number;
  net: number;
  funding: number;
}

interface SickState { state: string; workers: number; hours: number; estAccruedHours: number }
interface SickWorker { state: string; workerId: string; name: string | null; hours: number; estAccruedHours: number }

const TaxSickLeaveReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(yearStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [register, setRegister] = useState<{ rows: RegisterRow[] } | null>(null);
  const [sick, setSick] = useState<{ byState: SickState[]; workers: SickWorker[] } | null>(null);

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
        includeSickLeave: true,
      });
      const d = res.data as {
        evereeRegister: { rows: RegisterRow[] } | null;
        evereeRegisterError: string | null;
        sickLeave: { byState: SickState[]; workers: SickWorker[] } | null;
      };
      if (!d.evereeRegister) setError(d.evereeRegisterError || 'Everee register unavailable.');
      setRegister(d.evereeRegister);
      setSick(d.sickLeave);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Tax liability by month × entity from the register rows.
  const taxByMonth = useMemo(() => {
    if (!register) return [] as Array<{ month: string; entityName: string; gross: number; withheld: number; employer: number; funding: number }>;
    const m = new Map<string, { month: string; entityName: string; gross: number; net: number; funding: number }>();
    for (const r of register.rows) {
      if (!r.payDate) continue;
      const month = r.payDate.slice(0, 7);
      const key = `${month}|${r.entityName}`;
      const g = m.get(key) ?? { month, entityName: r.entityName, gross: 0, net: 0, funding: 0 };
      g.gross = Math.round((g.gross + r.gross) * 100) / 100;
      g.net = Math.round((g.net + r.net) * 100) / 100;
      g.funding = Math.round((g.funding + r.funding) * 100) / 100;
      m.set(key, g);
    }
    return Array.from(m.values())
      .map((g) => ({
        month: g.month,
        entityName: g.entityName,
        gross: g.gross,
        withheld: Math.round((g.gross - g.net) * 100) / 100,
        employer: Math.round((g.funding - g.gross) * 100) / 100,
        funding: g.funding,
      }))
      .sort((a, b) => b.month.localeCompare(a.month) || a.entityName.localeCompare(b.entityName));
  }, [register]);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <AccountBalanceOutlinedIcon fontSize="small" />
            <span>Tax &amp; Sick-Leave Liability</span>
          </Box>
        }
      />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" type="date" label="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Verification views over Everee-held data. Employee withholding = gross − net; employer
            taxes &amp; fees = funding − gross (Everee files and deposits — these columns verify what
            they held). Sick-leave accrual uses the CA-style 1-hour-per-30-worked basis; caps and
            city ordinances vary.
          </Typography>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {register && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Tax liability by month
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Month</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Gross</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Employee withholding</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Employer taxes &amp; fees</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Total funded</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {taxByMonth.map((r) => (
                    <TableRow key={`${r.month}|${r.entityName}`} hover>
                      <TableCell>{r.month}</TableCell>
                      <TableCell>{r.entityName}</TableCell>
                      <TableCell align="right">{usd(r.gross)}</TableCell>
                      <TableCell align="right">{usd(r.withheld)}</TableCell>
                      <TableCell align="right">{usd(r.employer)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{usd(r.funding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {sick && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Sick-leave accrual basis by state
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>State</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Workers</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Hours worked</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Est. accrued (1:30)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sick.byState.map((s) => (
                    <TableRow key={s.state} hover>
                      <TableCell>{s.state}</TableCell>
                      <TableCell align="right">{s.workers}</TableCell>
                      <TableCell align="right">{s.hours}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{s.estAccruedHours} h</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary">
              Top workers by hours (accrual basis):{' '}
              {sick.workers.slice(0, 10).map((w) => `${w.name ?? w.workerId} (${w.state}: ${w.hours}h)`).join(' · ')}
            </Typography>
          </CardContent>
        </Card>
      )}

      {!register && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick a range and hit Load (queries Everee live — takes ~30s).
        </Typography>
      )}
    </Box>
  );
};

export default TaxSickLeaveReportPage;
