/**
 * **TS.1 Phase 4 Slice 6b — per-entry Cloud Task worker.**
 *
 * One task per `TimesheetEntryV2` in a `TimesheetBatch`. The worker:
 *
 *   1. Loads the entry, batch, and Everee config.
 *   2. Builds the `ComposeBatchInput` from the pre-resolved task payload
 *      + entry fields and calls `composeBatchEntryPayloads` (Slice 6a).
 *   3. Submits to Everee:
 *      - **W-2**: POST `/integration/v1/labor/timesheet/worked-shifts`
 *        (or PUT when `entry.everee.workedShiftId` already exists —
 *        idempotent retry path). Then POST each additional payable
 *        (tips, bonus, meal premium, rest premium) via `/api/v2/payables`.
 *      - **Contractor**: POST one payable via `/api/v2/payables`.
 *   4. Stamps the entry: `status='sent_to_everee'` on success or
 *      `status='error'` with `everee.errorCode` + `everee.errorMessage`.
 *      Also stamps `everee.workedShiftId` (W-2) and
 *      `everee.payableExternalIds[]` for the finalize step.
 *   5. Transactionally decrements `batch._orchestrator.pendingTaskCount`
 *      and — if this was the last task — claims the finalize lock and
 *      kicks the finalizer.
 *
 * **Why a single worker for both W-2 and contractor?** Same Firestore
 * reads, same idempotency stamps, same finalize handoff. The branch is
 * small (composer kind switch) and keeping them together avoids
 * doubling the task-queue surface for a marginal LOC win.
 *
 * **Retry semantics**: `onTaskDispatched({ retryConfig: { maxAttempts: 3 }})`
 * — Everee 5xxs are retried via `evereeRequest`'s internal backoff
 * (Slice 1), so the task-queue retry exists to catch the very rare
 * transport-layer failure or our own transient Firestore hiccups. The
 * worker is fully idempotent: worked-shifts via the stored
 * `workedShiftId` → PUT path, and payables via deterministic
 * `externalId` → Everee dedupes.
 */

import * as admin from 'firebase-admin';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import {
  buildPayableExternalId,
  createPayable,
} from '../integrations/everee/evereePayables';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import {
  createWorkedShift,
  updateWorkedShift,
} from '../integrations/everee/evereeWorkedShifts';

import {
  composeBatchEntryPayloads,
  type ComposeBatchInput,
} from './composeTimesheetBatchPayloads';
import { finalizeTimesheetBatch } from './finalizeTimesheetBatch';
import type { SubmitEntryTaskPayload } from './submitTimesheetBatch';

