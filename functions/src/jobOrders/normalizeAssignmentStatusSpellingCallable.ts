/**
 * **R.4.2-F3 (2026-04-29)** — Admin-callable normalizer for the
 * `assignment.status` spelling drift surfaced during the R.4.2 backfill.
 *
 * --------------------------------------------------------------------
 * Why this exists
 * --------------------------------------------------------------------
 * The R.4.2 BCiP pre-flight reported a status mix containing both
 * `'cancelled'` (British, double-L) AND `'canceled'` (American,
 * single-L) values for what is logically the same state. British
 * spelling is the canonical form in the dataset (more common in
 * BCiP, matches shift-status convention, matches Phase-1 onboarding
 * step labels). This callable performs a one-shot, single-tenant,
 * idempotent rewrite of `'canceled'` → `'cancelled'` on the
 * `tenants/{tid}/assignments` collection.
 *
 * The corresponding upstream write site (`shiftAssignmentCascades.ts`)
 * was patched in the same PR to emit `'cancelled'` going forward, so
 * a clean run + the upstream patch together stop the drift at the
 * source. Phase2 UI dropdowns still write `'canceled'` from a
 * `<MenuItem value="canceled">` literal — that's a separate cleanup
 * tracked in `docs/R4_2_FOLLOWUPS.md` §R.4.2-F3.
 *
 * --------------------------------------------------------------------
 * Scope
 * --------------------------------------------------------------------
 *   - **Match:** docs whose `status` field is exactly the string
 *     `'canceled'` (case-sensitive, trimmed). Anything else
 *     (`'Canceled'`, `'cancelled'`, `'cancellation_pending'`, etc.)
 *     is left untouched.
 *   - **Action:** rewrite `status` to the literal string `'cancelled'`.
 *     Stamps `updatedAt = serverTimestamp()` and `updatedBy = 'system'`.
 *     Does NOT touch `canceledAt`, `cancellationReason`, or any other
 *     field — preserves operational history.
 *   - **Audit:** one row per rewrite in `tenants/{tid}/cascadeAuditLog`
 *     with `action: 'normalize_status_spelling'`,
 *     `beforeAssignmentStatus: 'canceled'`,
 *     `afterAssignmentStatus: 'cancelled'`. Skipped rows do NOT audit
 *     (the dry-run report is the audit for the no-op population).
 *
 * --------------------------------------------------------------------
 * Idempotency
 * --------------------------------------------------------------------
 * After a clean `--no-dry-run` run the same script returns
 *   `written = 0`, `skipped_already_canonical = scanned`, `errors = []`.
 * If a follow-up `--no-dry-run` ever shows `written > 0`, something
 * regenerated the old spelling — investigate the upstream write site
 * (the cascade trigger should be patched as of R.4.2-F3).
 *
 * --------------------------------------------------------------------
 * Mirrors the R.0c / R.1 ops shape
 * --------------------------------------------------------------------
 *   - dryRun = TRUE by default
 *   - single-tenant scope (gated by `securityLevel >= 7` on the
 *     active tenant; the CLI bypasses via service-account creds)
 *   - doc-id pagination via `pageToken` / `nextPageToken`
 *   - pageSize defaults to 1000, max 5000
 *   - audit emitted via the shared `writeCascadeAuditEntry` helper so
 *     R.16.1 forensic queries pick this up automatically
 *
 * @see docs/R4_2_FOLLOWUPS.md §R.4.2-F3
 * @see functions/src/shiftAssignmentCascades.ts (upstream writer patched)
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { writeCascadeAuditEntry } from './onJobOrderStatusTransitionSnapshot';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WRITE_CONCURRENCY = 10;

/** The exact source spelling this normalizer targets. Case-sensitive. */
export const STATUS_SPELLING_SOURCE = 'canceled' as const;
/** The canonical destination spelling. */
export const STATUS_SPELLING_TARGET = 'cancelled' as const;

interface NormalizeRequest {
  tenantId?: string;
  dryRun?: boolean;
  limit?: number;
  /** Doc-id cursor from a previous response's `nextPageToken`. */
  pageToken?: string | null;
}

export interface NormalizeAssignmentStatusSpellingReport {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  scanned: number;
  /** Docs whose `status` matched the source literal. */
  candidates: number;
  /** `--no-dry-run` only: docs the rewrite touched. */
  written: number;
  /** `--dry-run` only: docs the rewrite WOULD touch. */
  wouldWrite: number;
  /** Docs whose `status` was already canonical (`'cancelled'` or anything other than the source literal). */
  skipped_already_canonical: number;
  /**
   * Per-row record (capped to first 100 to keep the response payload
   * within the 10MB callable limit on big tenants).
   */
  rewritten: Array<{ assignmentId: string }>;
  errors: Array<{ assignmentId: string; error: string }>;
  truncated: boolean;
  nextPageToken: string | null;
  durationMs: number;
}

/**
 * Pure classifier. Exported for unit testing — keeps the filter
 * logic test-isolatable from the Firestore harness.
 */
export function shouldNormalizeAssignmentStatus(
  rawStatus: unknown,
): { rewrite: boolean; before: string | null } {
  if (typeof rawStatus !== 'string') return { rewrite: false, before: null };
  // Case-sensitive intentional — the dataset uses lowercase
  // assignment statuses everywhere; an uppercase variant would be a
  // separate (and weirder) data-hygiene issue worth surfacing
  // independently rather than silently rewriting.
  if (rawStatus === STATUS_SPELLING_SOURCE) return { rewrite: true, before: rawStatus };
  return { rewrite: false, before: rawStatus };
}

