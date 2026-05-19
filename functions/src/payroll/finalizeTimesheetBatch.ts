/**
 * **TS.1 Phase 4 Slice 6b — last-task-wins finalize.**
 *
 * Called by the per-entry worker (or by the orchestrator if all
 * pre-flights failed) once `batch._orchestrator.pendingTaskCount`
 * reaches zero. The finalize claim is established in the same
 * transaction that decrements the counter — see
 * `submitTimesheetEntryWorker.ts` — so only one task actually invokes
 * this function for any given batch.
 *
 * **What this does:**
 *
 *   1. Reads all entry statuses to compute the final batch status:
 *      - All `sent_to_everee` → `success`
 *      - Mixed `sent_to_everee` + `error` → `partial`
 *      - All `error` → `failed`
 *
 *   2. If at least one entry submitted successfully, requests the pay
 *      run via Everee's `POST /api/v2/payables/payment-request`. The
 *      call is **filter-based** (by externalIds — the exact set this
 *      batch produced) so we don't accidentally roll up payables from
 *      unrelated runs. Re-calling with the same filter is safe; Everee
 *      dedupes server-side.
 *
 *   3. Stamps `batch.status`, `batch.everee.payRunId`,
 *      `batch.everee.completedAt`, and `batch._orchestrator.finalizedAt`.
 *
 * **What this doesn't do:** flip per-entry status to `paid` — that's
 * the webhook path. The `sent_to_everee` status persists until the
 * `payment.paid` or `payment-payables.status-changed` event arrives.
 *
 * **Race-safety**: the finalize claim is established via the same
 * transaction that decrements the counter. If for any reason this
 * function is invoked twice for the same batch (e.g. operator triggers
 * a retry script), the second invocation re-stamps the same fields with
 * the same values — idempotent in practice. If the pay-request POST
 * itself fails, we record `everee.errorSummary` and leave the batch in
 * `partial`/`success` so the operator can retry pay-request only (a
 * separate ops surface, not in this slice).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { requestPayablePayout } from '../integrations/everee/evereePayables';

/**
 * Finalize a batch. Assumes the caller holds the finalize claim
 * (`_orchestrator.finalized = true` already set). Safe to re-call —
 * stamps the same terminal fields each time.
 */
export async function finalizeTimesheetBatch(
  tenantId: string,
  batchId: string,
): Promise<void> {
  const db = admin.firestore();
  const batchRef = db.doc(`tenants/${tenantId}/timesheet_batches/${batchId}`);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) {
    logger.warn('[finalizeTimesheetBatch] batch missing', { tenantId, batchId });
    return;
  }
  const batch = batchSnap.data() as Record<string, unknown>;
  const hiringEntityId = String(batch.hiringEntityId ?? '').trim();
  const entryIds = Array.isArray(batch.entryIds) ? (batch.entryIds as string[]) : [];

  // Load all entries to read status + payable externalIds.
  const entrySnaps = await Promise.all(
    entryIds.map((id) => db.doc(`tenants/${tenantId}/timesheet_entries/${id}`).get()),
  );

  let sentCount = 0;
  let errorCount = 0;
  const allPayableExternalIds: string[] = [];
  for (const snap of entrySnaps) {
    if (!snap.exists) continue;
    const data = snap.data() as Record<string, unknown>;
    const status = String(data.status ?? '');
    if (status === 'sent_to_everee' || status === 'paid') {
      sentCount++;
      const everee = (data.everee as Record<string, unknown>) ?? {};
      const ids = Array.isArray(everee.payableExternalIds)
        ? (everee.payableExternalIds as unknown[]).filter((s): s is string => typeof s === 'string')
        : [];
      for (const id of ids) allPayableExternalIds.push(id);
    } else if (status === 'error') {
      errorCount++;
    }
  }

  let finalStatus: 'success' | 'partial' | 'failed';
  if (sentCount > 0 && errorCount === 0) finalStatus = 'success';
  else if (sentCount > 0 && errorCount > 0) finalStatus = 'partial';
  else finalStatus = 'failed';

  // Pay-request call — only when we have entries to pay AND we can
  // resolve the entity's Everee config.
  let payRunId: number | undefined;
  let errorSummary: string | undefined;
  if (sentCount > 0) {
    try {
      const config = await getEvereeConfigForEntity(tenantId, hiringEntityId);
      if (!config) {
        errorSummary = `Entity ${hiringEntityId} not Everee-enabled at finalize time.`;
      } else {
        const r = await requestPayablePayout(config, {
          externalIds: allPayableExternalIds,
          includeWorkersOnRegularPayCycle: false,
        });
        payRunId = r.id || undefined;
      }
    } catch (e) {
      errorSummary = e instanceof Error ? e.message : String(e);
      logger.error('[finalizeTimesheetBatch] requestPayablePayout failed', {
        tenantId,
        batchId,
        err: errorSummary,
      });
    }
  } else {
    errorSummary = `All ${entryIds.length} entries failed submission.`;
  }

  await batchRef.update({
    status: finalStatus,
    everee: {
      ...((batch.everee as Record<string, unknown>) ?? {}),
      ...(payRunId !== undefined ? { payRunId: String(payRunId) } : {}),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(errorSummary ? { errorSummary } : {}),
    },
    '_orchestrator.finalizedAt': admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info('[finalizeTimesheetBatch] done', {
    tenantId,
    batchId,
    finalStatus,
    sentCount,
    errorCount,
    payRunId,
  });
}
