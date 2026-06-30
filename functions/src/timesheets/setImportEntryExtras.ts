/**
 * setImportEntryExtras — edit Tips and/or Bonus on a CSV-import timesheet entry
 * from the Timesheet Grid's inline Tips / Bonus cells.
 *
 * Why a callable: mirrors setImportEntryHours / setImportEntryPayRate — import
 * rows are edited server-side (consistent auth + live-row guard). Unlike pay
 * rate, tips/bonus are pay add-ons that do NOT affect the import lifecycle
 * (matchStatus), so there's no recompute here. Stored as `tips` and
 * `bonusAmount` to match the entry schema + the grid's total formula.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
  /** Provide either or both. Each is a dollar amount ≥ 0; 0 clears it. */
  tips?: number;
  bonus?: number;
}

/** Generous fat-finger ceiling for a single-day tip/bonus amount. */
const MAX_AMOUNT = 100000;

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

const clean = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    throw new HttpsError('invalid-argument', `Amount must be a number between 0 and ${MAX_AMOUNT}`);
  }
  return Math.round(n * 100) / 100;
};

export const setImportEntryExtras = onCall<Input, Promise<{ ok: true; tips?: number; bonusAmount?: number }>>(
  { enforceAppCheck: false, cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<{ ok: true; tips?: number; bonusAmount?: number }> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, entryId } = req.data || ({} as Input);
    if (!tenantId || !entryId) {
      throw new HttpsError('invalid-argument', 'tenantId and entryId are required');
    }
    const tips = clean(req.data?.tips);
    const bonusAmount = clean(req.data?.bonus);
    if (tips === undefined && bonusAmount === undefined) {
      throw new HttpsError('invalid-argument', 'Provide tips and/or bonus to set.');
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
        'This row is live in Everee — void it before changing tips or bonus.',
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    };
    if (tips !== undefined) updates.tips = tips;
    if (bonusAmount !== undefined) updates.bonusAmount = bonusAmount;

    await entryRef.update(updates);
    return { ok: true, tips, bonusAmount };
  },
);
