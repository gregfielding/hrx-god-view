/**
 * **TS.1 Phase 4 Slice 6b — submit-timesheet-batch orchestrator (top-level
 * callable + helpers).**
 *
 * `submitTimesheetBatch` is the entrypoint the recruiter UI calls to
 * push a `TimesheetBatch` (status='pending', `entryIds[]` materialized
 * upstream) into Everee. It:
 *
 *   1. Validates the caller can manage payroll for the tenant and that
 *      the batch is in `pending`.
 *   2. Loads each entry, runs the **pre-flight** (worker context,
 *      worksite TZ + epoch conversion, worked-shift workersComp class,
 *      Everee work-location id). Pre-flight failures stamp the entry
 *      as `error` with a reason and **don't** abort the batch — the
 *      "continue with partial batch" decision Greg locked in for 6b.
 *   3. Transactionally flips the batch to `submitting` and stamps the
 *      orchestrator counter (`_orchestrator.totalTasks` =
 *      `_orchestrator.pendingTaskCount` = entries that passed pre-flight).
 *   4. Enqueues one Cloud Task per pre-flighted entry pointing at
 *      `submitTimesheetEntryWorker` (Firebase v2 `onTaskDispatched`).
 *      Each task carries the pre-resolved context so the worker doesn't
 *      need to re-do the Firestore lookups.
 *   5. If zero entries passed pre-flight, the batch is immediately
 *      finalized as `failed` (with `_orchestrator.finalized=true`) so
 *      the UI doesn't show a spinner forever.
 *
 * **Idempotency**: re-invoking on a batch already in `submitting`
 * status throws `HttpsError('failed-precondition')`. Re-invoking after
 * terminal status (`success` / `partial` / `failed`) likewise throws —
 * a separate "retry batch" surface (not in this slice) would be the
 * right path for retries.
 *
 * **What's intentionally NOT in this file**: the per-entry HTTP work
 * (that's `submitTimesheetEntryWorker.ts`), the finalize logic (that's
 * `finalizeTimesheetBatch.ts`), and the adjustment surface (that's
 * `submitTimesheetAdjustment.ts`). Keeping them separated matches the
 * dispatch boundaries — easier to reason about, easier to test.
 */

import * as admin from 'firebase-admin';
import { getFunctions as getAdminFunctions } from 'firebase-admin/functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import {
  buildPayableExternalId,
  type EvereePayableExternalIdKind,
} from '../integrations/everee/evereePayables';
import { ensureEvereeWorkLocation } from '../integrations/everee/evereeWorkLocations';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { canManageEveree } from '../integrations/everee/evereeAccessGate';

import { finalizeTimesheetBatch } from './finalizeTimesheetBatch';
import {
  resolveExternalWorkerId,
  resolveWorksiteTz,
  workToEpochSeconds,
  workerKindFromEntityWorkerType,
} from './workerContextResolver';
import type { ComposeBreak } from './composeTimesheetBatchPayloads';

// ─────────────────────────────────────────────────────────────────────
// Task payload shape — what the worker receives in `taskRequest.data`
// ─────────────────────────────────────────────────────────────────────

/**
 * Pre-resolved per-entry context the orchestrator hands off to the
 * worker. The worker does NOT re-resolve any of this; everything that
 * needs a Firestore read is done once at enqueue time. This shrinks
 * the per-task hot path to: load entry → load batch + config → compose
 * → call Everee → stamp status.
 */
export interface SubmitEntryTaskPayload {
  tenantId: string;
  hiringEntityId: string;
  batchId: string;
  entryId: string;

  // Pre-resolved Everee context
  workerKind: 'w2' | 'contractor';
  externalWorkerId: string;
  evereeWorkLocationId: number;
  workersCompClassCode?: string;

  // Pre-resolved time math
  shiftStartEpochSeconds: number;
  shiftEndEpochSeconds: number;
  breaks: ComposeBreak[];
  worksiteTz: string;
}

// ─────────────────────────────────────────────────────────────────────
// Input / output shapes
// ─────────────────────────────────────────────────────────────────────

interface SubmitTimesheetBatchInput {
  tenantId: string;
  batchId: string;
}

interface SubmitTimesheetBatchResult {
  batchId: string;
  enqueuedEntryCount: number;
  preflightErrorCount: number;
  status: 'submitting' | 'failed';
}

// ─────────────────────────────────────────────────────────────────────
// Callable
// ─────────────────────────────────────────────────────────────────────

