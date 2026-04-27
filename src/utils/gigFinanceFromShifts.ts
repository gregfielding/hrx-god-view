/**
 * Derive gig job order financials from scheduled shifts + gigPositions rates.
 * Used for Finances & Budgeting week-scoped calculated columns (vs. job-order estimates).
 */

import { eachDayOfInterval, endOfWeek } from 'date-fns';
import { getDateScheduleEntriesWithHours } from './dateSchedule';

/** Max calendar span when projecting open-ended weekly (career) shifts for finance / range discovery. */
const WEEKLY_RECURRING_FINANCE_HORIZON_DAYS = 800;

/** Default employer payroll tax assumptions (on taxable wages = pay portion). Tune later / load from tenant. */
export const DEFAULT_FUTA_RATE_ON_PAY = 0.006; // 0.6% federal
export const DEFAULT_SUTA_RATE_ON_PAY = 0.009; // placeholder state avg; replace with tenant/state rules later

export type GigPositionRates = {
  payRate: number;
  billRate: number;
  workersCompPercent: number; // e.g. 2.34 => 2.34% of payroll
};

export type ShiftOccurrence = { dateStr: string; hours: number; headcount: number };

export type WeekShiftFinanceTotals = {
  /** Sum of bill rate × hours × headcount for occurrences in this week */
  billTotal: number;
  payTotal: number;
  workersCompTotal: number;
  futaTotal: number;
  sutaTotal: number;
  /** Bill − pay (staffing margin before employer payroll taxes on wages) */
  grossProfit: number;
  /** Bill − pay − WC − FUTA − SUTA (simplified net; excludes travel, etc.) */
  netProfit: number;
  occurrenceCount: number;
};

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseYmdLocal(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : stripTime(dt);
}

/** Hours between HH:mm and HH:mm; if end <= start, assume crosses midnight. */
export function hoursBetweenHHmm(start: string, end: string): number {
  const parse = (t: string) => {
    const p = (t || '0:0').split(':').map(Number);
    return (p[0] || 0) * 60 + (p[1] || 0);
  };
  const a = parse(start);
  let b = parse(end);
  if (b <= a) b += 24 * 60;
  return (b - a) / 60;
}

/**
 * Resolve pay/bill/WC from gigPositions for a shift's default job title.
 * Bill = pay * (1 + markup/100) when markup set; else explicit billRate.
 */
