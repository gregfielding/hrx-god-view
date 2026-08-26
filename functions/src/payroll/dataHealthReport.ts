/**
 * Data Health / Reconciliation spine (Greg 2026-08-26).
 *
 * THE upstream QA surface for every financial + WC report: before dissecting
 * a dozen downstream reports, prove two things per month × entity —
 *
 *   1. COMPLETENESS — Everee's settled payments (buildEvereeRegister, the
 *      wire-reconciliation truth built for the bookkeeper/CFO) vs HRX
 *      timesheet-entry gross. Expected identity:
 *        evereeGross ≈ entryGross + offCycleTotal
 *      The residual ("unexplained") is money that left the bank with no
 *      HRX entry behind it — the July symptom ($342k paid vs $228k
 *      attributed). Month buckets: register rows by periodEnd (falls back
 *      to payDate), entries/off-cycle by workDate — cross-month bleed at
 *      period boundaries is expected and shows as paired +/- residuals.
 *
 *   2. FIELD COVERAGE — gross-weighted % of entry dollars carrying each
 *      attribution/rate field every report depends on: assignment, job
 *      order, account, billRate, workState, WC code, WC rate. Each gap is
 *      a measured queue, in dependency order.
 *
 * Entry math and status filter mirror payrollCostReport exactly so the
 * numbers tie to every downstream report.
 */
import * as admin from 'firebase-admin';
import { buildEvereeRegister } from './payrollCostReport';

const db = admin.firestore();

const trim = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface Coverage {
  assignment: number;
  jobOrder: number;
  account: number;
  billRate: number;
  workState: number;
  wcCode: number;
  wcRate: number;
}

interface Cell {
  entryGross: number;
  entryCount: number;
  workers: Set<string>;
  covered: Coverage; // gross-weighted dollars carrying each field
  evereeGross: number;
  evereePayments: number;
  offCycleTotal: number;
}

function emptyCell(): Cell {
  return {
    entryGross: 0,
    entryCount: 0,
    workers: new Set(),
    covered: { assignment: 0, jobOrder: 0, account: 0, billRate: 0, workState: 0, wcCode: 0, wcRate: 0 },
    evereeGross: 0,
    evereePayments: 0,
    offCycleTotal: 0,
  };
}

