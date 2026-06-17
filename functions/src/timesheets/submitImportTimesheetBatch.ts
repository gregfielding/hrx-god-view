/**
 * submitImportTimesheetBatch — P4 of the CSV timesheet importer.
 *
 * Takes the "Ready" rows from the import grid (worker + pay rate + hours +
 * date, plus WC code + worksite for W-2) and submits them to Everee.
 *
 *   - 1099 (C1 Events, contractors): each row becomes a CONTRACTOR payable
 *     (gross = hours × pay rate). No worked-shift, no WC, no work-location.
 *     Idempotency: deterministic `externalId` per (tenant, customer+worker,
 *     workDate) — a re-submit targets the same payable rather than
 *     double-paying.
 *
 *   - W-2 (C1 Select, employees): each row becomes a worked shift on the
 *     Timesheets API. We send a synthetic shift window sized to the day's
 *     hours but DO NOT pre-classify regular/OT/DT — Everee's payroll engine
 *     computes daily + weekly overtime per state rules (an imported timesheet
 *     carries no clock detail, and Everee is the system of record). WC class
 *     code is required; worksite resolves to an Everee `workLocationId` via
 *     the cache. Idempotency is server-assigned: the returned `workedShiftId`
 *     is stored on the per-row status doc, and an already-submitted row is
 *     skipped to avoid duplicate shifts.
 *
 * Two modes for both paths:
 *   - dryRun: compose + return the exact preview WITHOUT calling Everee.
 *   - live: create the payables / worked shifts, write an audit batch doc +
 *     per-row status docs, return a summary.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { canManageEveree } from '../integrations/everee/evereeAccessGate';
import {
  bulkCreatePayables,
  deletePayable,
  type CreatePayableInput,
} from '../integrations/everee/evereePayables';
import { ensureEvereeWorkLocation } from '../integrations/everee/evereeWorkLocations';
import {
  createWorkedShift,
  deleteWorkedShift,
  type CreateWorkedShiftInput,
} from '../integrations/everee/evereeWorkedShifts';
import { importEntryDocId, importExternalId } from './importEntryKeys';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface SubmitRow {
  /** HRX uid — Everee's externalWorkerId by convention. */
  userId: string;
  /** YYYY-MM-DD. */
  workDate: string;
  hours: number;
  payRate: number;
  /** For display/labeling only. */
  workerName?: string;
  /** The event/site this day belongs to (CSV "Type"/site). Used only to make
   *  the per-day pay-stub line legible (e.g. "Contractor pay — Railbird — Jun 7"). */
  eventLabel?: string | null;
  // ── W-2 only ──
  workersCompCode?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
}

/** A per-day pay-stub line label. Each imported row is one day, so this keeps
 *  the stub itemized by date rather than a single weekly lump. */
function dayLabel(base: string, eventLabel: string | null | undefined, workDate: string): string {
  return [base, String(eventLabel || '').trim() || null, workDate]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 120);
}

interface ComposedPreview {
  externalId: string;
  externalWorkerId: string;
  workerName: string;
  workDate: string;
  hours: number;
  payRate: number;
  /** Straight-time gross (hours × payRate). For W-2 this is an estimate —
   *  Everee adds OT/DT at the pay run. */
  amount: number;
  workersCompCode?: string | null;
  worksiteName?: string | null;
}

/** Firestore-safe doc id for an externalId (which contains `::`). */
function payableStatusDocId(externalId: string): string {
  return String(externalId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 480);
}

/** Build the merge payload that mirrors a submitted import row onto its
 *  canonical `timesheet_entries` doc, so the Timesheet Grid reflects truth even
 *  if the recruiter never clicked "Save progress".
 *
 *  Set only fields this path owns — Firestore `merge:true` deep-merges nested
 *  maps, so writing `null` for a field a prior Save populated would clobber it.
 *  We therefore omit unknown fields rather than null them. */
