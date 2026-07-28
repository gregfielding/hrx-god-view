/**
 * Payroll cost attribution report (Greg 2026-07-28).
 *
 * Answers "what did FIFA Dallas cost us in payroll?" — the accounting gap
 * where money flowed HRX → Everee with no per-job attribution. Aggregates
 * SUBMITTED/PAID timesheet entries over a date range and groups dollars by
 * account → job order → worksite, plus a per-batch section that gives the
 * bookkeeper the split for each Everee funding wire ("$10,000 on 7/18 =
 * $2,000 Lollapalooza + $3,100 FIFA Dallas …") with percentages she can
 * apply to the burdened wire total (pro-rata, per Greg's decision).
 *
 * Source of truth is HRX's own entries (attribution resolved
 * entry → assignment → job order, same chain the submit orchestrator
 * uses); the Everee-side note/label tags are a convenience layer on top.
 * June-era entries that can't resolve a job order land in an explicit
 * "Unattributed" bucket rather than being silently dropped.
 *
 * Gate: books-level access (hrx claim, admin role, or securityLevel ≥ 6)
 * — same bar as the QBO connection management.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 12000;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Books access: hrx staff, admin role, or securityLevel >= 6. */
async function ensureBooksAccess(uid: string | undefined, token: Record<string, unknown> | undefined, tenantId: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, unknown>;
  const role = String(data.role ?? '').toLowerCase();
  const level = Number.parseInt(String(data.securityLevel ?? '0'), 10) || 0;
  const tenantLevel = Number.parseInt(
    String((data.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId]?.securityLevel ?? '0'),
    10,
  ) || 0;
  if (role === 'admin' || role === 'super_admin' || level >= 6 || tenantLevel >= 6) return;
  throw new HttpsError('permission-denied', 'Payroll cost reporting requires admin access.');
}

interface ReportRow {
  entryId: string;
  workDate: string;
  hiringEntityId: string;
  batchId: string | null;
  workerId: string;
  workerName: string | null;
  accountId: string | null;
  accountName: string | null;
  jobOrderId: string | null;
  jobOrderName: string | null;
  jobOrderNumber: string | null;
  worksiteName: string | null;
  hours: number;
  gross: number;
  tips: number;
  bonus: number;
  premiums: number;
  total: number;
  status: string;
  source: string;
}

interface GroupTotals {
  key: string;
  label: string;
  entries: number;
  workers: number;
  hours: number;
  total: number;
  pct: number;
}

