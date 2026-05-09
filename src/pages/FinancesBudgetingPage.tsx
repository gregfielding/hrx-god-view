/**
 * Finances and Budgeting – security levels 5, 6, and 7 (internal team).
 * Gig and Career job orders grouped by calendar week (Mon–Sun) using estimated dates / shift span.
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
  addYears,
  differenceInCalendarDays,
  endOfWeek,
  format,
  startOfWeek,
  subWeeks,
} from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { p } from '../data/firestorePaths';
import PageHeader from '../components/PageHeader';
import {
  computeJobOrderWeekShiftFinance,
  DEFAULT_FUTA_RATE_ON_PAY,
  DEFAULT_SUTA_RATE_ON_PAY,
  expandGigShiftToOccurrences,
} from '../utils/gigFinanceFromShifts';
import { isC1UnemploymentPricingEntity } from '../utils/shifts/sutaFutaAccountHydration';

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
  jobType?: string;
  gigEstimatedStartDate?: unknown;
  gigEstimatedEndDate?: unknown;
  /** Job order header dates (fallback when gig Financials dates not set) */
  startDate?: unknown;
  endDate?: unknown;
  gigEstimatedValue?: number;
  gigAverageMarkup?: number;
  /** Gig: Firestore gigPositions. Career: synthetic row from payRate/markup/bill for shift finance math. */
  gigPositions?: any[];
  poNumber?: string;
  status?: string;
  /** Hydrated from `tenants/{tid}/entities/{id}.name` (or `legalName`); used to
   *  decide whether FUTA / SUTA enter the Net column. 1099 entities (today:
   *  C1 Events LLC) skip both — independent contractors don't owe employer
   *  unemployment tax, so leaving the placeholder rates in would understate
   *  Net by ~1.5% for a substantial slice of the gig book. */
  hiringEntityName?: string | null;
}

/** True when the JO's hiring entity owes employer unemployment tax (W2 payroll). */
function appliesUnemploymentTax(jo: GigJobOrderRow): boolean {
  return isC1UnemploymentPricingEntity(jo.hiringEntityName ?? undefined);
}

/** Match the rate signature `computeJobOrderWeekShiftFinance` expects: real
 *  defaults for W2 entities, zero-rates for 1099. Centralized so the three
 *  call sites (week totals, has-figures gate, in-row calc) stay in sync. */
function rateAssumptionsFor(
  jo: GigJobOrderRow,
): { futaRate: number; sutaRate: number } {
  if (!appliesUnemploymentTax(jo)) {
    return { futaRate: 0, sutaRate: 0 };
  }
  return {
    futaRate: DEFAULT_FUTA_RATE_ON_PAY,
    sutaRate: DEFAULT_SUTA_RATE_ON_PAY,
  };
}