function importEntryStamp(args: {
  tenantId: string;
  hiringEntityId: string;
  customer: string;
  userId: string;
  workDate: string;
  hours: number;
  payRate: number;
  workerName?: string;
  eventLabel?: string | null;
  workersCompCode?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteState?: string | null;
  externalId: string;
  uid: string;
}): Record<string, unknown> {
  const importSidecar: Record<string, unknown> = {
    customer: args.customer,
    matchStatus: 'submitted',
    externalId: args.externalId,
  };
  if (args.workerName) importSidecar.csvWorkerName = args.workerName;
  if (args.eventLabel) importSidecar.csvSite = args.eventLabel;
  if (args.worksiteId) importSidecar.worksiteId = args.worksiteId;
  if (args.worksiteName) importSidecar.worksiteName = args.worksiteName;
  if (args.workersCompCode) importSidecar.workersCompCode = args.workersCompCode;

  const out: Record<string, unknown> = {
    id: importEntryDocId({ customer: args.customer, userId: args.userId, workDate: args.workDate }),
    tenantId: args.tenantId,
    source: 'csv_import',
    hiringEntityId: args.hiringEntityId,
    workerId: args.userId,
    workDate: args.workDate,
    actualHoursOverride: args.hours,
    totalRegularHours: args.hours,
    totalOTHours: 0,
    totalFlsaOTHours: 0,
    totalNonFlsaOTHours: 0,
    totalDoubleTimeHours: 0,
    mealBreakPenaltyHours: 0,
    restBreakPenaltyHours: 0,
    payRate: args.payRate,
    status: 'sent_to_everee',
    sentToEvereeAt: admin.firestore.FieldValue.serverTimestamp(),
    import: importSidecar,
    updatedBy: args.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (args.worksiteState) out.workState = args.worksiteState;
  if (args.workersCompCode) out.workersCompCode = args.workersCompCode;
  return out;
}

/** Noon-UTC of the work date — avoids a TZ off-by-one when Everee renders the
 *  pay-stub date, and keeps a synthetic shift window on the right calendar
 *  day across US time zones. */
function workDateEpochSeconds(workDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate || ''));
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) / 1000);
}

