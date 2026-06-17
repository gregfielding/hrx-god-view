/**
 * setImportEntryHours — edit the actual hours on a CSV-import timesheet entry
 * from the Timesheet Grid.
 *
 * Why a callable (the regular grid edits hours via a client write): import
 * rows read `totalRegularHours` for display/Total and submit on
 * `actualHoursOverride ?? totalRegularHours`. Those MUST move together, but the
 * Firestore-rules client allowlist only permits `actualHoursOverride` — so a
 * client write would desync them (and a cleared override would silently fall
 * back to the original hours at submit). This sets BOTH in lockstep.
 *
 * Use case: a recruiter already paid an advance for some days, so they zero out
 * those rows' hours — the row stays in HRX as a $0 record and is skipped at
 * submit (the Everee path skips any row with hours ≤ 0).
 *
 * Straight-time only (OT/DT stay 0; Everee classifies). Refuses rows already
 * live in Everee (submitted/paid). Same recruiter-band gate as the rest of the
 * timesheet-edit surface.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
  /** Decimal hours ≥ 0. 0 zeroes the row (skipped at submit). */
  hours: number;
}

/** A single import "day" can sum multiple shifts (saveImportTimesheetRows sums
 *  duplicate worker+day rows), so allow generous headroom; anything past a week
 *  is almost certainly a typo. */
const MAX_HOURS = 168;

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

export const setImportEntryHours = onCall<Input, Promise<{ ok: true; hours: number }>>(
  { enforceAppCheck: false, cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (req): Promise<{ ok: true; hours: number }> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, entryId, hours } = req.data || ({} as Input);
    if (!tenantId || !entryId) {
      throw new HttpsError('invalid-argument', 'tenantId and entryId are required');
    }
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0 || h > MAX_HOURS) {
      throw new HttpsError('invalid-argument', `hours must be a number between 0 and ${MAX_HOURS}`);
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
        'This row is live in Everee — void it before changing hours.',
      );
    }

    // Round to 2 decimals; keep override + straight-time total in lockstep.
    const rounded = Math.round(h * 100) / 100;
    await entryRef.update({
      actualHoursOverride: rounded,
      totalRegularHours: rounded,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    });

    return { ok: true, hours: rounded };
  },
);