export const submitTimesheetEntryWorker = onTaskDispatched<SubmitEntryTaskPayload>(
  {
    retryConfig: { maxAttempts: 3 },
    rateLimits: { maxConcurrentDispatches: 5 },
    memory: '512MiB',
  },
  async (req) => {
    const payload = req.data;
    const { tenantId, hiringEntityId, batchId, entryId } = payload;
    const db = admin.firestore();
    const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const batchRef = db.doc(`tenants/${tenantId}/timesheet_batches/${batchId}`);

    // Always decrement on the way out — even on error — so the batch
    // can finalize. We track success/failure on the entry doc; the
    // counter is only about "did this task complete its lifecycle."
    let didDecrement = false;
    const decrementAndMaybeFinalize = async (): Promise<void> => {
      if (didDecrement) return;
      didDecrement = true;
      const claim = await db.runTransaction(async (txn) => {
        const fresh = await txn.get(batchRef);
        if (!fresh.exists) return null;
        const cur = fresh.data() as Record<string, unknown>;
        const orch = (cur._orchestrator as Record<string, unknown>) ?? {};
        const finalized = orch.finalized === true;
        const pending = Number(orch.pendingTaskCount ?? 0) - 1;
        txn.update(batchRef, {
          '_orchestrator.pendingTaskCount': pending,
          ...(pending <= 0 && !finalized
            ? { '_orchestrator.finalized': true }
            : {}),
        });
        return pending <= 0 && !finalized ? 'finalize-now' : null;
      });
      if (claim === 'finalize-now') {
        try {
          await finalizeTimesheetBatch(tenantId, batchId);
        } catch (e) {
          logger.error('[submitTimesheetEntryWorker] finalize threw', {
            tenantId,
            batchId,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };

    try {
      const [entrySnap, batchSnap, config] = await Promise.all([
        entryRef.get(),
        batchRef.get(),
        getEvereeConfigForEntity(tenantId, hiringEntityId),
      ]);
      if (!entrySnap.exists) {
        throw new Error(`Entry ${entryId} not found.`);
      }
      if (!batchSnap.exists) {
        throw new Error(`Batch ${batchId} not found.`);
      }
      if (!config) {
        throw new Error(`Entity ${hiringEntityId} is not Everee-enabled.`);
      }
      const entry = entrySnap.data() as Record<string, unknown>;
      const evereeState = (entry.everee as Record<string, unknown>) ?? {};
      const existingWorkedShiftId = numericOrUndef(evereeState.workedShiftId);

      // Build ComposeBatchInput from entry + payload
      const composeInput: ComposeBatchInput = {
        entry: {
          tenantId,
          assignmentId: String(entry.assignmentId ?? ''),
          workerId: String(entry.workerId ?? ''),
          workDate: String(entry.workDate ?? ''),
          payRate: Number(entry.payRate ?? 0),
          totalRegularHours: Number(entry.totalRegularHours ?? 0),
          totalFlsaOTHours: numericOrUndef(entry.totalFlsaOTHours),
          totalNonFlsaOTHours: numericOrUndef(entry.totalNonFlsaOTHours),
          totalDoubleTimeHours: Number(entry.totalDoubleTimeHours ?? 0),
          mealBreakPenaltyHours: Number(entry.mealBreakPenaltyHours ?? 0),
          restBreakPenaltyHours: Number(entry.restBreakPenaltyHours ?? 0),
          tips: Number(entry.tips ?? 0),
          bonusAmount: Number(entry.bonusAmount ?? 0),
        },
        workerKind: payload.workerKind,
        externalWorkerId: payload.externalWorkerId,
        evereeWorkLocationId: payload.evereeWorkLocationId,
        workersCompClassCode: payload.workersCompClassCode,
        shiftStartEpochSeconds: payload.shiftStartEpochSeconds,
        shiftEndEpochSeconds: payload.shiftEndEpochSeconds,
        breaks: payload.breaks,
        note: typeof entry.notes === 'string' ? entry.notes : undefined,
      };

      const composed = composeBatchEntryPayloads(composeInput);

      let workedShiftId: number | undefined;
      const payableExternalIds: string[] = [];

      if (composed.kind === 'w2') {
        // Decide whether to send `correction-authorized=true`. Everee locks
        // worked-shifts to closed pay periods; without the flag a retroactive
        // POST returns 400 "shift is included in a payment that is already
        // approved, submitted, or paid." (2026-06-05 Cheneana case). Two
        // signals trigger correction mode:
        //   1. The entry already failed with that exact error before (retry).
        //   2. The work date is older than ~10 days (defensive — covers
        //      weekly + bi-weekly tenants without needing per-tenant config).
        // For PUT (existing workedShiftId), Everee already requires the flag
        // when the underlying payment was paid — we pass it unconditionally
        // there too since false-positives are harmless.
        const priorErrMsg = String(evereeState.errorMessage || '').toLowerCase();
        const failedBeforeOnLock = priorErrMsg.includes('already approved, submitted, or paid');
        const workDateMs = Date.parse(String(entry.workDate || ''));
        const isRetro =
          Number.isFinite(workDateMs) &&
          Date.now() - workDateMs > 10 * 24 * 60 * 60 * 1000;
        const correctionAuthorized = failedBeforeOnLock || isRetro;

        // Idempotent: PUT if we already have a workedShiftId, otherwise POST.
        if (existingWorkedShiftId) {
          const r = await updateWorkedShift(config, existingWorkedShiftId, composed.workedShift, {
            correctionAuthorized,
          });
          workedShiftId = r.workedShiftId;
        } else {
          const r = await createWorkedShift(config, composed.workedShift, { correctionAuthorized });
          workedShiftId = r.workedShiftId;
        }
        // Additional payables (tips, bonus, meal/rest premium). Each
        // POST is idempotent on Everee's side via deterministic externalId.
        for (const p of composed.payables) {
          try {
            const r = await createPayable(config, p);
            payableExternalIds.push(r.externalId);
          } catch (e) {
            // A single payable failing doesn't fail the whole entry —
            // the worked-shift IS the wage line. Log + continue so
            // tips/bonus retries can happen via the adjustment path.
            logger.warn('[submitTimesheetEntryWorker] payable POST failed', {
              tenantId,
              entryId,
              externalId: p.externalId,
              payCode: p.payCode,
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else {
        // Contractor — one payable
        for (const p of composed.payables) {
          const r = await createPayable(config, p);
          payableExternalIds.push(r.externalId);
        }
      }

      const updates: Record<string, unknown> = {
        status: 'sent_to_everee',
        sentToEvereeAt: admin.firestore.FieldValue.serverTimestamp(),
        'everee.externalWorkerId': payload.externalWorkerId,
        'everee.status': 'SUBMITTED',
        'everee.errorCode': admin.firestore.FieldValue.delete(),
        'everee.errorMessage': admin.firestore.FieldValue.delete(),
        'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
        'everee.payableExternalIds': payableExternalIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (workedShiftId !== undefined) {
        updates['everee.workedShiftId'] = String(workedShiftId);
      }
      await entryRef.update(updates);

      logger.info('[submitTimesheetEntryWorker] ok', {
        tenantId,
        batchId,
        entryId,
        workerKind: payload.workerKind,
        workedShiftId,
        payableExternalIds: payableExternalIds.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[submitTimesheetEntryWorker] submission failed', {
        tenantId,
        batchId,
        entryId,
        err: message,
      });
      try {
        await entryRef.update({
          status: 'error',
          'everee.status': 'ERROR',
          'everee.errorCode': 'submission_failed',
          'everee.errorMessage': message,
          'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.warn('[submitTimesheetEntryWorker] failed to stamp error', {
          tenantId,
          entryId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      await decrementAndMaybeFinalize();
    }
  },
);

function numericOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Re-export the externalId helper so the adjustment worker can share
// the exact same pattern — small ergonomic win to avoid yet another
// import.
export { buildPayableExternalId };
