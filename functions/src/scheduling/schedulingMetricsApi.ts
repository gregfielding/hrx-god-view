/**
 * Scheduling metrics — the Metrics tab on Who's Working (Greg, 2026-07-20).
 *
 * getSchedulingMetrics returns a trailing weekly series (default 12 weeks,
 * Sun–Sat) of the three numbers Greg asked to see as graphs:
 *   • hours    — scheduled assignment hours PLUS imported (CSV) worked hours,
 *                since portal-first crews (Legends etc.) live only in imports
 *   • workers  — distinct workers with any assignment or import hours that week
 *   • ftWorkers— distinct workers on an ongoing/open-ended assignment active
 *                that week (same definition as the Full-time Workers tab)
 *
 * Every metric is computed per account AND in total, so the client's account
 * filter is instant — one call, no refetch per filter change. Import rows are
 * attributed to accounts via their jobOrderId → JO join (rows without one
 * count toward the totals but no account).
 *
 * Estimates by design: assignment hours are start/end times (or weekly
 * schedule) without break deductions — trend-grade, not payroll-grade.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { canManageAssignments } from '../placementsApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const REMOVED_RE = /cancel|declined|rejected/;

interface WeekBucket {
  start: string;
  end: string;
  label: string;
}

function isoOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Trailing `n` Sun–Sat weeks ending with the current week. */
function trailingWeeks(n: number): WeekBucket[] {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thisSunday = new Date(todayUtc);
  thisSunday.setUTCDate(thisSunday.getUTCDate() - thisSunday.getUTCDay());
  const weeks: WeekBucket[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const start = new Date(thisSunday);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    weeks.push({
      start: isoOf(start),
      end: isoOf(end),
      label: `${start.getUTCMonth() + 1}/${start.getUTCDate()}`,
    });
  }
  return weeks;
}

function hoursBetween(startTime: unknown, endTime: unknown): number {
  if (typeof startTime !== 'string' || typeof endTime !== 'string') return 0;
  const m1 = startTime.match(/^(\d{1,2}):(\d{2})/);
  const m2 = endTime.match(/^(\d{1,2}):(\d{2})/);
  if (!m1 || !m2) return 0;
  let h = Number(m2[1]) + Number(m2[2]) / 60 - (Number(m1[1]) + Number(m1[2]) / 60);
  if (h < 0) h += 24;
  return h > 0 && h <= 24 ? h : 0;
}

function isOngoingDoc(a: FirebaseFirestore.DocumentData): boolean {
  const noEnd = !(typeof a.endDate === 'string' && a.endDate.trim().length > 0);
  const hasWs = a.weeklySchedule && Object.keys(a.weeklySchedule).length > 0;
  // Career JOs are the canonical "full-time" signal (Greg, 2026-07-20);
  // the schedule/open-shift flags remain as fallback for legacy docs
  // that predate the jobOrderType denorm.
  const isCareer = String(a.jobOrderType ?? '') === 'career';
  return noEnd && (isCareer || a.isOpenShift === true || a.noFixedTimes === true || Boolean(hasWs));
}

/** Per-(account, week) accumulator. Account '' = tenant totals. */
class Rollup {
  hours = new Map<string, number[]>();
  workers = new Map<string, Array<Set<string>>>();
  ft = new Map<string, Array<Set<string>>>();
  constructor(private nWeeks: number) {}
  private ensure(acct: string) {
    if (!this.hours.has(acct)) {
      this.hours.set(acct, new Array(this.nWeeks).fill(0));
      this.workers.set(acct, Array.from({ length: this.nWeeks }, () => new Set()));
      this.ft.set(acct, Array.from({ length: this.nWeeks }, () => new Set()));
    }
  }
  addHours(acct: string, week: number, h: number, workerId: string | null) {
    for (const key of ['', acct].filter((k, i) => i === 0 || k)) {
      this.ensure(key);
      this.hours.get(key)![week] += h;
      if (workerId) this.workers.get(key)![week].add(workerId);
    }
  }
  addFt(acct: string, week: number, workerId: string) {
    for (const key of ['', acct].filter((k, i) => i === 0 || k)) {
      this.ensure(key);
      this.ft.get(key)![week].add(workerId);
    }
  }
}

