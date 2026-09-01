/**
 * /reports/payroll-journal — Payroll Journal by QBO class (Greg
 * 2026-08-19, payroll roadmap #7): every Everee funding wire in the
 * range split across QBO classes — the exact splits the bookkeeper
 * types when classing each wire in QuickBooks. This is the July
 * wire-reconciliation engine as a standing report (JO# note tags,
 * timesheet entry index, Greg's persisted overrides, venue-token
 * matching, largest-remainder rounding to the penny).
 *
 * Class names are checked against QBO's live Class list — a "not in
 * QBO" chip means the class needs creating (or renaming) before the
 * split can be posted. Range filters on FUNDING dates (bank view).
 */

import React, { useEffect, useState } from 'react';
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
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
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

interface WireSplit {
  class: string;
  qboClass: string | null;
  qboClassExists: boolean;
  amount: number;
  pct: number;
}

interface Wire {
  fundingId: string;
  entityId: string;
  entityName: string;
  fundingDate: string;
  amount: number;
  payments: number;
  unattributed: number;
  splits: WireSplit[];
}

interface JournalData {
  totals: { wired: number; wires: number; unattributed: number; attributedPct: number };
  wires: Wire[];
  byClass: Array<{ class: string; qboClass: string | null; qboClassExists: boolean; amount: number }>;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PayrollJournalPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<JournalData | null>(null);
  const [pushing, setPushing] = useState(false);
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

  /**
   * Phase 4 (Greg 2026-08-31): post each wire's class splits to QBO as a
   * reallocation JE (credit 5010 unclassed / debit 5010 per class) —
   * Tabitha's manual "EV Pay Alloc" pattern, automated. Dry-run first;
   * wires she (or a prior push) already allocated are skipped.
   */
  const pushToQbo = async (): Promise<void> => {
    if (!tenantId) return;
    setPushing(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping', { timeout: 300000 });
      const dry = await fn({
        tenantId, action: 'pushWireAllocations', startDate, endDate, dryRun: true,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const d = dry.data as { wires: Array<{ fundingDate: string; entity: string; amount: number; status: string; docNumber?: string }> };
      const create = d.wires.filter((w) => w.status === 'would_create');
      const skip = d.wires.filter((w) => w.status === 'already_allocated');
      const summary =
        `Push wire allocations to QBO — dry run:\n\n` +
        `Would post ${create.length} reallocation JE(s):\n` +
        create.map((w) => `  ${w.fundingDate}  ${w.entity}  $${w.amount.toLocaleString()}  → ${w.docNumber}`).join('\n') +
        `\n\nAlready allocated (skipped): ${skip.length}\n\nEach JE credits 5010 unclassed and debits 5010 per class, penny-exact to the wire. Proceed?`;
      if (create.length === 0) { window.alert('Nothing to push — every wire in range is already allocated.'); return; }
      if (!window.confirm(summary)) return;
      const real = await fn({
        tenantId, action: 'pushWireAllocations', startDate, endDate, dryRun: false,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const r = real.data as { wires: Array<{ status: string }> };
      window.alert(`Done. Created: ${r.wires.filter((w) => w.status === 'created').length} · Skipped: ${r.wires.filter((w) => w.status === 'already_allocated').length}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

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
        includeWireJournal: true,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const d = res.data as { wireJournal: JournalData | null; wireJournalError: string | null };
      if (!d.wireJournal) {
        setError(d.wireJournalError || 'Wire journal unavailable.');
        setData(null);
      } else {
        setData(d.wireJournal);
        setRangeLabel(`${startDate} → ${endDate}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = (): void => {
    if (!data) return;
    const lines: string[] = [];
    lines.push('Funding date,Entity,Wire amount,Class,QBO class,In QBO,Split amount,Split %,Payments in wire');
    for (const w of data.wires) {
      for (const s of w.splits) {
        lines.push(
          [
            w.fundingDate,
            w.entityName,
            w.amount,
            s.class,
            s.qboClass ?? '',
            s.qboClassExists ? 'yes' : 'NO',
            s.amount,
            s.pct,
            w.payments,
          ].map(csvCell).join(','),
        );
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-journal-${startDate}-to-${endDate}.csv`;
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
            <MenuBookOutlinedIcon fontSize="small" />
            <span>Payroll Journal (QBO classes)</span>
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
              label="Start (funding date)"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="End (funding date)"
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
            <Button variant="outlined" color="secondary" onClick={() => void pushToQbo()} disabled={!data || pushing}>
              {pushing ? 'Pushing…' : 'Push to QBO'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Each Everee funding wire split across QBO classes — what the bookkeeper enters when
            classing the wire. Splits sum to each wire to the penny. Range filters on funding (bank)
            dates. A &quot;not in QBO&quot; chip means that class doesn&apos;t exist in QuickBooks yet.
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
              { label: 'Total wired', value: usd(data.totals.wired) },
              { label: 'Wires', value: String(data.totals.wires) },
              { label: 'Attributed', value: `${data.totals.attributedPct.toFixed(1)}%` },
              { label: 'Unattributed', value: usd(data.totals.unattributed) },
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {rangeLabel}
          </Typography>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Summary by class
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>QBO class</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byClass.map((c) => (
                      <TableRow key={c.class} hover>
                        <TableCell>
                          {c.qboClass ?? c.class}
                          {c.class !== 'Unattributed' && !c.qboClassExists && (
                            <Chip label="not in QBO" size="small" color="warning" variant="outlined" sx={{ ml: 1 }} />
                          )}
                          {c.class === 'Unattributed' && (
                            <Chip label="needs mapping" size="small" color="error" variant="outlined" sx={{ ml: 1 }} />
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{usd(c.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          {data.wires.map((w) => (
            <Card key={`${w.entityId}|${w.fundingId}`} sx={{ mb: 2 }}>
              <CardContent>
                <Stack direction="row" alignItems="baseline" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {w.fundingDate} · {w.entityName} · {usd(w.amount)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {w.payments} payments
                    {w.unattributed > 0 && ` · ${usd(w.unattributed)} unattributed`}
                  </Typography>
                </Stack>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableBody>
                      {w.splits.map((s) => (
                        <TableRow key={s.class} hover>
                          <TableCell>
                            {s.qboClass ?? s.class}
                            {s.class !== 'Unattributed' && !s.qboClassExists && (
                              <Chip label="not in QBO" size="small" color="warning" variant="outlined" sx={{ ml: 1 }} />
                            )}
                          </TableCell>
                          <TableCell align="right" sx={{ width: 140, fontWeight: 600 }}>{usd(s.amount)}</TableCell>
                          <TableCell align="right" sx={{ width: 90 }}>{s.pct.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {!data && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Pick a funding-date range and hit Load.
        </Typography>
      )}
    </Box>
  );
};

export default PayrollJournalPage;
