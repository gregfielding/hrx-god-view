/**
 * Operational backfill / refresh for `users.{uid}.riskProfile` via canonical path (no duplicated risk logic).
 *
 * Usage (from `functions/`):
 *   npx ts-node src/scripts/refreshWorkerRiskProfiles.ts --dry-run --limit=20
 *   npx ts-node src/scripts/refreshWorkerRiskProfiles.ts --tenantId=TENANT --limit=100
 *   npx ts-node src/scripts/refreshWorkerRiskProfiles.ts --userId=UID
 *   npx ts-node src/scripts/refreshWorkerRiskProfiles.ts --after=2025-01-01T00:00:00.000Z --limit=50
 *   npx ts-node src/scripts/refreshWorkerRiskProfiles.ts --only-missing --limit=200
 *   npx ts-node src/scripts/refreshWorkerRiskProfiles.ts --only-stale --limit=200
 */
import * as admin from 'firebase-admin';
import { refreshWorkerRiskProfileForUidCanonical } from '../workerAiPrescreen/workerRiskProfileRefreshCanonical';
import { classifyRiskProfileStaleness } from '../workerAiPrescreen/workerRiskProfileStaleness';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Args = {
  dryRun: boolean;
  limit: number;
  tenantId: string | null;
  userId: string | null;
  after: Date | null;
  onlyMissing: boolean;
  onlyStale: boolean;
  startAfterUserId: string | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit = 100;
  let tenantId: string | null = null;
  let userId: string | null = null;
  let after: Date | null = null;
  let onlyMissing = false;
  let onlyStale = false;
  let startAfterUserId: string | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || null;
    else if (a.startsWith('--userId=')) userId = a.slice('--userId='.length).trim() || null;
    else if (a.startsWith('--after=')) {
      const d = new Date(a.slice('--after='.length).trim());
      after = Number.isNaN(d.getTime()) ? null : d;
    } else if (a === '--only-missing') onlyMissing = true;
    else if (a === '--only-stale') onlyStale = true;
    else if (a.startsWith('--start-after-user-id=')) {
      startAfterUserId = a.slice('--start-after-user-id='.length).trim() || null;
    }
  }
  return { dryRun, limit, tenantId, userId, after, onlyMissing, onlyStale, startAfterUserId };
}

function runSummaryJson(args: {
  dryRun: boolean;
  processed: number;
  updated: number;
  wouldUpdate: number;
  skipped: number;
  errors: number;
  lastId?: string | null;
}): Record<string, unknown> {
  const { dryRun, processed, updated, wouldUpdate, skipped, errors, lastId } = args;
  const base: Record<string, unknown> = { processed, skipped, errors, dryRun };
  if (dryRun) {
    base.wouldUpdate = wouldUpdate;
  } else {
    base.updated = updated;
  }
  if (lastId !== undefined) base.lastId = lastId;
  return base;
}

function tenantMatch(data: Record<string, unknown>, tenantId: string): boolean {
  const t = data.tenantIds as Record<string, unknown> | undefined;
  return !!(t && t[tenantId]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let processed = 0;
  let updated = 0;
  let wouldUpdate = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;

  const runOne = async (uid: string) => {
    const r = await refreshWorkerRiskProfileForUidCanonical(db, uid, { dryRun: args.dryRun });
    processed += 1;
    if (r.status === 'updated') updated += 1;
    else if (r.status === 'dry_run_would_update') wouldUpdate += 1;
    else if (r.status === 'error') errors += 1;
    else skipped += 1;
    console.log(
      `[${r.status}] ${uid} ${r.reason}${r.newSignature ? ` sig=${String(r.newSignature).slice(0, 12)}…` : ''}`,
    );
  };

  if (args.userId) {
    await runOne(args.userId);
    console.log(JSON.stringify(runSummaryJson({ dryRun: args.dryRun, processed, updated, wouldUpdate, skipped, errors }), null, 2));
    return;
  }

  let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(300);
  if (args.startAfterUserId) {
    q = q.startAfter(args.startAfterUserId);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      if (processed >= args.limit) {
        console.log(
          JSON.stringify(
            runSummaryJson({ dryRun: args.dryRun, processed, updated, wouldUpdate, skipped, errors, lastId }),
            null,
            2,
          ),
        );
        return;
      }
      const data = doc.data() as Record<string, unknown>;
      if (args.tenantId && !tenantMatch(data, args.tenantId)) continue;
      if (args.after) {
        const ua = data.updatedAt as { toDate?: () => Date } | undefined;
        const ud = ua?.toDate?.();
        if (!ud || ud < args.after) continue;
      }
      if (args.onlyMissing && data.riskProfile) continue;
      if (args.onlyStale && classifyRiskProfileStaleness(data) !== 'stale') continue;

      lastId = doc.id;
      await runOne(doc.id);
    }
    const last = snap.docs[snap.docs.length - 1];
    if (!last || snap.docs.length < 300) break;
    q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).startAfter(last).limit(300);
  }

  console.log(
    JSON.stringify(runSummaryJson({ dryRun: args.dryRun, processed, updated, wouldUpdate, skipped, errors, lastId }), null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
