/**
 * Rebuild `users/{uid}.recruiterScoreSnapshot` via the canonical refresh path.
 *
 * Usage (repo root):
 *   npm run scores:backfill -- --dry-run --limit=100
 *   npm run scores:backfill -- --all
 *   npm run scores:backfill -- --tenantId=TENANT_ID --all
 *   npm run scores:backfill -- --userId=UID
 *
 * From `functions/`:
 *   npx ts-node --project tsconfig.scripts.json src/scripts/backfillRecruiterScoreSnapshots.ts --dry-run --limit=20
 */
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { buildRecruiterScoreSnapshotForUserDoc } from '../scoring/buildRecruiterScoreSnapshot';
import { buildRecruiterMasterScoreForUserDoc } from '../scoring/buildRecruiterMasterScore';
import { refreshRecruiterScoreSnapshotForUser } from '../scoring/refreshRecruiterScoreSnapshot';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Args = {
  dryRun: boolean;
  limit: number | null;
  all: boolean;
  tenantId: string | null;
  userId: string | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit: number | null = 100;
  let all = false;
  let tenantId: string | null = null;
  let userId: string | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--all') {
      all = true;
      limit = null;
    } else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      limit = Number.isFinite(n) && n > 0 ? n : 100;
      all = false;
    } else if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || null;
    else if (a.startsWith('--userId=')) userId = a.slice('--userId='.length).trim() || null;
  }
  return { dryRun, limit, all, tenantId, userId };
}

function tenantMatches(data: Record<string, unknown>, tenantId: string | null): boolean {
  if (!tenantId) return true;
  const t = data.tenantIds as Record<string, unknown> | undefined;
  return Boolean(t && typeof t === 'object' && t[tenantId] != null);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let missingPrimary = 0;
  /** Dry-run only: mirrors `refreshRecruiterScoreSnapshotForUser` write/skip counts (no Firestore writes). */
  let dryRunWouldWrite = 0;
  let dryRunWouldSkip = 0;
  const errors: string[] = [];

  const processOne = async (uid: string, data: Record<string, unknown>) => {
    scanned += 1;
    const hadSnap = Boolean(data.recruiterScoreSnapshot);
    const prevScore =
      hadSnap && typeof (data.recruiterScoreSnapshot as { score100?: unknown })?.score100 === 'number'
        ? (data.recruiterScoreSnapshot as { score100: number }).score100
        : null;
    if (args.dryRun) {
      try {
        const nextSnap = await buildRecruiterScoreSnapshotForUserDoc(db, uid, 'system');
        const nextMaster = await buildRecruiterMasterScoreForUserDoc(db, uid, 'system');
        const existingSig = (data.recruiterScoreSnapshot as { inputSignature?: string | null } | undefined)
          ?.inputSignature;
        const existingMasterSig = (data.recruiterMasterScore as { inputSignature?: string | null } | undefined)
          ?.inputSignature;
        const wouldSkip =
          existingSig === nextSnap.inputSignature &&
          existingMasterSig === nextMaster.inputSignature &&
          nextSnap.inputSignature != null &&
          nextMaster.inputSignature != null;
        if (wouldSkip) dryRunWouldSkip += 1;
        else dryRunWouldWrite += 1;
        console.log(
          JSON.stringify({
            uid,
            dryRun: true,
            hadSnapshot: hadSnap,
            previousScore100: prevScore,
            projectedScore100: nextSnap.score100 ?? null,
            projectedScoreKind: nextSnap.scoreKind ?? null,
            projectedMasterScore100: nextMaster.score100 ?? null,
            projectedMasterGrade: nextMaster.grade ?? null,
            wouldWrite: !wouldSkip,
          }),
        );
      } catch (e) {
        errors.push(`${uid}: ${e instanceof Error ? e.message : String(e)}`);
        console.log(
          JSON.stringify({
            uid,
            dryRun: true,
            hadSnapshot: hadSnap,
            previousScore100: prevScore,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      return;
    }
    try {
      const r = await refreshRecruiterScoreSnapshotForUser(db, uid, 'system');
      if (r.updated) updated += 1;
      else unchanged += 1;
      const after = (await db.collection('users').doc(uid).get()).data()?.recruiterScoreSnapshot as
        | { score100?: number | null }
        | undefined;
      if (after?.score100 == null) missingPrimary += 1;
    } catch (e) {
      errors.push(`${uid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const maxToProcess = args.all ? Number.POSITIVE_INFINITY : args.limit ?? 100;
  let processed = 0;

  if (args.userId) {
    const doc = await db.collection('users').doc(args.userId).get();
    if (!doc.exists) {
      console.error('User not found:', args.userId);
      process.exit(1);
    }
    const data = doc.data() as Record<string, unknown>;
    if (!tenantMatches(data, args.tenantId)) {
      console.error('User not in tenant:', args.tenantId);
      process.exit(1);
    }
    await processOne(args.userId, data);
  } else {
    let last: string | null = null;
    const pageSize = 300;
    // eslint-disable-next-line no-constant-condition
    while (processed < maxToProcess) {
      let q = db.collection('users').orderBy(FieldPath.documentId()).limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        last = d.id;
        const data = d.data() as Record<string, unknown>;
        if (!tenantMatches(data, args.tenantId)) continue;
        await processOne(d.id, data);
        processed += 1;
        if (processed >= maxToProcess) break;
      }
      if (snap.docs.length < pageSize) break;
    }
  }

  console.log(
    JSON.stringify(
      {
        scanned,
        updated,
        unchanged,
        missingPrimaryScore100: missingPrimary,
        dryRun: args.dryRun,
        ...(args.dryRun
          ? {
              wouldWrite: dryRunWouldWrite,
              wouldSkipUnchanged: dryRunWouldSkip,
            }
          : {}),
        errors,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
