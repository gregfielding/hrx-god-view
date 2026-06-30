/**
 * setTimesheetEntryPayRate — edit the pay rate on a regular (scheduled)
 * timesheet entry from the Timesheet Grid's inline Pay rate cell.
 *
 * Why a callable: `payRate` is NOT in the Firestore-rules client allowlist
 * (the editor hook only writes actuals/breaks/tips/bonus/notes), so a client
 * write is rejected — same reason WC and the import pay rate go through a
 * callable. Sets the rate; the grid's Total and the submit both read
 * `entry.payRate`, and the pay-breakdown recompute trigger re-fires on write.
 *
 * Import rows have their own callable (setImportEntryPayRate, which also
 * recomputes the import lifecycle), so this one refuses csv_import entries.
 * Live (submitted/paid) rows are refused — void first.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
  /** Hourly rate ≥ 0. */
  payRate: number;
}

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

export const setTimesheetEntryPayRate = onCall<Input, Promise<{ ok: true; payRate: number }>>(
  { enforceAppCheck: false, cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<{ ok: true; payRate: number }> => {
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
    if (entry.source === 'csv_import') {
      throw new HttpsError('failed-precondition', 'Use the Import CSV pay-rate edit for imported rows.');
    }
    if (entry.status === 'sent_to_everee' || entry.status === 'paid') {
      throw new HttpsError('failed-precondition', 'This row is live in Everee — void it before changing the pay rate.');
    }

    const rounded = Math.round(rate * 100) / 100;
    await entryRef.update({
      payRate: rounded,
      payRateSource: 'manual',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    });
    return { ok: true, payRate: rounded };
  },
);
