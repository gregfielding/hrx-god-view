/**
 * Recompute denormalized recruiter score summary fields from the latest interviews (safe path).
 * Calls `recomputeUserInterviewScoreSummary` — aligns `scoreSummary.overrideAdjustedScore`, primary source
 * metadata, and related fields with the latest `worker_ai_prescreen` when present.
 *
 * Usage (repo root):
 *   npm run recruiter:resync-primary-summaries -- --limit=500
 *   npm run recruiter:resync-primary-summaries -- --dry-run --uid=USER_ID
 *
 * From `functions/`:
 *   npx ts-node src/scripts/resyncRecruiterPrimarySummaries.ts --uid=USER_ID
 */
import * as admin from 'firebase-admin';
import { recomputeUserInterviewScoreSummary } from '../workerAiPrescreen/recomputeInterviewScoreSummary';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Args = { limit: number; dryRun: boolean; uid: string | null };

function parseArgs(argv: string[]): Args {
  let limit = 500;
  let dryRun = false;
  let uid: string | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 500);
    else if (a.startsWith('--uid=')) uid = a.slice('--uid='.length).trim() || null;
  }
  return { limit, dryRun, uid };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let updated = 0;
  let errors = 0;
  let dryRunCount = 0;

  const runOne = async (userId: string) => {
    if (args.dryRun) {
      console.log('[dry-run] would recompute', userId);
      dryRunCount += 1;
      return;
    }
    try {
      await recomputeUserInterviewScoreSummary(db, userId);
      updated += 1;
      console.log('ok', userId);
    } catch (e) {
      errors += 1;
      console.warn('failed', userId, e instanceof Error ? e.message : e);
    }
  };

  if (args.uid) {
    await runOne(args.uid);
  } else {
    let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    const page = 200;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const done = args.dryRun ? dryRunCount >= args.limit : updated >= args.limit;
      if (done) break;
      let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(page);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const doneInner = args.dryRun ? dryRunCount >= args.limit : updated >= args.limit;
        if (doneInner) break;
        const uid = doc.id;
        const intSnap = await db.collection('users').doc(uid).collection('interviews').limit(40).get();
        const hasPrescreen = intSnap.docs.some((d) => d.data().interviewKind === 'worker_ai_prescreen');
        if (!hasPrescreen) continue;
        await runOne(uid);
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < page) break;
    }
  }

  console.log(JSON.stringify({ updated, dryRunQueued: dryRunCount, errors, dryRun: args.dryRun }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
