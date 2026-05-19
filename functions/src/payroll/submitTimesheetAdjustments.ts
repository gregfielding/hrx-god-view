/**
 * **TS.1 Phase 4 Slice 6b — adjustment submission (callable + worker).**
 *
 * `TimesheetAdjustment` is the post-pay correction surface. It rides
 * Everee's **Payables** API exclusively — worked-shifts get locked
 * after the pay run is paid, so a wages-up correction can't go through
 * the Timesheets API. Instead, every adjustment is one payable per
 * delta type:
 *
 *   - `hoursDelta.regular` × `entry.payRate` → REGULAR_HOURLY payable
 *     (positive or negative dollar adjustment)
 *   - `hoursDelta.ot` × `entry.payRate × 1.5` → OVERTIME_HOURLY payable
 *   - `hoursDelta.doubleTime` × `entry.payRate × 2` → DOUBLE_TIME_HOURLY
 *   - `amountDelta.tips` → TIPS payable
 *   - `amountDelta.bonus` → BONUS payable
 *   - `amountDelta.penalty` → MEAL_PREMIUM payable (we use meal for
 *     generic penalties — the §226.7 use case is what drove this)
 *
 * Each payable carries a deterministic `externalId` of
 * `{tenantId}::{adjustmentId}::{KIND}` so re-running is idempotent.
 *
 * **Shape mirrors the batch surface** — same callable+task-queue
 * pattern, smaller because there's no worked-shift step and the
 * pre-flight is lighter. Re-uses `resolveExternalWorkerId` from the
 * worker-context resolver.
 *
 * **What this slice doesn't cover**: rolling adjustments into a batch
 * (`appliedBatchId` is set by future code), or the recruiter UI to
 * approve and submit. Today this callable accepts approved adjustments
 * directly by id.
 */

import * as admin from 'firebase-admin';
import { getFunctions as getAdminFunctions } from 'firebase-admin/functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { canManageEveree } from '../integrations/everee/evereeAccessGate';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import {
  buildAdjustmentExternalId,
  createPayable,
  requestPayablePayout,
  type CreatePayableInput,
  type EvereeEarningType,
} from '../integrations/everee/evereePayables';

import { resolveExternalWorkerId } from './workerContextResolver';

// ─────────────────────────────────────────────────────────────────────
// Task payload
// ─────────────────────────────────────────────────────────────────────

interface SubmitAdjustmentTaskPayload {
  tenantId: string;
  adjustmentId: string;
  hiringEntityId: string;
  externalWorkerId: string;
}

// ─────────────────────────────────────────────────────────────────────
// Callable
// ─────────────────────────────────────────────────────────────────────

interface SubmitTimesheetAdjustmentInput {
  tenantId: string;
  adjustmentId: string;
}

interface SubmitTimesheetAdjustmentResult {
  adjustmentId: string;
  status: 'submitting' | 'failed';
  errorCode?: string;
  errorMessage?: string;
}

