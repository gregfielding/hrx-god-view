/**
 * QA report: candidate fairness calibration (harsh outcomes for blue-collar ops).
 *
 * Usage (from repo root):
 *   npm run qa:prescreen-fairness -- --limit=80
 *
 * From `functions/`:
 *   npx ts-node src/scripts/qaPrescreenFairnessReview.ts --limit=50
 */
import * as admin from 'firebase-admin';
import {
  analyzePrescreenFairness,
  summarizeTransportAttendancePhysical,
} from '../utils/prescreenFairnessQa';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const WORKER_AI_PRESCREEN = 'worker_ai_prescreen';

type Args = {
  dryRun: boolean;
  limit: number;
  tenantId: string | null;
  systemOnly: boolean;
  after: Date | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit = 100;
  let tenantId: string | null = null;
  let systemOnly = false;
  let after: Date | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--system-only') systemOnly = true;
    else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || null;
    else if (a.startsWith('--after=')) {
      const raw = a.slice('--after='.length).trim();
      const d = new Date(raw);
      after = Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return { dryRun, limit, tenantId, systemOnly, after };
}

function tenantFromInterviewData(data: Record<string, unknown>): string | null {
  const ai = data.ai as Record<string, unknown> | undefined;
  const ctx = ai?.aiInterviewContext as Record<string, unknown> | undefined;
  const br = ctx?.businessRules as Record<string, unknown> | undefined;
  const t = br?.tenant;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function interviewCreatedAt(data: Record<string, unknown>): Date | null {
  const c = data.createdAt as { toDate?: () => Date } | undefined;
  const t = data.timestamp as { toDate?: () => Date } | undefined;
  return c?.toDate?.() ?? t?.toDate?.() ?? null;
}

function interviewMatchesSystem(data: Record<string, unknown>): boolean {
  const ai = data.ai as Record<string, unknown> | undefined;
  return String(ai?.model ?? '').trim() === 'rules_v1';
}

const GLOBAL_USER_PAGE_SIZE = 200;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows: Record<string, unknown>[] = [];
  let usersScanned = 0;
  let interviewsSeen = 0;
  let lastUser: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (rows.length < args.limit) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(GLOBAL_USER_PAGE_SIZE);
    if (lastUser) q = q.startAfter(lastUser);
    const usersSnap = await q.get();
    if (usersSnap.empty) break;
    for (const userDoc of usersSnap.docs) {
      usersScanned += 1;
      if (rows.length >= args.limit) break;
      const uid = userDoc.id;
      const intSnap = await db.collection('users').doc(uid).collection('interviews').get();
      for (const d of intSnap.docs) {
        interviewsSeen += 1;
        if (rows.length >= args.limit) break;
        const data = d.data() as Record<string, unknown>;
        if (data.interviewKind !== WORKER_AI_PRESCREEN) continue;
        if (args.systemOnly && !interviewMatchesSystem(data)) continue;
        if (args.tenantId && tenantFromInterviewData(data) !== args.tenantId) continue;
        if (args.after) {
          const ca = interviewCreatedAt(data);
          if (!ca || ca <= args.after) continue;
        }
        const ai = data.ai as Record<string, unknown> | undefined;
        const findings = analyzePrescreenFairness({ ai });
        if (findings.length === 0) continue;

        const hd = ai?.hiringDecision as Record<string, unknown> | undefined;
        const base = typeof ai?.baseInterviewScore === 'number' ? ai?.baseInterviewScore : ai?.overallScore;
        rows.push({
          uid,
          interviewId: d.id,
          base,
          adjusted: typeof ai?.overrideAdjustedScore === 'number' ? ai?.overrideAdjustedScore : base,
          recommendation: ai?.recommendation,
          decision: hd?.decision,
          autoAdvance: hd?.eligibleForAutoAdvance,
          flags: ai?.flags,
          transportAttendancePhysicalSummary: summarizeTransportAttendancePhysical(ai),
          fairnessFlags: findings.map((f) => f.code),
          explanation: findings.map((f) => f.message).join(' | '),
        });
      }
    }
    lastUser = usersSnap.docs[usersSnap.docs.length - 1];
    if (usersSnap.docs.length < GLOBAL_USER_PAGE_SIZE) break;
  }

  const payload = {
    ok: true,
    dryRun: args.dryRun,
    args,
    stats: { usersScanned, interviewsSeen, fairnessRows: rows.length },
    rows,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (args.dryRun) {
    console.log('[dry-run] no writes — report only');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