/** Run async tasks with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const submitImportTimesheetBatch = onCall(
  // W-2 posts one worked shift per row (no bulk endpoint on the default path),
  // so allow plenty of headroom; 1099 is bulk and finishes fast.
  { memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, customer, dryRun, rows } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      customer?: string;
      dryRun?: boolean;
      rows?: SubmitRow[];
    };
    if (!tenantId || !hiringEntityId || !Array.isArray(rows) || rows.length === 0) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and rows[] are required');
    }
    if (rows.length > 2000) {
      throw new HttpsError('invalid-argument', 'Too many rows in one submit (max 2000).');
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to submit timesheets for this tenant.');
    }

    const cfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!cfg?.evereeTenantId) {
      throw new HttpsError('failed-precondition', 'Selected entity is not configured for Everee.');
    }

    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const workerType = String((entitySnap.data() || {}).workerType || '').trim();
    const cust = String(customer || 'import').trim();
    const is1099 = workerType === '1099';

    const pathArgs: PathArgs = {
      uid: request.auth.uid,
      tenantId,
      hiringEntityId,
      cfg,
      cust,
      workerType,
      dryRun: !!dryRun,
      rows,
    };
    return is1099 ? submit1099(pathArgs) : submitW2(pathArgs);
  },
);

interface PathArgs {
  uid: string;
  tenantId: string;
  hiringEntityId: string;
  cfg: NonNullable<Awaited<ReturnType<typeof getEvereeConfigForEntity>>>;
  cust: string;
  workerType: string;
  dryRun: boolean;
  rows: SubmitRow[];
}

// ─────────────────────────────────────────────────────────────────────
// 1099 — contractor payables (bulk)
// ─────────────────────────────────────────────────────────────────────

async function submit1099(args: PathArgs) {
  const { uid, tenantId, hiringEntityId, cfg, cust, workerType, dryRun, rows } = args;
  const payables: CreatePayableInput[] = [];
  const preview: ComposedPreview[] = [];
  let skipped = 0;
  for (const row of rows) {
    const userId = String(row.userId || '').trim();
    const hours = Number(row.hours);
    const payRate = Number(row.payRate);
    const workDate = String(row.workDate || '').trim();
    if (!userId || !workDate || !(hours > 0) || !(payRate > 0)) {
      skipped += 1;
      continue;
    }
    const amount = Math.round(hours * payRate * 100) / 100;
    const externalId = importExternalId({ tenantId, customer: cust, userId, workDate, kind: 'CONTRACTOR' });
    payables.push({
      externalId,
      externalWorkerId: userId,
      label: dayLabel('Contractor pay', row.eventLabel, workDate),
      type: 'contractor',
      payCode: 'CONTRACTOR',
      timestamp: workDateEpochSeconds(workDate),
      amount: { amount: amount.toFixed(2), currency: 'USD' },
      payableModel: 'PRE_CALCULATED',
    });
    preview.push({
      externalId,
      externalWorkerId: userId,
      workerName: String(row.workerName || '').trim(),
      workDate,
      hours,
      payRate,
      amount,
    });
  }

  const totalAmount = Math.round(preview.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  if (dryRun) {
    return { dryRun: true, workerType, count: preview.length, skipped, totalAmount, preview };
  }
  if (payables.length === 0) {
    throw new HttpsError('invalid-argument', 'No payable rows to submit (all skipped).');
  }

  const submitted: string[] = [];
  const errors: string[] = [];
  const CHUNK = 150;
  for (let i = 0; i < payables.length; i += CHUNK) {
    const chunk = payables.slice(i, i + CHUNK);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await bulkCreatePayables(cfg, chunk);
      submitted.push(...res.externalIds);
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240));
    }
  }

  const batchRef = db.collection(`tenants/${tenantId}/timesheet_import_batches`).doc();
  await batchRef.set({
    tenantId,
    hiringEntityId,
    evereeTenantId: cfg.evereeTenantId,
    customer: cust,
    workerType,
    kind: 'payable',
    submittedByUid: uid,
    rowCount: preview.length,
    totalAmount,
    submittedExternalIds: submitted,
    errors,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const submittedSet = new Set(submitted);
  const byExternalId = new Map(preview.map((p) => [p.externalId, p]));
  const rowByExternalId = new Map(
    rows.map((r) => [
      importExternalId({
        tenantId,
        customer: cust,
        userId: String(r.userId || '').trim(),
        workDate: String(r.workDate || '').trim(),
        kind: 'CONTRACTOR',
      }),
      r,
    ]),
  );
  let writer = db.batch();
  let pending = 0;
  for (const externalId of submittedSet) {
    const p = byExternalId.get(externalId);
    const row = rowByExternalId.get(externalId);
    writer.set(
      db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`),
      {
        externalId,
        kind: 'payable',
        externalWorkerId: p?.externalWorkerId ?? null,
        workerName: p?.workerName ?? null,
        customer: cust,
        hiringEntityId,
        evereeTenantId: cfg.evereeTenantId,
        workDate: p?.workDate ?? null,
        hours: p?.hours ?? null,
        payRate: p?.payRate ?? null,
        amount: p?.amount ?? null,
        status: 'submitted',
        batchId: batchRef.id,
        submittedByUid: uid,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Mirror onto the canonical timesheet entry (Grid = source of truth).
    if (p) {
      const docId = importEntryDocId({ customer: cust, userId: p.externalWorkerId, workDate: p.workDate });
      writer.set(
        db.doc(`tenants/${tenantId}/timesheet_entries/${docId}`),
        {
          ...importEntryStamp({
            tenantId,
            hiringEntityId,
            customer: cust,
            userId: p.externalWorkerId,
            workDate: p.workDate,
            hours: p.hours,
            payRate: p.payRate,
            workerName: p.workerName,
            eventLabel: row?.eventLabel ?? null,
            externalId,
            uid,
          }),
          // Nested map (NOT dotted keys) — set(merge:true) deep-merges this,
          // dotted strings would create a literal "everee.x" field.
          everee: {
            payableExternalIds: [externalId],
            status: 'SUBMITTED',
            respondedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      pending += 1;
    }
    if (++pending >= 400) {
      // eslint-disable-next-line no-await-in-loop
      await writer.commit();
      writer = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await writer.commit();

  return {
    dryRun: false,
    workerType,
    batchId: batchRef.id,
    submitted: submitted.length,
    failed: payables.length - submitted.length,
    errors,
    totalAmount,
  };
}

// ─────────────────────────────────────────────────────────────────────
// W-2 — worked shifts (per-row; Everee classifies OT/DT)
// ─────────────────────────────────────────────────────────────────────

interface W2Plan {
  row: SubmitRow;
  userId: string;
  workDate: string;
  hours: number;
  payRate: number;
  wc: string;
  externalId: string;
}

async function submitW2(args: PathArgs) {
  const { uid, tenantId, hiringEntityId, cfg, cust, workerType, dryRun, rows } = args;

  // Validate + plan. W-2 worked shifts require a WC class code (comp-insurance
  // classification); a row without one is skipped and reported.
  const plans: W2Plan[] = [];
  let skipped = 0;
  let skippedNoWc = 0;
  for (const row of rows) {
    const userId = String(row.userId || '').trim();
    const hours = Number(row.hours);
    const payRate = Number(row.payRate);
    const workDate = String(row.workDate || '').trim();
    if (!userId || !workDate || !(hours > 0) || !(payRate > 0)) {
      skipped += 1;
      continue;
    }
    const wc = String(row.workersCompCode || '').trim();
    if (!wc) {
      skippedNoWc += 1;
      continue;
    }
    plans.push({
      row,
      userId,
      workDate,
      hours,
      payRate,
      wc,
      externalId: importExternalId({ tenantId, customer: cust, userId, workDate, kind: 'WORKED_SHIFT' }),
    });
  }

  const preview: ComposedPreview[] = plans.map((p) => ({
    externalId: p.externalId,
    externalWorkerId: p.userId,
    workerName: String(p.row.workerName || '').trim(),
    workDate: p.workDate,
    hours: p.hours,
    payRate: p.payRate,
    amount: Math.round(p.hours * p.payRate * 100) / 100,
    workersCompCode: p.wc,
    worksiteName: p.row.worksiteName ?? null,
  }));
  const totalAmount = Math.round(preview.reduce((s, p) => s + p.amount, 0) * 100) / 100;

  if (dryRun) {
    return {
      dryRun: true,
      workerType,
      // The total is a straight-time estimate; Everee adds OT/DT at the pay run.
      evereeClassifiesOt: true,
      count: preview.length,
      skipped,
      skippedNoWc,
      totalAmount,
      preview,
    };
  }

  if (plans.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      skippedNoWc > 0
        ? `No submittable rows — ${skippedNoWc} are missing a workers-comp code.`
        : 'No worked-shift rows to submit (all skipped).',
    );
  }

  // Skip rows already live in Everee (status doc 'submitted') so a re-submit
  // after a re-match doesn't create duplicate worked shifts. Worked-shift
  // idempotency is server-assigned, not deterministic, so this guard matters.
  const alreadyLive = new Set<string>();
  const READ_CHUNK = 300;
  for (let i = 0; i < plans.length; i += READ_CHUNK) {
    const slice = plans.slice(i, i + READ_CHUNK);
    const refs = slice.map((p) =>
      db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(p.externalId)}`),
    );
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, j) => {
      if (snap.exists && String(snap.data()?.status || '') === 'submitted') {
        alreadyLive.add(slice[j].externalId);
      }
    });
  }

  // Resolve each unique worksite to an Everee numeric workLocationId once.
  const locationCache = new Map<string, number>();
  const resolveLocation = async (row: SubmitRow): Promise<number | undefined> => {
    const wsId = String(row.worksiteId || '').trim();
    if (!wsId) return undefined;
    if (locationCache.has(wsId)) return locationCache.get(wsId);
    try {
      const a = row.worksiteAddress || {};
      const id = await ensureEvereeWorkLocation(tenantId, cfg, {
        worksiteId: wsId,
        name: String(row.worksiteName || wsId),
        address: { street: a.street, city: a.city, state: a.state, zip: a.zip },
      });
      locationCache.set(wsId, id);
      return id;
    } catch {
      // Non-fatal: Everee falls back to the worker's default work location.
      return undefined;
    }
  };

  const toSubmit = plans.filter((p) => !alreadyLive.has(p.externalId));
  let submitted = 0;
  const errors: string[] = [];
  const statusWrites: Array<{ plan: W2Plan; workedShiftId: number }> = [];

  // Bounded concurrency — Everee rate-limits, and evereeRequest retries 429s.
  await mapWithConcurrency(toSubmit, 8, async (p) => {
    try {
      const workLocationId = await resolveLocation(p.row);
      const start = workDateEpochSeconds(p.workDate);
      const end = start + Math.max(1, Math.round(p.hours * 3600));
      const input: CreateWorkedShiftInput = {
        externalWorkerId: p.userId,
        shiftStartEpochSeconds: start,
        shiftEndEpochSeconds: end,
        effectiveHourlyPayRate: { amount: p.payRate.toFixed(2), currency: 'USD' },
        workersCompClassCode: p.wc,
        note: dayLabel(`Imported from ${cust}`, p.row.eventLabel, p.workDate),
      };
      if (workLocationId != null) input.overrideWorkLocationId = workLocationId;
      // No fullyClassifiedHours — Everee's engine computes daily/weekly OT/DT.
      const res = await createWorkedShift(cfg, input);
      submitted += 1;
      statusWrites.push({ plan: p, workedShiftId: res.workedShiftId });
    } catch (e: unknown) {
      const who = String(p.row.workerName || p.userId);
      errors.push(
        `${who} ${p.workDate}: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`,
      );
    }
  });

  const batchRef = db.collection(`tenants/${tenantId}/timesheet_import_batches`).doc();
  await batchRef.set({
    tenantId,
    hiringEntityId,
    evereeTenantId: cfg.evereeTenantId,
    customer: cust,
    workerType,
    kind: 'worked_shift',
    submittedByUid: uid,
    rowCount: plans.length,
    totalAmount,
    submitted,
    skippedNoWc,
    alreadyLive: alreadyLive.size,
    errors,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const previewByExtId = new Map(preview.map((p) => [p.externalId, p]));
  let writer = db.batch();
  let pending = 0;
  for (const { plan, workedShiftId } of statusWrites) {
    const p = previewByExtId.get(plan.externalId);
    writer.set(
      db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(plan.externalId)}`),
      {
        externalId: plan.externalId,
        kind: 'worked_shift',
        workedShiftId,
        externalWorkerId: plan.userId,
        workerName: p?.workerName ?? null,
        customer: cust,
        hiringEntityId,
        evereeTenantId: cfg.evereeTenantId,
        workDate: plan.workDate,
        hours: plan.hours,
        payRate: plan.payRate,
        workersCompCode: plan.wc,
        amount: p?.amount ?? null,
        status: 'submitted',
        batchId: batchRef.id,
        submittedByUid: uid,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Mirror onto the canonical timesheet entry (Grid = source of truth).
    const entryDocId = importEntryDocId({ customer: cust, userId: plan.userId, workDate: plan.workDate });
    writer.set(
      db.doc(`tenants/${tenantId}/timesheet_entries/${entryDocId}`),
      {
        ...importEntryStamp({
          tenantId,
          hiringEntityId,
          customer: cust,
          userId: plan.userId,
          workDate: plan.workDate,
          hours: plan.hours,
          payRate: plan.payRate,
          workerName: p?.workerName,
          eventLabel: plan.row.eventLabel ?? null,
          workersCompCode: plan.wc,
          worksiteId: plan.row.worksiteId ?? null,
          worksiteName: plan.row.worksiteName ?? null,
          worksiteState: plan.row.worksiteAddress?.state ?? null,
          externalId: plan.externalId,
          uid,
        }),
        everee: {
          workedShiftId: String(workedShiftId),
          status: 'SUBMITTED',
          respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    pending += 2;
    if (pending >= 400) {
      // eslint-disable-next-line no-await-in-loop
      await writer.commit();
      writer = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await writer.commit();

  return {
    dryRun: false,
    workerType,
    evereeClassifiesOt: true,
    batchId: batchRef.id,
    submitted,
    failed: toSubmit.length - submitted,
    skippedNoWc,
    alreadyLive: alreadyLive.size,
    errors,
    totalAmount,
  };
}

/**
 * Retract a previously-submitted import row. For a payable, deletes it in
 * Everee by externalId; for a worked shift, deletes by the stored
 * `workedShiftId` (with `correction-authorized` in case the period already
 * posted). Marks the local status doc voided so the row returns to "Ready"
 * and can be re-submitted.
 */
