/**
 * **R.16.1 Phase 4** — Admin-only backfill callable that snapshots
 * cascade-policy fields onto pre-§16.1 active Job Orders.
 *
 * The snapshot trigger (`onJobOrderStatusTransitionSnapshot`) only
 * fires going forward — every JO already past `draft` when §16.1
 * deploys is missing `jo.snapshot.*`, which means downstream
 * snapshot-aware consumers (R.11 drift detection, the future
 * `getEffectiveJobOrderField` adopters in R.16.2, the Push-to-Active
 * dialog's affected-list query) would silently fall back to live
 * cascade reads on those JOs and defeat the purpose of §16.1.
 *
 * This callable closes that gap: for every JO whose status is *not*
 * `draft`/`cancelled` and that doesn't already carry
 * `snapshot.capturedAt`, run the same `runSnapshotPassForJo` path
 * the trigger uses (with `capturedBy: 'backfill'`). Single-source
 * the resolution logic — there's no second copy of the snapshot
 * envelope shape here.
 *
 * Ops shape (R.0c-style — same as `backfillAssignmentReadinessItemsCallable`):
 *   - `dryRun: true` is the default. Reports what *would* be touched
 *     and the bucket it falls into; no Firestore writes.
 *   - `dryRun: false` actually writes. Per-JO transactional, idempotent.
 *   - `--force` re-snapshots already-frozen JOs (skips L7's idempotency
 *     guard). Audit row's `context` is suffixed with `' (forced)'`.
 *   - Pagination via doc-id cursor (`pageToken`). `limit` defaults
 *     to 1000, capped at 5000.
 *   - Caller must be HRX-staff (security level 7) on the requested
 *     tenant. Mirrors R.0c / R.1 backfill gating.
 *
 * Idempotency contract:
 *   - First non-dry-run call: writes N snapshots, where N is the
 *     count of active JOs missing `capturedAt`.
 *   - Second call (without `force`): writes 0 — every JO from the
 *     first run now hits `skipped_already_snapshotted`.
 *   - With `force: true`: writes N (or however many active JOs are
 *     in the page), regardless of capture state.
 *
 * Audit trail:
 *   - Every snapshot write produces a `cascadeAuditLog` entry with
 *     `action: 'snapshot_via_backfill'`. The handoff §L10 specifies
 *     this action name.
 *   - Status-skipped JOs (draft/cancelled) do NOT produce audit
 *     entries — they're outside the snapshot system's domain.
 *   - Already-snapshotted skips (no-force path) DO produce an
 *     audit row with `action: 'snapshot_skipped'`,
 *     `skipKind: 'skip_already_snapshotted'` so the audit log shows
 *     the backfill "saw" the JO and made an explicit decision.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L7 (idempotency),
 *      §L10 (audit), Phase 4 spec.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import {
  runSnapshotPassForJo,
  writeCascadeAuditEntry,
} from './onJobOrderStatusTransitionSnapshot';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const PASS_CONCURRENCY = 5;

interface BackfillJoSnapshotRequest {
  tenantId?: string;
  dryRun?: boolean;
  limit?: number;
  /** Doc-id cursor from a previous response's `nextPageToken`. */
  pageToken?: string | null;
  /** Re-snapshot already-frozen JOs. Use only with explicit op approval. */
  force?: boolean;
}

interface JoBucketCounts {
  /** `status` is `'draft'` or `'cancelled'`. Skipped silently. */
  skipped_status: number;
  /** Already has `snapshot.capturedAt` and `force: false`. */
  skipped_already_snapshotted: number;
  /** dry-run: would write a fresh snapshot. */
  would_snapshot: number;
  /** dry-run + force: would re-snapshot a frozen JO. */
  would_snapshot_forced: number;
  /** non-dry-run: wrote a fresh snapshot. */
  snapshotted: number;
  /** non-dry-run + force: re-snapshotted a frozen JO. */
  snapshotted_forced: number;
}

interface BackfillJoSnapshotReport {
  tenantId: string;
  dryRun: boolean;
  force: boolean;
  limit: number;
  scanned: number;
  buckets: JoBucketCounts;
  errors: Array<{ jobOrderId: string; error: string }>;
  truncated: boolean;
  nextPageToken: string | null;
  /** ms spent in this single page run, for ops-eyeball cost tracking. */
  durationMs: number;
}

function normalizeSecurityLevel(level: unknown): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return Math.min(Math.max(level, 1), 7);
  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7);
}