export const submitTimesheetBatch = onCall<SubmitTimesheetBatchInput>(
  { memory: '512MiB' },
  async (request): Promise<SubmitTimesheetBatchResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }
    const { tenantId, batchId } = request.data ?? ({} as SubmitTimesheetBatchInput);
    if (!tenantId || !batchId) {
      throw new HttpsError('invalid-argument', 'tenantId and batchId required.');
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to submit timesheet batches for this tenant.');
    }

    const db = admin.firestore();
    const batchRef = db.doc(`tenants/${tenantId}/timesheet_batches/${batchId}`);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      throw new HttpsError('not-found', `Batch ${batchId} not found.`);
    }
    const batch = batchSnap.data() as Record<string, unknown>;
    const status = batch.status as string;
    if (status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `Batch ${batchId} is in status '${status}', not 'pending' — cannot submit.`,
      );
    }
    const hiringEntityId = String(batch.hiringEntityId ?? '').trim();
    if (!hiringEntityId) {
      throw new HttpsError('failed-precondition', 'Batch is missing hiringEntityId.');
    }
    const entryIds = Array.isArray(batch.entryIds) ? (batch.entryIds as string[]) : [];
    if (entryIds.length === 0) {
      throw new HttpsError('failed-precondition', 'Batch has no entryIds.');
    }

    const config = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!config) {
      throw new HttpsError(
        'failed-precondition',
        `Hiring entity ${hiringEntityId} is not Everee-enabled.`,
      );
    }

    // Pre-flight pass: resolve per-entry context. Mark non-fatal misses
    // as `error` so the batch can continue with the entries that DO work.
    const tasks: SubmitEntryTaskPayload[] = [];
    const preflightErrors: Array<{ entryId: string; code: string; message: string }> = [];
    const workLocationCache = new Map<string, number>(); // worksiteId → workLocationId

    // Single JO lookup per assignment — most batches share JOs across entries.
    const joCache = new Map<string, Record<string, unknown>>();
    // workerType cache per entity — there's typically one per batch, but be
    // robust if a future scope crosses entities.
    let entityWorkerType: string | undefined;
    try {
      const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
      entityWorkerType = String(entitySnap.data()?.workerType ?? '').trim() || undefined;
    } catch (e) {
      logger.warn('[submitTimesheetBatch] could not load entity workerType', {
        tenantId,
        hiringEntityId,
        err: e instanceof Error ? e.message : String(e),
      });
    }

    for (const entryId of entryIds) {
      const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
      const entrySnap = await entryRef.get();
      if (!entrySnap.exists) {
        preflightErrors.push({
          entryId,
          code: 'entry_missing',
          message: 'Timesheet entry doc not found.',
        });
        continue;
      }
      const entry = entrySnap.data() as Record<string, unknown>;
      const entryStatus = String(entry.status ?? '');
      if (entryStatus !== 'approved') {
        // Stamp the entry itself so the UI shows the reason.
        await stampEntryPreflightError(entryRef, 'entry_not_approved', `Entry status '${entryStatus}' — only 'approved' entries can be submitted.`);
        preflightErrors.push({
          entryId,
          code: 'entry_not_approved',
          message: `Entry status is '${entryStatus}'.`,
        });
        continue;
      }
      const workerId = String(entry.workerId ?? '');
      const assignmentId = String(entry.assignmentId ?? '');
      const jobOrderId = String(entry.jobOrderId ?? '');
      const workDate = String(entry.workDate ?? '');
      const workState = String(entry.workState ?? '');
      const scheduledStart = String(entry.actualStartTime ?? entry.scheduledStartTime ?? '');
      const scheduledEnd = String(entry.actualEndTime ?? entry.scheduledEndTime ?? '');

      // JO read (cached). The JO lives at one of three paths — same
      // fallback order as the R.4.2 backfill (job_orders → jobOrders →
      // recruiter_jobOrders).
      let jo = joCache.get(jobOrderId);
      if (!jo && jobOrderId) {
        for (const path of [
          `tenants/${tenantId}/job_orders/${jobOrderId}`,
          `tenants/${tenantId}/jobOrders/${jobOrderId}`,
          `tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`,
        ]) {
          try {
            const joSnap = await db.doc(path).get();
            if (joSnap.exists) {
              jo = joSnap.data() as Record<string, unknown>;
              joCache.set(jobOrderId, jo);
              break;
            }
          } catch {
            // Walk the next candidate.
          }
        }
      }
      const worksiteId = String((jo?.worksiteId as string) ?? '').trim();
      const worksiteName = String((jo?.worksiteName as string) ?? worksiteId).trim();
      const worksiteAddress = (jo?.worksiteAddress as Record<string, unknown>) ?? {};
      const worksiteState = String(worksiteAddress.state ?? '').trim();
      const workersCompClassCode = String((jo?.workersCompCode as string) ?? '').trim() || undefined;

      // Pre-flight #1: externalWorkerId via linkage fallback
      let externalWorkerId: string | null = null;
      try {
        externalWorkerId = await resolveExternalWorkerId(tenantId, workerId, config.evereeTenantId);
      } catch (e) {
        externalWorkerId = null;
      }
      if (!externalWorkerId) {
        await stampEntryPreflightError(
          entryRef,
          'missing_everee_worker_id',
          `Worker ${workerId} has no Everee linkage for tenant ${config.evereeTenantId}.`,
        );
        preflightErrors.push({
          entryId,
          code: 'missing_everee_worker_id',
          message: `No Everee worker for tenant ${config.evereeTenantId}.`,
        });
        continue;
      }

      // Pre-flight #2: work-location id (cached per worksite)
      if (!worksiteId) {
        await stampEntryPreflightError(entryRef, 'missing_worksite', 'JO has no worksiteId.');
        preflightErrors.push({
          entryId,
          code: 'missing_worksite',
          message: 'Job order has no worksiteId.',
        });
        continue;
      }
      let evereeWorkLocationId = workLocationCache.get(worksiteId);
      if (!evereeWorkLocationId) {
        try {
          evereeWorkLocationId = await ensureEvereeWorkLocation(tenantId, config, {
            worksiteId,
            name: worksiteName || worksiteId,
            address: {
              street: String(worksiteAddress.street ?? '') || undefined,
              city: String(worksiteAddress.city ?? '') || undefined,
              state: worksiteState || undefined,
              zip: String(worksiteAddress.zip ?? '') || undefined,
            },
          });
          workLocationCache.set(worksiteId, evereeWorkLocationId);
        } catch (e) {
          await stampEntryPreflightError(
            entryRef,
            'work_location_provision_failed',
            e instanceof Error ? e.message : String(e),
          );
          preflightErrors.push({
            entryId,
            code: 'work_location_provision_failed',
            message: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
      }

      // Pre-flight #3: workerKind + workersComp class (W-2 requires class)
      const workerKind = workerKindFromEntityWorkerType(entityWorkerType);
      if (workerKind === 'w2' && !workersCompClassCode) {
        await stampEntryPreflightError(
          entryRef,
          'missing_workers_comp_code',
          'W-2 entries require a workersCompCode on the job order.',
        );
        preflightErrors.push({
          entryId,
          code: 'missing_workers_comp_code',
          message: 'No workersCompCode on the job order.',
        });
        continue;
      }

      // Pre-flight #4: epoch conversion
      const worksiteTz = resolveWorksiteTz(workState, worksiteState);
      let shiftStartEpochSeconds: number;
      let shiftEndEpochSeconds: number;
      try {
        shiftStartEpochSeconds = workToEpochSeconds(workDate, scheduledStart, worksiteTz);
        shiftEndEpochSeconds = workToEpochSeconds(workDate, scheduledEnd, worksiteTz);
      } catch (e) {
        await stampEntryPreflightError(
          entryRef,
          'bad_time_inputs',
          e instanceof Error ? e.message : String(e),
        );
        preflightErrors.push({
          entryId,
          code: 'bad_time_inputs',
          message: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      // If the entry crosses midnight, end < start; bump end by 24h.
      if (shiftEndEpochSeconds <= shiftStartEpochSeconds) {
        shiftEndEpochSeconds += 24 * 3600;
      }

      // Breaks → epoch
      const breaks: ComposeBreak[] = [];
      const rawBreaks = Array.isArray(entry.breaks) ? (entry.breaks as Array<Record<string, unknown>>) : [];
      for (const b of rawBreaks) {
        const bStart = String(b.startTime ?? '');
        const bEnd = String(b.endTime ?? '');
        const paid = b.paid === true;
        if (!bStart || !bEnd) continue;
        try {
          let bs = workToEpochSeconds(workDate, bStart, worksiteTz);
          let be = workToEpochSeconds(workDate, bEnd, worksiteTz);
          if (be <= bs) be += 24 * 3600;
          if (be > bs) {
            breaks.push({ startEpochSeconds: bs, endEpochSeconds: be, paid });
          }
        } catch {
          // Skip malformed breaks — they're surfaced on the entry's
          // breaks array if a recruiter needs to fix.
        }
      }

      tasks.push({
        tenantId,
        hiringEntityId,
        batchId,
        entryId,
        workerKind,
        externalWorkerId,
        evereeWorkLocationId,
        workersCompClassCode,
        shiftStartEpochSeconds,
        shiftEndEpochSeconds,
        breaks,
        worksiteTz,
      });
    }

    const totalTasks = tasks.length;

    // Transactionally flip batch → submitting + stamp counters
    await db.runTransaction(async (txn) => {
      const fresh = await txn.get(batchRef);
      if (!fresh.exists) {
        throw new HttpsError('not-found', `Batch ${batchId} disappeared mid-flight.`);
      }
      const cur = fresh.data() as Record<string, unknown>;
      if (cur.status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          `Batch ${batchId} status changed mid-flight to '${cur.status}'.`,
        );
      }
      txn.update(batchRef, {
        status: totalTasks > 0 ? 'submitting' : 'failed',
        _orchestrator: {
          totalTasks,
          pendingTaskCount: totalTasks,
          finalized: totalTasks === 0,
          preflightErrors,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(totalTasks === 0
          ? {
              everee: {
                ...((cur.everee as Record<string, unknown>) ?? {}),
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                errorSummary: 'All entries failed pre-flight.',
              },
            }
          : {}),
      });
    });

    if (totalTasks === 0) {
      logger.warn('[submitTimesheetBatch] all entries failed pre-flight', {
        tenantId,
        batchId,
        preflightErrorCount: preflightErrors.length,
      });
      return {
        batchId,
        enqueuedEntryCount: 0,
        preflightErrorCount: preflightErrors.length,
        status: 'failed',
      };
    }

    // Enqueue one task per entry. Tasks may not all enqueue cleanly
    // (rare), so we decrement on any local enqueue failure so the
    // finalizer doesn't deadlock waiting.
    const queue = getAdminFunctions().taskQueue('submitTimesheetEntryWorker');
    let enqueueFailures = 0;
    for (const t of tasks) {
      try {
        await queue.enqueue(t);
      } catch (e) {
        enqueueFailures++;
        logger.error('[submitTimesheetBatch] enqueue failed', {
          tenantId,
          batchId,
          entryId: t.entryId,
          err: e instanceof Error ? e.message : String(e),
        });
        // Stamp the entry as errored so the UI surfaces it.
        const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${t.entryId}`);
        await stampEntryPreflightError(
          entryRef,
          'task_enqueue_failed',
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    if (enqueueFailures > 0) {
      // Decrement pendingTaskCount by the number that didn't enqueue —
      // the worker only decrements on actual dispatch. If a finalize is
      // triggered (i.e. enqueueFailures == totalTasks), finalize inline.
      const claim = await db.runTransaction(async (txn) => {
        const fresh = await txn.get(batchRef);
        if (!fresh.exists) return null;
        const cur = fresh.data() as Record<string, unknown>;
        const orch = (cur._orchestrator as Record<string, unknown>) ?? {};
        const pending = Number(orch.pendingTaskCount ?? 0) - enqueueFailures;
        const finalized = orch.finalized === true;
        txn.update(batchRef, {
          '_orchestrator.pendingTaskCount': pending,
          ...(pending <= 0 && !finalized
            ? { '_orchestrator.finalized': true }
            : {}),
        });
        return pending <= 0 && !finalized ? 'finalize-now' : null;
      });
      if (claim === 'finalize-now') {
        await finalizeTimesheetBatch(tenantId, batchId);
      }
    }

    return {
      batchId,
      enqueuedEntryCount: totalTasks - enqueueFailures,
      preflightErrorCount: preflightErrors.length + enqueueFailures,
      status: totalTasks - enqueueFailures > 0 ? 'submitting' : 'failed',
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function stampEntryPreflightError(
  entryRef: admin.firestore.DocumentReference,
  code: string,
  message: string,
): Promise<void> {
  try {
    await entryRef.update({
      status: 'error',
      'everee.errorCode': code,
      'everee.errorMessage': message,
      'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('[submitTimesheetBatch] failed to stamp entry error', {
      entryPath: entryRef.path,
      code,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Re-export for the worker to mirror the payable externalId convention
 * without yet another import path. Avoids drift between the orchestrator
 * and worker if the convention ever changes.
 */
export function makePayableExternalId(args: {
  tenantId: string;
  assignmentId: string;
  workDate: string;
  kind: EvereePayableExternalIdKind;
}): string {
  return buildPayableExternalId(args);
}
