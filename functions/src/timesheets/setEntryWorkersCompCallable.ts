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
import { normalizeUsStateCode } from '../recruiter/usStateNormalize';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** 8040 is the tenant's placeholder code for "carrier code/rate pending" —
 *  the WC monthly report synthesizes it at $2.35 for every state, so the
 *  entry-level resolution falls back to the same rate when the matrix has
 *  no explicit row. Keeps payroll moving in a not-yet-rated state. */
const PLACEHOLDER_8040_RATE = 2.35;

/** Resolve the internal WC rate for a state + code from the rate matrix
 *  (highest rate wins on a dup). Returns null when the pair isn't rated. */
async function resolveMatrixRate(
  tenantId: string,
  state: string | null,
  code: string,
): Promise<number | null> {
  if (!code) return null;
  // No resolvable state: 8040 still gets its synthetic placeholder rate so
  // the row can price and become Ready; real codes need a state.
  if (!state) return code === '8040' ? PLACEHOLDER_8040_RATE : null;
  const snap = await db
    .collection(`tenants/${tenantId}/workers_comp_rates`)
    .where('state', '==', state)
    .where('code', '==', code)
    .get();
  let rate: number | null = null;
  snap.forEach((d) => {
    const r = Number((d.data() || {}).rate);
    if (Number.isFinite(r)) rate = rate == null ? r : Math.max(rate, r);
  });
  if (rate == null && code === '8040') return PLACEHOLDER_8040_RATE;
  return rate;
}

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
    // Dialog-picked work state for rows that can't resolve one (traveling
    // crews — the assignment has no fixed worksite state, Greg 2026-08-05).
    // Used for the matrix rate lookup and stamped on the entry when its own
    // workState is empty, so downstream WC reporting gets the state too.
    const pickedWorkState = String(
      (req.data as unknown as Record<string, unknown> | undefined)?.workState ?? '',
    )
      .trim()
      .toUpperCase();
    if (pickedWorkState && !/^[A-Z]{2}$/.test(pickedWorkState)) {
      throw new HttpsError('invalid-argument', 'workState must be a 2-letter state code.');
    }
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
    // When a code is set but NO explicit rate is passed, resolve the rate
    // from the WC matrix by the entry's worksite state + code. The grid's
    // WC dialog now asks for the code only — the (internal, not-sent-to-
    // Everee) rate is looked up here (Greg 2026-07-30).
    let matrixRate: number | null = null;
    if (typeof workersCompCode === 'string' && workersCompCode.trim() && workersCompRate === undefined) {
      // Import rows keep the worksite state in the `import` sidecar; top-level
      // `workState` / `worksiteAddress` can be empty (esp. after a re-resolve
      // that had no assignment address), so fall back to it — otherwise the
      // rate can't be looked up and the row is stuck at "Needs WC".
      const impAddr = (entry.import as Record<string, unknown> | undefined)?.worksiteAddress as
        | Record<string, unknown>
        | undefined;
      const state = normalizeUsStateCode(
        String(
          entry.workState ||
            (entry.worksiteAddress as Record<string, unknown> | undefined)?.state ||
            impAddr?.state ||
            pickedWorkState ||
            '',
        ),
      );
      matrixRate = await resolveMatrixRate(tenantId, state, workersCompCode.trim());
    }

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
    } else if (matrixRate != null) {
      entryUpdates.workersCompRate = matrixRate;
    }
    // Stamp the dialog-picked state only when the entry has none of its own —
    // a resolved worksite state always wins over a manual pick.
    if (pickedWorkState && !String(entry.workState ?? '').trim()) {
      entryUpdates.workState = pickedWorkState;
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
          ? matrixRate != null
            ? matrixRate
            : (typeof entry.workersCompRate === 'number' ? (entry.workersCompRate as number) : null)
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
      // W-2 rows need BOTH the class code AND a resolved rate to be ready —
      // a code with no rate (state unresolved, e.g. traveling crews) leaves
      // the WC report hollow (Greg 2026-08-05). 1099 rows never require WC.
      if (!['submitted', 'paid', 'voided', 'blocked'].includes(ms)) {
        const hiringEntityId = String(entry.hiringEntityId || '').trim();
        let is1099 = false;
        if (hiringEntityId) {
          const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
          is1099 = String((entitySnap.data() || {}).workerType || '').trim() === '1099';
        }
        const payRate = Number(entry.payRate);
        // Assignment-as-truth gate: W-2 rows need a real assignment too.
        const hasAsn = Boolean(String(entry.assignmentId ?? '').trim());
        importPatch['import.matchStatus'] =
          !is1099 && !hasAsn
            ? 'needs_assignment'
            : !(payRate > 0)
              ? 'needs_rate'
              : !is1099 && (!finalCode || finalRate == null)
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
