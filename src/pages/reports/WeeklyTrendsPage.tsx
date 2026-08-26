/**
 * /reports/weekly-trends — FIN-1 consumer (Greg 2026-08-25).
 *
 * Reads the server-built `finance_week_rollups` (week × entity × account ×
 * job order) directly — no callable, no range ceiling, no QBO join. Shows
 * the trailing weeks' ACCRUAL picture: bill (hours × the entry billRate
 * snapshot), pay gross, margin, hours, headcount — the first surface in the
 * product where revenue comes from our own data instead of invoice matching.
 *
 * Bill coverage is shown honestly: entries without a billRate snapshot roll
 * into "pay gross w/o bill rate" so a thin accrual line is visibly thin, not
 * silently wrong.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface RollupDoc {
  weekStart: string;
  entityId: string;
  accountId: string | null;
  accountName: string | null;
  jobOrderId: string | null;
  jobOrderName: string | null;
  hours: number;
  payGross: number;
  billGross: number;
  marginGross: number;
  billMissingPayGross: number;
  entries: number;
  workers: number;
}

const HORIZONS = [13, 26, 52] as const;

const WeeklyTrendsPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [horizon, setHorizon] = useState<number>(26);
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [rows, setRows] = useState<RollupDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const start = new Date(Date.now() - horizon * 7 * 86400000).toISOString().slice(0, 10);
        const snap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'finance_week_rollups'), where('weekStart', '>=', start)),
        );
        if (!cancelled) setRows(snap.docs.map((d) => d.data() as RollupDoc));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, horizon]);

  const entityIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entityId))).sort(),
    [rows],
  );

  const filtered = useMemo(
    () => (entityFilter === 'all' ? rows : rows.filter((r) => r.entityId === entityFilter)),
    [rows, entityFilter],
  );

  const byWeek = useMemo(() => {
    const m = new Map<
      string,
      { bill: number; pay: number; hours: number; workers: number; billMissingPay: number; entries: number }
    >();
    for (const r of filtered) {
      const w = m.get(r.weekStart) ?? { bill: 0, pay: 0, hours: 0, workers: 0, billMissingPay: 0, entries: 0 };
      w.bill += r.billGross;
      w.pay += r.payGross;
      w.hours += r.hours;
      w.workers += r.workers; // sum of per-dimension distinct — upper bound
      w.billMissingPay += r.billMissingPayGross;
      w.entries += r.entries;
      m.set(r.weekStart, w);
    }
    return Array.from(m.entries())
      .map(([weekStart, w]) => ({ weekStart, ...w, margin: w.bill - w.pay }))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [filtered]);

  const byAccount = useMemo(() => {
    const m = new Map<string, { name: string; bill: number; pay: number; hours: number }>();
    for (const r of filtered) {
      const key = r.accountId ?? '(no account)';
      const a = m.get(key) ?? { name: r.accountName || '(no account)', bill: 0, pay: 0, hours: 0 };
      a.bill += r.billGross;
      a.pay += r.payGross;
      a.hours += r.hours;
      if (r.accountName) a.name = r.accountName;
      m.set(key, a);
    }
    return Array.from(m.values())
      .map((a) => ({ ...a, margin: a.bill - a.pay }))
      .sort((a, b) => b.bill - a.bill)
      .slice(0, 25);
  }, [filtered]);

  const totals = useMemo(
    () =>
      byWeek.reduce(
        (t, w) => ({
          bill: t.bill + w.bill,
          pay: t.pay + w.pay,
          billMissingPay: t.billMissingPay + w.billMissingPay,
        }),
        { bill: 0, pay: 0, billMissingPay: 0 },
      ),
    [byWeek],
  );
  const coveragePct = totals.pay > 0 ? Math.round(((totals.pay - totals.billMissingPay) / totals.pay) * 100) : 0;

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center">
            <TimelineOutlinedIcon />
            <span>Weekly Trends</span>
          </Stack>
        }
        subtitle="Accrual bill vs pay per week from the nightly rollups — revenue from our own bill rates, no invoice matching, no range ceiling."
      />

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={horizon}
          onChange={(_, v) => v && setHorizon(v)}
        >
          {HORIZONS.map((h) => (
            <ToggleButton key={h} value={h}>
              {h} wks
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Chip
          size="small"
          label="All entities"
          color={entityFilter === 'all' ? 'primary' : 'default'}
          variant={entityFilter === 'all' ? 'filled' : 'outlined'}
          onClick={() => setEntityFilter('all')}
        />
        {entityIds.map((id) => (
          <Chip
            key={id}
            size="small"
            label={id}
            color={entityFilter === id ? 'primary' : 'default'}
            variant={entityFilter === id ? 'filled' : 'outlined'}
            onClick={() => setEntityFilter(id)}
          />
        ))}
        {!loading && byWeek.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Bill-rate coverage: {coveragePct}% of pay gross has an accrual bill rate
            {totals.billMissingPay > 0 ? ` (${usd(totals.billMissingPay)} without)` : ''}
          </Typography>
        )}
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : byWeek.length === 0 ? (
        <Alert severity="info">
          No rollups yet for this window — the nightly build populates them (first backfill runs
          server-side).
        </Alert>
      ) : (
        <>
          <TableContainer sx={{ mb: 4 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Week (Mon)</TableCell>
                  <TableCell align="right">Bill (accrual)</TableCell>
                  <TableCell align="right">Pay gross</TableCell>
                  <TableCell align="right">Margin</TableCell>
                  <TableCell align="right">Margin %</TableCell>
                  <TableCell align="right">Hours</TableCell>
                  <TableCell align="right">Entries</TableCell>
                  <TableCell align="right">Pay w/o bill rate</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byWeek.map((w) => (
                  <TableRow key={w.weekStart} hover>
                    <TableCell>{w.weekStart}</TableCell>
                    <TableCell align="right">{usd(w.bill)}</TableCell>
                    <TableCell align="right">{usd(w.pay)}</TableCell>
                    <TableCell align="right" sx={{ color: w.margin >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                      {usd(w.margin)}
                    </TableCell>
                    <TableCell align="right">
                      {w.bill > 0 ? `${Math.round((w.margin / w.bill) * 100)}%` : '—'}
                    </TableCell>
                    <TableCell align="right">{Math.round(w.hours).toLocaleString()}</TableCell>
                    <TableCell align="right">{w.entries.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ color: w.billMissingPay > 0 ? 'warning.main' : 'text.secondary' }}>
                      {usd(w.billMissingPay)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            By account (window totals, top 25)
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell align="right">Bill (accrual)</TableCell>
                  <TableCell align="right">Pay gross</TableCell>
                  <TableCell align="right">Margin</TableCell>
                  <TableCell align="right">Hours</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byAccount.map((a) => (
                  <TableRow key={a.name} hover>
                    <TableCell>{a.name}</TableCell>
                    <TableCell align="right">{usd(a.bill)}</TableCell>
                    <TableCell align="right">{usd(a.pay)}</TableCell>
                    <TableCell align="right" sx={{ color: a.margin >= 0 ? 'success.main' : 'error.main' }}>
                      {usd(a.margin)}
                    </TableCell>
                    <TableCell align="right">{Math.round(a.hours).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
};

export default WeeklyTrendsPage;
