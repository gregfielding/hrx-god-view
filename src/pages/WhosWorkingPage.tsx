/**
 * Who's Working — the weekly assignment report (Phase 3a).
 *
 * Design contract (Greg, 2026-07-17 review): answer "who is assigned,
 * where, and for how many hours" for ANY week — last week for payroll
 * checks, this week and next for planning — in plain English with zero
 * configuration. Recruiters pick a week with arrows; everything else is
 * automatic.
 *
 * Data: the SAME resolver the Timesheets grid uses
 * (`resolveTimesheetGrid`, new `tenant_period` filter kind), so scheduled
 * hours here always agree with the payroll grid — one source of truth for
 * the weeklySchedule/open-shift expansion and the phantom-row filters.
 * Rows are grouped Account → Job Order → worker; per worker we show the
 * days they're scheduled, total scheduled hours, and actual hours where a
 * timesheet entry exists (past weeks). CSV-imported (Indeed Flex) worked
 * rows are included via the resolver's import leg, so portal-first crews
 * appear in the payroll view too.
 *
 * Money (pay × hours vs bill × hours, OT at 1.5× bill) is Phase 3b — this
 * page deliberately stays people + hours.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  Button,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import AssignmentDrawer, {
  type AssignmentDrawerTarget,
} from '../components/recruiter/AssignmentDrawer';
import {
  resolveTimesheetGrid,
  scheduledHoursForRow,
  actualHoursForRow,
  type TimesheetGridRow,
} from '../components/timesheets/timesheetGridResolver';
import {
  type PeriodRange,
  currentWeeklyPeriod,
  shiftWeeklyPeriod,
  eachDateInPeriod,
  formatWeekOfLabel,
  dowForIso,
  dowShortLabel,
  todayIsoLocal,
} from '../utils/timesheets/dateRange';

/* -------------------------------------------------------------------------
 * Aggregation
 * ------------------------------------------------------------------------- */

interface WorkerLine {
  workerId: string;
  workerName: string;
  /** ISO dates in the week the worker is scheduled/worked. */
  dates: Set<string>;
  scheduledHours: number;
  actualHours: number;
  hasEntries: boolean;
  /** Drawer target — first-seen assignment context for this worker. */
  shiftId: string | null;
  assignmentId: string | null;
  /** Import-only rows have no real assignment to open/end. */
  isImport: boolean;
}

interface JobOrderGroup {
  jobOrderId: string;
  label: string;
  /** "Child account · worksite · address" — shown under each worker name. */
  subLine: string | null;
  workers: Map<string, WorkerLine>;
  scheduledHours: number;
  actualHours: number;
  payDollars: number;
  billDollars: number;
  rowsMissingRates: number;
}

interface AccountGroup {
  key: string;
  label: string;
  jobOrders: Map<string, JobOrderGroup>;
  workerIds: Set<string>;
  scheduledHours: number;
  actualHours: number;
  payDollars: number;
  billDollars: number;
  rowsMissingRates: number;
}

/** Per-worker tenant-wide day hours, for the OT estimate (a worker can
 *  cross accounts in a week; OT thresholds apply to the worker, not the
 *  account). */
interface OtEstimate {
  workersOver40: number;
  estimatedOtHours: number;
}

/** Full-time tracker (Phase 3c): one worker's hours across the 4 weeks
 *  ending with the selected week — newest last. */
interface FullTimeRow {
  workerId: string;
  workerName: string;
  weekHours: number[];
  latestHours: number;
  trendingUp: boolean;
}

/** Full-time builder: a coverage-gap seat matched to an under-full-time
 *  worker who is free that day. Shape mirrors the divergence sweep's
 *  coverageGaps rows (getScheduleDivergence). */
interface GapRow {
  jobOrderId: string;
  jobTitle: string;
  accountName: string;
  date: string;
  needed: number;
  filled: number;
  gap: number;
}

interface BuilderSuggestion {
  workerId: string;
  workerName: string;
  currentHours: number;
  gap: GapRow;
}

/** Weekly metrics — shape mirrors the getSchedulingMetrics callable. */
interface MetricsPayload {
  weeks: Array<{ start: string; end: string; label: string }>;
  accounts: string[];
  totals: Array<{ hours: number; workers: number; ftWorkers: number }>;
  byAccount: Record<string, Array<{ hours: number; workers: number; ftWorkers: number }>>;
}

/** Single-series chart hue — categorical slot 1 of the validated default
 *  palette (dataviz skill). One hue for all three small multiples: each
 *  chart holds ONE measure, so identity comes from the chart title, never
 *  a legend or color coding. */
const CHART_HUE = '#2a78d6';