function getSecurityLevelForActiveTenant(user: Record<string, unknown>): number {
  const activeTenantId = user.activeTenantId as string | undefined;
  if (!activeTenantId) return normalizeSecurityLevel(user.securityLevel);
  const tenantSettings = (user.tenantIds as Record<string, unknown> | undefined)?.[
    activeTenantId
  ] as Record<string, unknown> | undefined;
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }
  return normalizeSecurityLevel(user.securityLevel);
}

// ─────────────────────────────────────────────────────────────────────
// Per-JO classifier — pure, exported for tests.
// ─────────────────────────────────────────────────────────────────────

export type BackfillBucket =
  | 'skipped_status'
  | 'skipped_already_snapshotted'
  | 'would_snapshot'
  | 'would_snapshot_forced'
  | 'snapshotted'
  | 'snapshotted_forced';

export interface ClassifyArgs {
  joData: Record<string, unknown> | null | undefined;
  dryRun: boolean;
  force: boolean;
}

/**
 * Decide which bucket a JO falls into based on its status + snapshot
 * state and the run mode. Pure — exported so the dry-run report is
 * fully predictable from doc data alone (no cascade resolution
 * needed to build it).
 */
export function classifyJoForBackfill(args: ClassifyArgs): BackfillBucket {
  const { joData, dryRun, force } = args;
  if (!joData || typeof joData !== 'object') return 'skipped_status';

  const status = typeof joData.status === 'string' ? joData.status : '';
  if (status === '' || status === 'draft' || status === 'cancelled') {
    return 'skipped_status';
  }

  const snapshot = joData.snapshot as { capturedAt?: unknown } | undefined;
  const isSnapshotted =
    snapshot !== null && typeof snapshot === 'object' && snapshot.capturedAt !== undefined;

  if (isSnapshotted && !force) {
    return 'skipped_already_snapshotted';
  }

  if (dryRun) {
    return isSnapshotted ? 'would_snapshot_forced' : 'would_snapshot';
  }
  return isSnapshotted ? 'snapshotted_forced' : 'snapshotted';
}

// ─────────────────────────────────────────────────────────────────────
// Per-JO orchestrator — applies the bucket decision and (when
// `dryRun` is false) drives `runSnapshotPassForJo`.
// ─────────────────────────────────────────────────────────────────────

export interface ProcessOneArgs {
  tenantId: string;
  jobOrderId: string;
  joData: Record<string, unknown>;
  dryRun: boolean;
  force: boolean;
  fdb: admin.firestore.Firestore;
}

export async function processOneJoForBackfill(
  args: ProcessOneArgs,
): Promise<{ bucket: BackfillBucket; durationMs: number }> {
  const { tenantId, jobOrderId, joData, dryRun, force, fdb } = args;
  const start = Date.now();
  const bucket = classifyJoForBackfill({ joData, dryRun, force });

  if (bucket === 'skipped_status') {
    return { bucket, durationMs: Date.now() - start };
  }

  if (bucket === 'skipped_already_snapshotted') {
    // Audit the deliberate skip so the run is auditable end-to-end.
    await writeCascadeAuditEntry(
      {
        action: 'snapshot_skipped',
        tenantId,
        jobOrderId,
        triggeredBy: 'backfill',
        skipKind: 'skip_already_snapshotted',
        context: 'backfill (no force)',
      },
      fdb,
    );
    return { bucket, durationMs: Date.now() - start };
  }

  if (dryRun) {
    return { bucket, durationMs: Date.now() - start };
  }

  // Non-dry-run path: run the same orchestrator the trigger uses,
  // with `capturedBy: 'backfill'` so the audit row distinguishes the
  // origin. We pass beforeStatus='draft' / afterStatus=joData.status
  // synthetically so the decision unit returns `'snapshot'` for the
  // active-JO path. (If the JO is somehow on `cancelled` we short-
  // circuited above; safe by construction.)
  const result = await runSnapshotPassForJo({
    tenantId,
    jobOrderId,
    beforeStatus: 'draft',
    afterStatus: typeof joData.status === 'string' ? joData.status : 'open',
    capturedBy: 'backfill',
    preloadedJoData: joData,
    fdb,
    force,
  });

  if (result.decision.kind !== 'snapshot') {
    // Expected only on a TOCTOU race (another writer froze the JO
    // between classifier and orchestrator). Re-classify into
    // already-snapshotted for the report.
    return {
      bucket: 'skipped_already_snapshotted',
      durationMs: Date.now() - start,
    };
  }

  return { bucket, durationMs: Date.now() - start };
}

