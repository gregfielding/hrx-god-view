/**
 * deleteImportEntry — delete a single CSV-import timesheet entry from the
 * Timesheet Grid's per-row trash action.
 *
 * Firestore rules deny client deletes on timesheet_entries, so this callable
 * does it. Scoped to `source: 'csv_import'` rows (the persisted import rows the
 * recruiter manages) and refuses any row that's live in Everee (submitted/paid)
 * — those must be voided first so we don't orphan a payable/worked shift.
 *
 * Use case: clear out blocked/duplicate import rows that will never be paid
 * (e.g. a worker who won't be onboarded) without re-uploading the whole file.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
}

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
  throw new HttpsError('permission-denied', 'Not authorized to delete timesheet entries');
}

export const deleteImportEntry = onCall<Input, Promise<{ ok: true; deleted: string }>>(
  { enforceAppCheck: false, cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<{ ok: true; deleted: string }> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, entryId } = req.data || ({} as Input);
    if (!tenantId || !entryId) {
      throw new HttpsError('invalid-argument', 'tenantId and entryId are required');
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    const ref = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const snap = await ref.get();
    if (!snap.exists) return { ok: true, deleted: entryId }; // already gone — idempotent
    const entry = snap.data() as Record<string, unknown>;
    if (entry.source !== 'csv_import') {
      throw new HttpsError('failed-precondition', 'Only CSV-import rows can be deleted here.');
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
        'This row is live in Everee — void it before deleting.',
      );
    }

    await ref.delete();
    return { ok: true, deleted: entryId };
  },
);
