/**
 * setImportEntryWorksite — set the worksite (work location) on a CSV-import
 * timesheet entry from the Timesheet Grid's worksite dropdown.
 *
 * Why it matters: the W-2 import submit sends `overrideWorkLocationId` only when
 * the row carries a `worksiteId`. Everee validates the WC class code against the
 * shift's work-location STATE — a row with no worksite gets no override and
 * Everee falls back to the worker's default location (which may be the wrong
 * state, e.g. a stub CA address → "Invalid workers comp code NNNN for CA"). A
 * manually-set worksite resolves to an Everee work location in the right state.
 *
 * Mirrors setImportEntryHours / setImportEntryPayRate: recruiter-band gate,
 * csv_import only, refuses rows already live in Everee. Stamps workState from
 * the worksite so the Grid + downstream agree.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}
interface Input {
  tenantId: string;
  entryId: string;
  worksiteId: string;
  worksiteName: string;
  worksiteAddress: Address;
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
  throw new HttpsError('permission-denied', 'Not authorized to edit timesheet entries');
}

export const setImportEntryWorksite = onCall<Input, Promise<{ ok: true; workState: string }>>(
  { enforceAppCheck: false, cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<{ ok: true; workState: string }> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, entryId, worksiteId, worksiteName, worksiteAddress } = req.data || ({} as Input);
    if (!tenantId || !entryId || !worksiteId) {
      throw new HttpsError('invalid-argument', 'tenantId, entryId, and worksiteId are required');
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
        'This row is live in Everee — void it before changing the worksite.',
      );
    }

    const addr: Address = {
      street: String(worksiteAddress?.street || ''),
      city: String(worksiteAddress?.city || ''),
      state: String(worksiteAddress?.state || ''),
      zip: String(worksiteAddress?.zip || ''),
    };
    const workState = addr.state || '';

    await entryRef.update({
      workState,
      'import.worksiteId': String(worksiteId),
      'import.worksiteName': String(worksiteName || worksiteId),
      'import.worksiteAddress': addr,
      'import.worksiteSource': 'manual',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    });

    return { ok: true, workState };
  },
);
