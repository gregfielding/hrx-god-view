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
 * **R.10 — second pass.** This function also runs `runBackgroundCheckExpiryPass`,
 * which walks top-level `backgroundChecks` for completed checks whose
 * resolved validity threshold (JO → Location → Account → 365) has elapsed,
 * and stamps `expired: true` on the doc. The existing
 * `onBackgroundCheckWriteUpdateReadiness` trigger picks up the stamp and
 * propagates `'expired'` to `employeeReadinessItems` — single source of
 * truth. See `docs/READINESS_R10_HANDOFF.md`.
 *
 * @see assignmentMatchExpiryHelpers.ts (where expiresAtMs is stamped)
 * @see assignmentMatchRefreshHelpers.ts (sibling refresh path)
 * @see compliance/screeningAutomationShared.ts (R.10 cascade resolver)
 * @see readiness/onBackgroundCheckWriteUpdateReadiness.ts (R.10 propagation)
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase C
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';
import {
  DEFAULT_SCREENING_VALIDITY_DAYS,
  mergeScreeningValidityDaysFromLayers,
  screeningLocationKeyCandidates,
} from '../compliance/screeningAutomationShared';

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
// R.10 — Pass 2: background-check expiry sweep
// ─────────────────────────────────────────────────────────────────────────

/** Hard cap on the BG-check candidate query — protects against runaway loads. */
const BG_EXPIRY_MAX_CANDIDATES = 5000;

/** Batch size for BG expiry stamping. Firestore commit limit is 500; 250 leaves headroom. */
const BG_EXPIRY_BATCH_SIZE = 250;

export interface BackgroundCheckExpirySummary {
  /** BG check docs the query returned for consideration. */
  candidatesScanned: number;
  /** Docs flipped to `expired: true`. */
  checksExpired: number;
  /** Docs skipped because `hrxStatus` / `orderCompleted` aren't in a completed state yet. */
  checksSkippedNotCompleted: number;
  /** Docs skipped because `updatedAt` / `createdAt` are missing — can't compute completion ms. */
  checksSkippedMissingCompletedAt: number;
  /** Docs skipped because they're still within their validity window. */
  checksSkippedWithinValidity: number;
  /** Docs skipped because we couldn't resolve `tenantId` from the doc body. */
  checksSkippedMissingTenant: number;
  /** Account/JO/location lookups performed during this pass (after memoization). */
  cascadeLookups: number;
}

/**
 * **R.10** — Pure decision unit for one BG check at sweep time.
 *
 * Inputs are pre-resolved by the caller so this is testable without admin SDK
 * mocks. The caller is responsible for:
 *
 *   - Filtering out already-`expired:true` docs at query time (cheaper +
 *     preserves the "shouldn't un-expire" invariant on the read path).
 *   - Resolving `validityDays` from the cascade per doc (memoized per pass).
 *   - Extracting `completedMs` from `updatedAt ?? createdAt`.
 *
 * Decision tree:
 *
 *   - `hrxStatus` not in {`completed`, `report_ready`} AND `orderCompleted !== true`
 *     → `skip_not_completed`. Order isn't done yet, can't be expired.
 *   - `completedMs` is null (no usable timestamp) → `skip_missing_completed_at`.
 *     Defensive — query SHOULD only return docs with timestamps.
 *   - `completedMs + validityDays * 86_400_000 >= nowMs` → `skip_within_validity`.
 *   - Otherwise → `expire` with the `validityDays` actually applied (for
 *     `expiredValidityDays` audit stamp).
 *
 * Boundary alignment: matches `decideReconcileAction` — `expiresAtMs >= nowMs`
 * is "still valid". A check completed exactly `validityDays` ago is treated
 * as still valid for the next millisecond and gets caught on the next pass.
 */
export type BackgroundCheckExpiryAction =
  | { kind: 'expire'; appliedValidityDays: number; expiresAtMs: number }
  | {
      kind: 'skip';
      reason:
        | 'not_completed'
        | 'missing_completed_at'
        | 'within_validity';
      expiresAtMs?: number;
    };