const MetricChart: React.FC<{
  title: string;
  caption: string;
  data: Array<{ label: string; value: number }>;
  area?: boolean;
}> = ({ title, caption, data, area }) => (
  <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
    <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
      {caption}
    </Typography>
    <Box sx={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        {area ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
            <ChartTooltip
              formatter={(v: number | string) => [v, title]}
              labelFormatter={(l) => `Week of ${l}`}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={CHART_HUE}
              strokeWidth={2}
              fill={CHART_HUE}
              fillOpacity={0.12}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
            <ChartTooltip
              formatter={(v: number | string) => [v, title]}
              labelFormatter={(l) => `Week of ${l}`}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={CHART_HUE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </Box>
  </Paper>
);

/** One ongoing (open-ended) assignment — the Full-Time Workers tab.
 *  Shape mirrors the getOngoingAssignments callable. */
interface OngoingRow {
  assignmentId: string;
  userId: string;
  workerName: string;
  phone: string;
  accountName: string;
  jobOrderId: string;
  jobOrderName?: string;
  shiftId: string;
  jobTitle: string;
  worksiteName: string;
  worksiteAddress?: string;
  startDate: string | null;
  weeklyDays: string[];
  isOpenShift: boolean;
  payRate: number | null;
  billRate: number | null;
  status: string;
}

/** Match workers sitting under full-time with open seats on days they
 *  don't already work. At most 2 suggestions per worker so one busy JO
 *  doesn't drown the list; workers closest to 35 rank first (fastest
 *  wins). DNR and readiness are enforced by the placement flow itself. */
function buildSuggestions(
  ftRows: FullTimeRow[],
  workerWeekDates: Map<string, Set<string>>,
  gaps: GapRow[],
  maxTotal = 10,
): BuilderSuggestion[] {
  const out: BuilderSuggestion[] = [];
  const candidates = ftRows
    .filter((w) => w.latestHours > 0 && w.latestHours < 35)
    .sort((a, b) => b.latestHours - a.latestHours);
  for (const w of candidates) {
    if (out.length >= maxTotal) break;
    const busy = workerWeekDates.get(w.workerId) ?? new Set<string>();
    let perWorker = 0;
    for (const g of gaps) {
      if (perWorker >= 2 || out.length >= maxTotal) break;
      if (busy.has(g.date)) continue;
      out.push({ workerId: w.workerId, workerName: w.workerName, currentHours: w.latestHours, gap: g });
      perWorker += 1;
    }
  }
  return out;
}

interface JoNames {
  accountKey: string;
  accountLabel: string;
  joLabel: string;
  /** Child/site account when the JO carries one (carrier-style lineage). */
  childAccountLabel: string | null;
  /** "Worksite name · street, city, state" line for under the worker name. */
  worksiteLine: string | null;
}

function buildGroups(
  rows: TimesheetGridRow[],
  joNames: Map<string, JoNames>,
): { groups: AccountGroup[]; ot: OtEstimate } {
  const accounts = new Map<string, AccountGroup>();
  // workerId → workDate → hours, tenant-wide, for the OT estimate.
  const workerDayHours = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.kind !== 'entry' && row.kind !== 'empty') continue;
    const joId = row.assignment.jobOrderId || '';
    const names = joId ? joNames.get(joId) : undefined;
    // Unmatched import rows have no JO — group them under their venue
    // name so imported crews are never silently dropped from the report.
    const accountKey =
      names?.accountKey ||
      (row.assignment.worksiteDisplayName
        ? `venue:${row.assignment.worksiteDisplayName}`
        : 'unknown');
    const accountLabel =
      names?.accountLabel || row.assignment.worksiteDisplayName || 'Unmatched';
    const joLabel = names?.joLabel || row.assignment.worksiteDisplayName || 'Job order';

    let account = accounts.get(accountKey);
    if (!account) {
      account = {
        key: accountKey,
        label: accountLabel,
        jobOrders: new Map(),
        workerIds: new Set(),
        scheduledHours: 0,
        actualHours: 0,
        payDollars: 0,
        billDollars: 0,
        rowsMissingRates: 0,
      };
      accounts.set(accountKey, account);
    }
    const joGroupKey = joId || accountKey;
    let jo = account.jobOrders.get(joGroupKey);
    if (!jo) {
      jo = {
        jobOrderId: joId,
        label: joLabel,
        subLine:
          [names?.childAccountLabel, names?.worksiteLine].filter(Boolean).join(' · ') || null,
        workers: new Map(),
        scheduledHours: 0,
        actualHours: 0,
        payDollars: 0,
        billDollars: 0,
        rowsMissingRates: 0,
      };
      account.jobOrders.set(joGroupKey, jo);
    }

    const workerId = row.assignment.workerId || row.assignment.candidateId || row.key;
    const rowIsImport = row.kind === 'entry' && row.isImport === true;
    let worker = jo.workers.get(workerId);
    if (!worker) {
      worker = {
        workerId,
        workerName: row.assignment.workerDisplayName || 'Worker',
        dates: new Set(),
        scheduledHours: 0,
        actualHours: 0,
        hasEntries: false,
        shiftId: row.assignment.shiftId,
        assignmentId: row.assignment.id || null,
        isImport: rowIsImport,
      };
      jo.workers.set(workerId, worker);
    } else if (worker.workerName === 'Worker' && row.assignment.workerDisplayName) {
      worker.workerName = row.assignment.workerDisplayName;
    }
    // A real assignment row beats an import row as the drawer target.
    if (worker.isImport && !rowIsImport) {
      worker.shiftId = row.assignment.shiftId;
      worker.assignmentId = row.assignment.id || null;
      worker.isImport = false;
    }

    const sched = scheduledHoursForRow(row);
    const actual = row.kind === 'entry' ? actualHoursForRow(row) : 0;
    worker.dates.add(row.workDate);
    worker.scheduledHours += sched;
    worker.actualHours += actual;
    if (row.kind === 'entry') worker.hasEntries = true;
    jo.scheduledHours += sched;
    jo.actualHours += actual;
    account.workerIds.add(workerId);
    account.scheduledHours += sched;
    account.actualHours += actual;

    // Money: actual hours when an entry exists, scheduled otherwise —
    // same preference the hours display uses. OT premium is deliberately
    // NOT modeled per account: Greg bills OT at 1.5× exactly as it's
    // paid at 1.5×, so straight-rate margin holds; OT is surfaced as a
    // week-level hours estimate instead.
    const moneyHours = row.kind === 'entry' && actual > 0 ? actual : sched;
    const payRate = row.assignment.payRate;
    const billRate = row.assignment.billRate;
    if (moneyHours > 0 && (payRate <= 0 || billRate <= 0)) {
      jo.rowsMissingRates += 1;
      account.rowsMissingRates += 1;
    }
    jo.payDollars += moneyHours * payRate;
    jo.billDollars += moneyHours * billRate;
    account.payDollars += moneyHours * payRate;
    account.billDollars += moneyHours * billRate;

    if (moneyHours > 0) {
      let days = workerDayHours.get(workerId);
      if (!days) {
        days = new Map();
        workerDayHours.set(workerId, days);
      }
      days.set(row.workDate, (days.get(row.workDate) ?? 0) + moneyHours);
    }
  }

  // OT estimate (CA approximation): per worker, the greater of daily
  // hours beyond 8 and weekly hours beyond 40. Directional only — exact
  // OT lives in payroll.
  let workersOver40 = 0;
  let estimatedOtHours = 0;
  for (const days of Array.from(workerDayHours.values())) {
    let weekTotal = 0;
    let dailyOt = 0;
    for (const h of Array.from(days.values())) {
      weekTotal += h;
      if (h > 8) dailyOt += h - 8;
    }
    const weeklyOt = Math.max(0, weekTotal - 40);
    if (weekTotal > 40) workersOver40 += 1;
    estimatedOtHours += Math.max(dailyOt, weeklyOt);
  }

  const groups = Array.from(accounts.values()).sort((a, b) =>
    b.scheduledHours + b.actualHours - (a.scheduledHours + a.actualHours),
  );
  return { groups, ot: { workersOver40, estimatedOtHours } };
}

function fmtHours(h: number): string {
  if (h <= 0) return '—';
  const rounded = Math.round(h * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} hrs`;
}

function fmtMoney(d: number): string {
  if (d <= 0) return '—';
  return d.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function marginPct(pay: number, bill: number): string {
  if (bill <= 0) return '—';
  return `${Math.round(((bill - pay) / bill) * 100)}%`;
}

const SHOW_MONEY_KEY = 'whosWorking.showMoney';

function friendlyGapDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
}

/** Hours per row for people-math: actual when a timesheet entry exists,
 *  scheduled otherwise. Shared by the money rollup and the full-time
 *  tracker so both agree with the hours the report displays. */
function hoursForRow(row: TimesheetGridRow): number {
  if (row.kind !== 'entry' && row.kind !== 'empty') return 0;
  const actual = row.kind === 'entry' ? actualHoursForRow(row) : 0;
  return actual > 0 ? actual : scheduledHoursForRow(row);
}

function buildFullTimeRows(
  rows: TimesheetGridRow[],
  weeks: PeriodRange[],
): FullTimeRow[] {
  const byWorker = new Map<string, FullTimeRow>();
  for (const row of rows) {
    if (row.kind !== 'entry' && row.kind !== 'empty') continue;
    const hrs = hoursForRow(row);
    if (hrs <= 0) continue;
    const weekIdx = weeks.findIndex(
      (w) => row.workDate >= w.start && row.workDate <= w.end,
    );
    if (weekIdx < 0) continue;
    const workerId = row.assignment.workerId || row.assignment.candidateId || row.key;
    let ft = byWorker.get(workerId);
    if (!ft) {
      ft = {
        workerId,
        workerName: row.assignment.workerDisplayName || 'Worker',
        weekHours: weeks.map(() => 0),
        latestHours: 0,
        trendingUp: false,
      };
      byWorker.set(workerId, ft);
    } else if (ft.workerName === 'Worker' && row.assignment.workerDisplayName) {
      ft.workerName = row.assignment.workerDisplayName;
    }
    ft.weekHours[weekIdx] += hrs;
  }
  const result: FullTimeRow[] = [];
  for (const ft of Array.from(byWorker.values())) {
    const n = ft.weekHours.length;
    ft.latestHours = ft.weekHours[n - 1];
    // "Growing": each of the last three weeks beat the one before it.
    ft.trendingUp =
      n >= 3 &&
      ft.weekHours[n - 1] > ft.weekHours[n - 2] &&
      ft.weekHours[n - 2] > ft.weekHours[n - 3] &&
      ft.weekHours[n - 1] > 0;
    result.push(ft);
  }
  return result.sort((a, b) => b.latestHours - a.latestHours);
}

/* -------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

const WhosWorkingPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodRange>(() => currentWeeklyPeriod(0, 6));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [ot, setOt] = useState<OtEstimate>({ workersOver40: 0, estimatedOtHours: 0 });
  const [rowCount, setRowCount] = useState(0);
  const [showMoney, setShowMoney] = useState<boolean>(
    () => localStorage.getItem(SHOW_MONEY_KEY) === '1',
  );
  const [tab, setTab] = useState(0);
  const [drawerTarget, setDrawerTarget] = useState<AssignmentDrawerTarget | null>(null);
  const [ongoing, setOngoing] = useState<OngoingRow[] | null>(null);
  const [ongoingLoading, setOngoingLoading] = useState(false);

  const loadOngoing = useCallback(async () => {
    if (!tenantId) return;
    setOngoingLoading(true);
    try {
      const fn = httpsCallable(functions, 'getOngoingAssignments');
      const res = await fn({ tenantId });
      setOngoing(((res.data as { rows?: OngoingRow[] })?.rows ?? []) as OngoingRow[]);
    } catch {
      setOngoing([]);
    } finally {
      setOngoingLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tab === 1 && ongoing === null) void loadOngoing();
  }, [tab, ongoing, loadOngoing]);

  // Metrics tab — one fetch covers every account (the filter is instant).
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsAccount, setMetricsAccount] = useState<string>('');

  useEffect(() => {
    if (tab !== 2 || metrics !== null || !tenantId) return;
    setMetricsLoading(true);
    const fn = httpsCallable(functions, 'getSchedulingMetrics');
    fn({ tenantId, weeks: 12 })
      .then((res) => setMetrics(res.data as MetricsPayload))
      .catch(() => setMetrics({ weeks: [], accounts: [], totals: [], byAccount: {} }))
      .finally(() => setMetricsLoading(false));
  }, [tab, metrics, tenantId]);

  const metricSeries = useMemo(() => {
    if (!metrics) return null;
    const src = metricsAccount ? metrics.byAccount[metricsAccount] ?? [] : metrics.totals;
    const point = (i: number) => src[i] ?? { hours: 0, workers: 0, ftWorkers: 0 };
    return {
      hours: metrics.weeks.map((w, i) => ({ label: w.label, value: point(i).hours })),
      workers: metrics.weeks.map((w, i) => ({ label: w.label, value: point(i).workers })),
      ftWorkers: metrics.weeks.map((w, i) => ({ label: w.label, value: point(i).ftWorkers })),
    };
  }, [metrics, metricsAccount]);

  const openWorker = useCallback((target: AssignmentDrawerTarget) => {
    setDrawerTarget(target);
  }, []);

  const toggleMoney = useCallback(() => {
    setShowMoney((prev) => {
      localStorage.setItem(SHOW_MONEY_KEY, prev ? '0' : '1');
      return !prev;
    });
  }, []);

  // Full-time tracker (3c) — loads 4 weeks of data only when opened, so
  // the default weekly view stays cheap.
  const [ftOpen, setFtOpen] = useState(false);
  const [ftLoading, setFtLoading] = useState(false);
  const [ftRows, setFtRows] = useState<FullTimeRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<BuilderSuggestion[]>([]);
  const ftWeeks = useMemo<PeriodRange[]>(
    () => [-3, -2, -1, 0].map((delta) => shiftWeeklyPeriod(period, delta)),
    [period],
  );

  const loadFullTime = useCallback(async () => {
    if (!tenantId) return;
    setFtLoading(true);
    try {
      const entitiesSnap = await getDocs(collection(db, 'tenants', tenantId, 'entities'));
      const resolution = await resolveTimesheetGrid({
        fdb: db,
        tenantId,
        filter: {
          kind: 'tenant_period',
          periodStart: ftWeeks[0].start,
          periodEnd: ftWeeks[ftWeeks.length - 1].end,
          hiringEntityIds: entitiesSnap.docs.map((d) => d.id),
        },
      });
      const rows = buildFullTimeRows(resolution.rows, ftWeeks);
      setFtRows(rows);

      // Full-time builder: only actionable when the selected week isn't
      // already over — the divergence sweep's coverage gaps are
      // today-forward.
      const today = todayIsoLocal();
      if (period.end >= today) {
        try {
          const fn = httpsCallable(functions, 'getScheduleDivergence');
          const res = await fn({ tenantId });
          const allGaps = ((res.data as { coverageGaps?: GapRow[] })?.coverageGaps ?? []).filter(
            (g) => g.date >= today && g.date >= period.start && g.date <= period.end && g.gap > 0,
          );
          // The selected week's per-worker busy days, from the same
          // 4-week resolution (no extra reads).
          const busyDays = new Map<string, Set<string>>();
          for (const row of resolution.rows) {
            if (row.kind !== 'entry' && row.kind !== 'empty') continue;
            if (row.workDate < period.start || row.workDate > period.end) continue;
            const wid = row.assignment.workerId || row.assignment.candidateId;
            if (!wid) continue;
            let set = busyDays.get(wid);
            if (!set) {
              set = new Set();
              busyDays.set(wid, set);
            }
            set.add(row.workDate);
          }
          setSuggestions(buildSuggestions(rows, busyDays, allGaps));
        } catch {
          setSuggestions([]);
        }
      } else {
        setSuggestions([]);
      }
    } catch {
      setFtRows([]);
      setSuggestions([]);
    } finally {
      setFtLoading(false);
    }
  }, [tenantId, ftWeeks, period]);

  useEffect(() => {
    // Period changed — 4-week window moved, so stale tracker data must
    // reload on next open.
    setFtRows(null);
    setFtOpen(false);
  }, [period]);

  const openFullTime = useCallback(() => {
    setFtOpen(true);
    if (ftRows === null) void loadFullTime();
  }, [ftRows, loadFullTime]);

  const isCurrentWeek = useMemo(() => {
    const now = currentWeeklyPeriod(0, 6);
    return now.start === period.start;
  }, [period]);
  const isPastWeek = useMemo(() => period.end < todayIsoLocal(), [period]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      // Entity ids feed the resolver's CSV-import leg (its composite
      // index is entity-scoped). Small list; loaded fresh per view.
      const entitiesSnap = await getDocs(collection(db, 'tenants', tenantId, 'entities'));
      const hiringEntityIds = entitiesSnap.docs.map((d) => d.id);

      const resolution = await resolveTimesheetGrid({
        fdb: db,
        tenantId,
        filter: {
          kind: 'tenant_period',
          periodStart: period.start,
          periodEnd: period.end,
          hiringEntityIds,
        },
      });

      // Name join: one JO read per unique job order in the result set.
      const joIds = new Set<string>();
      for (const r of resolution.rows) {
        if (r.assignment.jobOrderId) joIds.add(r.assignment.jobOrderId);
      }
      const joNames = new Map<string, JoNames>();
      await Promise.all(
        Array.from(joIds).map(async (joId) => {
          try {
            const s = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', joId));
            if (!s.exists()) return;
            const jo = s.data() as Record<string, unknown>;
            const accountLabel = String(
              jo.companyName || jo.accountName || jo.parentAccountName || 'Account',
            );
            const joLabel = String(
              jo.jobOrderName || jo.jobTitle || jo.title || 'Job order',
            );
            const childAccountLabel =
              typeof jo.recruiterAccountName === 'string' &&
              jo.recruiterAccountName.trim() &&
              jo.recruiterAccountName !== accountLabel
                ? jo.recruiterAccountName
                : null;
            const addr = (jo.worksiteAddress ?? {}) as Record<string, unknown>;
            const addressStr = [addr.street, addr.city, addr.state]
              .filter(Boolean)
              .join(', ');
            const worksiteName = String(jo.worksiteName || jo.locationName || '');
            const worksiteLine =
              [worksiteName, addressStr].filter(Boolean).join(' · ') || null;
            joNames.set(joId, {
              accountKey: String(jo.companyId || jo.accountId || accountLabel),
              accountLabel,
              joLabel,
              childAccountLabel,
              worksiteLine,
            });
          } catch {
            // Name-join miss just falls back to venue labels.
          }
        }),
      );

      const built = buildGroups(resolution.rows, joNames);
      setGroups(built.groups);
      setOt(built.ot);
      setRowCount(resolution.rows.length);
      if (resolution.errors.length > 0) {
        // Non-fatal resolver warnings — surface the first so data gaps
        // are never silent, without burying the report under a wall.
        setError(resolution.errors[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEnded = useCallback(() => {
    // An end changes both tabs' data — reload the week view and invalidate
    // the ongoing list so it refetches on next look.
    setOngoing(null);
    void load();
  }, [load]);

  const weekDates = useMemo(() => eachDateInPeriod(period), [period]);
  const totalWorkers = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) for (const id of Array.from(g.workerIds)) ids.add(id);
    return ids.size;
  }, [groups]);
  const totalScheduled = groups.reduce((s, g) => s + g.scheduledHours, 0);
  const totalActual = groups.reduce((s, g) => s + g.actualHours, 0);
  const totalPay = groups.reduce((s, g) => s + g.payDollars, 0);
  const totalBill = groups.reduce((s, g) => s + g.billDollars, 0);
  const totalMissingRates = groups.reduce((s, g) => s + g.rowsMissingRates, 0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Who's Working
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tab === 0
              ? 'Everyone assigned for the week — by account, with their days and hours.'
              : tab === 1
                ? 'Workers on ongoing, open-ended assignments — your full-time crew.'
                : 'Weekly trends — hours, workers, and full-timers over the last 12 weeks.'}
          </Typography>
        </Box>
        {tab === 0 && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <IconButton aria-label="Previous week" onClick={() => setPeriod((p) => shiftWeeklyPeriod(p, -1))}>
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="subtitle1" fontWeight={600} sx={{ minWidth: 170, textAlign: 'center' }}>
              {formatWeekOfLabel(period)}
            </Typography>
            <IconButton aria-label="Next week" onClick={() => setPeriod((p) => shiftWeeklyPeriod(p, 1))}>
              <ChevronRightIcon />
            </IconButton>
            {!isCurrentWeek && (
              <Tooltip title="Jump back to this week">
                <Button
                  size="small"
                  startIcon={<TodayIcon />}
                  onClick={() => setPeriod(currentWeeklyPeriod(0, 6))}
                >
                  This week
                </Button>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Who's Working" />
        <Tab label="Full-time workers" />
        <Tab label="Metrics" />
      </Tabs>

      {tab === 0 && (
      <>
      {/* Week summary strip */}
      <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="h6" fontWeight={700}>{totalWorkers}</Typography>
            <Typography variant="caption" color="text.secondary">workers assigned</Typography>
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700}>{fmtHours(totalScheduled)}</Typography>
            <Typography variant="caption" color="text.secondary">scheduled</Typography>
          </Box>
          {isPastWeek && (
            <Box>
              <Typography variant="h6" fontWeight={700}>{fmtHours(totalActual)}</Typography>
              <Typography variant="caption" color="text.secondary">actually worked</Typography>
            </Box>
          )}
          <Box>
            <Typography variant="h6" fontWeight={700}>{groups.length}</Typography>
            <Typography variant="caption" color="text.secondary">accounts</Typography>
          </Box>
          {showMoney && (
            <>
              <Box>
                <Typography variant="h6" fontWeight={700}>{fmtMoney(totalPay)}</Typography>
                <Typography variant="caption" color="text.secondary">worker pay</Typography>
              </Box>
              <Box>
                <Typography variant="h6" fontWeight={700}>{fmtMoney(totalBill)}</Typography>
                <Typography variant="caption" color="text.secondary">client billing</Typography>
              </Box>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  {fmtMoney(totalBill - totalPay)}{' '}
                  <Typography component="span" variant="body2" color="text.secondary">
                    ({marginPct(totalPay, totalBill)})
                  </Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">margin</Typography>
              </Box>
              {ot.estimatedOtHours > 0 && (
                <Box>
                  <Typography variant="h6" fontWeight={700}>{fmtHours(ot.estimatedOtHours)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    overtime (est., {ot.workersOver40} over 40 hrs)
                  </Typography>
                </Box>
              )}
            </>
          )}
          <Box sx={{ ml: 'auto', alignSelf: 'center' }}>
            <Button size="small" onClick={toggleMoney}>
              {showMoney ? 'Hide money' : 'Show money'}
            </Button>
          </Box>
        </Stack>
        {showMoney && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Estimates from assignment rates × hours. Overtime is billed at 1.5× just like it's
            paid at 1.5×, so the margin % holds even with overtime.
            {totalMissingRates > 0 &&
              ` ${totalMissingRates} row${totalMissingRates === 1 ? '' : 's'} missing a pay or bill rate — those count as $0.`}
          </Typography>
        )}
      </Paper>

      {error && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      ) : groups.length === 0 ? (
        <Paper variant="outlined" sx={{ mt: 2, p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Nobody is scheduled this week
          </Typography>
          <Typography variant="body2" color="text.secondary">
            No assignments touch {formatWeekOfLabel(period)}. Use the arrows to check another week.
          </Typography>
        </Paper>
      ) : (
        groups.map((account) => (
          <Paper key={account.key} variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Typography variant="subtitle1" fontWeight={700}>{account.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {account.workerIds.size} worker{account.workerIds.size === 1 ? '' : 's'} ·{' '}
                  {fmtHours(account.scheduledHours)} scheduled
                  {isPastWeek && account.actualHours > 0
                    ? ` · ${fmtHours(account.actualHours)} worked`
                    : ''}
                  {showMoney && account.billDollars > 0
                    ? ` · ${fmtMoney(account.payDollars)} pay / ${fmtMoney(account.billDollars)} bill · ${marginPct(account.payDollars, account.billDollars)} margin`
                    : ''}
                </Typography>
              </Stack>
            </Box>
            {Array.from(account.jobOrders.values()).map((jo) => (
              <Box key={jo.jobOrderId || jo.label} sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                  {jo.jobOrderId ? (
                    <Button
                      size="small"
                      sx={{ textTransform: 'none', fontWeight: 600, p: 0, minWidth: 0 }}
                      onClick={() => navigate(`/jobs/job-orders/${jo.jobOrderId}?tab=placements`)}
                    >
                      {jo.label}
                    </Button>
                  ) : (
                    <Typography variant="body2" fontWeight={600}>{jo.label}</Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {fmtHours(jo.scheduledHours)} scheduled
                    {isPastWeek && jo.actualHours > 0 ? ` · ${fmtHours(jo.actualHours)} worked` : ''}
                    {showMoney && jo.billDollars > 0
                      ? ` · ${fmtMoney(jo.payDollars)} pay / ${fmtMoney(jo.billDollars)} bill · ${marginPct(jo.payDollars, jo.billDollars)} margin`
                      : ''}
                  </Typography>
                </Stack>
                <Box sx={{ mt: 1 }}>
                  {Array.from(jo.workers.values())
                    .sort((a, b) => a.workerName.localeCompare(b.workerName))
                    .map((w) => (
                      <Stack
                        key={w.workerId}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                        onClick={
                          !w.isImport && (w.shiftId || w.assignmentId)
                            ? () =>
                                openWorker({
                                  workerId: w.workerId,
                                  workerName: w.workerName,
                                  jobOrderId: jo.jobOrderId || null,
                                  shiftId: w.shiftId,
                                  assignmentId: w.assignmentId,
                                })
                            : undefined
                        }
                        sx={{
                          py: 0.5,
                          ...(!w.isImport && (w.shiftId || w.assignmentId)
                            ? {
                                cursor: 'pointer',
                                borderRadius: 1,
                                '&:hover': { bgcolor: 'action.hover' },
                              }
                            : {}),
                        }}
                      >
                        <Box sx={{ minWidth: 180 }}>
                          <Typography variant="body2">{w.workerName}</Typography>
                          {jo.subLine && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {jo.subLine}
                            </Typography>
                          )}
                        </Box>
                        <Stack direction="row" spacing={0.5}>
                          {weekDates.map((d) => {
                            const dow = dowForIso(d);
                            const on = w.dates.has(d);
                            return (
                              <Chip
                                key={d}
                                label={dow == null ? '?' : dowShortLabel(dow)}
                                size="small"
                                color={on ? 'primary' : 'default'}
                                variant={on ? 'filled' : 'outlined'}
                                sx={{ opacity: on ? 1 : 0.35, minWidth: 44 }}
                              />
                            );
                          })}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                          {isPastWeek && w.hasEntries && w.actualHours > 0
                            ? `${fmtHours(w.actualHours)} worked`
                            : `${fmtHours(w.scheduledHours)} scheduled`}
                        </Typography>
                      </Stack>
                    ))}
                </Box>
              </Box>
            ))}
          </Paper>
        ))
      )}

      {!loading && rowCount > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Hours come from the same math as the Timesheets grid, so this report always matches payroll.
        </Typography>
      )}
      </>
      )}

      {tab === 1 && (
      <>
      {/* Full-time workers — ongoing, open-ended assignments */}
      {ongoingLoading || ongoing === null ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : ongoing.length === 0 ? (
        <Paper variant="outlined" sx={{ mt: 2, p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            No ongoing assignments yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Workers appear here when they're placed on an open-ended assignment — a standing
            weekly schedule or an open shift with no end date.
          </Typography>
        </Paper>
      ) : (
        Array.from(
          ongoing.reduce((m, r) => {
            const k = r.accountName || 'Account';
            if (!m.has(k)) m.set(k, [] as OngoingRow[]);
            m.get(k)!.push(r);
            return m;
          }, new Map<string, OngoingRow[]>()),
        ).map(([acct, rows]) => (
          <Paper key={acct} variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle1" fontWeight={700}>{acct}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {rows.length} ongoing worker{rows.length === 1 ? '' : 's'}
                </Typography>
              </Stack>
            </Box>
            {rows.map((r) => (
              <Box
                key={r.assignmentId}
                onClick={() =>
                  openWorker({
                    workerId: r.userId,
                    workerName: r.workerName,
                    jobOrderId: r.jobOrderId || null,
                    shiftId: r.shiftId || null,
                    assignmentId: r.assignmentId,
                  })
                }
                sx={{
                  px: 2,
                  py: 1.25,
                  borderTop: 1,
                  borderColor: 'divider',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{r.workerName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[r.jobOrderName || r.jobTitle, r.worksiteName, r.worksiteAddress]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    {r.startDate && (
                      <Chip size="small" variant="outlined" label={`since ${r.startDate}`} />
                    )}
                    {r.isOpenShift ? (
                      <Chip size="small" color="success" variant="outlined" label="Open shift" />
                    ) : (
                      r.weeklyDays.map((d) => (
                        <Chip
                          key={d}
                          size="small"
                          color="primary"
                          label={dowShortLabel(Number(d) as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
                        />
                      ))
                    )}
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Paper>
        ))
      )}
      {ongoing !== null && ongoing.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Click a worker to see the full assignment — and to end it as of a date when someone
          quit or was replaced.
        </Typography>
      )}

      {/* Full-time watch — the 4-week hours trend */}
      <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>Full-time watch</Typography>
              <Typography variant="caption" color="text.secondary">
                Hours per worker over the 4 weeks ending {formatWeekOfLabel(period)} — who's at
                full-time, who's close, and who's growing.
              </Typography>
            </Box>
            {!ftOpen && (
              <Button size="small" variant="outlined" onClick={openFullTime}>
                Show
              </Button>
            )}
          </Stack>
        </Box>
        {ftOpen && (
          <Box sx={{ px: 2, py: 1.5 }}>
            {ftLoading ? (
              <Stack alignItems="center" sx={{ py: 3 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : !ftRows || ftRows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No hours in this 4-week window.
              </Typography>
            ) : (
              <>
                {suggestions.length === 0 && period.end >= todayIsoLocal() && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                    No ways to add hours right now — every upcoming shift this week is fully
                    staffed. When a shift needs people, workers under 35 hrs who are free that day
                    will be suggested here.
                  </Typography>
                )}
                {suggestions.length > 0 && (
                  <Box
                    sx={{
                      mb: 2,
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'info.main',
                      color: 'info.contrastText',
                      '& .MuiTypography-root': { color: 'inherit' },
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                      Ways to add hours this week
                    </Typography>
                    {suggestions.map((s, i) => (
                      <Stack
                        key={`${s.workerId}-${s.gap.jobOrderId}-${s.gap.date}-${i}`}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ py: 0.25 }}
                      >
                        <Typography variant="body2">
                          <strong>{s.workerName}</strong> is at {Math.round(s.currentHours)}h —{' '}
                          {s.gap.accountName || 'an account'} · {s.gap.jobTitle || 'a shift'} still
                          needs {s.gap.gap} {s.gap.gap === 1 ? 'person' : 'people'} on{' '}
                          {friendlyGapDate(s.gap.date)}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          sx={{ ml: 'auto', whiteSpace: 'nowrap' }}
                          onClick={() =>
                            navigate(`/jobs/job-orders/${s.gap.jobOrderId}?tab=placements`)
                          }
                        >
                          Open placements
                        </Button>
                      </Stack>
                    ))}
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}>
                      Workers under 35 hrs matched to open seats on days they're free. Drop them on
                      the shift from Placements — the usual offer text (and 60-second undo) applies.
                    </Typography>
                  </Box>
                )}
                <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    color="success"
                    label={`${ftRows.filter((w) => w.latestHours >= 35).length} at full-time (35+)`}
                  />
                  <Chip
                    size="small"
                    color="warning"
                    label={`${ftRows.filter((w) => w.latestHours >= 30 && w.latestHours < 35).length} close (30–35)`}
                  />
                  <Chip
                    size="small"
                    color="info"
                    label={`${ftRows.filter((w) => w.trendingUp).length} growing week over week`}
                  />
                </Stack>
                {ftRows.slice(0, 40).map((w) => (
                  <Stack
                    key={w.workerId}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ py: 0.5, borderTop: 1, borderColor: 'divider' }}
                  >
                    <Typography variant="body2" sx={{ minWidth: 180 }}>{w.workerName}</Typography>
                    <Stack direction="row" spacing={0.5}>
                      {w.weekHours.map((h, i) => (
                        <Chip
                          key={ftWeeks[i].start}
                          size="small"
                          variant={i === w.weekHours.length - 1 ? 'filled' : 'outlined'}
                          color={h >= 35 ? 'success' : h >= 30 ? 'warning' : 'default'}
                          label={h > 0 ? `${Math.round(h)}h` : '·'}
                          sx={{ minWidth: 48, opacity: h > 0 ? 1 : 0.4 }}
                        />
                      ))}
                    </Stack>
                    <Box sx={{ ml: 'auto' }}>
                      {w.latestHours >= 35 ? (
                        <Chip size="small" color="success" variant="outlined" label="Full-time" />
                      ) : w.latestHours >= 30 ? (
                        <Chip size="small" color="warning" variant="outlined" label="Close" />
                      ) : w.trendingUp ? (
                        <Chip size="small" color="info" variant="outlined" label="Growing" />
                      ) : null}
                    </Box>
                  </Stack>
                ))}
                {ftRows.length > 40 && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Showing the top 40 of {ftRows.length} workers by latest-week hours.
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Oldest week first; the filled chip is {formatWeekOfLabel(period)}. Uses worked
                  hours where timesheets exist, scheduled hours otherwise.
                </Typography>
              </>
            )}
          </Box>
        )}
      </Paper>
      </>
      )}

      {tab === 2 && (
      <>
      {metricsLoading || !metricSeries ? (
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <>
          <Stack direction="row" sx={{ mt: 2 }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="metrics-account-label">Account</InputLabel>
              <Select
                labelId="metrics-account-label"
                label="Account"
                value={metricsAccount}
                onChange={(e) => setMetricsAccount(e.target.value)}
              >
                <MenuItem value="">All accounts</MenuItem>
                {(metrics?.accounts ?? []).map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <MetricChart
            title="Total hours"
            caption="Scheduled assignment hours plus imported (CSV) worked hours, per week."
            data={metricSeries.hours}
            area
          />
          <MetricChart
            title="Total workers"
            caption="Distinct workers with any hours that week."
            data={metricSeries.workers}
          />
          <MetricChart
            title="Full-time workers"
            caption="Workers on an ongoing, open-ended assignment active that week."
            data={metricSeries.ftWorkers}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            Trend estimates — hours are start-to-end times without break deductions; payroll-grade
            numbers live on the Timesheets grid.
          </Typography>
        </>
      )}
      </>
      )}

      <AssignmentDrawer
        open={drawerTarget !== null}
        tenantId={tenantId ?? ''}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
        onEnded={handleEnded}
      />
    </Box>
  );
};

export default WhosWorkingPage;
