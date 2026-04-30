/**
 * E.1 + E.2 — Everee reconcile worker.
 *
 * Single owner of "fetch fresh state from Everee + write the snapshot to
 * `everee_workers/{entityId}__{userId}.readinessMirror`". Three callers:
 *
 *   1. `evereeAdminReconcileWorker` — the manual / admin / "Re-sync"
 *      callable (this file).
 *   2. `evereeReconcileCron` — the every-2h sweep
 *      (`evereeReconcileCron.ts`).
 *   3. `onEvereeWebhookEventCreated` processor — fires after every
 *      webhook event so the snapshot is always fresh post-event
 *      (`evereeWebhook.ts`).
 *
 * All three call the same `reconcileWorkerInternal` helper so the
 * fetch-+-compute-+-write logic lives in one place. The callable layer
 * adds auth + arg validation; the cron layer adds iteration + skip
 * guards; the webhook layer adds best-effort error swallowing.
 *
 * The four upstream Everee endpoints are issued in parallel via
 * `Promise.allSettled` — a slow `/files` shouldn't block a fast
 * `/workers/{id}` from landing on the snapshot, and a 404 on `/w9-info`
 * (worker is W-2) shouldn't poison the whole reconcile.
 */

import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { evereePaths, requireEvereeEnabledEntity } from './evereeConfig';
import { evereeRequest } from './evereeHttp';
import {
  computeEvereeReadinessMirror,
  type EvereeReadinessMirror,
  type EvereeReadinessSyncSource,
  type EvereeWorkerApiResponse,
  type MirrorInputFiles,
  type MirrorInputW4,
  type MirrorInputW9,
} from './evereeReadinessMirror';

const db = () => admin.firestore();

// ─────────────────────────────────────────────────────────────────────────
// Auth helpers — kept private to this file. Mirror the gate logic in
// `evereeCallables.ts` exactly so an admin's roles work consistently
// across every Everee surface.
// ─────────────────────────────────────────────────────────────────────────

function requireAuth(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  return request.auth;
}

function canManageEveree(
  auth: { token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } } | null | undefined,
  tenantId: string,
): boolean {
  if (!auth?.token) return false;
  const roles = auth.token.roles ?? {};
  const tenantRole = roles[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return true;
  if (auth.token.hrx === true) return true;
  return false;
}

function canSelfOrManageEveree(
  auth:
    | { uid: string; token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } }
    | null
    | undefined,
  tenantId: string,
  targetUserId: string,
): boolean {
  if (!auth?.uid) return false;
  if (targetUserId && auth.uid === targetUserId) return true;
  return canManageEveree(auth as Parameters<typeof canManageEveree>[0], tenantId);
}

