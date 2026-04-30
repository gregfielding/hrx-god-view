/**
 * E.2 — Everee reconcile cron.
 *
 * Backstop for missed/unhandled webhook events. Sweeps every Everee
 * worker linkage doc across every tenant every 2 hours and refreshes
 * the `readinessMirror` snapshot via `reconcileWorkerInternal`.
 *
 * Why we need it:
 *   - We don't yet have a confirmed Everee event catalog beyond
 *     `worker.onboarding-completed`, so events like "bank account
 *     added" or "W-4 updated" never trigger an automatic refresh today.
 *   - Webhook delivery itself is occasionally delayed in pilot.
 *   - 2h is fresh enough for the readiness chip / aggregator without
 *     hammering the Everee API.
 *
 * Skip rules:
 *   - `lifecycleStatus === 'TERMINATED'`: state shouldn't change.
 *   - `lastEvereeReconcileAt < 30min ago`: a recent webhook or manual
 *     sync probably already refreshed.
 *   - Linkage doc missing required identity fields (no `entityId` /
 *     `userId` / `evereeWorkerId`): can't reconcile. Logged as a drift
 *     signal so ops sees the inconsistency.
 *   - Entity no longer Everee-enabled: `reconcileWorkerInternal`
 *     returns `not_enabled`; we count it but don't surface as a
 *     failure.
 *
 * Per-worker failures are caught individually so one bad worker
 * doesn't stop the sweep — the whole run aggregates summary counters.
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { evereePaths } from './evereeConfig';
import { reconcileWorkerInternal } from './evereeReconcileWorker';

const db = () => admin.firestore();

/** Skip workers reconciled within this window (ms). Default 30 min. */
const RECENT_SYNC_SKIP_MS = (() => {
  const raw = process.env.EVEREE_RECONCILE_RECENT_SYNC_SKIP_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
})();

/**
 * Hard cap on workers reconciled per sweep (across all tenants).
 * Protects against runaway loads if the Everee tenant pool grows.
 * Override via env for backfill / disaster-recovery one-shots.
 */
const MAX_WORKERS_PER_SWEEP = (() => {
  const raw = process.env.EVEREE_RECONCILE_MAX_PER_SWEEP;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5000;
})();

/** Per-sweep telemetry — exported so the cron's audit log is structured. */
export interface EvereeReconcileSweepSummary {
  tenantsScanned: number;
  workersConsidered: number;
  workersReconciled: number;
  workersSkippedTerminated: number;
  workersSkippedRecentSync: number;
  workersSkippedMissingIdentity: number;
  workersSkippedNotEnabled: number;
  workersFailed: number;
  /** Capped at the first 25 entries so a runaway failure mode doesn't blow up the log line. */
  failureSamples: Array<{ tenantId: string; workerDocId: string; reason: string }>;
}

/**
 * Inner implementation, exported for unit tests so they can stub the
 * Firestore reads + the reconcile helper without going through the
 * scheduler runtime.
 */