export async function buildDataHealthReport(input: {
  tenantId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}): Promise<Record<string, unknown>> {
  const { tenantId, startDate, endDate } = input;

  // ---- Reference data ------------------------------------------------------
  const [entitiesSnap, ratesSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/entities`).get(),
    db.collection(`tenants/${tenantId}/workers_comp_rates`).get(),
  ]);
  const entityMeta = new Map<string, { name: string; isContractor: boolean }>();
  entitiesSnap.forEach((d) => {
    const name = trim(d.data().name) || d.id;
    if (/sandbox/i.test(d.id) || /sandbox/i.test(name)) return;
    entityMeta.set(d.id, {
      name,
      isContractor:
        trim(d.data().workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(d.id),
    });
  });

  // WC matrix (generic + entity-scoped overlay, same as the coverage report).
  const genericRates: Array<Record<string, unknown>> = [];
  const scopedRates = new Map<string, Array<Record<string, unknown>>>();
  ratesSnap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (trim(x.modifierAccountId)) return;
    const scope = trim(x.hiringEntityId);
    if (!scope) genericRates.push(x);
    else {
      if (!scopedRates.has(scope)) scopedRates.set(scope, []);
      scopedRates.get(scope)!.push(x);
    }
  });
  interface MatrixMaps {
    rateByStateCode: Map<string, number>;
    byStateTitle: Map<string, { code: string; rate: number }>;
    byStateDefault: Map<string, { code: string; rate: number }>;
  }
  const matrixCache = new Map<string, MatrixMaps>();
  const matrixFor = (entityId: string): MatrixMaps => {
    const hit = matrixCache.get(entityId);
    if (hit) return hit;
    const m: MatrixMaps = { rateByStateCode: new Map(), byStateTitle: new Map(), byStateDefault: new Map() };
    const apply = (x: Record<string, unknown>): void => {
      const st = trim(x.state).toUpperCase();
      const code = trim(x.code);
      if (!st || !code) return;
      m.rateByStateCode.set(`${st}_${code}`, num(x.rate));
      const titles = Array.isArray(x.jobTitles) ? (x.jobTitles as unknown[]) : [];
      for (const t of titles) {
        const title = trim(t);
        if (title === '*') m.byStateDefault.set(st, { code, rate: num(x.rate) });
        else if (title) m.byStateTitle.set(`${st}_${title.toLowerCase()}`, { code, rate: num(x.rate) });
      }
    };
    genericRates.forEach(apply);
    (scopedRates.get(entityId) ?? []).forEach(apply);
    matrixCache.set(entityId, m);
    return m;
  };

  // ---- HRX entries ---------------------------------------------------------
  const entriesSnap = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workDate', '>=', startDate)
    .where('workDate', '<=', endDate)
    .get();

  interface Picked {
    month: string;
    entityId: string;
    gross: number;
    workerId: string;
    assignmentId: string;
    jobOrderId: string;
    accountId: string;
    billRate: number;
    state: string;
    entryCode: string;
    workDate: string;
    source: string;
    worksiteHint: string;
  }
  const picked: Picked[] = [];
  const asnIds = new Set<string>();
  entriesSnap.forEach((d) => {
    const e = d.data() as Record<string, unknown>;
    const status = trim(e.status);
    if (!['sent_to_everee', 'submitted', 'paid'].includes(status)) return;
    const entityId = trim(e.hiringEntityId);
    const meta = entityMeta.get(entityId);
    if (!meta) return;
    const isImport = trim(e.source) === 'csv_import';
    const rate = num(e.payRate);
    const reg = num(e.totalRegularHours);
    const ot = num(e.totalOTHours);
    const dt = num(e.totalDoubleTimeHours);
    const premiums = isImport ? 0 : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
    const hourly = meta.isContractor
      ? round2((reg + ot + dt) * rate)
      : isImport
        ? round2(reg * rate + ot * rate * 1.5)
        : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
    const gross = round2(hourly + premiums + num(e.tips) + num(e.bonusAmount));
    if (gross === 0) return;
    const sidecar = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
      | Record<string, unknown>
      | undefined;
    const state =
      trim(e.workState).toUpperCase() ||
      trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
      trim(sidecar?.state).toUpperCase() ||
      '';
    const assignmentId = trim(e.assignmentId);
    if (assignmentId) asnIds.add(assignmentId);
    picked.push({
      month: trim(e.workDate).slice(0, 7),
      entityId,
      gross,
      workerId: trim(e.workerId),
      assignmentId,
      jobOrderId: trim(e.jobOrderId),
      accountId: trim(e.accountId),
      billRate: num(e.billRate),
      state,
      entryCode: trim(e.workersCompCode),
      workDate: trim(e.workDate),
      source: trim(e.source),
      worksiteHint:
        trim(((e.import ?? {}) as Record<string, unknown>).worksiteName) || trim(e.worksiteName),
    });
  });

  const assignments = new Map<string, Record<string, unknown>>();
  const asnList = Array.from(asnIds);
  for (let i = 0; i < asnList.length; i += 100) {
    const snaps = await db.getAll(
      ...asnList.slice(i, i + 100).map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)),
    );
    snaps.forEach((s) => {
      if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
    });
  }
  const joIds = new Set<string>();
  picked.forEach((p) => {
    const jo = p.jobOrderId || trim(assignments.get(p.assignmentId)?.jobOrderId);
    if (jo) joIds.add(jo);
  });
  const joDocs = new Map<string, Record<string, unknown>>();
  const joList = Array.from(joIds);
  for (let i = 0; i < joList.length; i += 100) {
    const snaps = await db.getAll(
      ...joList.slice(i, i + 100).map((id) => db.doc(`tenants/${tenantId}/job_orders/${id}`)),
    );
    snaps.forEach((s) => {
      if (s.exists) joDocs.set(s.id, s.data() as Record<string, unknown>);
    });
  }

  // ---- Aggregate cells -----------------------------------------------------
  const cells = new Map<string, Cell>(); // `${month}|${entityId}`
  const cellFor = (month: string, entityId: string): Cell => {
    const key = `${month}|${entityId}`;
    if (!cells.has(key)) cells.set(key, emptyCell());
    return cells.get(key)!;
  };
  const noAssignmentQueue: Array<Record<string, unknown>> = [];

  for (const p of picked) {
    const c = cellFor(p.month, p.entityId);
    c.entryGross = round2(c.entryGross + p.gross);
    c.entryCount += 1;
    if (p.workerId) c.workers.add(p.workerId);

    const a = p.assignmentId ? assignments.get(p.assignmentId) : undefined;
    const hasAssignment = Boolean(a);
    const joId = p.jobOrderId || trim(a?.jobOrderId);
    const jo = joId ? joDocs.get(joId) : undefined;
    const hasJo = Boolean(jo || joId);
    const accountId = p.accountId || trim(jo?.recruiterAccountId) || trim(jo?.accountId);
    const matrix = matrixFor(p.entityId);
    const jobTitle = trim(a?.jobTitle) || '(no title)';
    let code = p.entryCode || trim(a?.workersCompCode);
    if (!code && p.state) code = matrix.byStateTitle.get(`${p.state}_${jobTitle.toLowerCase()}`)?.code ?? '';
    if (!code && p.state) code = matrix.byStateDefault.get(p.state)?.code ?? '';
    const hasRate = Boolean(code && p.state && matrix.rateByStateCode.has(`${p.state}_${code}`));

    if (hasAssignment) c.covered.assignment = round2(c.covered.assignment + p.gross);
    else if (noAssignmentQueue.length < 25) {
      noAssignmentQueue.push({
        workDate: p.workDate,
        entityId: p.entityId,
        gross: p.gross,
        source: p.source || null,
        worksite: p.worksiteHint || null,
        workerId: p.workerId || null,
      });
    }
    if (hasJo) c.covered.jobOrder = round2(c.covered.jobOrder + p.gross);
    if (accountId) c.covered.account = round2(c.covered.account + p.gross);
    if (p.billRate > 0) c.covered.billRate = round2(c.covered.billRate + p.gross);
    if (p.state) c.covered.workState = round2(c.covered.workState + p.gross);
    if (code && code !== '8040') c.covered.wcCode = round2(c.covered.wcCode + p.gross);
    if (hasRate) c.covered.wcRate = round2(c.covered.wcRate + p.gross);
  }

  // ---- Everee register (settled truth) ------------------------------------
  const register = (await buildEvereeRegister(tenantId, startDate, endDate, null)) as {
    rows: Array<Record<string, unknown>>;
  };
  for (const r of register.rows) {
    const entityId = trim(r.entityId);
    if (!entityMeta.has(entityId)) continue;
    const month = (trim(r.periodEnd) || trim(r.payDate)).slice(0, 7);
    if (!month) continue;
    const c = cellFor(month, entityId);
    c.evereeGross = round2(c.evereeGross + num(r.gross));
    c.evereePayments += 1;
  }

  // ---- Off-cycle payments (explain part of the delta) ----------------------
  const offSnap = await db
    .collection(`tenants/${tenantId}/offcycle_payments`)
    .where('workDate', '>=', startDate)
    .where('workDate', '<=', endDate)
    .get();
  offSnap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (trim(x.status) === 'error') return;
    const entityId = trim(x.hiringEntityId);
    if (!entityMeta.has(entityId)) return;
    const month = trim(x.workDate).slice(0, 7);
    const c = cellFor(month, entityId);
    c.offCycleTotal = round2(c.offCycleTotal + num(x.total));
  });

  // ---- Shape ---------------------------------------------------------------
  const pct = (part: number, whole: number): number =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 100;
  const months = Array.from(new Set(Array.from(cells.keys()).map((k) => k.split('|')[0]))).sort().reverse();
  const out = months.map((month) => {
    const entities = Array.from(cells.entries())
      .filter(([k]) => k.startsWith(`${month}|`))
      .map(([k, c]) => {
        const entityId = k.split('|')[1];
        const unexplained = round2(c.evereeGross - c.entryGross - c.offCycleTotal);
        return {
          entityId,
          entityName: entityMeta.get(entityId)?.name ?? entityId,
          evereeGross: c.evereeGross,
          evereePayments: c.evereePayments,
          entryGross: c.entryGross,
          entryCount: c.entryCount,
          workers: c.workers.size,
          offCycleTotal: c.offCycleTotal,
          unexplained,
          coveragePct: {
            assignment: pct(c.covered.assignment, c.entryGross),
            jobOrder: pct(c.covered.jobOrder, c.entryGross),
            account: pct(c.covered.account, c.entryGross),
            billRate: pct(c.covered.billRate, c.entryGross),
            workState: pct(c.covered.workState, c.entryGross),
            wcCode: pct(c.covered.wcCode, c.entryGross),
            wcRate: pct(c.covered.wcRate, c.entryGross),
          },
          coverageGapGross: {
            assignment: round2(c.entryGross - c.covered.assignment),
            jobOrder: round2(c.entryGross - c.covered.jobOrder),
            account: round2(c.entryGross - c.covered.account),
            billRate: round2(c.entryGross - c.covered.billRate),
            workState: round2(c.entryGross - c.covered.workState),
            wcCode: round2(c.entryGross - c.covered.wcCode),
            wcRate: round2(c.entryGross - c.covered.wcRate),
          },
        };
      })
      .sort((a, b) => b.evereeGross - a.evereeGross);
    return {
      month,
      entities,
      totals: {
        evereeGross: round2(entities.reduce((s, e) => s + e.evereeGross, 0)),
        entryGross: round2(entities.reduce((s, e) => s + e.entryGross, 0)),
        offCycleTotal: round2(entities.reduce((s, e) => s + e.offCycleTotal, 0)),
        unexplained: round2(entities.reduce((s, e) => s + e.unexplained, 0)),
      },
    };
  });

  return {
    tenantId,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    months: out,
    noAssignmentQueueSample: noAssignmentQueue,
    notes: [
      'Month buckets: Everee by pay-period end; entries/off-cycle by work date — period-boundary bleed shows as paired +/- residuals in adjacent months.',
      'unexplained = evereeGross − entryGross − offCycle: dollars Everee settled with no HRX entry behind them.',
      'Coverage percentages are gross-weighted (dollars, not row counts).',
    ],
  };
}