// ─────────────────────────────────────────────────────────────────────
// Page driver — applied per-page so a tenant with thousands of active
// JOs is paginated by the operator (matches R.7 ops shape).
// ─────────────────────────────────────────────────────────────────────

export interface RunBackfillPageArgs {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  pageToken: string | null;
  force: boolean;
  fdb: admin.firestore.Firestore;
}

export async function runBackfillPage(
  args: RunBackfillPageArgs,
): Promise<BackfillJoSnapshotReport> {
  const { tenantId, dryRun, limit, pageToken, force, fdb } = args;
  const startMs = Date.now();

  let q = fdb
    .collection(`tenants/${tenantId}/job_orders`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(limit) as admin.firestore.Query;
  if (pageToken) {
    q = q.startAfter(pageToken);
  }

  const snap = await q.get();

  const report: BackfillJoSnapshotReport = {
    tenantId,
    dryRun,
    force,
    limit,
    scanned: snap.size,
    buckets: {
      skipped_status: 0,
      skipped_already_snapshotted: 0,
      would_snapshot: 0,
      would_snapshot_forced: 0,
      snapshotted: 0,
      snapshotted_forced: 0,
    },
    errors: [],
    truncated: snap.size === limit,
    nextPageToken: snap.size === limit ? snap.docs[snap.docs.length - 1].id : null,
    durationMs: 0,
  };

  for (let i = 0; i < snap.docs.length; i += PASS_CONCURRENCY) {
    const chunk = snap.docs.slice(i, i + PASS_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (joDoc) => {
        try {
          const out = await processOneJoForBackfill({
            tenantId,
            jobOrderId: joDoc.id,
            joData: (joDoc.data() ?? {}) as Record<string, unknown>,
            dryRun,
            force,
            fdb,
          });
          return { ok: true as const, jobOrderId: joDoc.id, bucket: out.bucket };
        } catch (e) {
          return {
            ok: false as const,
            jobOrderId: joDoc.id,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ jobOrderId: item.jobOrderId, error: item.error });
        continue;
      }
      report.buckets[item.bucket] += 1;
    }
  }

  report.durationMs = Date.now() - startMs;
  return report;
}

// ─────────────────────────────────────────────────────────────────────
// Callable wrapper — the deployable surface.
// ─────────────────────────────────────────────────────────────────────

export const backfillJoSnapshotFieldsCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<BackfillJoSnapshotReport> => {
    const data = (request.data ?? {}) as BackfillJoSnapshotRequest;
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

    const tenantId = String(data.tenantId ?? '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

    const dryRun = data.dryRun !== false; // default TRUE
    const force = data.force === true; // default FALSE
    const requestedLimit = Number(data.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const pageToken =
      typeof data.pageToken === 'string' && data.pageToken.trim().length > 0
        ? data.pageToken.trim()
        : null;

    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User record not found.');
    }
    const callerUser = userSnap.data() ?? {};
    const callerSecurityLevel = getSecurityLevelForActiveTenant(callerUser);
    const callerActiveTenantId =
      typeof callerUser.activeTenantId === 'string' ? callerUser.activeTenantId : null;

    // R.16.1 backfill mirrors the R.0c gate: HRX-staff (security level 7)
    // on the requested tenant. Backfill writes ride directly on
    // production data, and a `--force` run will overwrite frozen
    // financial/compliance fields, so the strictest existing
    // convention applies.
    if (callerActiveTenantId !== tenantId || callerSecurityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions. Backfill requires security level 7 on the requested tenant.',
      );
    }

    if (force) {
      logger.warn(
        '[R.16.1][backfillJoSnapshotFieldsCallable] FORCE run — re-snapshotting frozen JOs',
        { tenantId, callerUid: uid, dryRun, limit, pageToken },
      );
    }

    const report = await runBackfillPage({
      tenantId,
      dryRun,
      limit,
      pageToken,
      force,
      fdb: db,
    });

    logger.info('[R.16.1][backfillJoSnapshotFieldsCallable] complete', {
      tenantId,
      dryRun,
      force,
      limit,
      scanned: report.scanned,
      buckets: report.buckets,
      errorCount: report.errors.length,
      truncated: report.truncated,
      nextPageToken: report.nextPageToken,
      durationMs: report.durationMs,
      callerUid: uid,
    });

    return report;
  },
);
