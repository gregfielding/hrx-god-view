/**
 * **TS.1 Phase 4 Slice 7 — reconciler cron for stuck batches.**
 *
 * Backstop for webhook drops + orchestrator crashes. Runs every
 * 15 minutes, walks `timesheet_batches` that are stuck in a non-
 * terminal state (`submitting` / `partial`) and haven't been touched
 * in >30 min, queries Everee for authoritative status, and
 * reconciles HRX-side state.
 *
 * **Why we need it.** Three failure modes the orchestrator can't
 * self-heal:
 *
 *   1. **Webhook drop.** Everee processes a payment but the
 *      `payment.paid` / `payment-payables.status-changed` event
 *      never reaches our webhook endpoint (network glitch, Everee
 *      bug, signature verification edge case). Entry stays at
 *      `sent_to_everee` forever even though it's actually paid.
 *
 *   2. **Orchestrator crash.** `submitTimesheetEntryWorker` task
 *      crashes between the Everee POST and the entry-status stamp.
 *      Cloud Tasks retries up to 3x; if all 3 fail mid-stamp, the
 *      entry stays at `approved` with `_orchestrator.pendingTaskCount`
 *      stuck above zero. Batch never finalizes.
 *
 *   3. **Finalize claim lost.** The transactional last-task claim in
 *      `finalizeTimesheetBatch` is atomic but a process kill between
 *      the txn and the actual finalize write could leave the batch
 *      with `finalized: true` but no `status` flip.
 *
 * **What we do per stuck batch:**
 *
 *   - Load every referenced entry.
 *   - For entries with `everee.workedShiftId`: GET the worked-shift
 *     from Everee, update HRX status if Everee says it's paid/error.
 *   - For entries with `everee.payableExternalIds`: query
 *     `/api/v2/payables?external-ids=...`, roll up status by worst-
 *     case across the line items.
 *   - If all entries reach a terminal state → finalize the batch
 *     (status='success' / 'partial' / 'failed').
 *   - For entries still at `approved` after 30 min: mark `error`
 *     with `orchestrator_orphaned` so a recruiter can re-submit.
 *
 * **Safe to re-run.** Idempotent: applying the same Everee → HRX
 * status mapping twice produces the same end state. The 30-min
 * grace period avoids racing the orchestrator's normal flow.
 *
 * Per-batch failures are caught individually so one bad batch doesn't
 * stop the sweep.
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { evereeRequest } from '../integrations/everee/evereeHttp';
import { listPayables } from '../integrations/everee/evereePayables';
import { finalizeTimesheetBatch } from './finalizeTimesheetBatch';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = (): admin.firestore.Firestore => admin.firestore();

// ─────────────────────────────────────────────────────────────────────
// Config + tuning knobs
// ─────────────────────────────────────────────────────────────────────

/** Skip batches updated within this window — the orchestrator's
 *  normal path might still be in-flight. */
const STUCK_BATCH_THRESHOLD_MS = (() => {
  const raw = process.env.RECONCILE_STUCK_BATCH_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
})();

/** Hard cap on batches reconciled per sweep. Protects against the
 *  cron getting overwhelmed if a deploy bug created many stuck
 *  batches all at once. */
const MAX_BATCHES_PER_SWEEP = (() => {
  const raw = process.env.RECONCILE_MAX_BATCHES_PER_SWEEP;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 50;
})();

const NON_TERMINAL_BATCH_STATUSES = ['submitting', 'partial'] as const;

// ─────────────────────────────────────────────────────────────────────
// Status mapping — Everee → HRX
// ─────────────────────────────────────────────────────────────────────

/**
 * Translate an Everee payable lifecycle status into the HRX entry
 * status. Matches the webhook-handler mapping exactly (see
 * `handlePayablesStatusChanged` in evereeWebhook.ts) so the reconciler
 * + webhook converge on the same outcomes.
 *
 *   PAID                → 'paid'
 *   ERROR               → 'error'
 *   RETURNED            → 'error' (deposit returned by bank)
 *   UNPAYABLE_WORKER    → 'error' (worker can't receive funds)
 *   PENDING / IN_PROGRESS / SCHEDULED / SUBMITTED / etc. → null
 *     (still in-flight; no status change)
 */
export function mapEvereeStatusToEntryStatus(
  raw: string | undefined,
): 'paid' | 'error' | null {
  const upper = (raw ?? '').toUpperCase().trim();
  if (upper === 'PAID' || upper === 'COMPLETED') return 'paid';
  if (upper === 'ERROR' || upper === 'RETURNED' || upper === 'UNPAYABLE_WORKER') {
    return 'error';
  }
  return null;
}

