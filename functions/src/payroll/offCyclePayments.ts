/**
 * Off-cycle / manual payroll payments (Mark Garcia's request, 2026-07-28).
 *
 * The direct-payment gap in cost attribution: payments Mark made inside
 * Everee's UI bypassed HRX entirely — no log, no job-order attribution.
 * This module moves those payments INTO HRX: an admin picks a worker,
 * reason, amount, and (optionally) a job order; HRX sends the Everee
 * payable with the standard name-first attribution tag on its label and
 * records the payment at tenants/{t}/offcycle_payments/{id}, where the
 * Payroll Costs report picks it up like any other entry.
 *
 * Reasons map to Everee pay codes by tax treatment:
 *   wage-like (missed hours / late timesheet / forgot bank account /
 *   correction / other) → REGULAR_HOURLY on W-2 (ordinary wage taxation)
 *   or CONTRACTOR on 1099; bonus → BONUS; expense reimbursement →
 *   REIMBURSEMENT (non-taxable); per diem rides as a second payable
 *   with PER_DIEM.
 *
 * Gate: books-level access — same bar as the Payroll Costs report.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { createPayable, EvereeEarningType } from '../integrations/everee/evereePayables';
import { resolveEvereeWorkerTypeForOnCall } from '../integrations/everee/evereeEntityWorkerType';
import { ensureBooksAccess } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const trim = (v: unknown): string => String(v ?? '').trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;

export type OffCycleReason =
  | 'missed_hours'
  | 'late_timesheet'
  | 'forgot_bank_account'
  | 'bonus'
  | 'expense_reimbursement'
  | 'payroll_correction'
  | 'other';

export const OFF_CYCLE_REASON_LABELS: Record<OffCycleReason, string> = {
  missed_hours: 'Missed hours',
  late_timesheet: 'Late timesheet',
  forgot_bank_account: 'Forgot bank account',
  bonus: 'Bonus',
  expense_reimbursement: 'Expense reimbursement',
  payroll_correction: 'Payroll correction',
  other: 'Other',
};

/** Sanity ceilings — a fat-fingered extra digit should fail loudly. */
const MAX_GROSS = 10000;
const MAX_PER_DIEM = 1000;

function payCodeFor(reason: OffCycleReason, workerType: 'employee' | 'contractor'): EvereeEarningType {
  if (reason === 'bonus') return 'BONUS';
  if (reason === 'expense_reimbursement') return 'REIMBURSEMENT';
  // Wage-like reasons: taxable regular wages on W-2, plain contractor pay
  // on 1099. NOT RETRO_WAGES — that custom code was never provisioned on
  // the Everee tenants (2026-07-28 sandbox probe: "Unknown 'payCode'");
  // payables accept the standard REGULAR_HOURLY code directly, which
  // taxes as ordinary wages (verified 201 + echo in sandbox).
  return workerType === 'contractor' ? 'CONTRACTOR' : 'REGULAR_HOURLY';
}

/**
 * Bounded worker search for the off-cycle dialog: first/last name prefix
 * (as-typed + title-cased) and exact lowercased email. Tenant membership
 * filtered in memory. Never an unbounded scan.
 */
export const searchOffCycleWorkers = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 30 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const query = trim(request.data?.query);
    if (!tenantId || query.length < 2) return { workers: [] };
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const found = new Map<string, Record<string, unknown>>();
    if (query.includes('@')) {
      const snap = await db.collection('users').where('email', '==', query.toLowerCase()).limit(5).get();
      snap.forEach((d) => found.set(d.id, d.data()));
    } else {
      const tc = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
      const variants = Array.from(new Set([query, tc(query)]));
      for (const field of ['firstName', 'lastName'] as const) {
        for (const v of variants) {
          // eslint-disable-next-line no-await-in-loop
          const snap = await db
            .collection('users')
            .where(field, '>=', v)
            .where(field, '<=', `${v}`)
            .limit(10)
            .get();
          snap.forEach((d) => found.set(d.id, d.data()));
        }
      }
    }
    const workers = [...found.entries()]
      .filter(([, u]) => {
        const tenantIds = u.tenantIds as Record<string, unknown> | string[] | undefined;
        if (Array.isArray(tenantIds)) return tenantIds.includes(tenantId);
        if (tenantIds && typeof tenantIds === 'object') return tenantId in tenantIds;
        return trim(u.tenantId) === tenantId;
      })
      .slice(0, 12)
      .map(([id, u]) => ({
        id,
        name: `${trim(u.firstName)} ${trim(u.lastName)}`.trim() || trim(u.displayName) || id,
        email: trim(u.email) || null,
      }));
    return { workers };
  },
);

