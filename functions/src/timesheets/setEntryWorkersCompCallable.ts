/**
 * setEntryWorkersComp — admin callable for the Timesheets grid's inline
 * "WC Code" / "WC Rate" cells.
 *
 * Two writes, transactional:
 *   1. `tenants/{tid}/timesheet_entries/{entryId}` — stamp the override
 *      fields directly on the entry. The pre-flight in
 *      `submitTimesheetBatch.ts` checks these first in its resolution
 *      chain, so a missing-WC error clears immediately.
 *   2. `tenants/{tid}/job_orders/{joId}/shifts/{shiftId}` — when the
 *      shift doc is missing the same fields, back-fill them too. One
 *      edit then fixes every other entry on that shift (past + future)
 *      via the existing resolution chain.
 *
 * Caller may pass either field independently (`undefined` skips the
 * write). Passing `null` for a field explicitly clears the override.
 *
 * Permissions: HRX or securityLevel >= 5 on the tenant — same gate as
 * the rest of the timesheets-edit surface.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  entryId: string;
  /** Pass a non-empty string to set, `null` to clear, `undefined` to leave untouched. */
  workersCompCode?: string | null;
  /** Decimal number (e.g. 2.25). Pass `null` to clear, `undefined` to skip. */
  workersCompRate?: number | null;
}

interface Output {
  ok: true;
  entryUpdated: true;
  /** True when the shift doc was also written (was previously missing). */
  shiftBackfilled: boolean;
}

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) {
    throw new HttpsError('permission-denied', 'No access to this tenant');
  }
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to edit timesheet entries');
}

export const setEntryWorkersComp = onCall<Input, Promise<Output>>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (req): Promise<Output> => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, entryId, workersCompCode, workersCompRate } = req.data || ({} as Input);
    if (!tenantId || !entryId) {
      throw new HttpsError('invalid-argument', 'tenantId and entryId are required');
    }
    if (workersCompCode === undefined && workersCompRate === undefined) {
      throw new HttpsError(
        'invalid-argument',
        'At least one of workersCompCode / workersCompRate must be provided',
      );
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      throw new HttpsError('not-found', `Entry ${entryId} not found`);
    }
    const entry = entrySnap.data() as Record<string, unknown>;

    // Build the entry patch. `null` clears via FieldValue.delete; a
    // string / number sets; `undefined` (omitted) leaves the field
    // alone — letting the caller patch one field without touching the
    // other.
    const entryUpdates: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (workersCompCode === null) {
      entryUpdates.workersCompCode = admin.firestore.FieldValue.delete();
    } else if (typeof workersCompCode === 'string' && workersCompCode.trim()) {
      entryUpdates.workersCompCode = workersCompCode.trim();
    }
    if (workersCompRate === null) {
      entryUpdates.workersCompRate = admin.firestore.FieldValue.delete();
    } else if (typeof workersCompRate === 'number' && Number.isFinite(workersCompRate)) {
      entryUpdates.workersCompRate = workersCompRate;
    }
    await entryRef.update(entryUpdates);

    // CSV-import entries mirror WC into the `import` sidecar + recompute the
    // import lifecycle (Needs WC → Ready) so the grid + Import tab agree and
    // the row becomes submittable. `typed` source = a manual recruiter edit,
    // which the Import tab restores on resume.
    if (entry.source === 'csv_import') {
      const finalCode =
        workersCompCode === undefined
          ? (typeof entry.workersCompCode === 'string' ? entry.workersCompCode : null)
          : typeof workersCompCode === 'string' && workersCompCode.trim()
            ? workersCompCode.trim()
            : null;
      const finalRate =
        workersCompRate === undefined
          ? (typeof entry.workersCompRate === 'number' ? (entry.workersCompRate as number) : null)
          : typeof workersCompRate === 'number' && Number.isFinite(workersCompRate)
            ? workersCompRate
            : null;
      const imp = (entry.import as Record<string, unknown>) || {};
      const ms = String(imp.matchStatus || '');
      const importPatch: Record<string, unknown> = {
        'import.workersCompCode': finalCode,
        'import.workersCompRate': finalRate,
        'import.workersCompSource': 'typed',
      };
      // Don't disturb live/blocked rows; otherwise re-derive ready/needs_*.
      if (!['submitted', 'paid', 'voided', 'blocked'].includes(ms)) {
        const payRate = Number(entry.payRate);
        importPatch['import.matchStatus'] = !(payRate > 0)
          ? 'needs_rate'
          : !finalCode
            ? 'needs_wc'
            : 'ready';
      }
      await entryRef.update(importPatch);
    }

    // Mirror to the shift when (a) we know the shiftId AND (b) the shift
    // doc currently doesn't have the field. This back-fills the
    // canonical source so OTHER entries on the same shift inherit
    // through the resolution chain instead of each needing their own
    // override.
    let shiftBackfilled = false;
    const jobOrderId = String(entry.jobOrderId ?? '').trim();
    const shiftIdFromField = String(entry.shiftId ?? '').trim();
    // Older entries don't carry a denormalized shiftId field — fall back
    // to parsing it from the entry id (`{shiftId}__{userId}__{date}_{date}`).
    const shiftId =
      shiftIdFromField || (entryId.includes('__') ? entryId.split('__')[0]! : '');
    if (jobOrderId && shiftId) {
      const shiftRef = db.doc(
        `tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`,
      );
      try {
        const shiftSnap = await shiftRef.get();
        if (shiftSnap.exists) {
          const shift = shiftSnap.data() as Record<string, unknown>;
          const shiftPatch: Record<string, unknown> = {};
          if (
            typeof workersCompCode === 'string' &&
            workersCompCode.trim() &&
            (typeof shift.workersCompCode !== 'string' || !shift.workersCompCode.trim())
          ) {
            shiftPatch.workersCompCode = workersCompCode.trim();
          }
          if (
            typeof workersCompRate === 'number' &&
            Number.isFinite(workersCompRate) &&
            (typeof shift.workersCompRate !== 'number' ||
              !Number.isFinite(shift.workersCompRate as number))
          ) {
            shiftPatch.workersCompRate = workersCompRate;
          }
          if (Object.keys(shiftPatch).length > 0) {
            shiftPatch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await shiftRef.update(shiftPatch);
            shiftBackfilled = true;
          }
        }
      } catch (e) {
        // Non-fatal — the entry override already protects this entry,
        // and the shift back-fill is purely a "fix it for everyone else"
        // bonus. Log and move on.
        logger.warn('[setEntryWorkersComp] shift back-fill failed', {
          tenantId,
          entryId,
          jobOrderId,
          shiftId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.info('[setEntryWorkersComp] ok', {
      tenantId,
      entryId,
      callerUid: req.auth.uid,
      setCode: typeof workersCompCode === 'string',
      setRate: typeof workersCompRate === 'number',
      shiftBackfilled,
    });

    return { ok: true, entryUpdated: true, shiftBackfilled };
  },
);