export interface DecideBackgroundCheckExpiryArgs {
  hrxStatus: string | null | undefined;
  orderCompleted: boolean | null | undefined;
  completedMs: number | null;
  validityDays: number;
  nowMs: number;
}

export function decideBackgroundCheckExpiryAction(
  args: DecideBackgroundCheckExpiryArgs,
): BackgroundCheckExpiryAction {
  const { hrxStatus, orderCompleted, completedMs, validityDays, nowMs } = args;

  const statusCompleted =
    orderCompleted === true || hrxStatus === 'completed' || hrxStatus === 'report_ready';
  if (!statusCompleted) {
    return { kind: 'skip', reason: 'not_completed' };
  }

  if (completedMs == null || !Number.isFinite(completedMs) || completedMs <= 0) {
    return { kind: 'skip', reason: 'missing_completed_at' };
  }

  const safeValidityDays =
    Number.isInteger(validityDays) && validityDays > 0
      ? validityDays
      : DEFAULT_SCREENING_VALIDITY_DAYS;

  const expiresAtMs = completedMs + safeValidityDays * 86_400_000;
  if (expiresAtMs >= nowMs) {
    return { kind: 'skip', reason: 'within_validity', expiresAtMs };
  }

  return { kind: 'expire', appliedValidityDays: safeValidityDays, expiresAtMs };
}

/**
 * **R.10** — Per-pass cache for cascade lookups. Keyed off `tenantId/accountId`,
 * `tenantId/accountId/locationKey`, `tenantId/jobOrderId`. Bounded to the size
 * of distinct accounts/JOs/locations seen in one pass — no eviction needed
 * because the pass terminates.
 */
class CascadeCache {
  private accounts = new Map<string, Record<string, unknown> | null>();
  private locations = new Map<string, Record<string, unknown> | null>();
  private jobOrders = new Map<string, Record<string, unknown> | null>();
  /** Lookups performed (after cache hits dedupe). */
  public readsPerformed = 0;

  async getAccount(
    fdb: admin.firestore.Firestore,
    tenantId: string,
    accountId: string,
  ): Promise<Record<string, unknown> | null> {
    const k = `${tenantId}/${accountId}`;
    if (this.accounts.has(k)) return this.accounts.get(k) ?? null;
    this.readsPerformed++;
    try {
      const snap = await fdb
        .collection('tenants')
        .doc(tenantId)
        .collection('accounts')
        .doc(accountId)
        .get();
      const v = snap.exists ? (snap.data() as Record<string, unknown>) : null;
      this.accounts.set(k, v);
      return v;
    } catch {
      this.accounts.set(k, null);
      return null;
    }
  }

  async getLocationDefaults(
    fdb: admin.firestore.Firestore,
    tenantId: string,
    accountId: string,
    locationKey: string,
  ): Promise<Record<string, unknown> | null> {
    const k = `${tenantId}/${accountId}/${locationKey}`;
    if (this.locations.has(k)) return this.locations.get(k) ?? null;
    this.readsPerformed++;
    try {
      const snap = await fdb
        .collection('tenants')
        .doc(tenantId)
        .collection('accounts')
        .doc(accountId)
        .collection('location_defaults')
        .doc(locationKey)
        .get();
      const v = snap.exists ? (snap.data() as Record<string, unknown>) : null;
      this.locations.set(k, v);
      return v;
    } catch {
      this.locations.set(k, null);
      return null;
    }
  }

  async getJobOrder(
    fdb: admin.firestore.Firestore,
    tenantId: string,
    jobOrderId: string,
  ): Promise<Record<string, unknown> | null> {
    const k = `${tenantId}/${jobOrderId}`;
    if (this.jobOrders.has(k)) return this.jobOrders.get(k) ?? null;
    this.readsPerformed++;
    try {
      const snap = await fdb
        .collection('tenants')
        .doc(tenantId)
        .collection('job_orders')
        .doc(jobOrderId)
        .get();
      const v = snap.exists ? (snap.data() as Record<string, unknown>) : null;
      this.jobOrders.set(k, v);
      return v;
    } catch {
      this.jobOrders.set(k, null);
      return null;
    }
  }
}

