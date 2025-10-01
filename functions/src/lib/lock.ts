import * as admin from 'firebase-admin';

const db = admin.firestore();

// Simple Firestore-based lock with TTL to avoid concurrent scheduler runs
export async function acquireLock(name: string, ttlMs = 25 * 60 * 1000): Promise<() => Promise<void>> {
  const ref = db.doc(`ops_locks/${name}`);
  const now = Date.now();
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const status = snap.get('status');
      const ts = Number(snap.get('ts') || 0);
      if (status === 'running' && now - ts < ttlMs) {
        throw new Error(`Lock '${name}' held`);
      }
    }
    tx.set(ref, { status: 'running', ts: now }, { merge: true });
    return async () => {
      await ref.set({ status: 'done', ts: Date.now() }, { merge: true });
    };
  });
}


