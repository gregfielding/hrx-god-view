/**
 * **R.11** — Detect screening-package drift on JobOrder writes.
 *
 * Fires when `tenants/{tid}/job_orders/{joId}.screeningPackageId`
 * changes. For every in-flight `backgroundChecks` doc tied to that JO,
 * compares the new package's service ids against the check's stamped
 * `requestedServices` and stamps `packageDrift` + `hasPendingPackageDrift`
 * on the check when the new package is **more strict** or **incomparable**.
 *
 * Pure detection — does NOT auto-cancel, auto-reorder, or change readiness.
 * Surfacing happens via the R.6 drawer (warning Alert) and the R.8 matrix
 * banner. CSAs acknowledge via `acknowledgeBackgroundCheckPackageDriftCallable`.
 *
 * **Trigger semantics:**
 *   - Tight fingerprint: only acts when the **effective** screening
 *     package id changes between the before/after JO docs. The
 *     "effective" id is `snapshot.screeningPackageId` for
 *     post-activation JOs (§16.1 L5) and the live `screeningPackageId`
 *     for pre-activation JOs. Single-purpose, no tangle with the
 *     other JO write triggers.
 *   - Includes null↔set transitions (a JO that gains a package for the
 *     first time should still flag in-flight checks ordered with the prior
 *     null/default).
 *   - Idempotent: re-firing the same JO write produces no new stamps
 *     because `check.requestedPackageId === after.screeningPackageId`
 *     short-circuits at the per-check level.
 *   - Snapshot-aware (§16.1 L5): once a JO is activated, edits to the
 *     live `screeningPackageId` are ignored — only Push-to-Active
 *     mutations of `snapshot.screeningPackageId` trigger drift. This is
 *     the only consumer rewire in §16.1; the rest follow in R.16.2.
 *
 * **Service-set comparison limitation (V1):** compares `serviceId` only,
 * not jurisdictional scope. Same `serviceId` can mean different counties.
 * False-positive on jurisdictional change → CSA acknowledges, no harm.
 * Track as R.11.2 follow-up if production data shows it matters.
 *
 * @see compliance/screeningAutomationShared.ts (`classifyServiceSetDrift`,
 *      `AccusourceCatalogPackageServiceCache`)
 * @see integrations/accusource/acknowledgePackageDrift.ts (CSA action)
 * @see docs/READINESS_R11_HANDOFF.md L2.R11 + L3.R11
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  AccusourceCatalogPackageServiceCache,
  classifyServiceSetDrift,
  type ServiceSetDriftKind,
} from '../compliance/screeningAutomationShared';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Hard cap on the per-trigger query size — protects against a JO with absurdly many in-flight checks. */
const DRIFT_MAX_CANDIDATES = 1000;

/** Status values that mean the check is in-flight (NOT completed/canceled). Mirrors the R.11 spec verbatim. */
const TERMINAL_HRX_STATUSES = new Set<string>(['completed', 'canceled']);