/**
 * Roll up the per-payable statuses for a single ENTRY (which may
 * have multiple component payables — wages, tips, bonus, etc.).
 *
 * Rules:
 *   - Any ERROR / RETURNED / UNPAYABLE_WORKER → 'error' (worst-case
 *     wins; one bad payable means the entry can't be safely marked
 *     paid even if other components cleared)
 *   - ALL payables map to 'paid' AND there's at least one → 'paid'
 *   - Any payable still in-flight (PENDING / IN_PROGRESS / SCHEDULED
 *     / SUBMITTED / unknown) → null (worker hasn't received full
 *     amount yet)
 *
 * Returns `null` when no terminal resolution is appropriate yet.
 */
export function rollupPayableStatuses(statuses: string[]): 'paid' | 'error' | null {
  if (statuses.length === 0) return null;
  let allPaid = true;
  for (const s of statuses) {
    const mapped = mapEvereeStatusToEntryStatus(s);
    if (mapped === 'error') return 'error'; // any error short-circuits
    if (mapped !== 'paid') allPaid = false;
  }
  return allPaid ? 'paid' : null;
}

// ─────────────────────────────────────────────────────────────────────
// Per-batch reconciliation
// ─────────────────────────────────────────────────────────────────────

export interface ReconcileBatchSummary {
  tenantId: string;
  batchId: string;
  entryCount: number;
  entriesUpdated: number;
  entriesUnchanged: number;
  entriesErroredOrphaned: number;
  finalized: boolean;
  errors: string[];
}

/**
 * Reconcile one stuck batch. Loads entries, queries Everee, applies
 * status updates, finalizes if all entries are terminal.
 */
