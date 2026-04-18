/**
 * Operational backfill / refresh for `users.{uid}.scoreSummary.aiScore` (Hiring Score v1.1).
 *
 * Usage (from repo root):
 *   npm run score:refresh -- --dry-run --limit=20
 *   npm run score:refresh -- --only-missing --limit=100
 *   npm run score:refresh -- --only-stale --limit=500
 *   npm run score:refresh -- --userId=UID
 *
 * From `functions/`:
 *   npx ts-node --project tsconfig.scripts.json src/scripts/refreshHiringScores.ts --dry-run --limit=20
 */
import * as admin from 'firebase-admin';
import { runRefreshHiringScoresBatch } from '../hiringScore/refreshHiringScoresCore';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Args = {
  dryRun: boolean;
  limit: number;
  userId: string | null;
  onlyMissing: boolean;
  onlyStale: boolean;
  startAfterUserId: string | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit = 100;
  let userId: string | null = null;
  let onlyMissing = false;
  let onlyStale = false;
  let startAfterUserId: string | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--userId=')) userId = a.slice('--userId='.length).trim() || null;
    else if (a === '--only-missing') onlyMissing = true;
    else if (a === '--only-stale') onlyStale = true;
    else if (a.startsWith('--start-after-user-id=')) {
      startAfterUserId = a.slice('--start-after-user-id='.length).trim() || null;
    }
  }
  return { dryRun, limit, userId, onlyMissing, onlyStale, startAfterUserId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const r = await runRefreshHiringScoresBatch(db, {
    dryRun: args.dryRun,
    limit: args.limit,
    userId: args.userId,
    onlyMissing: args.onlyMissing,
    onlyStale: args.onlyStale,
    startAfterUserId: args.startAfterUserId,
  });
  console.log(JSON.stringify({ ...r, dryRun: args.dryRun, args }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
