/**
 * R.0c — Admin-callable backfill for `workerAttestations`.
 *
 * For each `tenants/{tenantId}/applications/*` doc that has been submitted at
 * some point (`submittedAt` is set), replays the canonical R.0a/R.0b mapping
 * onto the worker's user doc with:
 *
 *   - `source = 'application_backfill'`
 *   - `attestedAt` = the application's original `submittedAt` (falls back to
 *     `appliedAt`, then `createdAt`, then write-time `now()`)
 *
 * Profile-wins-once-set (D2) is preserved: a field is only written when the
 * profile slot is null/missing/empty. This means re-runs are idempotent and
 * R.0c never overwrites a worker's R.0b-synced answers OR a future R.9
 * worker-edit value.
 *
 * Dry-run is the default. Set `dryRun: false` to actually write.
 *
 * Pagination uses doc-id cursor. The default `limit: 1000` is fine for the
 * single tenant we're backfilling today; if the dry-run report shows
 * `truncated: true` (i.e. we hit the limit and there's more), pass back the
 * `nextPageToken` from the response on the next call.
 *
 * See: docs/READINESS_R0_HANDOFF.md (PR 3)
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import {
  buildAttestationsSyncPatchFromApplication,
  type AttestationAttestedAt,
} from './triggers/onApplicationSubmittedSyncProfile';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WRITE_CONCURRENCY = 10;

interface BackfillRequest {
  tenantId?: string;
  dryRun?: boolean;
  limit?: number;
  /** Doc-id cursor from a previous response's `nextPageToken`. */
  pageToken?: string | null;
}

interface BackfillReport {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  scanned: number;
  candidates: number;
  written: number;
  wouldWrite: number;
  skipped_no_uid: number;
  skipped_unsubmitted: number;
  skipped_user_doc_missing: number;
  skipped_profile_already_set: number;
  fieldsWritten: number;
  errors: Array<{ appId: string; error: string }>;
  truncated: boolean;
  nextPageToken: string | null;
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

function pickAttestedAtFromApplication(
  app: Record<string, unknown>,
): AttestationAttestedAt {
  const candidates = ['submittedAt', 'appliedAt', 'createdAt'] as const;
  for (const key of candidates) {
    const value = app[key];
    if (value instanceof admin.firestore.Timestamp) return value;
    if (value instanceof Date) return value;
    // Some legacy docs store ISO strings — coerce to Date.
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return admin.firestore.FieldValue.serverTimestamp();
}

function pickUidFromApplication(app: Record<string, unknown>): string | null {
  if (typeof app.userId === 'string' && app.userId.trim().length > 0) return app.userId;
  if (typeof app.workerId === 'string' && app.workerId.trim().length > 0) return app.workerId;
  if (typeof app.uid === 'string' && app.uid.trim().length > 0) return app.uid;
  return null;
}

function appHasBeenSubmitted(app: Record<string, unknown>): boolean {
  // The most reliable signal that the application was submitted at some point
  // is the presence of `submittedAt`. Wizard.tsx writes both `submittedAt`
  // and `appliedAt` on submit; drafts have neither. We prefer the explicit
  // timestamp check over a status enum because the status field has churned
  // through several values over time (`submitted`, `reviewing`, `hired`, etc.)
  // and `submittedAt` is a stable proxy for "this was committed at some point".
  return app.submittedAt !== undefined && app.submittedAt !== null;
}

async function processOneApplication(args: {
  tenantId: string;
  appId: string;
  appData: Record<string, unknown>;
  dryRun: boolean;
  source: 'application_backfill';
}): Promise<{
  outcome:
    | 'skipped_no_uid'
    | 'skipped_unsubmitted'
    | 'skipped_user_doc_missing'
    | 'skipped_profile_already_set'
    | 'wrote'
    | 'would_write';
  fieldsWritten: number;
}> {
  if (!appHasBeenSubmitted(args.appData)) {
    return { outcome: 'skipped_unsubmitted', fieldsWritten: 0 };
  }

  const uid = pickUidFromApplication(args.appData);
  if (!uid) return { outcome: 'skipped_no_uid', fieldsWritten: 0 };

  const userRef = admin.firestore().doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return { outcome: 'skipped_user_doc_missing', fieldsWritten: 0 };
  }

  const existingAttestations = ((userSnap.data() ?? {}).workerAttestations ??
    {}) as Record<string, unknown>;

  const attestedAt = pickAttestedAtFromApplication(args.appData);

  const patch = buildAttestationsSyncPatchFromApplication({
    applicationDoc: args.appData,
    existingAttestations,
    source: args.source,
    attestedAt,
  });

  if (Object.keys(patch).length === 0) {
    return { outcome: 'skipped_profile_already_set', fieldsWritten: 0 };
  }

  if (!args.dryRun) {
    // D2 `merge: true` so partial patches don't stomp unrelated profile fields.
    await userRef.set(patch, { merge: true });
    return { outcome: 'wrote', fieldsWritten: Object.keys(patch).length };
  }
  return { outcome: 'would_write', fieldsWritten: Object.keys(patch).length };
}

export const backfillWorkerAttestationsCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<BackfillReport> => {
    const requestData = (request.data ?? {}) as BackfillRequest;
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

    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User record not found.');
    }
    const callerUser = userSnap.data() ?? {};
    const callerSecurityLevel = getSecurityLevelForActiveTenant(callerUser);
    const callerActiveTenantId =
      typeof callerUser.activeTenantId === 'string' ? callerUser.activeTenantId : null;

