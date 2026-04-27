/**
 * Lightweight QA / ops report for recent `users.riskProfile` outputs.
 *
 * Usage (from `functions/`):
 *   npx ts-node src/scripts/qaRiskProfileReport.ts --limit=50
 *   npx ts-node src/scripts/qaRiskProfileReport.ts --minScore=70 --limit=30
 *   npx ts-node src/scripts/qaRiskProfileReport.ts --missing-only --limit=100
 *   npx ts-node src/scripts/qaRiskProfileReport.ts --stale-only --limit=100
 *   npx ts-node src/scripts/qaRiskProfileReport.ts --riskType=transportation --limit=50
 *   npx ts-node src/scripts/qaRiskProfileReport.ts --severity=high --limit=50
 */
import * as admin from 'firebase-admin';
import { classifyRiskProfileStaleness } from '../workerAiPrescreen/workerRiskProfileStaleness';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Args = {
  limit: number;
  tenantId: string | null;
  minScore: number | null;
  missingOnly: boolean;
  staleOnly: boolean;
  riskType: string | null;
  severity: string | null;
};

function parseArgs(argv: string[]): Args {
  let limit = 40;
  let tenantId: string | null = null;
  let minScore: number | null = null;
  let missingOnly = false;
  let staleOnly = false;
  let riskType: string | null = null;
  let severity: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 40);
    else if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || null;
    else if (a.startsWith('--minScore=')) minScore = parseInt(a.slice('--minScore='.length), 10) || null;
    else if (a === '--missing-only') missingOnly = true;
    else if (a === '--stale-only') staleOnly = true;
    else if (a.startsWith('--riskType=')) riskType = a.slice('--riskType='.length).trim() || null;
    else if (a.startsWith('--severity=')) severity = a.slice('--severity='.length).trim().toLowerCase() || null;
  }
  return { limit, tenantId, minScore, missingOnly, staleOnly, riskType, severity };
}

function tenantMatch(data: Record<string, unknown>, tenantId: string): boolean {
  const t = data.tenantIds as Record<string, unknown> | undefined;
  return !!(t && t[tenantId]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows: Record<string, unknown>[] = [];
  let scanned = 0;
  let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(400);
  // eslint-disable-next-line no-constant-condition
  while (rows.length < args.limit && scanned < 8000) {
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      if (rows.length >= args.limit) break;
      const data = doc.data() as Record<string, unknown>;
      if (args.tenantId && !tenantMatch(data, args.tenantId)) continue;
      const rp = data.riskProfile as Record<string, unknown> | undefined;
      const staleness = classifyRiskProfileStaleness(data);
      if (args.missingOnly && rp) continue;
      if (args.staleOnly && staleness !== 'stale') continue;
      const score = typeof rp?.overallRiskScore === 'number' ? (rp.overallRiskScore as number) : null;
      if (args.minScore != null && (score == null || score < args.minScore)) continue;
      const top = Array.isArray(rp?.topRisks) ? (rp.topRisks as Record<string, unknown>[]) : [];
      if (args.riskType && !top.some((t) => String(t.type) === args.riskType)) continue;
      if (args.severity && !top.some((t) => String(t.severity).toLowerCase() === args.severity)) continue;

      rows.push({
        userId: doc.id,
        overallRiskScore: score,
        staleness,
        lastGeneratedBy: rp?.lastGeneratedBy,
        topRisks: top.map((t) => ({
          type: t.type,
          severity: t.severity,
          source: t.source,
          summary: t.summary,
        })),
        lastUpdatedAt: rp?.lastUpdatedAt,
        generationSignature: rp?.generationSignature ? String(rp.generationSignature).slice(0, 16) + '…' : null,
      });
    }
    const last = snap.docs[snap.docs.length - 1];
    if (!last || snap.docs.length < 400) break;
    q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).startAfter(last).limit(400);
  }
  console.log(JSON.stringify({ scanned, reported: rows.length, rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