export function resolveGigPositionRates(gigPositions: any[] | undefined, defaultJobTitle: string | undefined): GigPositionRates | null {
  if (!gigPositions?.length) return null;
  const t = (defaultJobTitle || '').trim().toLowerCase();
  let pos = gigPositions.find((p: any) => (String(p.jobTitle || '').trim().toLowerCase() === t && t.length > 0));
  if (!pos) pos = gigPositions[0];
  if (!pos) return null;

  const payRate = parseFloat(String(pos.payRate ?? ''));
  if (!Number.isFinite(payRate) || payRate < 0) return null;

  const markup = parseFloat(String((pos as any).markup ?? ''));
  const billExplicit = parseFloat(String((pos as any).billRate ?? ''));
  let billRate: number;
  if (Number.isFinite(markup) && markup > 0) {
    billRate = payRate * (1 + markup / 100);
  } else if (Number.isFinite(billExplicit) && billExplicit >= 0) {
    billRate = billExplicit;
  } else {
    billRate = payRate;
  }

  const wcRaw = (pos as any).workersCompRate;
  const workersCompPercent = wcRaw != null && wcRaw !== '' ? parseFloat(String(wcRaw)) : 0;

  return {
    payRate,
    billRate,
    workersCompPercent: Number.isFinite(workersCompPercent) ? workersCompPercent : 0,
  };
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type WeeklyScheduleShape = Record<string, { enabled?: boolean; startTime?: string; endTime?: string }>;

/**
 * Career open-ended shifts: `weeklySchedule` only (no `dateSchedule`). Expand into occurrences
 * either for one Mon–Sun week (`weekMonday` set) or across a bounded horizon for range discovery.
 */
function expandWeeklyScheduleToOccurrences(
  shift: any,
  shiftStartYmd: string,
  weeklySchedule: WeeklyScheduleShape,
  weekMonday?: Date
): ShiftOccurrence[] {
  const startD = parseYmdLocal(shiftStartYmd);
  if (!startD) return [];

  const endCap = shift?.endDate ? parseYmdLocal(String(shift.endDate).slice(0, 10)) : null;
  const horizonEnd = new Date(startD);
  horizonEnd.setDate(horizonEnd.getDate() + WEEKLY_RECURRING_FINANCE_HORIZON_DAYS);
  const absoluteEnd = endCap && endCap < horizonEnd ? endCap : horizonEnd;

  const headcount = Math.max(1, Number(shift.totalStaffRequested) || 1);

  const pushIfScheduled = (d: Date, out: ShiftOccurrence[]) => {
    const dayStart = stripTime(d);
    if (dayStart < startD) return;
    if (dayStart > absoluteEnd) return;
    const dowKey = String(dayStart.getDay());
    const day = weeklySchedule[dowKey];
    if (!day?.enabled) return;
    const st = String(day.startTime || '').trim();
    const et = String(day.endTime || '').trim();
    if (!st || !et) return;
    const hours = hoursBetweenHHmm(st, et);
    if (hours <= 0) return;
    out.push({ dateStr: ymdFromDate(dayStart), hours, headcount });
  };

  const out: ShiftOccurrence[] = [];
  if (weekMonday) {
    const ws = stripTime(weekMonday);
    const we = endOfWeek(weekMonday, { weekStartsOn: 1 });
    for (const d of eachDayOfInterval({ start: ws, end: we })) {
      pushIfScheduled(d, out);
    }
    return out;
  }

  for (const d of eachDayOfInterval({ start: startD, end: absoluteEnd })) {
    pushIfScheduled(d, out);
  }
  return out;
}

export type ExpandGigShiftOptions = {
  /** When set, only occurrences in this ISO week (Mon–Sun) are returned for weekly recurring shifts. */
  weekMonday?: Date;
};

/**
 * Expand a Firestore shift doc + job order into dated occurrences (for gig shifts).
 */
export function expandGigShiftToOccurrences(
  shift: any,
  _jobOrder: any,
  opts?: ExpandGigShiftOptions
): ShiftOccurrence[] {
  const mode = shift?.shiftMode;
  const shiftDate = String(shift?.shiftDate || '').slice(0, 10);
  if (!shiftDate) return [];

  if (
    mode === 'multi' &&
    shift?.weeklySchedule &&
    typeof shift.weeklySchedule === 'object' &&
    (!shift.dateSchedule || Object.keys(shift.dateSchedule).length === 0)
  ) {
    const ws = shift.weeklySchedule as WeeklyScheduleShape;
    const hasEnabled = Object.values(ws).some(
      (d) => d && d.enabled && String(d.startTime || '').trim() && String(d.endTime || '').trim()
    );
    if (hasEnabled) {
      return expandWeeklyScheduleToOccurrences(shift, shiftDate, ws, opts?.weekMonday);
    }
  }

  if (mode === 'multi' && shift?.dateSchedule && Object.keys(shift.dateSchedule).length > 0) {
    const entries = getDateScheduleEntriesWithHours(shift.dateSchedule, shiftDate, shift.endDate);
    return entries.map((e) => {
      const hours = hoursBetweenHHmm(e.startTime, e.endTime);
      const wn = e.workersNeeded != null ? Math.max(1, Number(e.workersNeeded)) : 1;
      const os = e.overstaff != null ? Math.max(0, Number(e.overstaff)) : 0;
      const headcount = wn + os;
      return { dateStr: e.date, hours, headcount };
    });
  }

  if (mode === 'multi' && shift?.endDate && shift.endDate !== shiftDate) {
    const startD = parseYmdLocal(shiftDate);
    const endD = parseYmdLocal(String(shift.endDate).slice(0, 10));
    if (!startD || !endD) return [];
    const days = eachDayOfInterval({ start: startD, end: endD });
    const startT = shift.defaultStartTime || '00:00';
    const endT = shift.defaultEndTime || '23:59';
    const hours = hoursBetweenHHmm(startT, endT);
    const headcount = Math.max(1, Number(shift.totalStaffRequested) || 1);
    return days.map((d) => ({
      dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      hours,
      headcount,
    }));
  }

  // Single-day
  const hours = hoursBetweenHHmm(shift.defaultStartTime || '00:00', shift.defaultEndTime || '23:59');
  const headcount = Math.max(1, Number(shift.totalStaffRequested) || 1);
  return [{ dateStr: shiftDate, hours, headcount }];
}

export function occurrenceDateInWeek(dateStr: string, weekMonday: Date): boolean {
  const d = parseYmdLocal(dateStr);
  if (!d) return false;
  const ws = stripTime(weekMonday);
  const we = endOfWeek(weekMonday, { weekStartsOn: 1 });
  return d >= ws && d <= we;
}

/**
 * Sum bill/pay/WC/taxes for occurrences that fall in `weekMonday`'s Mon–Sun window.
 */
export function sumWeekFinanceFromOccurrences(
  occurrences: ShiftOccurrence[],
  rates: GigPositionRates | null,
  weekMonday: Date,
  futaRate: number = DEFAULT_FUTA_RATE_ON_PAY,
  sutaRate: number = DEFAULT_SUTA_RATE_ON_PAY
): WeekShiftFinanceTotals {
  const empty: WeekShiftFinanceTotals = {
    billTotal: 0,
    payTotal: 0,
    workersCompTotal: 0,
    futaTotal: 0,
    sutaTotal: 0,
    grossProfit: 0,
    netProfit: 0,
    occurrenceCount: 0,
  };

  if (!rates) return empty;

  let billTotal = 0;
  let payTotal = 0;
  let wcTotal = 0;
  let futaTotal = 0;
  let sutaTotal = 0;
  let n = 0;

  for (const occ of occurrences) {
    if (!occurrenceDateInWeek(occ.dateStr, weekMonday)) continue;
    const h = Math.max(0, occ.hours);
    const hc = Math.max(0, occ.headcount);
    if (h <= 0 || hc <= 0) continue;

    const pay = h * hc * rates.payRate;
    const bill = h * hc * rates.billRate;
    const wc = pay * (rates.workersCompPercent / 100);
    const futa = pay * futaRate;
    const suta = pay * sutaRate;

    payTotal += pay;
    billTotal += bill;
    wcTotal += wc;
    futaTotal += futa;
    sutaTotal += suta;
    n += 1;
  }

  const grossProfit = billTotal - payTotal;
  const netProfit = billTotal - payTotal - wcTotal - futaTotal - sutaTotal;

  return {
    billTotal,
    payTotal,
    workersCompTotal: wcTotal,
    futaTotal,
    sutaTotal,
    grossProfit,
    netProfit,
    occurrenceCount: n,
  };
}

/**
 * Aggregate all shifts for a job order for one calendar week.
 */
export function computeJobOrderWeekShiftFinance(
  jobOrder: any,
  shifts: any[],
  weekMonday: Date,
  futaRate?: number,
  sutaRate?: number
): WeekShiftFinanceTotals {
  const gigPositions = jobOrder?.gigPositions as any[] | undefined;
  const totals: WeekShiftFinanceTotals = {
    billTotal: 0,
    payTotal: 0,
    workersCompTotal: 0,
    futaTotal: 0,
    sutaTotal: 0,
    grossProfit: 0,
    netProfit: 0,
    occurrenceCount: 0,
  };

  for (const shift of shifts) {
    const title = shift?.defaultJobTitle;
    const rates = resolveGigPositionRates(gigPositions, title);
    const occ = expandGigShiftToOccurrences(shift, jobOrder, { weekMonday });
    const part = sumWeekFinanceFromOccurrences(occ, rates, weekMonday, futaRate, sutaRate);
    totals.billTotal += part.billTotal;
    totals.payTotal += part.payTotal;
    totals.workersCompTotal += part.workersCompTotal;
    totals.futaTotal += part.futaTotal;
    totals.sutaTotal += part.sutaTotal;
    totals.occurrenceCount += part.occurrenceCount;
  }

  totals.grossProfit = totals.billTotal - totals.payTotal;
  totals.netProfit =
    totals.billTotal - totals.payTotal - totals.workersCompTotal - totals.futaTotal - totals.sutaTotal;

  return totals;
}
