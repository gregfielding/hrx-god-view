import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type ClientMetric = {
  kind: 'ai_client';
  route?: string;
  model: string;
  schemaVersion?: string;
  cacheHit: boolean;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  ts?: number;
};

type ServerMetric = {
  kind: 'ai_server';
  op: string;
  deduped: boolean;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  ts?: number;
};

export const metricsIngest = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    const payload = req.body || {};
    const events: Array<ClientMetric | ServerMetric> = Array.isArray(payload.events) ? payload.events : [];
    if (!events.length) { res.json({ ok: true, accepted: 0 }); return; }
    const batch = db.batch();
    const now = Date.now();
    for (const ev of events) {
      const base = { ts: ev['ts'] ?? now, _at: admin.firestore.FieldValue.serverTimestamp() } as any;
      const dest = db.collection('ai_metrics_events').doc();
      batch.set(dest, { ...ev, ...base });
    }
    await batch.commit();
    res.json({ ok: true, accepted: events.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


