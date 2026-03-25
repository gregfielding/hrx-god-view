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
  differenceInCalendarDays,
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
  expandGigShiftToOccurrences,
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

/** Inclusive calendar days from start through end (local dates). */
function calendarDaysInclusive(start: Date, end: Date): number {
  if (end < start) return 0;
  return differenceInCalendarDays(end, start) + 1;
}

/** How many calendar days of [eventStart, eventEnd] fall in Mon–Sun week of weekMonday. */
function eventCalendarDaysInWeek(weekMonday: Date, eventStart: Date, eventEnd: Date): number {
  const weekSunday = endOfWeek(weekMonday, { weekStartsOn: 1 });
  const overlapStart = eventStart > weekMonday ? eventStart : weekMonday;
  const overlapEnd = eventEnd < weekSunday ? eventEnd : weekSunday;
  if (overlapStart > overlapEnd) return 0;
  return calendarDaysInclusive(overlapStart, overlapEnd);
}

/**
 * Spread full-event estimated value across calendar days, then sum only days in this week.
 * If dates are missing, returns full value (no proration).
 */
function proratedEstimateForWeek(
  fullEstimatedValue: number | null | undefined,
  weekMonday: Date,
  eventStart: Date | null,
  eventEnd: Date | null
): number | null {
  if (fullEstimatedValue == null || !Number.isFinite(Number(fullEstimatedValue))) return null;
  const ev = Number(fullEstimatedValue);
  if (ev <= 0) return null;
  if (!eventStart || !eventEnd) return null;
  const totalDays = calendarDaysInclusive(eventStart, eventEnd);
  if (totalDays <= 0) return null;
  const daysThisWeek = eventCalendarDaysInWeek(weekMonday, eventStart, eventEnd);
  if (daysThisWeek <= 0) return null;
  const dayValue = ev / totalDays;
  const prorated = dayValue * daysThisWeek;
  return Number.isFinite(prorated) ? prorated : null;
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
  /** Job order header dates (fallback when gig Financials dates not set) */
  startDate?: unknown;
  endDate?: unknown;
  gigEstimatedValue?: number;
  gigAverageMarkup?: number;
  gigPositions?: any[];
  poNumber?: string;
  status?: string;
}

/** Min/max calendar days from all shift occurrences (gig shifts). */
function dateRangeFromShifts(shifts: any[]): { start: Date | null; end: Date | null } {
  const ymds: string[] = [];
  for (const shift of shifts) {
    const occ = expandGigShiftToOccurrences(shift, {});
    occ.forEach((o) => ymds.push(o.dateStr));
  }
  if (ymds.length === 0) return { start: null, end: null };
  ymds.sort();
  return { start: parseYmd(ymds[0]), end: parseYmd(ymds[ymds.length - 1]) };
}

/**
 * Calendar range for which week a gig appears + proration denominator.
 * 1) gigEstimatedStartDate / gigEstimatedEndDate (Financials)
 * 2) job startDate / endDate (if end missing, single-day event)
 * 3) min–max dates from scheduled shifts
 */
function getBudgetingEventRange(jo: GigJobOrderRow, shifts: any[]): { start: Date | null; end: Date | null } {
  const gStart = parseYmd(jo.gigEstimatedStartDate);
  const gEnd = parseYmd(jo.gigEstimatedEndDate);
  if (gStart && gEnd) return { start: gStart, end: gEnd };

  const jdStart = parseYmd(jo.startDate);
  const jdEnd = parseYmd(jo.endDate);
  if (jdStart && jdEnd) return { start: jdStart, end: jdEnd };
  if (jdStart && !jdEnd) return { start: jdStart, end: jdStart };

  return dateRangeFromShifts(shifts);
}

/**
 * Sum for the week: each row uses shift Bill & Gross when this week has shift hours; otherwise prorated
 * Est. value and Est. gross (same logic as the table cells).
 */
