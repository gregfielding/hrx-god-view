/**
 * QA: recruiter-facing score source conflicts (stale summary vs latest prescreen operational score).
 *
 * Flags when denormalized `users.scoreSummary` would imply a much lower primary score than the latest
 * `worker_ai_prescreen` interview `ai.overrideAdjustedScore`, or when summary fields are out of sync.
 *
 * Usage (repo root):
 *   npm run qa:recruiter-score-source -- --limit=200
 *   npm run qa:recruiter-score-source -- --dry-run --uid=USER_ID
 *
 * From `functions/`:
 *   npx ts-node src/scripts/qaRecruiterScoreSourceConflicts.ts --limit=50
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const WORKER_AI_PRESCREEN = 'worker_ai_prescreen';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

function letterGrade(n: number): Grade {
  if (n >= 90) return 'A';
  if (n >= 80) return 'B';
  if (n >= 70) return 'C';
  if (n >= 60) return 'D';
  return 'F';
}

function gradeIndex(g: Grade): number {
  return { A: 4, B: 3, C: 2, D: 1, F: 0 }[g];
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

function getCanonicalComposite(ss: Record<string, unknown>): number | null {
  const ai = finite(ss.aiScore);
  if (ai != null) return ai;
  return null;
}

/**
 * Mirrors `resolveRecruiterOperationalScore100` (summary only — list/header without live interview `ai`).
 */
function primaryFromSummaryOnly(ss: Record<string, unknown>): { score: number | null; source: string } {
  const override = finite(ss.overrideAdjustedScore);
  const base = finite(ss.baseInterviewScore);
  const last10 = finite(ss.interviewLastScore10);
  const count = typeof ss.interviewCount === 'number' ? ss.interviewCount : 0;
  const interviewLastAs100 =
    last10 != null && count > 0 ? Math.round(Math.max(0, Math.min(100, last10 * 10))) : null;
  const composite = getCanonicalComposite(ss);

  const score =
    override ?? base ?? interviewLastAs100 ?? composite ?? null;

  let source = 'none';
  if (override != null && score === override) source = 'summary_override';
  else if (base != null && score === base && override == null) source = 'summary_base';
  else if (interviewLastAs100 != null && score === interviewLastAs100) source = 'interview_last10_proxy';
  else if (composite != null && score === composite) source = 'legacy_composite_aiScore';
  return { score, source };
}

function operationalFromInterviewAi(ai: Record<string, unknown> | undefined): number | null {
  if (!ai) return null;
  const base = finite(ai.baseInterviewScore) ?? finite(ai.overallScore);
  const adj = finite(ai.overrideAdjustedScore);
  const pick = adj ?? base;
  return pick;
}

type Args = { limit: number; maxUsersScanned: number; dryRun: boolean; uid: string | null };

function parseArgs(argv: string[]): Args {
  let limit = 300;
  let maxUsersScanned = 8000;
  let dryRun = false;
  let uid: string | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 300);
    else if (a.startsWith('--maxUsersScanned='))
      maxUsersScanned = Math.max(10, parseInt(a.slice('--maxUsersScanned='.length), 10) || 8000);
    else if (a.startsWith('--uid=')) uid = a.slice('--uid='.length).trim() || null;
  }
  return { limit, maxUsersScanned, dryRun, uid };
}

type FlagRow = {
  uid: string;
  interviewId: string;
  flags: string[];
  displayedSource: string;
  displayedScore: number | null;
  operationalScore: number | null;
  profileComposite: number | null;
  delta: number | null;
  summaryOverride: number | null;
  recommendation?: string;
  hiringDecision?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows: FlagRow[] = [];

  const processUser = async (uid: string) => {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return;
    const userData = userSnap.data() as Record<string, unknown>;
    const ss = (userData.scoreSummary as Record<string, unknown>) || {};

    let intSnap;
    try {
      intSnap = await db.collection('users').doc(uid).collection('interviews').orderBy('createdAt', 'desc').get();
    } catch {
      try {
        intSnap = await db.collection('users').doc(uid).collection('interviews').orderBy('timestamp', 'desc').get();
      } catch {
        intSnap = await db.collection('users').doc(uid).collection('interviews').get();
      }
    }

    let latestPrescreen: { id: string; data: Record<string, unknown> } | null = null;
    for (const d of intSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (data.interviewKind === WORKER_AI_PRESCREEN) {
        latestPrescreen = { id: d.id, data };
        break;
      }
    }
    if (!latestPrescreen) return;

    const ai = latestPrescreen.data.ai as Record<string, unknown> | undefined;
    const op = operationalFromInterviewAi(ai);
    if (op == null) return;

    const listPrimary = primaryFromSummaryOnly(ss);
    const composite = getCanonicalComposite(ss);
    const summaryOverride = finite(ss.overrideAdjustedScore);

    const flags: string[] = [];
    const disp = listPrimary.score;
    const delta = disp != null ? op - disp : null;

    if (summaryOverride != null && Math.abs(summaryOverride - op) >= 3) {
      flags.push('stale_scoreSummary_overrideAdjustedScore');
    }

    if (listPrimary.source === 'legacy_composite_aiScore' && op >= 70 && (disp ?? 0) < 60) {
      flags.push('legacy_profile_score_overriding_prescreen_score');
    }

    if (delta != null && delta >= 20) {
      flags.push('recruiter_primary_score_conflicts_with_latest_operational_score');
    }

    const gDisp = disp != null ? letterGrade(disp) : null;
    const gOp = letterGrade(op);
    if (gDisp && gOp && Math.abs(gradeIndex(gOp) - gradeIndex(gDisp)) >= 2) {
      flags.push('header_grade_mismatch_vs_interview');
    }

    if (flags.length === 0) return;

    const hd = ai?.hiringDecision as Record<string, unknown> | undefined;
    rows.push({
      uid,
      interviewId: latestPrescreen.id,
      flags,
      displayedSource: listPrimary.source,
      displayedScore: disp,
      operationalScore: op,
      profileComposite: composite,
      delta,
      summaryOverride,
      recommendation: typeof ai?.recommendation === 'string' ? ai.recommendation : undefined,
      hiringDecision: typeof hd?.decision === 'string' ? hd.decision : undefined,
    });
  };

  if (args.uid) {
    await processUser(args.uid);
  } else {
    let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    const page = 200;
    let usersScanned = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (rows.length >= args.limit) break;
      if (usersScanned >= args.maxUsersScanned) break;
      let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(page);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        if (rows.length >= args.limit) break;
        if (usersScanned >= args.maxUsersScanned) break;
        usersScanned += 1;
        await processUser(doc.id);
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < page) break;
    }
  }

  console.log(JSON.stringify({ dryRun: args.dryRun, count: rows.length, maxUsersScanned: args.maxUsersScanned, rows }, null, 2));
  if (rows.length > 0 && !args.dryRun) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
