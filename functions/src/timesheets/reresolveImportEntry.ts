/**
 * reresolveImportEntry — reconnect a saved CSV-import timesheet row to the
 * worker's assignment, from the Timesheet Grid.
 *
 * Why (Greg 2026-07-30): import rows are matched at import time. When the
 * paired assignment didn't exist yet (the recruiter creates it later), the
 * row lands as "Needs rate" with no pay rate / WC / worksite. This callable
 * re-runs just the assignment step for one saved entry — load the worker's
 * assignments, pick the one whose date window covers the work date (same
 * `pairAssignment` the matcher uses — active OR ended, only cancelled/
 * declined are dropped), and fill payRate + WC + worksite from it, then
 * recompute the import lifecycle. One click instead of re-uploading the CSV.
 *
 * Live/blocked rows (submitted/paid/voided) are refused — void first.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { loadWorkerAssignments, pairAssignment } from './importTimesheetMatchWorkers';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
}
interface Output {
  ok: true;
  connected: boolean;
  payRate?: number | null;
  workersCompCode?: string | null;
  workersCompRate?: number | null;
  assignmentId?: string | null;
  matchStatus?: string;
  message?: string;
}

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (tenantMeta) {
    const role = String(tenantMeta.role || '').trim().toLowerCase();
    if (['recruiter', 'manager', 'admin'].includes(role)) return;
    const sec = parseInt(String(tenantMeta.securityLevel ?? data.securityLevel ?? '0'), 10);
    if (!Number.isNaN(sec) && sec >= 5) return;
  }
  const rootSec = parseInt(String(data.securityLevel ?? '0'), 10);
  if (!Number.isNaN(rootSec) && rootSec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to edit timesheet entries');
}

const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const strOrNull = (...c: unknown[]): string | null => {
  for (const v of c) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
};

export const reresolveImportEntry = onCall<Input, Promise<Output>>(
  { cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<Output> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, entryId } = req.data || ({} as Input);
    if (!tenantId || !entryId) {
      throw new HttpsError('invalid-argument', 'tenantId and entryId are required');
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', `Entry ${entryId} not found`);
    const entry = entrySnap.data() as Record<string, unknown>;
    if (entry.source !== 'csv_import') {
      throw new HttpsError('failed-precondition', 'Only CSV-import rows can be re-resolved here.');
    }
    const imp = (entry.import as Record<string, unknown>) || {};
    const ms = String(imp.matchStatus || '');
    if (
      entry.status === 'sent_to_everee' ||
      entry.status === 'paid' ||
      ['submitted', 'paid', 'voided'].includes(ms)
    ) {
      throw new HttpsError('failed-precondition', 'This row is live in Everee — void it first.');
    }

    const userId = strOrNull(entry.userId, entry.workerId, (imp as Record<string, unknown>).userId);
    const workDate = strOrNull(entry.workDate)?.slice(0, 10) || '';
    if (!userId || !workDate) {
      throw new HttpsError('failed-precondition', 'Row is missing a worker or work date.');
    }

    const assignments = await loadWorkerAssignments(tenantId, userId);
    const assignment = pairAssignment(assignments, workDate);
    if (!assignment) {
      return {
        ok: true,
        connected: false,
        message:
          'No assignment covers this work date yet. Create the assignment (its dates must span this day), then re-resolve.',
      };
    }

    const payRate = numOrNull(assignment.payRate);
    const billRate = numOrNull(assignment.billRate);
    const wcCode = strOrNull(assignment.workersCompCode, assignment.workersCompClassCode);
    const wcRate = numOrNull(assignment.workersCompRate);
    const worksiteAddress =
      assignment.worksiteAddress && typeof assignment.worksiteAddress === 'object'
        ? assignment.worksiteAddress
        : null;
    const worksiteName = strOrNull(assignment.worksiteName);
    const jobOrderId = strOrNull(assignment.jobOrderId);

    // 1099 sends no WC → don't gate the lifecycle on WC for contractor entities.
    const entitySnap = entry.hiringEntityId
      ? await db.doc(`tenants/${tenantId}/entities/${String(entry.hiringEntityId)}`).get()
      : null;
    const is1099 = String((entitySnap?.data() || {}).workerType || '').trim() === '1099';

    const updates: Record<string, unknown> = {
      assignmentId: assignment.id,
      'import.assignmentId': assignment.id,
      'import.payRateSource': 'assignment',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    };
    if (payRate != null) updates.payRate = payRate;
    if (billRate != null) updates.billRate = billRate;
    if (wcCode != null) {
      updates.workersCompCode = wcCode;
      updates['import.workersCompCode'] = wcCode;
      updates['import.workersCompSource'] = 'assignment';
    }
    if (wcRate != null) {
      updates.workersCompRate = wcRate;
      updates['import.workersCompRate'] = wcRate;
    }
    if (worksiteAddress) {
      updates.worksiteAddress = worksiteAddress;
      updates['import.worksiteAddress'] = worksiteAddress;
      updates['import.worksiteSource'] = 'assignment';
    }
    // Stamp top-level `workState` when it's empty — downstream WC-matrix rate
    // lookups (setEntryWorkersComp, grid resolver, Everee submit) key off it,
    // and re-resolving an entry whose assignment lacks a worksite address used
    // to leave it blank, stranding the row at "Needs WC".
    if (!strOrNull(entry.workState)) {
      const resolvedState =
        (worksiteAddress as { state?: string } | null)?.state ||
        (assignment as unknown as { worksiteState?: string }).worksiteState ||
        ((entry.import as Record<string, unknown> | undefined)?.worksiteAddress as
          | { state?: string }
          | undefined)?.state ||
        null;
      if (resolvedState) updates.workState = String(resolvedState).trim().toUpperCase();
    }
    if (worksiteName) updates['import.worksiteName'] = worksiteName;
    if (jobOrderId) updates.jobOrderId = jobOrderId;

    // Recompute the import lifecycle (mirror setImportEntryPayRate/WC).
    const effPay = payRate != null ? payRate : Number(entry.payRate);
    const effWc = wcCode || strOrNull(entry.workersCompCode, (imp as Record<string, unknown>).workersCompCode);
    const nextStatus = !(effPay > 0) ? 'needs_rate' : !is1099 && !effWc ? 'needs_wc' : 'ready';
    updates['import.matchStatus'] = nextStatus;

    await entryRef.update(updates);

    return {
      ok: true,
      connected: true,
      payRate: payRate ?? (Number.isFinite(Number(entry.payRate)) ? Number(entry.payRate) : null),
      workersCompCode: wcCode,
      workersCompRate: wcRate,
      assignmentId: assignment.id,
      matchStatus: nextStatus,
    };
  },
);