export async function reconcileStuckBatch(
  tenantId: string,
  batchId: string,
): Promise<ReconcileBatchSummary> {
  const summary: ReconcileBatchSummary = {
    tenantId,
    batchId,
    entryCount: 0,
    entriesUpdated: 0,
    entriesUnchanged: 0,
    entriesErroredOrphaned: 0,
    finalized: false,
    errors: [],
  };

  const batchRef = db().doc(`tenants/${tenantId}/timesheet_batches/${batchId}`);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) {
    summary.errors.push('batch_missing');
    return summary;
  }
  const batch = batchSnap.data() as Record<string, unknown>;
  const hiringEntityId = String(batch.hiringEntityId ?? '').trim();
  const entryIds = Array.isArray(batch.entryIds) ? (batch.entryIds as string[]) : [];
  summary.entryCount = entryIds.length;
  if (!hiringEntityId) {
    summary.errors.push('missing_hiring_entity');
    return summary;
  }
  const config = await getEvereeConfigForEntity(tenantId, hiringEntityId);
  if (!config) {
    summary.errors.push('entity_not_everee_enabled');
    return summary;
  }

  let anyNonTerminal = false;
  for (const entryId of entryIds) {
    const entryRef = db().doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const snap = await entryRef.get();
    if (!snap.exists) {
      summary.entriesUnchanged++;
      continue;
    }
    const entry = snap.data() as Record<string, unknown>;
    const status = String(entry.status ?? '');
    const evereeState = (entry.everee as Record<string, unknown>) ?? {};

    // Already terminal → no reconcile needed.
    if (status === 'paid' || status === 'error') {
      summary.entriesUnchanged++;
      continue;
    }

    // Stuck at approved with no orchestrator progress → orphaned.
    if (status === 'approved') {
      try {
        await entryRef.update({
          status: 'error',
          'everee.errorCode': 'orchestrator_orphaned',
          'everee.errorMessage': 'Reconciler detected entry never advanced past approved.',
          'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        summary.entriesErroredOrphaned++;
        summary.entriesUpdated++;
      } catch (e) {
        summary.errors.push(`entry ${entryId}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    // status === 'sent_to_everee' — query Everee for authoritative state.
    if (status !== 'sent_to_everee') {
      summary.entriesUnchanged++;
      continue;
    }

    const externalIds = Array.isArray(evereeState.payableExternalIds)
      ? (evereeState.payableExternalIds as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        )
      : [];
    const workedShiftId =
      typeof evereeState.workedShiftId === 'string' && evereeState.workedShiftId
        ? evereeState.workedShiftId
        : null;

    let resolvedStatus: 'paid' | 'error' | null = null;
    let resolvedNote = '';

    // 1) Payable lookup if we have external ids.
    if (externalIds.length > 0) {
      try {
        const raw = await listPayables(config, { externalIds });
        const items = extractPayables(raw);
        const statuses: string[] = items.map(
          (p) => String(p.paymentStatus ?? p.status ?? '').toUpperCase(),
        );
        resolvedStatus = rollupPayableStatuses(statuses);
        resolvedNote = `payables: ${statuses.join(',')}`;
      } catch (e) {
        summary.errors.push(
          `entry ${entryId} payables: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // 2) Worked-shift lookup as secondary signal (W-2 only).
    if (resolvedStatus === null && workedShiftId) {
      try {
        const ws = await evereeRequest<Record<string, unknown>>(
          config,
          'GET',
          `/integration/v1/labor/timesheet/worked-shifts/${workedShiftId}`,
        );
        const wsStatus = String(
          (ws?.status as string) ?? (ws?.paymentStatus as string) ?? '',
        ).toUpperCase();
        resolvedStatus = mapEvereeStatusToEntryStatus(wsStatus);
        if (resolvedStatus) resolvedNote = `worked-shift: ${wsStatus}`;
      } catch (e) {
        summary.errors.push(
          `entry ${entryId} worked-shift: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (resolvedStatus === null) {
      // Still in-flight per Everee — leave entry alone, mark batch as
      // still non-terminal so finalize is skipped this cycle.
      anyNonTerminal = true;
      summary.entriesUnchanged++;
      continue;
    }

    try {
      await entryRef.update({
        status: resolvedStatus,
        'everee.status': resolvedStatus.toUpperCase(),
        'everee.respondedAt': admin.firestore.FieldValue.serverTimestamp(),
        'everee.reconciledAt': admin.firestore.FieldValue.serverTimestamp(),
        'everee.reconcileNote': resolvedNote.slice(0, 240),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      summary.entriesUpdated++;
    } catch (e) {
      summary.errors.push(
        `entry ${entryId} update: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Re-finalize the batch if all entries are now terminal.
  if (!anyNonTerminal) {
    try {
      // Re-set _orchestrator.finalized=false so finalizeTimesheetBatch
      // can do its work. Then call finalize. The finalize logic reads
      // entry statuses and computes final batch status.
      await batchRef.update({
        '_orchestrator.finalized': false,
        '_orchestrator.reconciledAt': admin.firestore.FieldValue.serverTimestamp(),
      });
      await finalizeTimesheetBatch(tenantId, batchId);
      summary.finalized = true;
    } catch (e) {
      summary.errors.push(`finalize: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// Sweep
// ─────────────────────────────────────────────────────────────────────

export interface ReconcileSweepSummary {
  tenantsScanned: number;
  batchesConsidered: number;
  batchesReconciled: number;
  entriesUpdated: number;
  entriesErroredOrphaned: number;
  batchesFinalized: number;
  errors: number;
}

/**
 * Scan every tenant for stuck batches and reconcile them. Exported
 * for unit / integration testing — the cron just wraps this.
 */
export async function runReconcileSweep(): Promise<ReconcileSweepSummary> {
  const summary: ReconcileSweepSummary = {
    tenantsScanned: 0,
    batchesConsidered: 0,
    batchesReconciled: 0,
    entriesUpdated: 0,
    entriesErroredOrphaned: 0,
    batchesFinalized: 0,
    errors: 0,
  };

  const stuckThreshold = new Date(Date.now() - STUCK_BATCH_THRESHOLD_MS);
  const tenantsSnap = await db().collection('tenants').get();

  for (const tenantDoc of tenantsSnap.docs) {
    summary.tenantsScanned++;
    const tenantId = tenantDoc.id;
    // One Firestore query per (tenant, status) — `in` predicate would
    // be cleaner but the cron's volume is low so two reads is fine.
    const batchRefs = await db()
      .collection('tenants').doc(tenantId)
      .collection('timesheet_batches')
      .where('status', 'in', NON_TERMINAL_BATCH_STATUSES as unknown as string[])
      .where('updatedAt', '<', admin.firestore.Timestamp.fromDate(stuckThreshold))
      .limit(MAX_BATCHES_PER_SWEEP)
      .get()
      .catch((err) => {
        logger.warn('[reconcileTimesheetBatches] tenant query failed', {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
    if (!batchRefs) continue;

    for (const batchDoc of batchRefs.docs) {
      summary.batchesConsidered++;
      try {
        const result = await reconcileStuckBatch(tenantId, batchDoc.id);
        summary.batchesReconciled++;
        summary.entriesUpdated += result.entriesUpdated;
        summary.entriesErroredOrphaned += result.entriesErroredOrphaned;
        if (result.finalized) summary.batchesFinalized++;
        if (result.errors.length > 0) {
          summary.errors += result.errors.length;
          logger.warn('[reconcileTimesheetBatches] batch errors', {
            tenantId,
            batchId: batchDoc.id,
            errors: result.errors.slice(0, 5),
          });
        }
      } catch (e) {
        summary.errors++;
        logger.warn('[reconcileTimesheetBatches] batch fatal', {
          tenantId,
          batchId: batchDoc.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// Scheduled cron
// ─────────────────────────────────────────────────────────────────────

export const reconcileTimesheetBatchesCron = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const startedAt = Date.now();
    let summary: ReconcileSweepSummary;
    try {
      summary = await runReconcileSweep();
    } catch (err) {
      logger.error('[reconcileTimesheetBatchesCron] sweep_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    logger.info('[reconcileTimesheetBatchesCron] sweep_complete', {
      durationMs: Date.now() - startedAt,
      ...summary,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface PayableShape {
  paymentStatus?: string;
  status?: string;
}

function extractPayables(raw: unknown): PayableShape[] {
  if (Array.isArray(raw)) return raw as PayableShape[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as PayableShape[];
    if (Array.isArray(obj.data)) return obj.data as PayableShape[];
  }
  return [];
}