export const voidImportTimesheetPayable = onCall(
  { memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, externalId, userId, workDate, customer } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      externalId?: string;
      /** Optional — lets the void reconstruct the canonical entry id to flip it
       *  back to re-sendable. The client always sends these for import rows. */
      userId?: string;
      workDate?: string;
      customer?: string;
    };
    if (!tenantId || !hiringEntityId || !externalId) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and externalId are required');
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to void payables for this tenant.');
    }
    const cfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!cfg?.evereeTenantId) {
      throw new HttpsError('failed-precondition', 'Selected entity is not configured for Everee.');
    }

    const statusRef = db.doc(
      `tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`,
    );
    const statusSnap = await statusRef.get();
    const data = statusSnap.data() || {};

    if (data.kind === 'worked_shift') {
      const workedShiftId = Number(data.workedShiftId);
      if (!(workedShiftId > 0)) {
        throw new HttpsError('failed-precondition', 'No Everee worked-shift id recorded for this row.');
      }
      await deleteWorkedShift(cfg, workedShiftId, { correctionAuthorized: true });
    } else {
      await deletePayable(cfg, externalId);
    }

    await statusRef.set(
      {
        status: 'voided',
        voidedByUid: request.auth.uid,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Flip the canonical entry back to a re-sendable draft so the Grid + Import
    // tab both show it as no-longer-submitted. Prefer the explicit identity the
    // client passes; fall back to the status doc's recorded worker + date.
    const vUserId = String(userId || data.externalWorkerId || '').trim();
    const vWorkDate = String(workDate || data.workDate || '').trim();
    const vCustomer = String(customer || data.customer || '').trim();
    if (vUserId && vWorkDate && vCustomer) {
      const entryDocId = importEntryDocId({ customer: vCustomer, userId: vUserId, workDate: vWorkDate });
      await db.doc(`tenants/${tenantId}/timesheet_entries/${entryDocId}`).set(
        {
          status: 'draft',
          sentToEvereeAt: admin.firestore.FieldValue.delete(),
          // Nested maps deep-merge under set(merge:true); dotted keys would
          // create literal "import.x"/"everee.x" fields instead.
          import: { matchStatus: 'voided' },
          everee: {
            workedShiftId: admin.firestore.FieldValue.delete(),
            payableExternalIds: admin.firestore.FieldValue.delete(),
            status: 'VOIDED',
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: request.auth.uid,
        },
        { merge: true },
      );
    }
    return { ok: true, externalId };
  },
);