    // R.0c is HRX-staff territory (writes to many user profiles). Match the
    // gate used by `backfillSlackChannels` (security level 7 + active tenant
    // matches the requested tenant). Spec sketched ">= 6" but the existing
    // backfill convention is stricter; if Greg wants to relax this later it's
    // a one-line change.
    if (callerActiveTenantId !== tenantId || callerSecurityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions. Backfill requires security level 7 on the requested tenant.',
      );
    }

    let appsQuery = db
      .collection(`tenants/${tenantId}/applications`)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);
    if (pageToken) {
      appsQuery = appsQuery.startAfter(pageToken);
    }

    const apps = await appsQuery.get();

    const report: BackfillReport = {
      tenantId,
      dryRun,
      limit,
      scanned: apps.size,
      candidates: 0,
      written: 0,
      wouldWrite: 0,
      skipped_no_uid: 0,
      skipped_unsubmitted: 0,
      skipped_user_doc_missing: 0,
      skipped_profile_already_set: 0,
      fieldsWritten: 0,
      errors: [],
      truncated: apps.size === limit,
      nextPageToken: apps.size === limit ? apps.docs[apps.docs.length - 1].id : null,
    };

    // Process in chunks to bound concurrency. Each chunk runs in parallel;
    // chunks are awaited sequentially so we don't fan out 1000 user-doc reads
    // at once.
    for (let i = 0; i < apps.docs.length; i += WRITE_CONCURRENCY) {
      const chunk = apps.docs.slice(i, i + WRITE_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (appDoc) => {
          try {
            const result = await processOneApplication({
              tenantId,
              appId: appDoc.id,
              appData: appDoc.data() ?? {},
              dryRun,
              source: 'application_backfill',
            });
            return { ok: true as const, appId: appDoc.id, result };
          } catch (e) {
            return {
              ok: false as const,
              appId: appDoc.id,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );

      for (const item of results) {
        if (!item.ok) {
          report.errors.push({ appId: item.appId, error: item.error });
          continue;
        }
        const { outcome, fieldsWritten } = item.result;
        switch (outcome) {
          case 'skipped_no_uid':
            report.skipped_no_uid += 1;
            break;
          case 'skipped_unsubmitted':
            report.skipped_unsubmitted += 1;
            break;
          case 'skipped_user_doc_missing':
            report.skipped_user_doc_missing += 1;
            break;
          case 'skipped_profile_already_set':
            report.candidates += 1;
            report.skipped_profile_already_set += 1;
            break;
          case 'wrote':
            report.candidates += 1;
            report.written += 1;
            report.fieldsWritten += fieldsWritten;
            break;
          case 'would_write':
            report.candidates += 1;
            report.wouldWrite += 1;
            report.fieldsWritten += fieldsWritten;
            break;
        }
      }
    }

    logger.info('[R.0c][backfillWorkerAttestationsCallable] complete', {
      tenantId,
      dryRun,
      limit,
      scanned: report.scanned,
      candidates: report.candidates,
      written: report.written,
      wouldWrite: report.wouldWrite,
      skipped_unsubmitted: report.skipped_unsubmitted,
      skipped_no_uid: report.skipped_no_uid,
      skipped_user_doc_missing: report.skipped_user_doc_missing,
      skipped_profile_already_set: report.skipped_profile_already_set,
      fieldsWritten: report.fieldsWritten,
      errorCount: report.errors.length,
      truncated: report.truncated,
      nextPageToken: report.nextPageToken,
      callerUid: uid,
    });

    return report;
  },
);
