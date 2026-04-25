/**
 * Phase C.2 — daily reconciler that flips Phase B match items to `expired`
 * once their underlying record's expiration has passed.
 *
 * Closes the time-passes branch of matrix §6 hole #7. The write-driven
 * branch (`onUserLicensesChangeRefreshAssignments`) handles "worker uploads
 * a new license"; this scheduler handles "license aged out and nobody
 * touched anything".
 *
 * Query (collection-group):
 *   `assignmentReadinessItems`
 *     where `expiresAtMs < nowMs`
 *     where `status == 'complete_pass'`
 *
 * Both fields are indexed (`expiresAtMs ASC, status ASC`) — see
 * `firestore.indexes.json`. Without the index, this query fails with
 * INVALID_ARGUMENT at runtime.
 *
 * **Why not query for status==expired and just filter out?** Cheaper to query
 * the candidate set up front. A worker placement is unlikely to have more
 * than a handful of items expiring in the same day; we batch updates in
 * chunks of 250 (Firestore commit limit is 500; we leave headroom).
 *
 * **Idempotency:** the run-id pattern from `scheduledOrchestrator` ensures
 * we only process one "day" worth of work per UTC day, even if the scheduler
 * fires twice. Each item flip is also a no-op if status already moved off
 * `complete_pass` between the query and the write.
 *
 * @see assignmentMatchExpiryHelpers.ts (where expiresAtMs is stamped)
 * @see assignmentMatchRefreshHelpers.ts (sibling refresh path)
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase C
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Batch size for reconcile writes. Firestore commit limit is 500; 250 leaves headroom. */
const RECONCILE_BATCH_SIZE = 250;

/** Hard cap on the candidate query — protects against runaway loads. */
const RECONCILE_MAX_CANDIDATES = 5000;

export interface ReconcileSummary {
  /** Items the query returned for consideration. */
  candidatesScanned: number;
  /** Items flipped to `expired` (status changed). */
  itemsFlipped: number;
  /** Items skipped because status had already moved off `complete_pass`. */
  itemsSkippedRaceCondition: number;
  /** Items skipped because `expiresAtMs` was missing/invalid by the time we read. */
  itemsSkippedNoExpiry: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure helper — extracted so it's unit-testable without admin SDK mocks.
// ─────────────────────────────────────────────────────────────────────────

export type ReconcileAction =
  | { kind: 'flip' }
  | { kind: 'skip'; reason: 'race_condition_status_moved' | 'missing_or_future_expiry' };

/**
 * Decide what to do with one item snapshot at reconcile time.
 *
 *   - status no longer `complete_pass` → skip (race condition; another
 *     trigger fired between our query and our read).
 *   - expiresAtMs missing, non-positive, OR `>= nowMs` → skip.
 *     The boundary is exclusive (`expiresAtMs >= nowMs` skips) so this
 *     decision aligns with the candidate query (`expiresAtMs < nowMs`).
 *     A value at the exact boundary is "just becoming expired" but hasn't
 *     yet — gets caught on the next pass when nowMs has advanced.
 *   - Otherwise → flip to `expired`.
 *
 * Pure. No I/O. Testable.
 */
export function decideReconcileAction(
  item: Pick<AssignmentReadinessItem, 'status' | 'expiresAtMs'>,
  nowMs: number,
): ReconcileAction {
  if (item.status !== 'complete_pass') {
    return { kind: 'skip', reason: 'race_condition_status_moved' };
  }
  if (
    typeof item.expiresAtMs !== 'number' ||
    item.expiresAtMs <= 0 ||
    item.expiresAtMs >= nowMs
  ) {
    return { kind: 'skip', reason: 'missing_or_future_expiry' };
  }
  return { kind: 'flip' };
}

// ─────────────────────────────────────────────────────────────────────────
// Reconcile core (admin SDK; called by the scheduled function + manual hook)
// ─────────────────────────────────────────────────────────────────────────

/**
 * One-shot reconcile pass. Exported so it can be invoked from a callable for
 * manual replays (e.g. after an outage that paused the scheduler).
 */
export async function runReconcilePass(args: {
  db: admin.firestore.Firestore;
  nowMs: number;
}): Promise<ReconcileSummary> {
  const { db: fdb, nowMs } = args;
  const summary: ReconcileSummary = {
    candidatesScanned: 0,
    itemsFlipped: 0,
    itemsSkippedRaceCondition: 0,
    itemsSkippedNoExpiry: 0,
  };

  const snap = await fdb
    .collectionGroup('assignmentReadinessItems')
    .where('expiresAtMs', '<', nowMs)
    .where('status', '==', 'complete_pass')
    .limit(RECONCILE_MAX_CANDIDATES)
    .get();

  summary.candidatesScanned = snap.size;
  if (snap.empty) return summary;

  const nowIso = new Date(nowMs).toISOString();

  // Apply in committed batches to stay under Firestore's 500-write limit.
  let batch = fdb.batch();
  let pendingInBatch = 0;

  for (const doc of snap.docs) {
    const item = doc.data() as AssignmentReadinessItem;
    const decision = decideReconcileAction(item, nowMs);

    if (decision.kind === 'skip') {
      if (decision.reason === 'race_condition_status_moved') {
        summary.itemsSkippedRaceCondition++;
      } else {
        summary.itemsSkippedNoExpiry++;
      }
      continue;
    }

    batch.update(doc.ref, {
      status: 'expired',
      updatedAt: nowIso,
    });
    pendingInBatch++;
    summary.itemsFlipped++;

    if (pendingInBatch >= RECONCILE_BATCH_SIZE) {
      await batch.commit();
      batch = fdb.batch();
      pendingInBatch = 0;
    }
  }

  if (pendingInBatch > 0) {
    await batch.commit();
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// Scheduled function — daily at 02:00 America/New_York (low-traffic window).
// ─────────────────────────────────────────────────────────────────────────

export const dailyReconcileExpiredReadiness = onSchedule(
  {
    schedule: 'every day 02:00',
    timeZone: 'America/New_York',
    region: 'us-central1',
    maxInstances: 1,
    retryCount: 0,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    // Idempotency guard — same pattern as scheduledOrchestrator. If a manual
    // trigger fired earlier in the same UTC day, skip.
    const runId = `dailyReconcileExpiredReadiness_${new Date().toISOString().slice(0, 10)}`;
    const runRef = db.collection('function_runs').doc(runId);
    try {
      await runRef.create({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        type: 'reconcile_expired_readiness',
      });
    } catch {
      logger.info('dailyReconcileExpiredReadiness: already ran today, skipping', { runId });
      return;
    }

    const start = Date.now();
    try {
      const summary = await runReconcilePass({ db, nowMs: start });
      logger.info('dailyReconcileExpiredReadiness: done', {
        runId,
        durationMs: Date.now() - start,
        ...summary,
      });
    } catch (err) {
      logger.error('dailyReconcileExpiredReadiness: failed', {
        runId,
        durationMs: Date.now() - start,
        err: err instanceof Error ? err.message : String(err),
      });
      // Throw so Cloud Functions records the failure (retryCount=0 means it
      // doesn't retry, just shows up red in the dashboard).
      throw err;
    }
  },
);
