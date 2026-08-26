/**
 * /reports/data-health — the Reconciliation Spine (Greg 2026-08-26).
 *
 * The upstream QA surface for every financial + WC report. Per month ×
 * entity: Everee-settled gross (the wire-reconciliation truth) vs HRX
 * entry gross, off-cycle explained, UNEXPLAINED residual highlighted —
 * then gross-weighted coverage of every field the dozen downstream
 * reports depend on (assignment → job order → account → bill rate →
 * work state → WC code → WC rate). Fix queues upstream; every report
 * downstream corrects itself.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
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
import RefreshIcon from '@mui/icons-material/Refresh';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface EntityRow {
  entityId: string;
  entityName: string;
  evereeGross: number;
  evereePayments: number;
  entryGross: number;
  entryCount: number;
  workers: number;
  offCycleTotal: number;
  unexplained: number;
  coveragePct: Record<string, number>;
  coverageGapGross: Record<string, number>;
}

interface MonthBlock {
  month: string;
  entities: EntityRow[];
  totals: { evereeGross: number; entryGross: number; offCycleTotal: number; unexplained: number };
}

interface HealthData {
  startDate: string;
  endDate: string;
  months: MonthBlock[];
  noAssignmentQueueSample: Array<Record<string, unknown>>;
  notes: string[];
}

const COVERAGE_FIELDS: Array<{ key: string; label: string; feeds: string }> = [
  { key: 'assignment', label: 'Assignment', feeds: 'point of truth — everything below resolves through it' },
  { key: 'jobOrder', label: 'Job order', feeds: 'job costing, attribution, wire journal splits' },
  { key: 'account', label: 'Account', feeds: 'gross margin by client, weekly trends' },
  { key: 'billRate', label: 'Bill rate', feeds: 'accrual revenue, margin, forecasting' },
  { key: 'workState', label: 'Work state', feeds: 'all WC reports, state tax context' },
  { key: 'wcCode', label: 'WC class code', feeds: 'carrier wage report, premium, audits' },
  { key: 'wcRate', label: 'WC rate', feeds: 'premium computation, margin WC line' },
];

const pctColor = (p: number): string => (p >= 99 ? 'success.main' : p >= 90 ? 'warning.main' : 'error.main');

const monthsAgoIso = (n: number): string => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n, 1);
  return d.toISOString().slice(0, 10);
};

const DataHealthPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [startDate, setStartDate] = useState(monthsAgoIso(3));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport');
      const res = await fn({ tenantId, dataHealth: true, startDate, endDate });
      setData(res.data as HealthData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tenantId, startDate, endDate]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center">
            <MonitorHeartOutlinedIcon />
            <span>Data Health</span>
          </Stack>
        }
        subtitle="The reconciliation spine: Everee-settled dollars vs HRX entries per month, plus how much of every entry-dollar carries the fields the reports depend on."
      />

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <TextField size="small" type="date" label="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <Button variant="contained" size="small" startIcon={<RefreshIcon />} disabled={loading} onClick={() => void load()}>
          Run
        </Button>
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
      ) : (
        data && (
          <>
            {data.months.map((m) => (
              <Card key={m.month} variant="outlined" sx={{ mb: 2.5 }}>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {m.month}
                    </Typography>
                    {m.month === currentMonth && (
                      <Chip size="small" variant="outlined" label="month to date — import lag expected" />
                    )}
                    <Typography variant="body2" color="text.secondary">
                      Everee settled {usd(m.totals.evereeGross)} · entries {usd(m.totals.entryGross)} · off-cycle{' '}
                      {usd(m.totals.offCycleTotal)}
                    </Typography>
                    <Chip
                      size="small"
                      color={Math.abs(m.totals.unexplained) < 1000 ? 'success' : 'error'}
                      label={`unexplained ${usd(m.totals.unexplained)}`}
                    />
                  </Stack>

                  <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Entity</TableCell>
                          <TableCell align="right">Everee settled</TableCell>
                          <TableCell align="right">Entries</TableCell>
                          <TableCell align="right">Off-cycle</TableCell>
                          <TableCell align="right">Unexplained</TableCell>
                          {COVERAGE_FIELDS.map((f) => (
                            <TableCell key={f.key} align="right">
                              <Tooltip title={`Feeds: ${f.feeds}`}>
                                <span>{f.label}</span>
                              </Tooltip>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {m.entities.map((e) => (
                          <TableRow key={e.entityId} hover>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {e.entityName}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {e.entryCount.toLocaleString()} entries · {e.workers.toLocaleString()} workers
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{usd(e.evereeGross)}</TableCell>
                            <TableCell align="right">{usd(e.entryGross)}</TableCell>
                            <TableCell align="right">{usd(e.offCycleTotal)}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ fontWeight: 700, color: Math.abs(e.unexplained) < 1000 ? 'success.main' : 'error.main' }}
                            >
                              {usd(e.unexplained)}
                            </TableCell>
                            {COVERAGE_FIELDS.map((f) => {
                              const p = e.coveragePct[f.key] ?? 0;
                              const gap = e.coverageGapGross[f.key] ?? 0;
                              return (
                                <TableCell key={f.key} align="right" sx={{ color: pctColor(p) }}>
                                  <Tooltip title={gap > 0 ? `${usd(gap)} of entry gross missing ${f.label}` : 'fully covered'}>
                                    <span>{p}%</span>
                                  </Tooltip>
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ))}

            {data.noAssignmentQueueSample.length > 0 && (
              <Card variant="outlined" sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                    No-assignment queue (sample) — materialize assignments for these, never read-time patches
                  </Typography>
                  {data.noAssignmentQueueSample.map((q, i) => (
                    <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {String(q.workDate)} · {String(q.entityId)} · {usd(q.gross)} · {String(q.source ?? '')} ·{' '}
                      {String(q.worksite ?? '(no worksite)')}
                    </Typography>
                  ))}
                </CardContent>
              </Card>
            )}

            <Alert severity="info" icon={false}>
              {data.notes.map((n, i) => (
                <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                  {n}
                </Typography>
              ))}
            </Alert>
          </>
        )
      )}
    </Box>
  );
};

export default DataHealthPage;