export const getPayrollCostReport = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const startDate = trim(request.data?.startDate);
    const endDate = trim(request.data?.endDate);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpsError('invalid-argument', 'tenantId, startDate, endDate (YYYY-MM-DD) are required.');
    }
    const rangeDays = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
    if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
      throw new HttpsError('invalid-argument', `Date range must be 0-${MAX_RANGE_DAYS} days.`);
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // Entries in range. Single-field range on workDate is auto-indexed;
    // status + entity filters applied in memory.
    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();

    interface Picked {
      id: string;
      e: Record<string, unknown>;
    }
    const picked: Picked[] = [];
    snap.forEach((d) => {
      const e = d.data();
      // Canonical "money left HRX" statuses (live vocabulary 2026-07-28:
      // draft | approved | sent_to_everee | paid | error).
      const status = trim(e.status);
      if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
      if (hiringEntityId && trim(e.hiringEntityId) !== hiringEntityId) return;
      picked.push({ id: d.id, e });
    });

    // Resolve attribution via assignments (batched), then JO + account names.
    const assignmentIds = Array.from(
      new Set(picked.map((p) => trim(p.e.assignmentId)).filter(Boolean)),
    );
    const assignments = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < assignmentIds.length; i += 100) {
      const chunk = assignmentIds.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    const joIds = new Set<string>();
    const accountIds = new Set<string>();
    for (const p of picked) {
      const a = assignments.get(trim(p.e.assignmentId));
      const joId = trim(p.e.jobOrderId) || trim(a?.jobOrderId);
      if (joId) joIds.add(joId);
      // Entries carry accountId top-level (both scheduled and csv_import).
      const acctId = trim(p.e.accountId) || trim(a?.accountId);
      if (acctId) accountIds.add(acctId);
    }

    const joDocs = new Map<string, Record<string, unknown>>();
    for (const joId of joIds) {
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        const s = await db.doc(`tenants/${tenantId}/${coll}/${joId}`).get();
        if (s.exists) {
          joDocs.set(joId, s.data() as Record<string, unknown>);
          const acctId = trim(s.data()?.recruiterAccountId);
          if (acctId) accountIds.add(acctId);
          break;
        }
      }
    }
    const accountDocs = new Map<string, Record<string, unknown>>();
    const acctIdList = Array.from(accountIds);
    for (let i = 0; i < acctIdList.length; i += 100) {
      const chunk = acctIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) accountDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    // Per-entry dollars — mirrors the server-side batch total math
    // (createTimesheetBatch) and the grid's dollarAmountForRow.
    const rows: ReportRow[] = [];
    for (const p of picked.slice(0, MAX_ROWS)) {
      const e = p.e;
      const a = assignments.get(trim(e.assignmentId));
      const isImport = trim(e.source) === 'csv_import';
      const rate = num(e.payRate);
      const reg = num(e.totalRegularHours);
      const ot = num(e.totalOTHours);
      const dt = num(e.totalDoubleTimeHours);
      const meal = num(e.mealBreakPenaltyHours);
      const rest = num(e.restBreakPenaltyHours);
      const tips = num(e.tips);
      const bonus = num(e.bonusAmount);
      const gross = isImport
        ? round2(reg * rate + ot * rate * 1.5)
        : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
      const premiums = isImport ? 0 : round2((meal + rest) * rate);
      const total = round2(gross + premiums + tips + bonus);
      const hours = round2(reg + ot + dt);

      const joId = trim(e.jobOrderId) || trim(a?.jobOrderId) || null;
      const jo = joId ? joDocs.get(joId) : undefined;
      const acctId = trim(e.accountId) || trim(a?.accountId) || trim(jo?.recruiterAccountId) || null;
      const acct = acctId ? accountDocs.get(acctId) : undefined;
      const importSidecar = (e.import ?? {}) as Record<string, unknown>;
      const workerName =
        `${trim(a?.firstName)} ${trim(a?.lastName)}`.trim() ||
        trim(a?.workerDisplayName) ||
        null;

      // Submit-day key: entries don't carry a batch id in prod, and Everee
      // funds per pay run — (entity, submit date) is the wire-shaped group.
      const sentAt = e.sentToEvereeAt as admin.firestore.Timestamp | undefined;
      const sentDate = sentAt?.toDate ? sentAt.toDate().toISOString().slice(0, 10) : null;

      rows.push({
        entryId: p.id,
        workDate: trim(e.workDate),
        hiringEntityId: trim(e.hiringEntityId),
        batchId: sentDate ? `${trim(e.hiringEntityId) || 'entity'} · sent ${sentDate}` : null,
        workerId: trim(e.workerId),
        workerName,
        accountId: acctId,
        accountName: trim(acct?.name) || null,
        jobOrderId: joId,
        jobOrderName: trim(jo?.jobOrderName) || null,
        jobOrderNumber: trim(jo?.jobOrderNumber) || null,
        worksiteName:
          trim(a?.worksiteName) ||
          trim(jo?.worksiteName) ||
          trim(importSidecar.worksiteName) ||
          trim(importSidecar.csvSite) ||
          trim(e.worksiteName) ||
          null,
        hours,
        gross,
        tips,
        bonus,
        premiums,
        total,
        status: trim(e.status),
        source: isImport ? 'csv_import' : 'scheduled',
      });
    }

    const grand = round2(rows.reduce((s, r) => s + r.total, 0));

    const group = (keyOf: (r: ReportRow) => string, labelOf: (r: ReportRow) => string): GroupTotals[] => {
      const m = new Map<string, GroupTotals & { workerSet: Set<string> }>();
      for (const r of rows) {
        const key = keyOf(r);
        let g = m.get(key);
        if (!g) {
          g = { key, label: labelOf(r), entries: 0, workers: 0, hours: 0, total: 0, pct: 0, workerSet: new Set() };
          m.set(key, g);
        }
        g.entries += 1;
        g.hours = round2(g.hours + r.hours);
        g.total = round2(g.total + r.total);
        g.workerSet.add(r.workerId);
      }
      return Array.from(m.values())
        .map(({ workerSet, ...g }) => ({ ...g, workers: workerSet.size, pct: grand > 0 ? round2((g.total / grand) * 100) : 0 }))
        .sort((x, y) => y.total - x.total);
    };

    const byJobOrder = group(
      (r) => r.jobOrderId ?? `unattributed:${r.worksiteName ?? 'unknown'}`,
      (r) =>
        r.jobOrderName
          ? `${r.jobOrderNumber ? `#${r.jobOrderNumber} ` : ''}${r.jobOrderName}${r.worksiteName && r.worksiteName !== r.jobOrderName ? ` — ${r.worksiteName}` : ''}`
          : `Unattributed${r.worksiteName ? ` — ${r.worksiteName}` : ''}`,
    );
    const byAccount = group(
      (r) => r.accountId ?? 'unattributed',
      (r) => r.accountName ?? 'Unattributed',
    );

    // Per-batch split — the wire-parsing view for the bookkeeper.
    interface BatchSplit {
      batchId: string;
      hiringEntityId: string;
      total: number;
      entries: number;
      dateRange: { min: string; max: string };
      byJobOrder: Array<{ label: string; total: number; pct: number }>;
    }
    const batchMap = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const key = r.batchId ?? 'no-batch';
      batchMap.set(key, [...(batchMap.get(key) ?? []), r]);
    }
    const byBatch: BatchSplit[] = Array.from(batchMap.entries())
      .map(([batchId, batchRows]) => {
        const total = round2(batchRows.reduce((s, r) => s + r.total, 0));
        const joTotals = new Map<string, { label: string; total: number }>();
        for (const r of batchRows) {
          const label = r.jobOrderName
            ? `${r.jobOrderNumber ? `#${r.jobOrderNumber} ` : ''}${r.jobOrderName}`
            : `Unattributed${r.worksiteName ? ` — ${r.worksiteName}` : ''}`;
          const cur = joTotals.get(label) ?? { label, total: 0 };
          cur.total = round2(cur.total + r.total);
          joTotals.set(label, cur);
        }
        const dates = batchRows.map((r) => r.workDate).sort();
        return {
          batchId,
          hiringEntityId: batchRows[0]?.hiringEntityId ?? '',
          total,
          entries: batchRows.length,
          dateRange: { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' },
          byJobOrder: Array.from(joTotals.values())
            .map((t) => ({ ...t, pct: total > 0 ? round2((t.total / total) * 100) : 0 }))
            .sort((x, y) => y.total - x.total),
        };
      })
      .sort((x, y) => (x.dateRange.max < y.dateRange.max ? 1 : -1));

    return {
      startDate,
      endDate,
      hiringEntityId: hiringEntityId || null,
      totals: {
        gross: grand,
        entries: rows.length,
        workers: new Set(rows.map((r) => r.workerId)).size,
        unattributed: round2(rows.filter((r) => !r.jobOrderId).reduce((s, r) => s + r.total, 0)),
      },
      truncated: picked.length > MAX_ROWS,
      byJobOrder,
      byAccount,
      byBatch,
      rows,
    };
  },
);
