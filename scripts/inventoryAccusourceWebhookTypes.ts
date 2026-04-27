/**
 * Inventory diagnostic: group every event in `integrations_accusource_webhook_events`
 * by its `type` value (and by detected drug-lab shape) and print one sample payload
 * per type so we can see exactly what shapes AccuSource actually sends us.
 *
 * Goals:
 *   - Identify which webhook topic delivers the final report URL (report_ready,
 *     final_report_ready, profile_completed, etc.) so we can capture it.
 *   - Identify which topic carries an adjudication / decision value.
 *   - Spot any other undocumented event shapes we're silently dropping.
 *
 * Usage:
 *   GCLOUD_PROJECT=hrx1-d3beb npx ts-node scripts/inventoryAccusourceWebhookTypes.ts
 *
 * Scope: full collection scan. With ~thousands of events, budget ~30s. Adds
 *   a `--days=N` flag to narrow the scan to the last N days via receivedAt.
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DAYS = (() => {
  const m = process.argv.find((a) => a.startsWith('--days='));
  if (!m) return null;
  const n = Number(m.slice('--days='.length));
  return Number.isFinite(n) && n > 0 ? n : null;
})();

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

type Bucket = {
  type: string;
  count: number;
  topLevelKeySet: Set<string>;
  nestedPayloadKeySet: Set<string>;
  sampleIds: string[];
  sample: Record<string, unknown> | null;
  interestingHits: {
    reportUrl: string[];
    decision: string[];
    reportReady: string[];
  };
};

function detectInterestingFields(payload: Record<string, unknown>): {
  reportUrl: string[];
  decision: string[];
  reportReady: string[];
} {
  const hits = { reportUrl: [] as string[], decision: [] as string[], reportReady: [] as string[] };
  const walk = (obj: unknown, path: string) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      const lower = k.toLowerCase();
      if (
        lower.includes('report') && (lower.includes('url') || lower.includes('link') || lower.includes('href') || lower.includes('pdf'))
      ) hits.reportUrl.push(p);
      if (lower.includes('decision') || lower.includes('adjudicat') || lower === 'outcome' || lower === 'result' || lower === 'disposition')
        hits.decision.push(p);
      if (lower.includes('report') && (lower.includes('ready') || lower.includes('complete') || lower.includes('final')))
        hits.reportReady.push(p);
      if (typeof v === 'object') walk(v, p);
    }
  };
  walk(payload, '');
  return hits;
}

async function main() {
  console.log(`\n=== AccuSource webhook-type inventory (project=${PROJECT_ID}${DAYS ? `, last ${DAYS}d` : ''}) ===\n`);

  const buckets = new Map<string, Bucket>();
  const interestingAcrossAll = { reportUrl: new Set<string>(), decision: new Set<string>(), reportReady: new Set<string>() };

  let scanned = 0;
  let q: FirebaseFirestore.Query = db.collection('integrations_accusource_webhook_events');
  if (DAYS) {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - DAYS * 86_400_000);
    q = q.where('receivedAt', '>=', cutoff);
  }
  // Use stable pagination by doc id — avoids composite index on receivedAt.
  q = q.orderBy(admin.firestore.FieldPath.documentId()).limit(500);

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let pageQ = q;
    if (cursor) pageQ = pageQ.startAfter(cursor);
    const snap = await pageQ.get();
    if (snap.empty) break;

    for (const d of snap.docs) {
      scanned += 1;
      const data = d.data();
      const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, unknown>;

      // Type key: prefer stored `type`; otherwise infer from payload.type or mark by shape.
      let typeKey = String(data.type ?? payload.type ?? '').trim();
      if (!typeKey) typeKey = 'unknown';
      if (typeKey === 'unknown' && typeof payload.lab === 'string') {
        const labKey = payload.reg_id != null || (payload as Record<string, unknown>).regId != null ? 'drug_lab_ping' : 'unknown';
        typeKey = labKey;
      }

      let b = buckets.get(typeKey);
      if (!b) {
        b = {
          type: typeKey,
          count: 0,
          topLevelKeySet: new Set(),
          nestedPayloadKeySet: new Set(),
          sampleIds: [],
          sample: null,
          interestingHits: { reportUrl: [], decision: [], reportReady: [] },
        };
        buckets.set(typeKey, b);
      }
      b.count += 1;
      for (const k of Object.keys(payload)) b.topLevelKeySet.add(k);
      const nested = (payload.payload && typeof payload.payload === 'object' ? payload.payload : {}) as Record<string, unknown>;
      for (const k of Object.keys(nested)) b.nestedPayloadKeySet.add(k);
      if (b.sampleIds.length < 3) b.sampleIds.push(d.id);
      if (!b.sample) b.sample = payload;

      const interesting = detectInterestingFields(payload);
      for (const p of interesting.reportUrl) { b.interestingHits.reportUrl.push(p); interestingAcrossAll.reportUrl.add(`${typeKey}::${p}`); }
      for (const p of interesting.decision) { b.interestingHits.decision.push(p); interestingAcrossAll.decision.add(`${typeKey}::${p}`); }
      for (const p of interesting.reportReady) { b.interestingHits.reportReady.push(p); interestingAcrossAll.reportReady.add(`${typeKey}::${p}`); }
    }

    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < 500) break;
  }

  console.log(`scanned ${scanned} events across ${buckets.size} distinct type(s)\n`);

  const ordered = [...buckets.values()].sort((a, b) => b.count - a.count);
  for (const b of ordered) {
    console.log(`--- type="${b.type}" count=${b.count} (samples: ${b.sampleIds.join(', ')}) ---`);
    console.log(`  topLevelKeys: ${[...b.topLevelKeySet].sort().join(', ')}`);
    if (b.nestedPayloadKeySet.size > 0) {
      console.log(`  nestedPayloadKeys: ${[...b.nestedPayloadKeySet].sort().join(', ')}`);
    }
    if (b.interestingHits.reportUrl.length > 0) console.log(`  REPORT URL PATHS observed: ${[...new Set(b.interestingHits.reportUrl)].join(', ')}`);
    if (b.interestingHits.decision.length > 0) console.log(`  DECISION PATHS observed: ${[...new Set(b.interestingHits.decision)].join(', ')}`);
    if (b.interestingHits.reportReady.length > 0) console.log(`  REPORT-READY PATHS observed: ${[...new Set(b.interestingHits.reportReady)].join(', ')}`);
    console.log(`  sample payload:\n${JSON.stringify(b.sample, null, 2).split('\n').map((l) => '    ' + l).join('\n')}`);
    console.log('');
  }

  console.log('=== summary of interesting field paths across all event types ===');
  console.log(`  report URL candidates: ${[...interestingAcrossAll.reportUrl].join(', ') || '(none)'}`);
  console.log(`  decision candidates:   ${[...interestingAcrossAll.decision].join(', ') || '(none)'}`);
  console.log(`  report-ready signals:  ${[...interestingAcrossAll.reportReady].join(', ') || '(none)'}`);
  console.log('\n=== done ===\n');
  process.exit(0);
}

main().catch((err) => { console.error('fatal', err); process.exit(1); });