/** Career jobs store pay/bill on the job order root; shift finance helpers expect gigPositions-shaped entries. */
function buildGigPositionsForFinance(data: Record<string, unknown>): any[] {
  const raw = Array.isArray(data.gigPositions) ? (data.gigPositions as any[]) : [];
  if (raw.length > 0) return raw;
  if (String(data.jobType || '').toLowerCase() !== 'career') return [];
  const payRate = parseFloat(String(data.payRate ?? ''));
  if (!Number.isFinite(payRate) || payRate < 0) return [];
  const jobTitle = String(data.jobTitle || data.jobOrderName || '').trim();
  const pos: Record<string, unknown> = { jobTitle, payRate: String(payRate) };
  const markup = parseFloat(String(data.markup ?? ''));
  if (Number.isFinite(markup)) pos.markup = String(markup);
  const bill = parseFloat(String(data.calculatedBillRate ?? data.billRate ?? ''));
  if (Number.isFinite(bill) && bill >= 0) pos.billRate = String(bill);
  const wc = data.workersCompRate;
  if (wc != null && wc !== '') pos.workersCompRate = String(wc);
  return [pos];
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
  const jobType = String(jo.jobType || '').toLowerCase();
  const gStart = parseYmd(jo.gigEstimatedStartDate);
  const gEnd = parseYmd(jo.gigEstimatedEndDate);
  if (gStart && gEnd) return { start: gStart, end: gEnd };

  const jdStart = parseYmd(jo.startDate);
  const jdEnd = parseYmd(jo.endDate);
  if (jdStart && jdEnd) return { start: jdStart, end: jdEnd };
  if (jdStart && !jdEnd) {
    if (jobType === 'career') {
      return { start: jdStart, end: addYears(jdStart, 2) };
    }
    return { start: jdStart, end: jdStart };
  }

  const fromShifts = dateRangeFromShifts(shifts);
  if (fromShifts.start && fromShifts.end) {
    if (jobType === 'career') {
      const horizonEnd = addYears(fromShifts.start, 2);
      return {
        start: fromShifts.start,
        end: fromShifts.end > horizonEnd ? fromShifts.end : horizonEnd,
      };
    }
    return fromShifts;
  }
  return fromShifts;
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
    const { futaRate, sutaRate } = rateAssumptionsFor(jo);
    const calc = computeJobOrderWeekShiftFinance(
      { gigPositions: jo.gigPositions },
      shifts,
      weekMonday,
      futaRate,
      sutaRate
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

function isJobOrderCancelledForBudget(status: string | undefined): boolean {
  const s = String(status || '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled';
}

/** True when this week shows at least one non-empty money cell (prorated estimate or shift-based bill/gross). */
function jobOrderHasBudgetFiguresForWeek(jo: GigJobOrderRow, weekMonday: Date, shifts: any[]): boolean {
  const { start: eventStart, end: eventEnd } = getBudgetingEventRange(jo, shifts);
  const evWeek = proratedEstimateForWeek(jo.gigEstimatedValue, weekMonday, eventStart, eventEnd);
  const estGross = grossProfitFromEvMarkup(evWeek ?? undefined, jo.gigAverageMarkup);
  const { futaRate, sutaRate } = rateAssumptionsFor(jo);
  const calc = computeJobOrderWeekShiftFinance(
    { gigPositions: jo.gigPositions },
    shifts,
    weekMonday,
    futaRate,
    sutaRate
  );
  if (calc.occurrenceCount > 0) return true;
  if (evWeek != null && Number(evWeek) > 0) return true;
  if (estGross != null && Number(estGross) > 0) return true;
  return false;
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
      const q = query(ref, where('jobType', 'in', ['gig', 'career']));
      const snap = await getDocs(q);
      type LoadedJobOrder = GigJobOrderRow & { hiringEntityId?: string };
      const rows: LoadedJobOrder[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            jobOrderName: (data.jobOrderName || data.jobTitle || '(Untitled)') as string,
            companyName: companyDisplayFromJobOrderDoc(data),
            jobType: typeof data.jobType === 'string' ? data.jobType : undefined,
            gigEstimatedStartDate: data.gigEstimatedStartDate,
            gigEstimatedEndDate: data.gigEstimatedEndDate,
            startDate: data.startDate,
            endDate: data.endDate,
            gigEstimatedValue: data.gigEstimatedValue as number | undefined,
            gigAverageMarkup: data.gigAverageMarkup as number | undefined,
            gigPositions: buildGigPositionsForFinance(data),
            poNumber: data.poNumber as string | undefined,
            status: data.status as string | undefined,
            hiringEntityId:
              typeof data.hiringEntityId === 'string' && data.hiringEntityId.trim()
                ? data.hiringEntityId.trim()
                : undefined,
          };
        })
        .filter((jo) => !isJobOrderCancelledForBudget(jo.status));

      // Cache entity-name reads so a tenant with 100 JOs sharing 3 entities
      // collapses to 3 doc reads. Mirrors `useActiveShifts.fetchHiringEntityName`.
      const entityNameCache = new Map<string, Promise<string | null>>();
      const fetchEntityName = (entityId: string): Promise<string | null> => {
        let pending = entityNameCache.get(entityId);
        if (!pending) {
          pending = (async (): Promise<string | null> => {
            try {
              const entSnap = await getDoc(
                doc(db, 'tenants', tenantId, 'entities', entityId),
              );
              if (!entSnap.exists()) return null;
              const ed = entSnap.data() as Record<string, unknown>;
              const pick = (v: unknown): string =>
                typeof v === 'string' && v.trim() ? v.trim() : '';
              return pick(ed.name) || pick(ed.legalName) || pick(ed.title) || null;
            } catch (err) {
              console.warn('FinancesBudgeting: entity name load failed for', entityId, err);
              return null;
            }
          })();
          entityNameCache.set(entityId, pending);
        }
        return pending;
      };

      const shiftMap: Record<string, any[]> = {};
      await Promise.all([
        // Hydrate hiring-entity name onto each row in parallel with the
        // shifts subcollection load. The name decides whether FUTA / SUTA
        // are folded into Net (via `rateAssumptionsFor`).
        Promise.all(
          rows.map(async (jo) => {
            if (!jo.hiringEntityId) return;
            jo.hiringEntityName = await fetchEntityName(jo.hiringEntityId);
          }),
        ),
        Promise.all(
          rows.map(async (jo) => {
            try {
              const shiftsRef = collection(db, p.shifts(tenantId, jo.id));
              const shiftSnap = await getDocs(shiftsRef);
              shiftMap[jo.id] = shiftSnap.docs.map((sd) => ({ id: sd.id, ...sd.data() }));
            } catch (e) {
              console.warn('FinancesBudgeting: shifts load failed for', jo.id, e);
              shiftMap[jo.id] = [];
            }
          }),
        ),
      ]);

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
            Gross = bill − pay. Net also subtracts WC (% of pay). For W2 hiring
            entities (e.g. C1 Workforce / C1 Select), Net additionally subtracts
            placeholder FUTA ({(DEFAULT_FUTA_RATE_ON_PAY * 100).toFixed(1)}%) and
            SUTA ({(DEFAULT_SUTA_RATE_ON_PAY * 100).toFixed(1)}%) on pay — replace
            with tenant rules later. 1099 entities (C1 Events LLC) skip both
            because independent contractors don't owe employer unemployment tax.
            Timesheets and travel will refine this further.
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
    const overlapping = jobsForWeek(weekMonday);
    const rows = overlapping.filter((jo) =>
      jobOrderHasBudgetFiguresForWeek(jo, weekMonday, shiftsByJobOrderId[jo.id] || [])
    );
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
                      {overlapping.length === 0
                        ? 'No gig or career job orders with a resolvable date range (Financials, job dates, or shifts) overlap this week.'
                        : 'Job orders overlap this week, but none have a prorated budget estimate or scheduled shift hours here — add Financials (value + dates) or shifts to see rows.'}
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
                  const { futaRate: rowFutaRate, sutaRate: rowSutaRate } =
                    rateAssumptionsFor(jo);
                  const calc = computeJobOrderWeekShiftFinance(
                    jobOrderPayload,
                    shifts,
                    weekMonday,
                    rowFutaRate,
                    rowSutaRate
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
        subtitle="Gig and career job orders by week (Mon–Sun). Compare budget estimates to shift-based calculations as you add shifts."
      />

      <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
        <Alert severity="info" sx={{ mb: 2 }} icon={false}>
          <Typography variant="body2">
            <strong>Gig</strong> and <strong>career</strong> job orders appear when their date range overlaps Mon–Sun. We
            use <strong>Financials estimated start/end</strong> first; then <strong>job start/end</strong>; then{' '}
            <strong>shift dates</strong>. Open-ended career jobs (no end date) are treated as running forward for two
            years for forecasting so they can appear in each overlapping week. <strong>Est. value / est. gross</strong>{' '}
            use the Financials total spread across that range (career rows often show — until Financials are filled).{' '}
            <strong>Shift columns</strong> use scheduled hours in this week only. Rows with no prorated estimate and no
            shift hours in that week are hidden so the table stays scannable.
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