// ─────────────────────────────────────────────────────────────────────────
// Per-endpoint fetchers. Each returns the wrapper shape the pure compute
// function expects (`{ applicable, data }` / `{ ok, files }`), translating
// Everee's 404-as-not-applicable convention here so the compute function
// doesn't have to care about HTTP status.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse the HTTP status that `evereeRequest` embeds in its thrown Error
 * message (shape: `Everee API GET /path: <status> <body>`). Same helper
 * `evereeCallables.ts` uses; duplicated here to keep this file self-
 * contained (and to avoid pulling the entire callables module into the
 * cron's cold-start graph).
 */
function parseEvereeErrorStatus(message: string): number | null {
  const match = /:\s*(\d{3})\b/.exec(message);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch the W-4 settings. 404 ⇒ `applicable: false` (worker is a
 * contractor or hasn't filed W-4 yet). Other failures ⇒ `applicable:
 * true` with no data, plus a structured warning so we can spot
 * persistent upstream errors in Cloud Logs.
 */
async function tryFetchW4(
  config: Awaited<ReturnType<typeof requireEvereeEnabledEntity>>,
  evereeWorkerId: string,
  logCtx: Record<string, unknown>,
): Promise<MirrorInputW4> {
  try {
    const data = await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}/w-4-tax-withholding-settings`,
    );
    return { applicable: true, data: data as MirrorInputW4['data'] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = parseEvereeErrorStatus(message);
    if (status === 404) return { applicable: false };
    logger.warn('[evereeReconcile] w4_fetch_failed', {
      ...logCtx,
      status,
      message: message.slice(0, 240),
    });
    return { applicable: true };
  }
}

/** Fetch W-9. 404 ⇒ `applicable: false` (worker is W-2). */
async function tryFetchW9(
  config: Awaited<ReturnType<typeof requireEvereeEnabledEntity>>,
  evereeWorkerId: string,
  logCtx: Record<string, unknown>,
): Promise<MirrorInputW9> {
  try {
    const data = await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}/w9-info`,
    );
    return { applicable: true, data: data as MirrorInputW9['data'] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = parseEvereeErrorStatus(message);
    if (status === 404) return { applicable: false };
    logger.warn('[evereeReconcile] w9_fetch_failed', {
      ...logCtx,
      status,
      message: message.slice(0, 240),
    });
    return { applicable: true };
  }
}

/**
 * Fetch the files index. The endpoint accepts `worker-id` as a query
 * param and returns `{ items: [...] }` (paginated). `size=100` matches
 * the existing `evereeAdminGetWorkerDocuments` callable — covers the
 * worst pilot scenario (full annual tax pack + onboarding + policies).
 */
async function tryFetchFiles(
  config: Awaited<ReturnType<typeof requireEvereeEnabledEntity>>,
  evereeWorkerId: string,
  logCtx: Record<string, unknown>,
): Promise<MirrorInputFiles> {
  try {
    const response = await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/workers/files?worker-id=${encodeURIComponent(evereeWorkerId)}&size=100`,
    );
    const items = Array.isArray(response?.items) ? (response.items as unknown[]) : [];
    return { ok: true, files: items as MirrorInputFiles['files'] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn('[evereeReconcile] files_fetch_failed', {
      ...logCtx,
      message: message.slice(0, 240),
    });
    return { ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The shared reconcile core.
// ─────────────────────────────────────────────────────────────────────────

export interface ReconcileWorkerInput {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  syncSource: EvereeReadinessSyncSource;
}

export interface ReconcileWorkerResult {
  ok: boolean;
  mirror?: EvereeReadinessMirror;
  reason?:
    | 'worker_fetch_failed'
    | 'link_doc_missing'
    | 'wrote'
    | 'not_enabled'
    | 'unknown_error';
  syncSource: EvereeReadinessSyncSource;
  /** Empty unless the worker fetch failed — surfaces upstream message safely. */
  error?: string;
}

/**
 * Fetch all four endpoints in parallel, compute the snapshot, write it to
 * the linkage doc. Used by the admin callable, the cron, and the webhook
 * processor. **Never throws** — caller decides how loudly to fail.
 *
 * Behaviour:
 *   - `worker` fetch fails (any status): bail out with
 *     `{ ok: false, reason: 'worker_fetch_failed' }`. Without the base
 *     worker shape we can't even decide W-2 vs 1099, so the whole
 *     compute is invalid.
 *   - W-4 / W-9 / files individually fail: log + treat as
 *     `{ applicable: true, data: undefined }` (or `{ ok: false }` for
 *     files). The compute function falls back to `null` for those
 *     fields — partial freshness is better than none.
 *   - Linkage doc missing: log + bail (we can't `update` a doc that
 *     isn't there, and we don't want to silently `set` it because that
 *     would mask a real linkage drift).
 *   - Linkage doc present: `update()` (NOT `set/merge`) per the R.0c
 *     lesson — `set/merge` with dotted keys creates literal top-level
 *     fields when the Admin SDK's path-detection trips.
 *   - Top-level `status` + `apiObservedOnboardingCompleteAt` are kept
 *     in sync for backward-compat with EE.4 / EE.5 callers that still
 *     read those legacy fields.
 */
export async function reconcileWorkerInternal(
  input: ReconcileWorkerInput,
): Promise<ReconcileWorkerResult> {
  const { tenantId, entityId, userId, evereeWorkerId, syncSource } = input;

  if (!tenantId || !entityId || !userId || !evereeWorkerId) {
    return { ok: false, reason: 'unknown_error', syncSource, error: 'missing_required_arg' };
  }

  const logCtx = {
    surface: 'everee.reconcile' as const,
    tenantId,
    entityId,
    userId,
    evereeWorkerId,
    syncSource,
  };

  let config: Awaited<ReturnType<typeof requireEvereeEnabledEntity>>;
  try {
    config = await requireEvereeEnabledEntity(tenantId, entityId);
  } catch (e: unknown) {
    // Most-likely cause: entity is no longer Everee-enabled (toggled off
    // mid-cron, or never enabled). Surface as `not_enabled` so the
    // caller can skip without alarming.
    const message = e instanceof Error ? e.message : String(e);
    logger.info('[evereeReconcile] entity_not_enabled', { ...logCtx, message });
    return { ok: false, reason: 'not_enabled', syncSource, error: message };
  }

  // Parallel fetches. `Promise.allSettled` so a slow /files doesn't
  // block /workers; the W-4/W-9 helpers translate 404 → applicable:false
  // internally so we never bail on the "wrong worker type" branch.
  const [workerSettled, w4Settled, w9Settled, filesSettled] = await Promise.allSettled([
    evereeRequest<EvereeWorkerApiResponse>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}`,
    ),
    tryFetchW4(config, evereeWorkerId, logCtx),
    tryFetchW9(config, evereeWorkerId, logCtx),
    tryFetchFiles(config, evereeWorkerId, logCtx),
  ]);

  if (workerSettled.status !== 'fulfilled') {
    const message =
      workerSettled.reason instanceof Error
        ? workerSettled.reason.message
        : String(workerSettled.reason);
    logger.warn('[evereeReconcile] worker_fetch_failed', {
      ...logCtx,
      message: message.slice(0, 240),
    });
    return {
      ok: false,
      reason: 'worker_fetch_failed',
      syncSource,
      error: message.slice(0, 240),
    };
  }

  // Defensive defaults if a helper somehow rejected (it shouldn't —
  // they catch internally — but TS doesn't know that).
  const w4: MirrorInputW4 =
    w4Settled.status === 'fulfilled' ? w4Settled.value : { applicable: true };
  const w9: MirrorInputW9 =
    w9Settled.status === 'fulfilled' ? w9Settled.value : { applicable: true };
  const files: MirrorInputFiles =
    filesSettled.status === 'fulfilled' ? filesSettled.value : { ok: false };

  const mirror = computeEvereeReadinessMirror({
    worker: workerSettled.value ?? {},
    w4,
    w9,
    files,
    syncSource,
  });

  // ── Persist ──
  const linkRef = db().doc(evereePaths.worker(tenantId, entityId, userId));
  const snap = await linkRef.get();
  if (!snap.exists) {
    // We deliberately don't `set` here. EE.5 owns the recovery path that
    // recreates a missing linkage doc; reconcile's contract is "snapshot
    // an existing link", not "create one from scratch". Bail loudly so
    // ops sees the drift in Cloud Logs.
    logger.warn('[evereeReconcile] link_doc_missing', logCtx);
    return { ok: false, reason: 'link_doc_missing', syncSource };
  }

  // EE.4 invariant: `apiObservedOnboardingCompleteAt` must be either a
  // serverTimestamp (when complete) or deleted (when not) — never
  // stale. Same FieldValue pattern `evereeGetMyOnboardingStatus` uses.
  const updatePayload: Record<string, unknown> = {
    readinessMirror: mirror,
    // Backward-compat: keep the legacy `status` field synchronized with
    // the snapshot's `onboardingComplete`. Other Everee callers (EE.4
    // preflight, EE.5 recovery, the existing webhook handler) still
    // read this field.
    status: mirror.onboardingComplete ? 'onboarding_complete' : 'created',
    apiObservedOnboardingCompleteAt: mirror.onboardingComplete
      ? admin.firestore.FieldValue.serverTimestamp()
      : admin.firestore.FieldValue.delete(),
    lastEvereeReconcileAt: admin.firestore.FieldValue.serverTimestamp(),
    lastEvereeReconcileSource: syncSource,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await linkRef.update(updatePayload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[evereeReconcile] write_failed', { ...logCtx, message: message.slice(0, 240) });
    return { ok: false, reason: 'unknown_error', syncSource, error: message.slice(0, 240) };
  }

  logger.info('[evereeReconcile] wrote', {
    ...logCtx,
    onboardingComplete: mirror.onboardingComplete,
    lifecycleStatus: mirror.lifecycleStatus,
    directDepositReady: mirror.directDepositReady,
    bankAccountCount: mirror.bankAccountCount,
    i9Applicable: mirror.i9Applicable,
    i9Signed: mirror.i9SignedAt !== null,
    w4Applicable: mirror.w4Applicable,
    w4Signed: mirror.w4SignedAt !== null,
    w9Applicable: mirror.w9Applicable,
    w9Signed: mirror.w9SignedAt !== null,
    handbookSigned: mirror.handbookSignedAt !== null,
    policiesSignedCount: mirror.policiesSignedCount,
    tinVerificationStatus: mirror.tinVerificationStatus,
  });

  return { ok: true, mirror, reason: 'wrote', syncSource };
}

// ─────────────────────────────────────────────────────────────────────────
// Public callable.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Manually trigger a fresh sync of a worker's Everee state into the
 * `everee_workers` snapshot. Surfaces:
 *   - Admin "Re-sync to Everee" button on the user profile (recruiter).
 *   - CSAs debugging stuck workers.
 *   - Worker-self "Refresh status" button (if/when the worker app
 *     surfaces one — same auth model as `evereeGetMyOnboardingStatus`).
 *
 * Returns `{ ok, mirror?, reason, syncSource, error? }` — clients render
 * `mirror` when present and surface `error` / `reason` otherwise.
 */
export const evereeAdminReconcileWorker = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  // Permit the worker's own "refresh" button + recruiter/admin tools.
  // `'cron'` is intentionally not accepted on the public surface — only
  // the server-side scheduler may claim that source.
  const requestedSource = typeof d?.syncSource === 'string' ? d.syncSource : 'manual';
  const syncSource: EvereeReadinessSyncSource =
    requestedSource === 'webhook' || requestedSource === 'embed'
      ? (requestedSource as EvereeReadinessSyncSource)
      : 'manual';

  if (!tenantId || !entityId || !evereeWorkerId || !userId) {
    throw new HttpsError(
      'invalid-argument',
      'tenantId, entityId, evereeWorkerId, userId required',
    );
  }
  if (!canSelfOrManageEveree(request.auth as Parameters<typeof canSelfOrManageEveree>[0], tenantId, userId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }

  const result = await reconcileWorkerInternal({
    tenantId,
    entityId,
    userId,
    evereeWorkerId,
    syncSource,
  });

  // Surface a callable-level error for the worker-fetch case so the
  // client can show an inline retry; everything else (link missing,
  // write failure, etc.) returns an `ok: false` with reason so the
  // caller can render a non-fatal explanation.
  if (!result.ok && result.reason === 'worker_fetch_failed') {
    throw new HttpsError(
      'failed-precondition',
      result.error || 'Failed to fetch worker from Everee',
    );
  }

  return result;
});
