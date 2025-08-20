import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

// Simple OpenAI embeddings helper
async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: text.slice(0, 8000) })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Embeddings error ${r.status}: ${t}`);
  }
  const data = (await r.json()) as any;
  return data?.data?.[0]?.embedding || [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]; const y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Upsert chunks into Firestore code index
export const upsertCodeChunks = onCall({ cors: true }, async (request) => {
  const { chunks } = request.data || {};
  if (!Array.isArray(chunks) || chunks.length === 0) throw new Error('No chunks provided');
  const db = admin.firestore();
  const batch = db.batch();
  for (const c of chunks) {
    const path: string = c.path || 'unknown';
    const text: string = c.text || '';
    const embedding = await embedText(text);
    const ref = db.collection('code_index').doc('global').collection('chunks').doc();
    batch.set(ref, { path, text, embedding, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  await batch.commit();
  return { success: true, count: chunks.length };
});

// Search top-K chunks by semantic similarity
export const searchCodeChunks = onCall({ cors: true }, async (request) => {
  const { query, topK = 8 } = request.data || {};
  if (!query) throw new Error('Missing query');
  const qVec = await embedText(query);
  const db = admin.firestore();
  // Read limited set for performance; scale later with a real vector DB
  const snap = await db.collection('code_index').doc('global').collection('chunks').orderBy('createdAt', 'desc').limit(500).get();
  const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const scored = items.map(it => ({ ...it, score: cosineSimilarity(qVec, it.embedding || []) }));
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, Math.min(topK, scored.length)).map(r => ({ path: r.path, text: r.text, score: r.score }));
  return { results };
});

export { embedText };

// HTTP variant for simple CI/client ingestion
import { onRequest } from 'firebase-functions/v2/https';

export const upsertCodeChunksHttp = onRequest(async (req, res): Promise<void> => {
  try {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }
    const { chunks } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!Array.isArray(chunks) || chunks.length === 0) {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(400).json({ error: 'No chunks provided' });
      return;
    }
    const db = admin.firestore();
    for (const c of chunks) {
      const path: string = c.path || 'unknown';
      const text: string = c.text || '';
      const embedding = await embedText(text);
      await db.collection('code_index').doc('global').collection('chunks').add({
        path,
        text,
        embedding,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(200).json({ success: true, count: chunks.length });
    return;
  } catch (err: any) {
    console.error('upsertCodeChunksHttp error:', err);
    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(500).json({ error: err?.message || 'Internal error' });
    return;
  }
});


