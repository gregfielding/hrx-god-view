/**
 * Batch refresh for `users.{uid}.scoreSummary` (Hiring Score v1.1) — scripts + scheduled job.
 * Uses the same payload as the web app (`getScoreSummaryUpdateFromHiringScoreV1`).
 * Signature guard: skips the write when the computed hiring score signature matches the stored one.
 */
import * as admin from 'firebase-admin';
import { getScoreSummaryUpdateFromHiringScoreV1 } from '../shared/hiringScoreFirestoreUpdate';
import { computeHiringScoreStaleness } from '../utils/hiringScoreStaleness';

export type RefreshHiringScoresModeArgs = {
  onlyMissing: boolean;
  onlyStale: boolean;
};

/** Whether this user should be considered by the current filter flags. */
export function userMatchesRefreshFilters(
  data: Record<string, unknown>,
  args: RefreshHiringScoresModeArgs,
): boolean {
  const ss = data.scoreSummary as Record<string, unknown> | undefined;
  const aiScore = ss?.aiScore;
  const hasAi = typeof aiScore === 'number' && Number.isFinite(aiScore);
  const sig = ss?.hiringScoreInputSignature;
  const hasSig = typeof sig === 'string' && sig.trim().length > 0;

  const needsMissing = !hasAi || !hasSig;
  const label = computeHiringScoreStaleness(data);
  const needsStale = label === 'stale';

  if (args.onlyMissing && args.onlyStale) return needsMissing && needsStale;
  if (args.onlyMissing) return needsMissing;
  if (args.onlyStale) return needsStale;
  return needsMissing || needsStale;
}

export type RefreshOneHiringScoreResult =
  | { status: 'skipped_filter' }
  | { status: 'skipped_signature' }
  | { status: 'dry_run_would_write' }
  | { status: 'updated' }
  | { status: 'error'; message: string };

/**
 * Recompute Hiring Score v1.1 and merge into the user doc. Respects signature guard (no write if unchanged).
 */
export async function refreshHiringScoreForUid(
  db: admin.firestore.Firestore,
  uid: string,
  opts: { dryRun: boolean },
): Promise<RefreshOneHiringScoreResult> {
  const ref = db.collection('users').doc(uid);
  let snap: admin.firestore.DocumentSnapshot;
  try {
    snap = await ref.get();
  } catch (e: any) {
    return { status: 'error', message: e?.message || String(e) };
  }
  if (!snap.exists) return { status: 'error', message: 'no document' };

  const data = snap.data() as Record<string, unknown>;
  const payload = getScoreSummaryUpdateFromHiringScoreV1(data);
  const newSig = payload['scoreSummary.hiringScoreInputSignature'];
  const existingSig = (data.scoreSummary as Record<string, unknown> | undefined)?.hiringScoreInputSignature as
    | string
    | undefined;

  if (existingSig != null && existingSig === newSig) {
    return { status: 'skipped_signature' };
  }

  if (opts.dryRun) return { status: 'dry_run_would_write' };

  try {
    await ref.update({
      ...payload,
      'scoreSummary.aiScoreUpdatedAt': admin.firestore.FieldValue.serverTimestamp(),
      'scoreSummary.hiringScoreComputedAt': admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: 'updated' };
  } catch (e: any) {
    return { status: 'error', message: e?.message || String(e) };
  }
}

export type RunRefreshHiringScoresBatchArgs = {
  dryRun: boolean;
  limit: number;
  userId: string | null;
  startAfterUserId: string | null;
} & RefreshHiringScoresModeArgs;

export type RunRefreshHiringScoresBatchResult = {
  processed: number;
  updated: number;
  skippedFilter: number;
  skippedSignature: number;
  errors: number;
  lastId: string | null;
};

/**
 * Scan users in document-id order; refresh up to `limit` users that match filters + per-doc predicate.
 */
export async function runRefreshHiringScoresBatch(
  db: admin.firestore.Firestore,
  args: RunRefreshHiringScoresBatchArgs,
): Promise<RunRefreshHiringScoresBatchResult> {
  let processed = 0;
  let updated = 0;
  let skippedFilter = 0;
  let skippedSignature = 0;
  let errors = 0;
  let lastId: string | null = null;

  const pageSize = 300;
  let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
  if (args.startAfterUserId) {
    q = q.startAfter(args.startAfterUserId);
  }

  if (args.userId) {
    const data = (await db.collection('users').doc(args.userId).get()).data() as Record<string, unknown> | undefined;
    if (!data) {
      return { processed: 0, updated: 0, skippedFilter: 0, skippedSignature: 0, errors: 1, lastId: null };
    }
    if (!userMatchesRefreshFilters(data, args)) {
      return { processed: 0, updated: 0, skippedFilter: 1, skippedSignature: 0, errors: 0, lastId: args.userId };
    }
    const r = await refreshHiringScoreForUid(db, args.userId, { dryRun: args.dryRun });
    processed = 1;
    if (r.status === 'updated' || r.status === 'dry_run_would_write') updated = 1;
    else if (r.status === 'skipped_signature') skippedSignature = 1;
    else if (r.status === 'error') errors = 1;
    return { processed, updated, skippedFilter, skippedSignature, errors, lastId: args.userId };
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (processed >= args.limit) {
        return { processed, updated, skippedFilter, skippedSignature, errors, lastId };
      }
      const data = doc.data() as Record<string, unknown>;
      if (!userMatchesRefreshFilters(data, args)) {
        skippedFilter += 1;
        lastId = doc.id;
        continue;
      }

      const r = await refreshHiringScoreForUid(db, doc.id, { dryRun: args.dryRun });
      processed += 1;
      lastId = doc.id;
      if (r.status === 'updated' || r.status === 'dry_run_would_write') updated += 1;
      else if (r.status === 'skipped_signature') skippedSignature += 1;
      else if (r.status === 'error') errors += 1;
    }

    const last = snap.docs[snap.docs.length - 1];
    if (!last || snap.docs.length < pageSize) break;
    q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).startAfter(last).limit(pageSize);
  }

  return { processed, updated, skippedFilter, skippedSignature, errors, lastId };
}