function weekFinancialTotals(
  rows: GigJobOrderRow[],
  weekMonday: Date,
  shiftsByJobOrderId: Record<string, any[]>
): { sumBill: number; sumGross: number } {
  let sumBill = 0;
  let sumGross = 0;
  for (const jo of rows) {
    const shifts = shiftsByJobOrderId[jo.id] || [];
    const { start: startStr, end: endStr } = getBudgetingEventRange(jo, shifts);
    const evWeek = proratedEstimateForWeek(jo.gigEstimatedValue, weekMonday, startStr, endStr);
    const estGross = grossProfitFromEvMarkup(evWeek ?? undefined, jo.gigAverageMarkup);
    const calc = computeJobOrderWeekShiftFinance(
      { gigPositions: jo.gigPositions },
      shifts,
      weekMonday,
      DEFAULT_FUTA_RATE_ON_PAY,
      DEFAULT_SUTA_RATE_ON_PAY
    );
    if (calc.occurrenceCount > 0) {
      sumBill += Number(calc.billTotal) || 0;
      sumGross += Number(calc.grossProfit) || 0;
    } else {
      if (evWeek != null) sumBill += evWeek;
      if (estGross != null) sumGross += estGross;
    }
  }
  return { sumBill, sumGross };
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
          startDate: data.startDate,
          endDate: data.endDate,
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
          const shifts = shiftsByJobOrderId[jo.id] || [];
          const { start, end } = getBudgetingEventRange(jo, shifts);
          return weekRangeOverlapsJob(weekMonday, start, end);
        })
        .sort((a, b) =>
          (a.jobOrderName || '').localeCompare(b.jobOrderName || '', undefined, { sensitivity: 'base' })
        );
    },
    [jobOrders, shiftsByJobOrderId]
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
    const weekTotals = weekFinancialTotals(rows, weekMonday, shiftsByJobOrderId);
    return (
      <Box key={weekMonday.toISOString()} sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: { xs: 1, sm: 2 },
            mb: 1.5,
            rowGap: 1,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'primary.main' }}>
            {formatWeekHeading(weekMonday)}
          </Typography>
          {rows.length > 0 && (
            <Tooltip
              title={
                <Typography variant="caption" component="span" display="block" sx={{ maxWidth: 320 }}>
                  Week total: each job uses <strong>shift Bill</strong> and <strong>shift Gross</strong> when this week has
                  scheduled shift hours; otherwise prorated <strong>Est. value</strong> and <strong>Est. gross</strong>.
                </Typography>
              }
              arrow
              placement="top"
            >
              <Typography
                variant="body2"
                component="span"
                sx={{
                  fontWeight: 500,
                  color: 'text.primary',
                  borderBottom: '1px dotted',
                  borderColor: 'text.secondary',
                  cursor: 'help',
                }}
              >
                Bill {formatCurrency(weekTotals.sumBill)} · Gross {formatCurrency(weekTotals.sumGross)}
              </Typography>
            </Tooltip>
          )}
        </Box>
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
                  <Tooltip
                    title="Total Financials value is spread evenly across each calendar day of the event; only days that fall in this week are included here."
                    arrow
                    placement="top"
                  >
                    <Box component="span" sx={{ cursor: 'help', borderBottom: '1px dotted', borderColor: 'text.secondary' }}>
                      Budget estimate (this week)
                    </Box>
                  </Tooltip>
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
                      No gig job orders with a resolvable date range (Financials, job dates, or shifts) overlap this
                      week.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((jo) => {
                  const shifts = shiftsByJobOrderId[jo.id] || [];
                  const { start: eventStart, end: eventEnd } = getBudgetingEventRange(jo, shifts);
                  const evWeek = proratedEstimateForWeek(jo.gigEstimatedValue, weekMonday, eventStart, eventEnd);
                  const m = jo.gigAverageMarkup;
                  const estGross = grossProfitFromEvMarkup(evWeek ?? undefined, m);
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
                      <TableCell>{eventStart ? format(eventStart, 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell>{eventEnd ? format(eventEnd, 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell align="right">{formatCurrency(evWeek)}</TableCell>
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
          Est. value and est. gross use the job order Financials total spread evenly per calendar day; this row shows
          only the portion for days that fall in this week. Shift columns only include hours in this week — not yet
          timesheet actuals.
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
            A gig appears in a week when its date range overlaps Mon–Sun. We use <strong>Financials estimated start/end</strong>{' '}
            first; if those aren&apos;t set, <strong>job start/end</strong>; if still missing, the <strong>min–max dates
            from shifts</strong>. <strong>Est. value / est. gross</strong> spread the Financials total across calendar
            days in that range (multi-week events don&apos;t double-count). <strong>Shift columns</strong> use hours in
            this week only.
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