export interface ScreeningPackageDriftSummary {
  /** Total checks the per-JO query returned. */
  candidatesScanned: number;
  /** Skipped because hrxStatus terminal or markedCompleteOutsideHrx === true. */
  checksSkippedNotInFlight: number;
  /** Skipped because requestedPackageId already matches new package (already-aligned shortcut). */
  checksSkippedAlreadyAligned: number;
  /** Service-set comparison concluded `'less_strict'` — older check covers everything new wants. */
  checksSkippedLessStrict: number;
  /** Stamped drift with `driftKind: 'more_strict'`. */
  checksStampedMoreStrict: number;
  /** Stamped drift with `driftKind: 'incomparable'` (legacy / catalog miss). */
  checksStampedIncomparable: number;
  /** AccuSource catalog reads performed (0 or 1 in practice — memoized). */
  catalogReadsPerformed: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure decision unit — testable without admin SDK mocks.
// ─────────────────────────────────────────────────────────────────────────

export type DriftPerCheckAction =
  | { kind: 'skip_not_in_flight' }
  | { kind: 'skip_already_aligned' }
  | { kind: 'skip_less_strict'; reason: string }
  | { kind: 'stamp_drift'; driftKind: Exclude<ServiceSetDriftKind, 'less_strict'>; reason: string };

export interface DecideDriftPerCheckArgs {
  /** From the BG check doc. */
  hrxStatus: string | null | undefined;
  markedCompleteOutsideHrx: boolean | null | undefined;
  expired: boolean | null | undefined;
  requestedPackageId: string | null | undefined;
  requestedServices: ReadonlyArray<string> | null | undefined;
  /** From the JO doc, post-write. */
  newPackageId: string | null;
  /** Resolved at trigger time via the catalog cache. Null = catalog miss / package not in catalog. */
  newPackageServiceIds: ReadonlyArray<string> | null;
}

/**
 * **R.11** — Decide what action the trigger should take for one BG check.
 *
 * Pure. No I/O. Order of checks matters (in-flight first, then alignment,
 * then service-set classification).
 */
export function decideDriftPerCheckAction(args: DecideDriftPerCheckArgs): DriftPerCheckAction {
  const {
    hrxStatus,
    markedCompleteOutsideHrx,
    expired,
    requestedPackageId,
    requestedServices,
    newPackageId,
    newPackageServiceIds,
  } = args;

  // R.11 spec definition of "in-flight":
  //   hrxStatus NOT IN [completed, canceled] AND markedCompleteOutsideHrx !== true
  //
  // Also exclude `expired:true` (R.10) — an already-expired check is
  // effectively terminal; CSA needs to reorder for any reason, drift
  // becomes moot.
  const statusStr = typeof hrxStatus === 'string' ? hrxStatus : '';
  if (TERMINAL_HRX_STATUSES.has(statusStr)) {
    return { kind: 'skip_not_in_flight' };
  }
  if (markedCompleteOutsideHrx === true) {
    return { kind: 'skip_not_in_flight' };
  }
  if (expired === true) {
    return { kind: 'skip_not_in_flight' };
  }

  // Already-aligned shortcut: the check was ordered with the same package
  // the JO is now setting. Idempotency for re-saves and bounce-restore.
  // String-trim for safety against legacy whitespace.
  const checkPid =
    typeof requestedPackageId === 'string' ? requestedPackageId.trim() : '';
  const newPid = typeof newPackageId === 'string' ? newPackageId.trim() : '';
  if (checkPid && newPid && checkPid === newPid) {
    return { kind: 'skip_already_aligned' };
  }

  // Service-set comparison.
  const drift = classifyServiceSetDrift(newPackageServiceIds, requestedServices);

  if (drift.kind === 'less_strict') {
    return { kind: 'skip_less_strict', reason: drift.reason };
  }

  return {
    kind: 'stamp_drift',
    driftKind: drift.kind,
    reason: drift.reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// I/O — sweep over in-flight BG checks under one JO and stamp drift.
// ─────────────────────────────────────────────────────────────────────────

interface DriftPassArgs {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  jobOrderId: string;
  newPackageId: string | null;
  newPackageName: string | null;
}

export async function runScreeningPackageDriftPassForJo(
  args: DriftPassArgs,
): Promise<ScreeningPackageDriftSummary> {
  const { fdb, tenantId, jobOrderId, newPackageId, newPackageName } = args;

  const summary: ScreeningPackageDriftSummary = {
    candidatesScanned: 0,
    checksSkippedNotInFlight: 0,
    checksSkippedAlreadyAligned: 0,
    checksSkippedLessStrict: 0,
    checksStampedMoreStrict: 0,
    checksStampedIncomparable: 0,
    catalogReadsPerformed: 0,
  };

  // Composite (tenantId, jobOrderId) index — see firestore.indexes.json.
  // In-flight filter is client-side: Firestore IN/NOT-IN limits +
  // boolean-flag filter would require multiple indexes; the candidate
  // set per JO is small (a handful of in-flight checks per JO at most),
  // so client filtering is cheap.
  const snap = await fdb
    .collection('backgroundChecks')
    .where('tenantId', '==', tenantId)
    .where('jobOrderId', '==', jobOrderId)
    .limit(DRIFT_MAX_CANDIDATES)
    .get();

  summary.candidatesScanned = snap.size;
  if (snap.empty) return summary;

  const cache = new AccusourceCatalogPackageServiceCache();
  const newPackageServiceIds = await cache.getServiceIdsForPackage(fdb, newPackageId);
  summary.catalogReadsPerformed = cache.readsPerformed;

  let batch = fdb.batch();
  let pendingInBatch = 0;
  const BATCH_LIMIT = 250;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;

    const action = decideDriftPerCheckAction({
      hrxStatus: typeof data.hrxStatus === 'string' ? data.hrxStatus : null,
      markedCompleteOutsideHrx: data.markedCompleteOutsideHrx === true,
      expired: data.expired === true,
      requestedPackageId:
        typeof data.requestedPackageId === 'string' ? data.requestedPackageId : null,
      requestedServices: Array.isArray(data.requestedServices)
        ? (data.requestedServices as string[])
        : null,
      newPackageId,
      newPackageServiceIds,
    });

    switch (action.kind) {
      case 'skip_not_in_flight':
        summary.checksSkippedNotInFlight++;
        continue;
      case 'skip_already_aligned':
        summary.checksSkippedAlreadyAligned++;
        continue;
      case 'skip_less_strict':
        summary.checksSkippedLessStrict++;
        // Info log — useful telemetry to confirm the cheap path is hitting.
        logger.info('[R.11] screeningPackageDrift: less_strict skip', {
          checkId: doc.id,
          tenantId,
          jobOrderId,
          newPackageId,
          reason: action.reason,
        });
        continue;
      case 'stamp_drift': {
        if (action.driftKind === 'more_strict') {
          summary.checksStampedMoreStrict++;
        } else {
          summary.checksStampedIncomparable++;
          // Warn log — telemetry per L3.R11 to monitor incomparable
          // frequency. High volume signals legacy-check backfill (R.11.5)
          // is overdue.
          logger.warn('[R.11] screeningPackageDrift: incomparable — stamping conservatively', {
            checkId: doc.id,
            tenantId,
            jobOrderId,
            newPackageId,
            existingHasRequestedServices: Array.isArray(data.requestedServices),
            newPackageInCatalog: newPackageServiceIds !== null,
            reason: action.reason,
          });
        }

        batch.update(doc.ref, {
          packageDrift: {
            jobOrderId,
            detectedAt: admin.firestore.FieldValue.serverTimestamp(),
            expectedPackageId: newPackageId ?? null,
            expectedPackageName: newPackageName ?? null,
            expectedServiceIds: newPackageServiceIds ?? null,
            driftKind: action.driftKind,
            acknowledgedAt: null,
            acknowledgedBy: null,
            acknowledgmentNote: null,
          },
          hasPendingPackageDrift: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        pendingInBatch++;

        if (pendingInBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = fdb.batch();
          pendingInBatch = 0;
        }
        break;
      }
    }
  }

  if (pendingInBatch > 0) {
    await batch.commit();
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// Firestore trigger — JO write with package-id fingerprint.
// ─────────────────────────────────────────────────────────────────────────

function pickStringField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!data) return null;
  const v = data[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * §16.1 L5 — pick the **effective** screening-package id for a JO.
 *
 * Pre-activation (`snapshot.capturedAt` absent): the live
 * `screeningPackageId` field is the source of truth — drift detection
 * should react to JO-form edits as it always has.
 *
 * Post-activation (`snapshot.capturedAt` present): the snapshot is the
 * source of truth. Live-field edits are intentionally ignored by
 * downstream consumers (per §16 propagation policy), so drift detection
 * must follow the snapshot too. The only path that mutates
 * `snapshot.screeningPackageId` post-activation is the Phase 5
 * Push-to-Active callable — when *that* writes a new value, the JO doc
 * write fires this trigger and the effective-id change kicks off a
 * drift pass against the in-flight checks.
 *
 * This is the only consumer rewire in §16.1 (per L2). All other
 * snapshot-policy field consumers stay on live values and will be
 * migrated in R.16.2.
 */
export function pickEffectiveScreeningPackageId(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data) return null;
  const snapshot = (data as { snapshot?: unknown }).snapshot;
  const isSnapshotted =
    snapshot !== null &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    (snapshot as { capturedAt?: unknown }).capturedAt !== undefined;

  if (isSnapshotted) {
    return pickStringField(snapshot as Record<string, unknown>, 'screeningPackageId');
  }
  return pickStringField(data, 'screeningPackageId');
}

function pickEffectivePackageName(
  data: Record<string, unknown> | null | undefined,
): string | null {
  // Package *name* isn't snapshotted today (§16.1 captures
  // screeningPackageId only). Fall back to the live name field — it
  // doesn't change retro-actively for an in-flight check anyway, so a
  // mismatched name in logs is purely cosmetic.
  return pickStringField(data, 'screeningPackageName');
}

export const onJobOrderWriteDetectScreeningPackageDrift = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}',
    region: 'us-central1',
    maxInstances: 5,
    // Bumped from 256 MiB -> 512 MiB on May 12 2026: the function was
    // failing the Cloud Run STARTUP TCP probe (worker container OOMs
    // before reaching the function body, ~270-280 MiB used vs 256 MiB
    // limit). Imports alone push past 256 MiB on cold start, so 256
    // wasn't survivable. Matches the global default; trim back later
    // only if profiling shows real headroom.
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const jobOrderId = String(event.params.jobOrderId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      // JO deleted. Don't fire — the in-flight checks under it are now
      // detached and any stamping would be misleading. If a JO is restored
      // later, the screening package re-set will trigger drift detection
      // naturally.
      return;
    }

    // §16.1 L5 — fingerprint on the **effective** package id (snapshot
    // wins over live for non-draft JOs). For pre-§16.1 / pre-activation
    // JOs this is identical to the previous behaviour: snapshot is
    // absent, so we fall back to `screeningPackageId`.
    const before = pickEffectiveScreeningPackageId(beforeData);
    const after = pickEffectiveScreeningPackageId(afterData);
    if (before === after) return;

    const newPackageName = pickEffectivePackageName(afterData);

    const start = Date.now();
    try {
      const summary = await runScreeningPackageDriftPassForJo({
        fdb: db,
        tenantId,
        jobOrderId,
        newPackageId: after,
        newPackageName,
      });

      logger.info('[R.11] onJobOrderWriteDetectScreeningPackageDrift: pass complete', {
        tenantId,
        jobOrderId,
        beforePackageId: before,
        afterPackageId: after,
        durationMs: Date.now() - start,
        ...summary,
      });
    } catch (err) {
      // Don't rethrow: drift detection is informational. A query failure
      // (e.g. INVALID_ARGUMENT before indexes deploy — see deploy runbook)
      // shouldn't crash the trigger and risk a retry storm.
      logger.error('[R.11] onJobOrderWriteDetectScreeningPackageDrift: pass failed', {
        tenantId,
        jobOrderId,
        beforePackageId: before,
        afterPackageId: after,
        durationMs: Date.now() - start,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
