/**
 * QA: recruiter score snapshot vs freshly built snapshot + interview pointer integrity.
 *
 * Usage (repo root):
 *   npm run qa:score-consistency -- --limit=200
 *   npm run qa:score-consistency -- --tenantId=TENANT_ID --dry-run
 *   npm run qa:score-consistency -- --userId=UID
 *
 * From `functions/`:
 *   npx ts-node --project tsconfig.scripts.json src/scripts/qaRecruiterScoreConsistency.ts --limit=50
 */
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { buildRecruiterScoreSnapshotForUserDoc } from '../scoring/buildRecruiterScoreSnapshot';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Args = {
  limit: number;
  dryRun: boolean;
  tenantId: string | null;
  userId: string | null;
};

function parseArgs(argv: string[]): Args {
  let limit = 200;
  let dryRun = false;
  let tenantId: string | null = null;
  let userId: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 200);
    else if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || null;
    else if (a.startsWith('--userId=')) userId = a.slice('--userId='.length).trim() || null;
  }
  return { limit, dryRun, tenantId, userId };
}

function tenantMatches(data: Record<string, unknown>, tenantId: string | null): boolean {
  if (!tenantId) return true;
  const t = data.tenantIds as Record<string, unknown> | undefined;
  return Boolean(t && typeof t === 'object' && t[tenantId] != null);
}

type Flag = {
  uid: string;
  kind: 'stale_or_drift' | 'missing_snapshot' | 'broken_source_interview' | 'decision_gap';
  detail: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const flags: Flag[] = [];
  let examined = 0;

  const checkUser = async (uid: string) => {
    const ref = db.collection('users').doc(uid);
    const cur = await ref.get();
    if (!cur.exists) return;
    const data = cur.data() as Record<string, unknown>;
    if (!tenantMatches(data, args.tenantId)) return;
    examined += 1;

    const stored = data.recruiterScoreSnapshot as Record<string, unknown> | undefined;
    if (!stored || stored.version !== 1) {
      flags.push({ uid, kind: 'missing_snapshot', detail: 'no version-1 recruiterScoreSnapshot' });
    }

    const built = await buildRecruiterScoreSnapshotForUserDoc(db, uid, 'system');
    const sScore = typeof stored?.score100 === 'number' && Number.isFinite(stored.score100) ? Math.round(stored.score100) : null;
    const bScore = built.score100 != null ? Math.round(built.score100) : null;
    if (sScore !== bScore) {
      flags.push({
        uid,
        kind: 'stale_or_drift',
        detail: `stored score100=${sScore} built=${bScore} (re-run backfill)`,
      });
    }

    const srcId = typeof stored?.sourceInterviewId === 'string' ? stored.sourceInterviewId : null;
    if (srcId) {
      const intDoc = await ref.collection('interviews').doc(srcId).get();
      if (!intDoc.exists) {
        flags.push({ uid, kind: 'broken_source_interview', detail: `sourceInterviewId=${srcId} missing` });
      }
    }

    if (stored && typeof stored.score100 === 'number' && Number.isFinite(stored.score100)) {
      const hasDecision = stored.decision != null && stored.decision !== '';
      const hasRec = stored.recommendation != null && stored.recommendation !== '';
      if (!hasDecision || !hasRec) {
        flags.push({
          uid,
          kind: 'decision_gap',
          detail: `decision=${String(stored.decision)} recommendation=${String(stored.recommendation)}`,
        });
      }
    }
  };

  if (args.userId) {
    await checkUser(args.userId);
  } else {
    let last: string | null = null;
    const pageSize = 200;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.collection('users').orderBy(FieldPath.documentId()).limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        last = d.id;
        await checkUser(d.id);
        if (examined >= args.limit) break;
      }
      if (snap.docs.length < pageSize || examined >= args.limit) break;
    }
  }

  const report = {
    examined,
    flagsFound: flags.length,
    dryRun: args.dryRun,
    flags: flags.slice(0, 500),
  };
  console.log(JSON.stringify(report, null, 2));
  if (args.dryRun && flags.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
