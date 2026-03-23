/**
 * Finances and Budgeting – security levels 5, 6, and 7 (internal team).
 * Gig job orders grouped by calendar week (Mon–Sun) using estimated event dates.
 * Shows job-order estimates vs. shift-calculated values for that week (refines as shifts are added).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Tabs,
  Tab,
  Tooltip,
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  addWeeks,
  endOfWeek,
  format,
  startOfWeek,
  subWeeks,
} from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import PageHeader from '../components/PageHeader';
import {
  computeJobOrderWeekShiftFinance,
  DEFAULT_FUTA_RATE_ON_PAY,
  DEFAULT_SUTA_RATE_ON_PAY,
} from '../utils/gigFinanceFromShifts';

const WEEKS_COUNT = 12;

function mondayOfWeekContaining(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

function parseYmd(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as any).toDate === 'function') {
    const dt = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(dt.getTime()) ? null : stripTime(dt);
  }
  const str = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : stripTime(dt);
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function weekRangeOverlapsJob(weekMonday: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  const weekSunday = endOfWeek(weekMonday, { weekStartsOn: 1 });
  return start <= weekSunday && end >= weekMonday;
}

function formatWeekHeading(weekMonday: Date): string {
  const sunday = endOfWeek(weekMonday, { weekStartsOn: 1 });
  return `${format(weekMonday, 'EEEE, MMM d')} – ${format(sunday, 'MMM d, yyyy')}`;
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function grossProfitFromEvMarkup(ev: number | null | undefined, markupPct: number | null | undefined): number | null {
  if (ev == null || !Number.isFinite(Number(ev)) || Number(ev) <= 0) return null;
  if (markupPct == null || !Number.isFinite(Number(markupPct)) || Number(markupPct) < 0) return null;
  const denom = 1 + Number(markupPct) / 100;
  if (denom <= 0) return null;
  const gp = Number(ev) - Number(ev) / denom;
  return Number.isFinite(gp) ? gp : null;
}

/** Same denormalized fields as JobOrderForm / detail; older docs may only have accountName or deal.companyName. */
function companyDisplayFromJobOrderDoc(data: Record<string, unknown>): string {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const fromRoot =
    pick(data.companyName) ||
    pick(data.accountName) ||
    pick(data.parentAccountName);
  if (fromRoot) return fromRoot;
  const deal = data.deal;
  if (deal && typeof deal === 'object') {
    const d = deal as Record<string, unknown>;
    const fromDeal = pick(d.companyName) || pick(d.name);
    if (fromDeal) return fromDeal;
  }
  return '—';
}

interface GigJobOrderRow {
  id: string;
  jobOrderName: string;
  companyName: string;
  gigEstimatedStartDate?: unknown;
  gigEstimatedEndDate?: unknown;
  gigEstimatedValue?: number;
  gigAverageMarkup?: number;
  gigPositions?: any[];
  poNumber?: string;
  status?: string;
}

const FinancesBudgetingPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobOrders, setJobOrders] = useState<GigJobOrderRow[]>([]);
  const [shiftsByJobOrderId, setShiftsByJobOrderId] = useState<Record<string, any[]>>({});
  const [tab, setTab] = useState<'forecast' | 'past'>('forecast');

  const todayMonday = useMemo(() => mondayOfWeekContaining(new Date()), []);

  const forecastWeeks = useMemo(() => {
    return Array.from({ length: WEEKS_COUNT }, (_, i) => addWeeks(todayMonday, i));
  }, [todayMonday]);

  const pastWeeks = useMemo(() => {
    return Array.from({ length: WEEKS_COUNT }, (_, i) => subWeeks(todayMonday, WEEKS_COUNT - i));
  }, [todayMonday]);

  const loadJobOrdersAndShifts = useCallback(async () => {
    if (!tenantId) {
      setJobOrders([]);
      setShiftsByJobOrderId({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ref = collection(db, p.jobOrders(tenantId));
      const q = query(ref, where('jobType', '==', 'gig'));
      const snap = await getDocs(q);
      const rows: GigJobOrderRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          jobOrderName: data.jobOrderName || data.jobTitle || '(Untitled)',
          companyName: companyDisplayFromJobOrderDoc(data as Record<string, unknown>),
          gigEstimatedStartDate: data.gigEstimatedStartDate,
          gigEstimatedEndDate: data.gigEstimatedEndDate,
          gigEstimatedValue: data.gigEstimatedValue,
          gigAverageMarkup: data.gigAverageMarkup,
          gigPositions: Array.isArray(data.gigPositions) ? data.gigPositions : [],
          poNumber: data.poNumber,
          status: data.status,
        };
      });

      const shiftMap: Record<string, any[]> = {};
      await Promise.all(
        rows.map(async (jo) => {
          try {
            const shiftsRef = collection(db, p.shifts(tenantId, jo.id));
            const shiftSnap = await getDocs(shiftsRef);
            shiftMap[jo.id] = shiftSnap.docs.map((sd) => ({ id: sd.id, ...sd.data() }));
          } catch (e) {
            console.warn('FinancesBudgeting: shifts load failed for', jo.id, e);
            shiftMap[jo.id] = [];
          }
        })
      );

      setJobOrders(rows);
      setShiftsByJobOrderId(shiftMap);
    } catch (e: any) {
      console.error('FinancesBudgetingPage load', e);
      setError(e?.message || 'Failed to load data');
      setJobOrders([]);
      setShiftsByJobOrderId({});
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadJobOrdersAndShifts();
  }, [loadJobOrdersAndShifts]);

  const jobsForWeek = useCallback(
    (weekMonday: Date) => {
      return jobOrders
        .filter((jo) => {
          const start = parseYmd(jo.gigEstimatedStartDate);
          const end = parseYmd(jo.gigEstimatedEndDate);
          return weekRangeOverlapsJob(weekMonday, start, end);
        })
        .sort((a, b) =>
          (a.jobOrderName || '').localeCompare(b.jobOrderName || '', undefined, { sensitivity: 'base' })
        );
    },
    [jobOrders]
  );

  const calcHeader = (
    <Tooltip
      title={
        <Box sx={{ p: 0.5, maxWidth: 320 }}>
          <Typography variant="caption" display="block">
            Bill, gross, and net are computed from <strong>shifts scheduled in this calendar week only</strong>, using
            each shift&apos;s hours, headcount, and job title matched to <strong>gig position</strong> pay, bill, and
            workers comp rates on the job order.
          </Typography>
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            Gross = bill − pay. Net also subtracts WC (% of pay), plus placeholder FUTA ({(DEFAULT_FUTA_RATE_ON_PAY * 100).toFixed(1)}%)
            and SUTA ({(DEFAULT_SUTA_RATE_ON_PAY * 100).toFixed(1)}%) on pay — replace with tenant rules later. Timesheets
            and travel will refine this further.
          </Typography>
        </Box>
      }
      placement="top"
      arrow
    >
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
        This week (shifts)
        <InfoOutlinedIcon fontSize="inherit" sx={{ opacity: 0.7 }} />
      </Box>
    </Tooltip>
  );

  const renderWeekTable = (weekMonday: Date) => {
    const rows = jobsForWeek(weekMonday);
    return (
      <Box key={weekMonday.toISOString()} sx={{ mb: 4 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'primary.main', mb: 1.5 }}>
          {formatWeekHeading(weekMonday)}
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1, overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 1100 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>
                  Job order
                </TableCell>
                <TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>
                  Company
                </TableCell>
                <TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>
                  Est. start
                </TableCell>
                <TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>
                  Est. end
                </TableCell>
                <TableCell align="center" colSpan={2} sx={{ borderBottom: 'none', bgcolor: 'action.hover' }}>
                  Job order estimate (whole event)
                </TableCell>
                <TableCell align="center" colSpan={3} sx={{ borderBottom: 'none', bgcolor: 'primary.50' }}>
                  {calcHeader}
                </TableCell>
                <TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>
                  PO #
                </TableCell>
                <TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>
                  Status
                </TableCell>
              </TableRow>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell align="right" sx={{ bgcolor: 'action.hover', fontSize: '0.75rem' }}>
                  Est. value
                </TableCell>
                <TableCell align="right" sx={{ bgcolor: 'action.hover', fontSize: '0.75rem' }}>
                  Est. gross
                </TableCell>
                <TableCell align="right" sx={{ bgcolor: 'primary.50', fontSize: '0.75rem' }}>
                  Bill
                </TableCell>
                <TableCell align="right" sx={{ bgcolor: 'primary.50', fontSize: '0.75rem' }}>
                  Gross
                </TableCell>
                <TableCell align="right" sx={{ bgcolor: 'primary.50', fontSize: '0.75rem' }}>
                  Net
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No gig job orders with estimated start/end dates overlap this week.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((jo) => {
                  const ev = jo.gigEstimatedValue;
                  const m = jo.gigAverageMarkup;
                  const estGross = grossProfitFromEvMarkup(ev, m);
                  const startStr = parseYmd(jo.gigEstimatedStartDate);
                  const endStr = parseYmd(jo.gigEstimatedEndDate);

                  const shifts = shiftsByJobOrderId[jo.id] || [];
                  const jobOrderPayload = {
                    gigPositions: jo.gigPositions,
                  };
                  const calc = computeJobOrderWeekShiftFinance(
                    jobOrderPayload,
                    shifts,
                    weekMonday,
                    DEFAULT_FUTA_RATE_ON_PAY,
                    DEFAULT_SUTA_RATE_ON_PAY
                  );
                  const hasShiftCalc = calc.occurrenceCount > 0;

                  return (
                    <TableRow
                      key={jo.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/jobs/job-orders/${jo.id}`)}
                    >
                      <TableCell sx={{ fontWeight: 500 }}>{jo.jobOrderName}</TableCell>
                      <TableCell>{jo.companyName}</TableCell>
                      <TableCell>{startStr ? format(startStr, 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell>{endStr ? format(endStr, 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell align="right">{formatCurrency(ev)}</TableCell>
                      <TableCell align="right">{estGross != null ? formatCurrency(estGross) : '—'}</TableCell>
                      <TableCell align="right" sx={{ bgcolor: 'primary.50' }}>
                        {hasShiftCalc ? formatCurrency(calc.billTotal) : '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ bgcolor: 'primary.50' }}>
                        {hasShiftCalc ? formatCurrency(calc.grossProfit) : '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ bgcolor: 'primary.50' }}>
                        {hasShiftCalc ? formatCurrency(calc.netProfit) : '—'}
                      </TableCell>
                      <TableCell>{jo.poNumber || '—'}</TableCell>
                      <TableCell>
                        {jo.status ? (
                          <Chip size="small" label={jo.status} variant="outlined" />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Estimates come from the job order Financials (full event). Shift columns only include hours that fall in this
          week; they replace intuition as you add shifts — not yet timesheet actuals.
        </Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <BarChartIcon fontSize="small" color="primary" />
              <Typography variant="h6" sx={{ fontSize: { xs: '20px', md: '24px' }, fontWeight: 600 }}>
                Finances and Budgeting
              </Typography>
            </Box>
          </Box>
        }
        subtitle="Gig job orders by week (Mon–Sun). Compare early budget estimates to shift-based calculations as you add detail. Example week: Mon Mar 23 – Sun Mar 29, 2026."
      />

      <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
        <Alert severity="info" sx={{ mb: 2 }} icon={false}>
          <Typography variant="body2">
            <strong>Estimates</strong> use Financials on the job order (whole event). <strong>Shift columns</strong> sum
            scheduled hours in <em>this week only</em>, using gig position pay/bill/WC rates. When shifts exist, use them
            to refine the plan; timesheets and extra costs (travel, etc.) will layer on later.
          </Typography>
        </Alert>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          <Tab value="forecast" label="Forecast" />
          <Tab value="past" label="Past" />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {tab === 'forecast' && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Next {WEEKS_COUNT} weeks starting this Monday ({format(todayMonday, 'MMM d, yyyy')}), including the
                current week.
              </Typography>
            )}
            {tab === 'past' && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Previous {WEEKS_COUNT} full weeks before this Monday ({format(todayMonday, 'MMM d, yyyy')}).
              </Typography>
            )}
            {tab === 'forecast' && forecastWeeks.map((w) => renderWeekTable(w))}
            {tab === 'past' && pastWeeks.map((w) => renderWeekTable(w))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default FinancesBudgetingPage;
