/**
 * Weekly financial rollups (Greg 2026-08-25 — FIN-1, the forecasting
 * keystone).
 *
 * One doc per (Monday-start week × entity × account × job order) at
 * `tenants/{t}/finance_week_rollups/{weekStart__entity__account__jo}`:
 * hours, pay gross, ACCRUAL bill gross (hours × the entry's billRate
 * snapshot — the field every entry carries and nothing ever read), tips,
 * bonus, premiums, distinct workers, and how much pay-gross lacked a bill
 * rate (billMissing*) so accrual coverage is honest.
 *
 * Why: every financial report recomputes from raw entries (366-day/12k-row
 * ceilings), revenue comes only from QBO invoices via fuzzy class matching
 * with a month-boundary distortion, and nothing materialized exists to
 * forecast from. These rollups give trend/forecast/budget surfaces a cheap,
 * unlimited-horizon read and an accrual revenue line that needs no QBO join.
 *
 * Entry math mirrors payrollCostReport exactly (csv_import: no DT/premiums;
 * contractor entities flat-rate) and the same status filter
 * (sent_to_everee/submitted/paid, total > 0) so rollups tie to the reports.
 *
 * Rebuilds are idempotent: deterministic doc ids, and every rollup doc for
 * the target weeks is deleted before the fresh set is written (so a JO that
 * lost all entries disappears instead of going stale).
 *
 * Hosted on reconcileTimesheetBatchesCron behind a once-per-day
 * function_runs claim (Cloud Run cap — no new function).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

const trim = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Monday of the week containing the date (UTC math on YYYY-MM-DD). */
export function weekStartOf(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function docIdPart(v: string): string {
  return (v || 'none').replace(/[\/#?%\s]+/g, '_').slice(0, 60);
}

export async function rebuildFinanceWeekRollups(input: {
  tenantId: string;
  /** Inclusive week-start bounds; both snapped to their Mondays. */
  startDate: string;
  endDate: string;
}): Promise<{ weeks: number; docs: number; entries: number }> {
  const tenantId = input.tenantId;
  const startWeek = weekStartOf(input.startDate);
  const endWeekStart = weekStartOf(input.endDate);
  // Scan through the END of the last week (Sunday).
  const scanEnd = new Date(`${endWeekStart}T00:00:00Z`);
  scanEnd.setUTCDate(scanEnd.getUTCDate() + 6);
  const scanEndIso = scanEnd.toISOString().slice(0, 10);

  // Entities: contractor flag drives the pay math.
  const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  const contractorByEntity = new Map<string, boolean>();
  entitiesSnap.forEach((d) => {
    const name = trim(d.data().name) || d.id;
    if (/sandbox/i.test(d.id) || /sandbox/i.test(name)) return;
    contractorByEntity.set(
      d.id,
      trim(d.data().workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(d.id),
    );
  });

  const snap = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workDate', '>=', startWeek)
    .where('workDate', '<=', scanEndIso)
    .get();

  interface Roll {
    weekStart: string;
    entityId: string;
    accountId: string;
    jobOrderId: string;
    hours: number;
    payGross: number;
    billGross: number;
    billMissingPayGross: number;
    billMissingEntries: number;
    tips: number;
    bonus: number;
    premiums: number;
    entries: number;
    workers: Set<string>;
  }
  const rolls = new Map<string, Roll>();
  const accountIds = new Set<string>();
  const jobOrderIds = new Set<string>();
  let pickedCount = 0;

  // Two-pass: import rows often carry an empty accountId but a real JO link
  // (same resolution the cost report uses — account via jo.recruiterAccountId).
  interface PickedRow {
    weekStart: string;
    entityId: string;
    accountId: string;
    jobOrderId: string;
    hours: number;
    payGross: number;
    billRate: number;
    tips: number;
    bonus: number;
    premiums: number;
    workerId: string;
  }
  const pickedRows: PickedRow[] = [];

  snap.forEach((d) => {
    const e = d.data() as Record<string, unknown>;
    const status = trim(e.status);
    if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
    const entityId = trim(e.hiringEntityId);
    if (!contractorByEntity.has(entityId)) return; // sandbox/unknown
    const isContractor = contractorByEntity.get(entityId) === true;
    const isImport = trim(e.source) === 'csv_import';
    const rate = num(e.payRate);
    const reg = num(e.totalRegularHours);
    const ot = num(e.totalOTHours);
    const dt = num(e.totalDoubleTimeHours);
    const premiums = isImport
      ? 0
      : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
    const hourly = isContractor
      ? round2((reg + ot + dt) * rate)
      : isImport
        ? round2(reg * rate + ot * rate * 1.5)
        : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
    const tips = round2(num(e.tips));
    const bonus = round2(num(e.bonusAmount));
    const payGross = round2(hourly + premiums + tips + bonus);
    if (payGross === 0) return;
    const hours = round2(reg + ot + dt);
    const workDate = trim(e.workDate);
    const weekStart = weekStartOf(workDate);
    if (weekStart < startWeek || weekStart > endWeekStart) return;

    const jobOrderId = trim(e.jobOrderId);
    if (jobOrderId) jobOrderIds.add(jobOrderId);
    pickedRows.push({
      weekStart,
      entityId,
      accountId: trim(e.accountId),
      jobOrderId,
      hours,
      payGross,
      billRate: num(e.billRate),
      tips,
      bonus,
      premiums,
      workerId: trim(e.workerId),
    });
    pickedCount += 1;
  });

  // JO docs first: account fallback + denormalized names.
  const joDocs = new Map<string, Record<string, unknown>>();
  const joList0 = Array.from(jobOrderIds);
  for (let i = 0; i < joList0.length; i += 100) {
    const chunk = joList0.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/job_orders/${id}`)));
    snaps.forEach((s) => {
      if (s.exists) joDocs.set(s.id, s.data() as Record<string, unknown>);
    });
  }

  for (const p of pickedRows) {
    const accountId = p.accountId || trim(joDocs.get(p.jobOrderId)?.recruiterAccountId);
    if (accountId) accountIds.add(accountId);

    // Accrual bill: flat hourly billRate snapshot × hours. v1 deliberately
    // applies no OT bill multiplier (the snapshot chain doesn't carry one);
    // billMissing* keeps the coverage honest where no rate was snapshotted.
    const bill = p.billRate > 0 ? round2(p.hours * p.billRate) : 0;

    const key = `${p.weekStart}|${p.entityId}|${accountId}|${p.jobOrderId}`;
    if (!rolls.has(key)) {
      rolls.set(key, {
        weekStart: p.weekStart,
        entityId: p.entityId,
        accountId,
        jobOrderId: p.jobOrderId,
        hours: 0,
        payGross: 0,
        billGross: 0,
        billMissingPayGross: 0,
        billMissingEntries: 0,
        tips: 0,
        bonus: 0,
        premiums: 0,
        entries: 0,
        workers: new Set(),
      });
    }
    const r = rolls.get(key)!;
    r.hours = round2(r.hours + p.hours);
    r.payGross = round2(r.payGross + p.payGross);
    r.billGross = round2(r.billGross + bill);
    if (p.billRate <= 0) {
      r.billMissingPayGross = round2(r.billMissingPayGross + p.payGross);
      r.billMissingEntries += 1;
    }
    r.tips = round2(r.tips + p.tips);
    r.bonus = round2(r.bonus + p.bonus);
    r.premiums = round2(r.premiums + p.premiums);
    r.entries += 1;
    if (p.workerId) r.workers.add(p.workerId);
  }

  // Denormalized names for cheap rendering.
  const accountNames = new Map<string, string>();
  const acctList = Array.from(accountIds);
  for (let i = 0; i < acctList.length; i += 100) {
    const chunk = acctList.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`)));
    snaps.forEach((s) => {
      if (s.exists) accountNames.set(s.id, trim(s.data()?.name));
    });
  }
  const joNames = new Map<string, string>();
  joDocs.forEach((x, id) => {
    joNames.set(id, trim(x.jobOrderName) || trim(x.name));
  });

  const coll = db.collection(`tenants/${tenantId}/finance_week_rollups`);

  // Delete-then-write for the target weeks so vanished dimensions don't stay.
  const staleSnap = await coll
    .where('weekStart', '>=', startWeek)
    .where('weekStart', '<=', endWeekStart)
    .get();
  let batch = db.batch();
  let ops = 0;
  const flush = async (): Promise<void> => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };
  for (const d of staleSnap.docs) {
    batch.delete(d.ref);
    ops += 1;
    if (ops >= 400) await flush();
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const r of rolls.values()) {
    const id = [docIdPart(r.weekStart), docIdPart(r.entityId), docIdPart(r.accountId), docIdPart(r.jobOrderId)].join('__');
    batch.set(coll.doc(id), {
      schemaVersion: 1,
      weekStart: r.weekStart,
      entityId: r.entityId,
      accountId: r.accountId || null,
      accountName: accountNames.get(r.accountId) || null,
      jobOrderId: r.jobOrderId || null,
      jobOrderName: joNames.get(r.jobOrderId) || null,
      hours: r.hours,
      payGross: r.payGross,
      billGross: r.billGross,
      marginGross: round2(r.billGross - r.payGross),
      billMissingPayGross: r.billMissingPayGross,
      billMissingEntries: r.billMissingEntries,
      tips: r.tips,
      bonus: r.bonus,
      premiums: r.premiums,
      entries: r.entries,
      workers: r.workers.size,
      updatedAt: now,
    });
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();

  const weekCount = Math.round((Date.parse(endWeekStart) - Date.parse(startWeek)) / (7 * 86400000)) + 1;
  logger.info('financeWeekRollups: rebuilt', {
    tenantId,
    startWeek,
    endWeekStart,
    weeks: weekCount,
    docs: rolls.size,
    entries: pickedCount,
  });
  return { weeks: weekCount, docs: rolls.size, entries: pickedCount };
}

/** Once-per-day trailing rebuild (trailing 6 weeks catches late edits and
 *  status flips). Claims `function_runs/financeWeekRollups_{day}` so the
 *  every-15-min host cron only pays the cost once. */
export async function maybeRunDailyFinanceRollups(tenantId: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const claimRef = db.doc(`function_runs/financeWeekRollups_${day}`);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimRef);
    if (snap.exists) return false;
    tx.set(claimRef, { startedAt: admin.firestore.FieldValue.serverTimestamp(), tenantId });
    return true;
  });
  if (!claimed) return;
  try {
    const end = day;
    const start = new Date(Date.now() - 6 * 7 * 86400000).toISOString().slice(0, 10);
    const res = await rebuildFinanceWeekRollups({ tenantId, startDate: start, endDate: end });
    await claimRef.set({ finishedAt: admin.firestore.FieldValue.serverTimestamp(), ...res }, { merge: true });
  } catch (e) {
    logger.error('financeWeekRollups: daily rebuild failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    await claimRef.set({ failedAt: admin.firestore.FieldValue.serverTimestamp(), error: String(e).slice(0, 300) }, { merge: true });
  }
}
