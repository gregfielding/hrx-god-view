/**
 * Export the last N worker AI prescreen interviews + category scores for sharing (e.g. ChatGPT).
 *
 * Reads `users/{uid}/interviews/{id}` via collection group `interviews`, newest first.
 *
 * Usage (from repo root):
 *   npm run export:prescreen-interviews -- --limit=5
 *
 * Requires Firebase Admin (serviceAccountKey.json / firebase-adminsdk.json / GOOGLE_APPLICATION_CREDENTIALS / ADC).
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

function parseArgs(): { limit: number } {
  const argv = process.argv.slice(2);
  let limit = 5;
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0 && n <= 50) limit = n;
    }
  }
  return { limit };
}

function initAdmin(): void {
  let credential: admin.credential.Credential | undefined;
  const possibleKeyPaths = [
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'firebase-adminsdk.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean) as string[];

  for (const keyPath of possibleKeyPaths) {
    if (keyPath && fs.existsSync(keyPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      credential = admin.credential.cert(serviceAccount);
      console.error(`Using service account: ${keyPath}`);
      break;
    }
  }
  if (!credential) {
    credential = admin.credential.applicationDefault();
    console.error('Using application default credentials');
  }

  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    undefined;

  try {
    admin.initializeApp({ credential, ...(projectId ? { projectId } : {}) });
  } catch {
    /* already initialized */
  }
}

function tsToIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    try {
      return (v as admin.firestore.Timestamp).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/** Drop huge nested blobs for paste-friendly JSON. */
function slimAi(ai: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ai || typeof ai !== 'object') return undefined;
  const { aiInterviewContext, debug, ...rest } = ai as Record<string, unknown>;
  void aiInterviewContext;
  return {
    ...rest,
    ...(debug ? { debug: '[omitted]' } : {}),
  };
}

async function main(): Promise<void> {
  const { limit } = parseArgs();
  initAdmin();
  const db = admin.firestore();

  /** Equality + orderBy matches composite COLLECTION_GROUP index (see firestore.indexes.json). */
  const fetchBatch = Math.min(80, Math.max(limit * 4, limit));
  const snap = await db
    .collectionGroup('interviews')
    .where('interviewKind', '==', 'worker_ai_prescreen')
    .orderBy('createdAt', 'desc')
    .limit(fetchBatch)
    .get();

  const rows: Array<{
    firestorePath: string;
    userId: string;
    interviewId: string;
    interviewKind: unknown;
    applicationId: unknown;
    jobId: unknown;
    createdAt: string | null;
    score10: unknown;
    ai: Record<string, unknown> | undefined;
  }> = [];

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const parts = d.ref.path.split('/');
    const userId = parts.length >= 2 ? parts[1] : '';
    rows.push({
      firestorePath: d.ref.path,
      userId,
      interviewId: d.id,
      interviewKind: data.interviewKind,
      applicationId: data.applicationId ?? null,
      jobId: data.jobId ?? null,
      createdAt: tsToIso(data.createdAt) ?? tsToIso(data.timestamp),
      score10: data.score10 ?? data.score ?? null,
      ai: slimAi(data.ai as Record<string, unknown> | undefined),
    });
    if (rows.length >= limit) break;
  }

  const out = {
    exportedAt: new Date().toISOString(),
    note: 'Worker AI prescreen interviews from users/{uid}/interviews. ai.categoryScores = prescreen category scores.',
    requestedLimit: limit,
    count: rows.length,
    interviews: rows,
  };

  console.log(JSON.stringify(out, null, 2));

  if (rows.length < limit) {
    console.error(
      `\nWarning: only found ${rows.length} worker_ai_prescreen interview(s) (query limit ${fetchBatch}).`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