export const getSchedulingMetrics = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = String(request.data?.tenantId ?? '');
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Assignment-management access required.');
    }
    const nWeeks = Math.min(26, Math.max(4, Number(request.data?.weeks) || 12));
    const weeks = trailingWeeks(nWeeks);
    const rangeStart = weeks[0].start;
    const rangeEnd = weeks[weeks.length - 1].end;
    const weekIndexOf = (dateIso: string): number => {
      if (dateIso < rangeStart || dateIso > rangeEnd) return -1;
      return weeks.findIndex((w) => dateIso >= w.start && dateIso <= w.end);
    };

    const rollup = new Rollup(nWeeks);

    // ---- assignments: scheduled hours + workers + full-time presence ----
    const assignments = await db.collection(`tenants/${tenantId}/assignments`).get();
    for (const doc of assignments.docs) {
      const a = doc.data() || {};
      if (REMOVED_RE.test(String(a.status ?? '').toLowerCase())) continue;
      const acct = String(a.companyName ?? '');
      const workerId = String(a.userId ?? a.candidateId ?? '') || null;
      const start = typeof a.startDate === 'string' ? a.startDate.slice(0, 10) : '';
      const end = typeof a.endDate === 'string' && a.endDate ? a.endDate.slice(0, 10) : '';

      if (isOngoingDoc(a)) {
        // Weekly-schedule expansion for each week the assignment is active.
        const ws = (a.weeklySchedule ?? {}) as Record<
          string,
          { enabled?: boolean; startTime?: string; endTime?: string }
        >;
        const perWeekHours = Object.values(ws)
          .filter((d) => d && d.enabled === true)
          .reduce((s, d) => s + hoursBetween(d.startTime, d.endTime), 0);
        for (let w = 0; w < weeks.length; w += 1) {
          const active = (!start || start <= weeks[w].end) && (!end || end >= weeks[w].start);
          if (!active) continue;
          if (workerId) rollup.addFt(acct, w, workerId);
          if (perWeekHours > 0) rollup.addHours(acct, w, perWeekHours, workerId);
        }
      } else if (start) {
        const w = weekIndexOf(start);
        if (w < 0) continue;
        const h = hoursBetween(a.startTime, a.endTime);
        if (h > 0) rollup.addHours(acct, w, h, workerId);
        else if (workerId) rollup.addHours(acct, w, 0, workerId);
      }
    }

    // ---- CSV-import worked hours (portal-first crews) ----
    const joAccountCache = new Map<string, string>();
    const joAccount = async (joId: string): Promise<string> => {
      if (!joId) return '';
      if (joAccountCache.has(joId)) return joAccountCache.get(joId)!;
      let acct = '';
      try {
        const jo = (await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get()).data() || {};
        acct = String(jo.companyName ?? jo.accountName ?? '');
      } catch {
        /* totals-only attribution */
      }
      joAccountCache.set(joId, acct);
      return acct;
    };
    const entities = await db.collection(`tenants/${tenantId}/entities`).get();
    for (const entity of entities.docs) {
      const entries = await db
        .collection(`tenants/${tenantId}/timesheet_entries`)
        .where('source', '==', 'csv_import')
        .where('hiringEntityId', '==', entity.id)
        .where('workDate', '>=', rangeStart)
        .where('workDate', '<=', rangeEnd)
        .get();
      for (const doc of entries.docs) {
        const e = doc.data() || {};
        const w = weekIndexOf(typeof e.workDate === 'string' ? e.workDate.slice(0, 10) : '');
        if (w < 0) continue;
        const h = Number(e.hours) > 0 ? Number(e.hours) : 0;
        const workerId = String(e.workerId ?? '') || null;
        // eslint-disable-next-line no-await-in-loop
        const acct = await joAccount(String(e.jobOrderId ?? ''));
        rollup.addHours(acct, w, h, workerId);
      }
    }

    const accounts = Array.from(rollup.hours.keys())
      .filter((k) => k !== '')
      .sort((a, b) => a.localeCompare(b));
    const seriesFor = (key: string) =>
      weeks.map((_, i) => ({
        hours: Math.round((rollup.hours.get(key)?.[i] ?? 0) * 10) / 10,
        workers: rollup.workers.get(key)?.[i].size ?? 0,
        ftWorkers: rollup.ft.get(key)?.[i].size ?? 0,
      }));
    return {
      weeks,
      accounts,
      totals: seriesFor(''),
      byAccount: Object.fromEntries(accounts.map((a) => [a, seriesFor(a)])),
    };
  },
);