export const createOffCyclePayment = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const workerId = trim(request.data?.workerId);
    const reason = trim(request.data?.reason) as OffCycleReason;
    const workDate = trim(request.data?.workDate);
    const jobOrderId = trim(request.data?.jobOrderId);
    const notes = trim(request.data?.notes).slice(0, 1000);
    const hours = Number(request.data?.hours) || 0;
    const hourlyRate = Number(request.data?.hourlyRate) || 0;
    const grossAmount = round2(Number(request.data?.grossAmount) || 0);
    const perDiemAmount = round2(Number(request.data?.perDiemAmount) || 0);

    if (!tenantId || !hiringEntityId || !workerId) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and workerId are required.');
    }
    if (!(reason in OFF_CYCLE_REASON_LABELS)) {
      throw new HttpsError('invalid-argument', `Unknown reason '${reason}'.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      throw new HttpsError('invalid-argument', 'workDate must be YYYY-MM-DD.');
    }
    if (grossAmount <= 0 && perDiemAmount <= 0) {
      throw new HttpsError('invalid-argument', 'Gross amount (or per diem) must be greater than zero.');
    }
    if (grossAmount > MAX_GROSS || perDiemAmount > MAX_PER_DIEM) {
      throw new HttpsError(
        'invalid-argument',
        `Amount exceeds the safety cap ($${MAX_GROSS} gross / $${MAX_PER_DIEM} per diem). Split the payment or ask engineering to raise the cap.`,
      );
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // Worker must exist (Everee submission uses the HRX uid as externalWorkerId).
    const workerSnap = await db.collection('users').doc(workerId).get();
    if (!workerSnap.exists) throw new HttpsError('not-found', 'Worker not found.');
    const worker = workerSnap.data() as Record<string, unknown>;
    const workerName = `${trim(worker.firstName)} ${trim(worker.lastName)}`.trim() || trim(worker.displayName) || workerId;

    // Entity → Everee config + worker classification.
    const config = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!config) {
      throw new HttpsError('failed-precondition', `Entity ${hiringEntityId} is not Everee-enabled.`);
    }
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const workerType = resolveEvereeWorkerTypeForOnCall(hiringEntityId, entitySnap.data() ?? {});

    // Optional JO → attribution (same name-first tag as batch submissions).
    let jo: Record<string, unknown> | null = null;
    if (jobOrderId) {
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        // eslint-disable-next-line no-await-in-loop
        const s = await db.doc(`tenants/${tenantId}/${coll}/${jobOrderId}`).get();
        if (s.exists) {
          jo = s.data() as Record<string, unknown>;
          break;
        }
      }
      if (!jo) throw new HttpsError('not-found', `Job order ${jobOrderId} not found.`);
    }
    const joName = trim(jo?.jobOrderName);
    const joPo = trim(jo?.poNumber);
    const worksiteName = trim(jo?.worksiteName);
    const accountId = trim(jo?.recruiterAccountId);
    let accountName = '';
    if (accountId) {
      const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      accountName = acct.exists ? trim(acct.data()?.name) : '';
    }
    const tagNamePart = joName
      ? worksiteName && worksiteName !== joName && worksiteName !== accountName
        ? `${joName.slice(0, 48)} — ${worksiteName.slice(0, 32)}`
        : joName.slice(0, 48)
      : '';
    const attributionTag = [
      accountName && accountName !== joName ? accountName.slice(0, 40) : '',
      tagNamePart,
      joPo ? `PO ${joPo.slice(0, 20)}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
      .trim();

    const reasonLabel = OFF_CYCLE_REASON_LABELS[reason];
    const labelCore = `Off-cycle: ${reasonLabel}${hours > 0 ? ` — ${hours} hrs` : ''}`;
    const label = (attributionTag ? `${attributionTag} · ${labelCore}` : labelCore).slice(0, 120);
    const timestamp = Math.floor(new Date(`${workDate}T12:00:00Z`).getTime() / 1000);

    // Record first (status pending) so a mid-flight crash leaves an audit
    // trail; the deterministic externalId keeps a retry idempotent on the
    // Everee side.
    const docRef = db.collection(`tenants/${tenantId}/offcycle_payments`).doc();
    const base = {
      tenantId,
      hiringEntityId,
      workerId,
      workerName,
      workerType,
      reason,
      reasonLabel,
      workDate,
      hours: hours > 0 ? hours : null,
      hourlyRate: hourlyRate > 0 ? hourlyRate : null,
      grossAmount,
      perDiemAmount: perDiemAmount > 0 ? perDiemAmount : null,
      total: round2(grossAmount + perDiemAmount),
      jobOrderId: jobOrderId || null,
      jobOrderName: joName || null,
      jobOrderNumber: trim(jo?.jobOrderNumber) || null,
      poNumber: joPo || null,
      accountId: accountId || null,
      accountName: accountName || null,
      worksiteName: worksiteName || null,
      attributionTag: attributionTag || null,
      label,
      notes: notes || null,
      createdByUid: request.auth?.uid ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending' as const,
    };
    await docRef.set(base);

    try {
      const results: Array<{ externalId: string; paymentStatus?: string }> = [];
      if (grossAmount > 0) {
        const r = await createPayable(config, {
          externalId: `offcycle_${docRef.id}`,
          externalWorkerId: workerId,
          label,
          type: `off_cycle_${reason}`,
          payCode: payCodeFor(reason, workerType),
          timestamp,
          amount: { amount: grossAmount.toFixed(2), currency: 'USD' },
          payableModel: 'PRE_CALCULATED',
          ...(hours > 0 && hourlyRate > 0
            ? {
                unitRate: { amount: hourlyRate.toFixed(2), currency: 'USD' },
                unitCount: hours,
              }
            : {}),
        });
        results.push({ externalId: r.externalId, paymentStatus: r.paymentStatus });
      }
      if (perDiemAmount > 0) {
        const r = await createPayable(config, {
          externalId: `offcycle_${docRef.id}_pd`,
          externalWorkerId: workerId,
          label: (attributionTag ? `${attributionTag} · Off-cycle: Per diem` : 'Off-cycle: Per diem').slice(0, 120),
          type: 'off_cycle_per_diem',
          payCode: 'PER_DIEM',
          timestamp,
          amount: { amount: perDiemAmount.toFixed(2), currency: 'USD' },
          payableModel: 'PRE_CALCULATED',
        });
        results.push({ externalId: r.externalId, paymentStatus: r.paymentStatus });
      }
      await docRef.update({
        status: 'sent_to_everee',
        sentToEvereeAt: admin.firestore.FieldValue.serverTimestamp(),
        everee: { payables: results },
      });
      return { id: docRef.id, status: 'sent_to_everee', total: base.total, label };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await docRef.update({ status: 'error', errorMessage: message.slice(0, 500) });
      throw new HttpsError('internal', `Everee rejected the payment: ${message}`);
    }
  },
);
