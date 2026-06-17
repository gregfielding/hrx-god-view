/**
 * setImportEntryPayRate — edit the pay rate on a CSV-import timesheet entry
 * from the Timesheet Grid's inline Pay rate cell.
 *
 * Why a callable: `payRate` is NOT in the Firestore-rules client allowlist (a
 * client write would be rejected), and setting it must recompute the import
 * lifecycle (needs_rate → needs_wc / ready) so the row's pill + submittability
 * stay correct — exactly like setEntryWorkersComp does for WC.
 *
 * Recompute mirrors the matcher: a row needs a WC code only for W-2 entities
 * (1099 sends no WC). Live/blocked rows (submitted/paid/voided/blocked) keep
 * their status — a rate edit doesn't un-block a worker-linkage problem.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
  /** Hourly rate ≥ 0. 0 clears it back to needs_rate. */
  payRate: number;
}

/** Generous fat-finger ceiling for an hourly rate. */
const MAX_RATE = 10000;

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) throw new HttpsError('permission-denied', 'No access to this tenant');
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to edit timesheet entries');
}

export const setImportEntryPayRate = onCall<Input, Promise<{ ok: true; payRate: number; matchStatus?: string }>>(
  { enforceAppCheck: false, cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<{ ok: true; payRate: number; matchStatus?: string }> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, entryId, payRate } = req.data || ({} as Input);
    if (!tenantId || !entryId) {
      throw new HttpsError('invalid-argument', 'tenantId and entryId are required');
    }
    const rate = Number(payRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
      throw new HttpsError('invalid-argument', `payRate must be a number between 0 and ${MAX_RATE}`);
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', `Entry ${entryId} not found`);
    const entry = entrySnap.data() as Record<string, unknown>;
    if (entry.source !== 'csv_import') {
      throw new HttpsError('failed-precondition', 'Only CSV-import rows are editable here.');
    }
    const imp = (entry.import as Record<string, unknown>) || {};
    if (
      entry.status === 'sent_to_everee' ||
      entry.status === 'paid' ||
      imp.matchStatus === 'submitted' ||
      imp.matchStatus === 'paid'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'This row is live in Everee — void it before changing the pay rate.',
      );
    }

    const rounded = Math.round(rate * 100) / 100;
    const updates: Record<string, unknown> = {
      payRate: rounded,
      'import.payRateSource': 'typed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    };

    // Recompute the lifecycle unless the row is in a state we don't disturb.
    const ms = String(imp.matchStatus || '');
    let nextStatus: string | undefined;
    if (!['submitted', 'paid', 'voided', 'blocked'].includes(ms)) {
      // WC only matters for W-2 — 1099 contractor payables send no WC code.
      const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entry.hiringEntityId}`).get();
      const is1099 = String((entitySnap.data() || {}).workerType || '').trim() === '1099';
      const wcCode =
        (typeof entry.workersCompCode === 'string' && entry.workersCompCode.trim()) ||
        (typeof imp.workersCompCode === 'string' && (imp.workersCompCode as string).trim()) ||
        '';
      nextStatus = !(rounded > 0) ? 'needs_rate' : !is1099 && !wcCode ? 'needs_wc' : 'ready';
      updates['import.matchStatus'] = nextStatus;
    }

    await entryRef.update(updates);
    return { ok: true, payRate: rounded, matchStatus: nextStatus };
  },
);