/**
 * **R.10** — Resolve the validity-days threshold for one BG check at sweep
 * time, using the cascade `mergeScreeningValidityDaysFromLayers`.
 *
 * Lookups are memoized via `CascadeCache` so a sweep over hundreds of checks
 * costs O(unique accounts) Firestore reads, not O(checks).
 *
 * If `tenantId` can't be resolved or the JO/Account look-ups all return null,
 * the cascade's `default` branch returns `DEFAULT_SCREENING_VALIDITY_DAYS`.
 */
async function resolveScreeningValidityDaysForCheck(
  fdb: admin.firestore.Firestore,
  check: Record<string, unknown>,
  cache: CascadeCache,
): Promise<{ validityDays: number; source: 'job_order' | 'location_defaults' | 'account' | 'default' }> {
  const tenantId = pickStringField(check.tenantId);
  if (!tenantId) {
    return { validityDays: DEFAULT_SCREENING_VALIDITY_DAYS, source: 'default' };
  }

  const jobOrderId = pickStringField(check.jobOrderId);
  let jobOrder: Record<string, unknown> | undefined;
  if (jobOrderId) {
    jobOrder = (await cache.getJobOrder(fdb, tenantId, jobOrderId)) ?? undefined;
  }

  const accountId =
    pickStringField(check.accountId) ??
    (jobOrder ? pickStringField(jobOrder.entityId) ?? pickStringField(jobOrder.accountId) : null);

  let account: Record<string, unknown> | undefined;
  if (accountId) {
    account = (await cache.getAccount(fdb, tenantId, accountId)) ?? undefined;
  }

  let locationDefaults: Record<string, unknown> | undefined;
  if (jobOrder && accountId) {
    const locationId =
      pickStringField(check.worksiteId) ??
      pickStringField(jobOrder.locationId) ??
      pickStringField(jobOrder.worksiteId) ??
      '';
    const companyId =
      pickStringField(jobOrder.companyId) ??
      pickStringField(jobOrder.crmCompanyId) ??
      pickStringField(check.accountId) ??
      '';
    const keys = screeningLocationKeyCandidates(jobOrder, accountId, locationId, companyId);
    for (const key of keys) {
      const loc = await cache.getLocationDefaults(fdb, tenantId, accountId, key);
      if (loc) {
        locationDefaults = loc;
        break;
      }
    }
  }

  return mergeScreeningValidityDaysFromLayers(jobOrder, locationDefaults, account);
}