interface ProcessOneArgs {
  tenantId: string;
  assignmentId: string;
  assignmentData: Record<string, unknown>;
  dryRun: boolean;
  fdb: admin.firestore.Firestore;
}

interface ProcessOneOutcome {
  outcome: 'rewrote' | 'would_rewrite' | 'skipped_already_canonical';
  before: string | null;
}

async function processOneAssignment(args: ProcessOneArgs): Promise<ProcessOneOutcome> {
  const { tenantId, assignmentId, assignmentData, dryRun, fdb } = args;

  const decision = shouldNormalizeAssignmentStatus(assignmentData.status);
  if (!decision.rewrite) {
    return { outcome: 'skipped_already_canonical', before: decision.before };
  }

  if (dryRun) {
    return { outcome: 'would_rewrite', before: decision.before };
  }

  await fdb.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      status: STATUS_SPELLING_TARGET,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'system',
    },
    { merge: true },
  );

  // Best-effort audit row. Failures here are logged but never abort
  // the operation — same convention as R.16.1's writeCascadeAuditEntry.
  try {
    await writeCascadeAuditEntry(
      {
        action: 'normalize_status_spelling',
        tenantId,
        assignmentId,
        triggeredBy: 'backfill',
        context: 'r4_2-f3 status-spelling normalizer',
        beforeAssignmentStatus: decision.before ?? STATUS_SPELLING_SOURCE,
        afterAssignmentStatus: STATUS_SPELLING_TARGET,
      },
      fdb,
    );
  } catch (err) {
    logger.warn('[R.4.2-F3] audit write failed (non-fatal)', {
      tenantId,
      assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { outcome: 'rewrote', before: decision.before };
}

export interface RunNormalizeStatusSpellingPageArgs {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  pageToken: string | null;
  fdb: admin.firestore.Firestore;
}

export async function runNormalizeAssignmentStatusSpellingPage(
  args: RunNormalizeStatusSpellingPageArgs,
): Promise<NormalizeAssignmentStatusSpellingReport> {
  const { tenantId, dryRun, limit, pageToken, fdb } = args;
  const startMs = Date.now();

  let q = fdb
    .collection(`tenants/${tenantId}/assignments`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(limit) as admin.firestore.Query;
  if (pageToken) q = q.startAfter(pageToken);

  const snap = await q.get();

  const report: NormalizeAssignmentStatusSpellingReport = {
    tenantId,
    dryRun,
    limit,
    scanned: snap.size,
    candidates: 0,
    written: 0,
    wouldWrite: 0,
    skipped_already_canonical: 0,
    rewritten: [],
    errors: [],
    truncated: snap.size === limit,
    nextPageToken: snap.size === limit ? snap.docs[snap.docs.length - 1].id : null,
    durationMs: 0,
  };

  for (let i = 0; i < snap.docs.length; i += WRITE_CONCURRENCY) {
    const chunk = snap.docs.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (doc) => {
        try {
          const out = await processOneAssignment({
            tenantId,
            assignmentId: doc.id,
            assignmentData: (doc.data() ?? {}) as Record<string, unknown>,
            dryRun,
            fdb,
          });
          return { ok: true as const, assignmentId: doc.id, result: out };
        } catch (e) {
          return {
            ok: false as const,
            assignmentId: doc.id,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ assignmentId: item.assignmentId, error: item.error });
        continue;
      }
      switch (item.result.outcome) {
        case 'rewrote':
          report.candidates += 1;
          report.written += 1;
          if (report.rewritten.length < 100) {
            report.rewritten.push({ assignmentId: item.assignmentId });
          }
          break;
        case 'would_rewrite':
          report.candidates += 1;
          report.wouldWrite += 1;
          if (report.rewritten.length < 100) {
            report.rewritten.push({ assignmentId: item.assignmentId });
          }
          break;
        case 'skipped_already_canonical':
          report.skipped_already_canonical += 1;
          break;
      }
    }
  }

  report.durationMs = Date.now() - startMs;
  return report;
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

export const normalizeAssignmentStatusSpellingCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<NormalizeAssignmentStatusSpellingReport> => {
    const requestData = (request.data ?? {}) as NormalizeRequest;
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

    const tenantId = String(requestData.tenantId ?? '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const dryRun = requestData.dryRun !== false; // default TRUE
    const requestedLimit = Number(requestData.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const pageToken =
      typeof requestData.pageToken === 'string' && requestData.pageToken.trim().length > 0
        ? requestData.pageToken.trim()
        : null;

    const fdb = admin.firestore();
    const userSnap = await fdb.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User record not found.');
    }
    const callerUser = userSnap.data() ?? {};
    const callerSecurityLevel = getSecurityLevelForActiveTenant(callerUser);
    const callerActiveTenantId =
      typeof callerUser.activeTenantId === 'string' ? callerUser.activeTenantId : null;

    if (callerActiveTenantId !== tenantId || callerSecurityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions. Normalizer requires security level 7 on the requested tenant.',
      );
    }

    const report = await runNormalizeAssignmentStatusSpellingPage({
      tenantId,
      dryRun,
      limit,
      pageToken,
      fdb,
    });

    logger.info('[R.4.2-F3][normalizeAssignmentStatusSpellingCallable] complete', {
      tenantId,
      dryRun,
      limit,
      scanned: report.scanned,
      candidates: report.candidates,
      written: report.written,
      wouldWrite: report.wouldWrite,
      skipped_already_canonical: report.skipped_already_canonical,
      errorCount: report.errors.length,
      truncated: report.truncated,
      nextPageToken: report.nextPageToken,
      durationMs: report.durationMs,
      callerUid: uid,
    });

    return report;
  },
);