export const submitTimesheetAdjustment = onCall<SubmitTimesheetAdjustmentInput>(
  { memory: '512MiB' },
  async (request): Promise<SubmitTimesheetAdjustmentResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }
    const { tenantId, adjustmentId } = request.data ?? ({} as SubmitTimesheetAdjustmentInput);
    if (!tenantId || !adjustmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and adjustmentId required.');
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to submit adjustments for this tenant.');
    }

    const db = admin.firestore();
    const adjRef = db.doc(`tenants/${tenantId}/timesheet_adjustments/${adjustmentId}`);
    const adjSnap = await adjRef.get();
    if (!adjSnap.exists) {
      throw new HttpsError('not-found', `Adjustment ${adjustmentId} not found.`);
    }
    const adj = adjSnap.data() as Record<string, unknown>;
    const status = String(adj.status ?? '');
    if (status !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        `Adjustment ${adjustmentId} is in status '${status}', not 'approved'.`,
      );
    }
    const hiringEntityId = String(adj.hiringEntityId ?? '').trim();
    const workerId = String(adj.workerId ?? '').trim();
    if (!hiringEntityId || !workerId) {
      throw new HttpsError(
        'failed-precondition',
        'Adjustment is missing hiringEntityId or workerId.',
      );
    }

    const config = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!config) {
      throw new HttpsError(
        'failed-precondition',
        `Hiring entity ${hiringEntityId} is not Everee-enabled.`,
      );
    }
    const externalWorkerId = await resolveExternalWorkerId(tenantId, workerId, config.evereeTenantId);
    if (!externalWorkerId) {
      // Mark the adjustment as errored — same pattern as batch pre-flight.
      await adjRef.update({
        status: 'error',
        'everee.error': `Worker ${workerId} has no Everee linkage for tenant ${config.evereeTenantId}.`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        adjustmentId,
        status: 'failed',
        errorCode: 'missing_everee_worker_id',
        errorMessage: `Worker ${workerId} has no Everee linkage.`,
      };
    }

    // Flip status optimistically — same shape as the entry path.
    await adjRef.update({
      status: 'sent_to_everee',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await getAdminFunctions()
      .taskQueue('submitTimesheetAdjustmentWorker')
      .enqueue({
        tenantId,
        adjustmentId,
        hiringEntityId,
        externalWorkerId,
      } as SubmitAdjustmentTaskPayload);

    return { adjustmentId, status: 'submitting' };
  },
);

// ─────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────

export const submitTimesheetAdjustmentWorker = onTaskDispatched<SubmitAdjustmentTaskPayload>(
  {
    retryConfig: { maxAttempts: 3 },
    rateLimits: { maxConcurrentDispatches: 5 },
    memory: '512MiB',
  },
  async (req) => {
    const { tenantId, adjustmentId, hiringEntityId, externalWorkerId } = req.data;
    const db = admin.firestore();
    const adjRef = db.doc(`tenants/${tenantId}/timesheet_adjustments/${adjustmentId}`);

    try {
      const [adjSnap, config] = await Promise.all([
        adjRef.get(),
        getEvereeConfigForEntity(tenantId, hiringEntityId),
      ]);
      if (!adjSnap.exists) throw new Error(`Adjustment ${adjustmentId} not found.`);
      if (!config) throw new Error(`Entity ${hiringEntityId} not Everee-enabled.`);

      const adj = adjSnap.data() as Record<string, unknown>;
      const originalEntryId = String(adj.originalEntryId ?? '').trim();
      if (!originalEntryId) throw new Error('Adjustment missing originalEntryId.');

      const entrySnap = await db.doc(`tenants/${tenantId}/timesheet_entries/${originalEntryId}`).get();
      if (!entrySnap.exists) throw new Error(`Original entry ${originalEntryId} not found.`);
      const entry = entrySnap.data() as Record<string, unknown>;
      const payRate = Number(entry.payRate ?? 0);
      const workDate = String(entry.workDate ?? '');
      if (!payRate || !workDate) {
        throw new Error('Original entry missing payRate or workDate — cannot compute adjustment dollar amounts.');
      }
      const timestamp = Math.floor(Date.parse(`${workDate}T12:00:00Z`) / 1000);

      const hours = (adj.hoursDelta as Record<string, unknown>) ?? {};
      const amounts = (adj.amountDelta as Record<string, unknown>) ?? {};
      const adjType = String(adj.adjustmentType ?? 'manual_correction');
      const reason = String(adj.reason ?? '').trim() || 'Timesheet adjustment';

      // Build the per-delta payable inputs.
      const payables: CreatePayableInput[] = [];

      const pushHourPayable = (
        delta: number,
        multiplier: number,
        payCode: EvereeEarningType,
        kind: string,
      ): void => {
        if (!delta) return;
        const amount = Math.round(delta * payRate * multiplier * 100) / 100;
        if (amount === 0) return;
        payables.push({
          externalId: `${buildAdjustmentExternalId({ tenantId, adjustmentId })}::${kind}`,
          externalWorkerId,
          label: `${reason} (${kind})`,
          type: adjType,
          payCode,
          timestamp,
          amount: { amount: amount.toFixed(2), currency: 'USD' },
          payableModel: 'PRE_CALCULATED',
        });
      };
      const pushDollarPayable = (
        amount: number,
        payCode: EvereeEarningType,
        kind: string,
      ): void => {
        if (!amount) return;
        const v = Math.round(amount * 100) / 100;
        if (v === 0) return;
        payables.push({
          externalId: `${buildAdjustmentExternalId({ tenantId, adjustmentId })}::${kind}`,
          externalWorkerId,
          label: `${reason} (${kind})`,
          type: adjType,
          payCode,
          timestamp,
          amount: { amount: v.toFixed(2), currency: 'USD' },
          payableModel: 'PRE_CALCULATED',
        });
      };

      pushHourPayable(Number(hours.regular ?? 0), 1.0, 'REGULAR_HOURLY', 'REGULAR');
      pushHourPayable(Number(hours.ot ?? 0), 1.5, 'OVERTIME_HOURLY', 'OT');
      pushHourPayable(Number(hours.doubleTime ?? 0), 2.0, 'DOUBLE_TIME_HOURLY', 'DT');
      pushDollarPayable(Number(amounts.tips ?? 0), 'TIPS', 'TIPS');
      pushDollarPayable(Number(amounts.bonus ?? 0), 'BONUS', 'BONUS');
      pushDollarPayable(Number(amounts.penalty ?? 0), 'MEAL_PREMIUM', 'PENALTY');

      if (payables.length === 0) {
        throw new Error('Adjustment has no non-zero deltas — nothing to submit.');
      }

      // POST each payable. Like the batch worker, a single payable
      // failure doesn't fail the whole adjustment — we record the
      // partial result. Adjustments are usually 1-3 payables, so
      // partials are rare; logging is enough.
      const submittedExternalIds: string[] = [];
      for (const p of payables) {
        try {
          const r = await createPayable(config, p);
          submittedExternalIds.push(r.externalId);
        } catch (e) {
          logger.warn('[submitTimesheetAdjustmentWorker] payable POST failed', {
            tenantId,
            adjustmentId,
            externalId: p.externalId,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (submittedExternalIds.length === 0) {
        throw new Error('All payables failed to submit.');
      }

      // Request pay-out for the just-submitted externalIds. Same shape
      // as the batch finalize — filter-based, idempotent.
      let payRunId: number | undefined;
      try {
        const r = await requestPayablePayout(config, {
          externalIds: submittedExternalIds,
          includeWorkersOnRegularPayCycle: false,
        });
        payRunId = r.id || undefined;
      } catch (e) {
        logger.warn('[submitTimesheetAdjustmentWorker] pay-request failed; status stays sent_to_everee', {
          tenantId,
          adjustmentId,
          err: e instanceof Error ? e.message : String(e),
        });
      }

      await adjRef.update({
        'everee.payableExternalIds': submittedExternalIds,
        ...(payRunId !== undefined ? { 'everee.payRunId': String(payRunId) } : {}),
        'everee.status': 'SUBMITTED',
        'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info('[submitTimesheetAdjustmentWorker] ok', {
        tenantId,
        adjustmentId,
        payables: submittedExternalIds.length,
        payRunId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[submitTimesheetAdjustmentWorker] failed', {
        tenantId,
        adjustmentId,
        err: message,
      });
      try {
        await adjRef.update({
          status: 'error',
          'everee.status': 'ERROR',
          'everee.error': message,
          'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.warn('[submitTimesheetAdjustmentWorker] failed to stamp error', {
          tenantId,
          adjustmentId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  },
);
