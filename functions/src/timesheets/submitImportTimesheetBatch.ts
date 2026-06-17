/**
 * submitImportTimesheetBatch — P4 of the CSV timesheet importer.
 *
 * Takes the "Ready" rows from the import grid (worker + pay rate + hours +
 * date) and submits them to Everee. For C1 Events (1099 contractors) each
 * row becomes a CONTRACTOR payable (gross = hours × pay rate); Everee handles
 * the 1099 tax mechanics. No worked-shift, no WC, no work-location for 1099.
 *
 * Two modes:
 *   - dryRun: compose + return the exact payloads WITHOUT POSTing — the
 *     recruiter previews what would be sent (zero risk).
 *   - live: bulk-create the payables, record an audit batch doc, return a
 *     per-batch summary. Idempotent: externalId is deterministic per
 *     (tenant, customer+worker, workDate), so a re-submit targets the same
 *     payable rather than double-paying.
 *
 * W-2 import submission (worked-shifts) is a later slice — this path requires
 * a 1099 entity.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { canManageEveree } from '../integrations/everee/evereeAccessGate';
import {
  buildPayableExternalId,
  bulkCreatePayables,
  deletePayable,
  type CreatePayableInput,
} from '../integrations/everee/evereePayables';

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
}

interface ComposedPayablePreview {
  externalId: string;
  externalWorkerId: string;
  workerName: string;
  workDate: string;
  hours: number;
  payRate: number;
  amount: number;
}

/** Firestore-safe doc id for a payable's externalId (which contains `::`). */
function payableStatusDocId(externalId: string): string {
  return String(externalId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 480);
}

/** Noon-UTC of the work date — avoids a TZ off-by-one when Everee renders the
 *  pay-stub date. The payable wire layer converts this epoch to ISO. */
function workDateEpochSeconds(workDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate || ''));
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) / 1000);
}

export const submitImportTimesheetBatch = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
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

    // This path handles 1099 (contractor payables). W-2 worked-shift import is
    // a later slice.
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const workerType = String((entitySnap.data() || {}).workerType || '').trim();
    if (workerType !== '1099') {
      throw new HttpsError(
        'failed-precondition',
        `Import submit currently supports 1099 entities only (this one is ${workerType || 'unspecified'}).`,
      );
    }

    const cust = String(customer || 'import').trim();
    const payables: CreatePayableInput[] = [];
    const preview: ComposedPayablePreview[] = [];
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
      const externalId = buildPayableExternalId({
        tenantId,
        assignmentId: `import-${cust}-${userId}`,
        workDate,
        kind: 'CONTRACTOR',
      });
      payables.push({
        externalId,
        externalWorkerId: userId,
        label: 'Contractor pay',
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
      return { dryRun: true, count: preview.length, skipped, totalAmount, preview };
    }

    if (payables.length === 0) {
      throw new HttpsError('invalid-argument', 'No payable rows to submit (all skipped).');
    }

    // Bulk-create in chunks under Everee's ~200/call limit. Each bulk call is
    // all-or-nothing per Everee.
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

    // Audit record for traceability + a handle for a future void/delete.
    const batchRef = db.collection(`tenants/${tenantId}/timesheet_import_batches`).doc();
    await batchRef.set({
      tenantId,
      hiringEntityId,
      evereeTenantId: cfg.evereeTenantId,
      customer: cust,
      workerType,
      submittedByUid: request.auth.uid,
      rowCount: preview.length,
      totalAmount,
      submittedExternalIds: submitted,
      errors,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Per-payable status docs so the import grid can show "Submitted" per row
    // across sessions, and the void path has a handle. Keyed by sanitized
    // externalId for O(1) lookup.
    const submittedSet = new Set(submitted);
    const byExternalId = new Map(preview.map((p) => [p.externalId, p]));
    let writer = db.batch();
    let pending = 0;
    for (const externalId of submittedSet) {
      const p = byExternalId.get(externalId);
      writer.set(
        db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`),
        {
          externalId,
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
          submittedByUid: request.auth.uid,
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (++pending >= 450) {
        // eslint-disable-next-line no-await-in-loop
        await writer.commit();
        writer = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await writer.commit();

    return {
      dryRun: false,
      batchId: batchRef.id,
      submitted: submitted.length,
      failed: payables.length - submitted.length,
      errors,
      totalAmount,
    };
  },
);

/**
 * Retract a previously-submitted import payable. Deletes it in Everee (only
 * works before the pay run finalizes) and marks the local status doc voided so
 * the row returns to "Ready" and can be re-submitted.
 */
export const voidImportTimesheetPayable = onCall(
  { memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, externalId } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      externalId?: string;
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
    await deletePayable(cfg, externalId);
    await db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`).set(
      {
        status: 'voided',
        voidedByUid: request.auth.uid,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, externalId };
  },
);
