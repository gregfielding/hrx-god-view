/**
 * QA report: prescreen interviews with large base→adjusted deltas or decision/recommendation edge cases.
 *
 *   npx ts-node src/scripts/reportOperationalOverrideQA.ts --tenantId=T --limit=200
 *   node lib/scripts/reportOperationalOverrideQA.js --limit=50
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Row = {
  path: string;
  base: number | null;
  adjusted: number | null;
  delta: number | null;
  recommendation?: string;
  decision?: string;
  autoAdvance?: boolean;
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function main(): Promise<void> {
  const limit = Math.min(5000, Math.max(1, parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '200', 10)));
  const tenantFilter = process.argv.find((a) => a.startsWith('--tenantId='))?.split('=')[1]?.trim() || null;

  const usersSnap = await db.collection('users').limit(400).get();
  const rows: Row[] = [];

  for (const u of usersSnap.docs) {
    const intSnap = await db.collection('users').doc(u.id).collection('interviews').limit(30).get();
    for (const d of intSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (data.interviewKind !== 'worker_ai_prescreen') continue;
      const ai = data.ai as Record<string, unknown> | undefined;
      if (!ai) continue;
      if (tenantFilter) {
        const ctx = ai.aiInterviewContext as Record<string, unknown> | undefined;
        const br = ctx?.businessRules as Record<string, unknown> | undefined;
        const t = typeof br?.tenant === 'string' ? br.tenant : '';
        if (t !== tenantFilter) continue;
      }
      const base = num(ai.baseInterviewScore) ?? num(ai.overallScore);
      const adj = num(ai.overrideAdjustedScore) ?? base;
      const delta = base != null && adj != null ? adj - base : null;
      const hd = ai.hiringDecision as Record<string, unknown> | undefined;
      rows.push({
        path: d.ref.path,
        base,
        adjusted: adj,
        delta,
        recommendation: typeof ai.recommendation === 'string' ? ai.recommendation : undefined,
        decision: typeof hd?.decision === 'string' ? hd.decision : undefined,
        autoAdvance: typeof hd?.eligibleForAutoAdvance === 'boolean' ? hd.eligibleForAutoAdvance : undefined,
      });
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
  }

  const largePos = [...rows].filter((r) => r.delta != null && r.delta >= 8).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const largeNeg = [...rows].filter((r) => r.delta != null && r.delta <= -8).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  const baseLowAdjHigh = rows.filter((r) => (r.base ?? 100) <= 60 && (r.adjusted ?? 0) >= 75);

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned: rows.length,
        largePositiveDelta: largePos.slice(0, 25),
        largeNegativeDelta: largeNeg.slice(0, 25),
        baseLe60AdjGe75: baseLowAdjHigh.slice(0, 25),
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