export async function runEvereeReconcileSweep(args: {
  /** Defaults to `Date.now()`. Injected for deterministic tests. */
  nowMs?: number;
  /**
   * Defaults to `reconcileWorkerInternal`. Tests stub this to assert the
   * skip-vs-reconcile decisions without making outbound HTTP calls.
   */
  reconcileFn?: typeof reconcileWorkerInternal;
  /** Override the recent-sync skip window (ms). */
  recentSyncSkipMs?: number;
  /** Cap on workers actually reconciled per sweep (skips don't count). */
  maxWorkersPerSweep?: number;
} = {}): Promise<EvereeReconcileSweepSummary> {
  const nowMs = args.nowMs ?? Date.now();
  const reconcileFn = args.reconcileFn ?? reconcileWorkerInternal;
  const recentSkipMs = args.recentSyncSkipMs ?? RECENT_SYNC_SKIP_MS;
  const maxPerSweep = args.maxWorkersPerSweep ?? MAX_WORKERS_PER_SWEEP;

  const summary: EvereeReconcileSweepSummary = {
    tenantsScanned: 0,
    workersConsidered: 0,
    workersReconciled: 0,
    workersSkippedTerminated: 0,
    workersSkippedRecentSync: 0,
    workersSkippedMissingIdentity: 0,
    workersSkippedNotEnabled: 0,
    workersFailed: 0,
    failureSamples: [],
  };

  // We iterate `tenants/*` rather than collection-group `everee_workers`
  // because the path helper is tenant-scoped and the per-tenant ordering
  // makes the audit log easier to reason about. With 3 entities × <100
  // workers each in pilot this is comfortably within Firestore limits;
  // when scale demands it, switch to a collectionGroup query and add a
  // shard cursor.
  const tenantsSnap = await db().collection('tenants').get();
  summary.tenantsScanned = tenantsSnap.size;

  outer: for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const workersSnap = await db().collection(evereePaths.workers(tenantId)).get();

    for (const workerDoc of workersSnap.docs) {
      summary.workersConsidered++;
      if (summary.workersReconciled >= maxPerSweep) {
        logger.warn('[evereeReconcileCron] sweep_capped', {
          tenantsScanned: summary.tenantsScanned,
          workersReconciled: summary.workersReconciled,
          cap: maxPerSweep,
        });
        break outer;
      }

      const data = (workerDoc.data() ?? {}) as {
        entityId?: string;
        userId?: string;
        evereeWorkerId?: string;
        externalWorkerId?: string;
        readinessMirror?: {
          lifecycleStatus?: string;
          lastEvereeSyncAt?: admin.firestore.Timestamp;
        };
        lastEvereeReconcileAt?: admin.firestore.Timestamp;
      };

      // Skip terminated workers — their state shouldn't change. We read
      // from the snapshot's lifecycleStatus rather than the legacy
      // top-level `status` field because the latter conflates onboarding
      // + lifecycle (EE.4 lesson).
      if (data.readinessMirror?.lifecycleStatus === 'TERMINATED') {
        summary.workersSkippedTerminated++;
        continue;
      }

      // Skip workers reconciled very recently. Prefer the dedicated
      // `lastEvereeReconcileAt` (set by `reconcileWorkerInternal`) over
      // the snapshot's `lastEvereeSyncAt` so a webhook-driven snapshot
      // refresh that didn't go through reconcile (legacy path) still
      // gets picked up.
      const lastReconcileMs =
        data.lastEvereeReconcileAt?.toMillis() ??
        data.readinessMirror?.lastEvereeSyncAt?.toMillis() ??
        0;
      if (lastReconcileMs > 0 && nowMs - lastReconcileMs < recentSkipMs) {
        summary.workersSkippedRecentSync++;
        continue;
      }

      // Linkage docs without resolvable identity can't be reconciled.
      // EE.5 owns the recovery path; we just log + count.
      const evereeWorkerId =
        (typeof data.evereeWorkerId === 'string' && data.evereeWorkerId) ||
        (typeof data.externalWorkerId === 'string' && data.externalWorkerId) ||
        '';
      if (!data.entityId || !data.userId || !evereeWorkerId) {
        summary.workersSkippedMissingIdentity++;
        logger.warn('[evereeReconcileCron] linkage_missing_identity', {
          tenantId,
          workerDocId: workerDoc.id,
          hasEntityId: !!data.entityId,
          hasUserId: !!data.userId,
          hasEvereeWorkerId: !!evereeWorkerId,
        });
        continue;
      }

      try {
        const result = await reconcileFn({
          tenantId,
          entityId: data.entityId,
          userId: data.userId,
          evereeWorkerId,
          syncSource: 'cron',
        });
        if (result.ok) {
          summary.workersReconciled++;
        } else if (result.reason === 'not_enabled') {
          summary.workersSkippedNotEnabled++;
        } else {
          summary.workersFailed++;
          if (summary.failureSamples.length < 25) {
            summary.failureSamples.push({
              tenantId,
              workerDocId: workerDoc.id,
              reason: result.reason ?? 'unknown',
            });
          }
        }
      } catch (err) {
        // `reconcileWorkerInternal` is documented to never throw, but
        // belt-and-suspenders: if it does, we contain the failure to
        // this worker and keep sweeping.
        summary.workersFailed++;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('[evereeReconcileCron] worker_reconcile_threw', {
          tenantId,
          workerDocId: workerDoc.id,
          message: message.slice(0, 240),
        });
        if (summary.failureSamples.length < 25) {
          summary.failureSamples.push({
            tenantId,
            workerDocId: workerDoc.id,
            reason: 'threw',
          });
        }
      }
    }
  }

  return summary;
}

/**
 * Scheduled wrapper. `every 2 hours` per the spec — staggered against
 * other Everee-touching jobs by accident of cron alignment, which is
 * fine at current scale.
 *
 * No `secrets:` array here because `reconcileWorkerInternal` reads the
 * Everee API token through `getSecret` (process.env), and per-tenant
 * tokens are bound at the project level via env. If/when we move to
 * `defineSecret`-bound API tokens, add them here too.
 */
export const evereeReconcileCron = onSchedule(
  {
    schedule: 'every 2 hours',
    timeZone: 'UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const startedAt = Date.now();
    let summary: EvereeReconcileSweepSummary;
    try {
      summary = await runEvereeReconcileSweep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[evereeReconcileCron] sweep_failed', { message: message.slice(0, 240) });
      throw err;
    }
    logger.info('[evereeReconcileCron] sweep_complete', {
      durationMs: Date.now() - startedAt,
      ...summary,
    });
  },
);