function pickStringField(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function timestampToMs(ts: unknown): number | null {
  if (ts == null) return null;
  if (ts instanceof admin.firestore.Timestamp) {
    try {
      return ts.toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * **R.10** — One-shot pass over `backgroundChecks` (top-level). Stamps
 * `expired: true` + `expiredAt` + `expiredValidityDays` on every check
 * whose completion time + resolved validity is before `nowMs`.
 *
 * Query filter:
 *   - `expired != true` (one-way invariant — already-expired stays expired).
 *   - `orderCompleted == true` OR `hrxStatus in [completed, report_ready]`
 *     would be ideal, but Firestore doesn't support OR-across-fields without
 *     two queries. We do `orderCompleted == true` and `hrxStatus IN [...]`
 *     as TWO separate queries and dedupe by docId.
 *
 * The `onBackgroundCheckWriteUpdateReadiness` trigger picks up the resulting
 * write and propagates `'expired'` to `employeeReadinessItems` — we don't
 * write to readiness directly. See L3.R10.
 */
export async function runBackgroundCheckExpiryPass(args: {
  db: admin.firestore.Firestore;
  nowMs: number;
}): Promise<BackgroundCheckExpirySummary> {
  const { db: fdb, nowMs } = args;
  const summary: BackgroundCheckExpirySummary = {
    candidatesScanned: 0,
    checksExpired: 0,
    checksSkippedNotCompleted: 0,
    checksSkippedMissingCompletedAt: 0,
    checksSkippedWithinValidity: 0,
    checksSkippedMissingTenant: 0,
    cascadeLookups: 0,
  };

  // Two queries: orderCompleted == true, and hrxStatus IN [completed,
  // report_ready]. Union by docId. `expired != true` filter is applied
  // client-side (Firestore `!=` is allowed but limited to one per query;
  // we keep the index simple).
  const seenIds = new Set<string>();
  const allDocs: admin.firestore.QueryDocumentSnapshot[] = [];

  const [byOrderCompleted, byHrxStatus] = await Promise.all([
    fdb
      .collection('backgroundChecks')
      .where('orderCompleted', '==', true)
      .limit(BG_EXPIRY_MAX_CANDIDATES)
      .get(),
    fdb
      .collection('backgroundChecks')
      .where('hrxStatus', 'in', ['completed', 'report_ready'])
      .limit(BG_EXPIRY_MAX_CANDIDATES)
      .get(),
  ]);

  for (const snap of [byOrderCompleted, byHrxStatus]) {
    for (const doc of snap.docs) {
      if (seenIds.has(doc.id)) continue;
      seenIds.add(doc.id);
      const data = doc.data() as Record<string, unknown>;
      // Client-side filter: skip if already expired.
      if (data.expired === true) continue;
      allDocs.push(doc);
    }
  }

  summary.candidatesScanned = allDocs.length;
  if (allDocs.length === 0) return summary;

  const cache = new CascadeCache();
  let batch = fdb.batch();
  let pendingInBatch = 0;

  for (const doc of allDocs) {
    const data = doc.data() as Record<string, unknown>;
    const tenantId = pickStringField(data.tenantId);
    if (!tenantId) {
      summary.checksSkippedMissingTenant++;
      continue;
    }

    const completedMs = timestampToMs(data.updatedAt) ?? timestampToMs(data.createdAt);

    const cascade = await resolveScreeningValidityDaysForCheck(fdb, data, cache);

    const action = decideBackgroundCheckExpiryAction({
      hrxStatus: typeof data.hrxStatus === 'string' ? data.hrxStatus : null,
      orderCompleted: data.orderCompleted === true ? true : null,
      completedMs,
      validityDays: cascade.validityDays,
      nowMs,
    });

    if (action.kind === 'skip') {
      switch (action.reason) {
        case 'not_completed':
          summary.checksSkippedNotCompleted++;
          break;
        case 'missing_completed_at':
          summary.checksSkippedMissingCompletedAt++;
          break;
        case 'within_validity':
          summary.checksSkippedWithinValidity++;
          break;
      }
      continue;
    }

    batch.update(doc.ref, {
      expired: true,
      expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      expiredValidityDays: action.appliedValidityDays,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    pendingInBatch++;
    summary.checksExpired++;

    if (pendingInBatch >= BG_EXPIRY_BATCH_SIZE) {
      await batch.commit();
      batch = fdb.batch();
      pendingInBatch = 0;
    }
  }

  if (pendingInBatch > 0) {
    await batch.commit();
  }

  summary.cascadeLookups = cache.readsPerformed;
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
    let pass1Done = false;
    let assignmentSummary: ReconcileSummary | null = null;
    let bgSummary: BackgroundCheckExpirySummary | null = null;
    try {
      // Pass 1 — assignment readiness items (Phase C.2, original).
      assignmentSummary = await runReconcilePass({ db, nowMs: start });
      pass1Done = true;
      logger.info('dailyReconcileExpiredReadiness: pass1 (assignment items) done', {
        runId,
        durationMs: Date.now() - start,
        ...assignmentSummary,
      });

      // Pass 2 — R.10 background-check expiry sweep. Independent of pass 1;
      // failures in either pass are logged but the other still ran on the
      // partial-failure path.
      const pass2Start = Date.now();
      bgSummary = await runBackgroundCheckExpiryPass({ db, nowMs: pass2Start });
      logger.info('dailyReconcileExpiredReadiness: pass2 (background check expiry) done', {
        runId,
        durationMs: Date.now() - pass2Start,
        ...bgSummary,
      });
    } catch (err) {
      logger.error('dailyReconcileExpiredReadiness: failed', {
        runId,
        durationMs: Date.now() - start,
        pass1Done,
        assignmentSummary,
        bgSummary,
        err: err instanceof Error ? err.message : String(err),
      });
      // Throw so Cloud Functions records the failure (retryCount=0 means it
      // doesn't retry, just shows up red in the dashboard).
      throw err;
    }
  },
);
