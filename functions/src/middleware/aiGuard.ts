import * as admin from 'firebase-admin';
import { stableHash } from '../utils/hash';

if (!admin.apps.length) admin.initializeApp();

const db = () => admin.firestore();
const COL = 'ai_idempotency';

type IdemStatus = 'in_progress' | 'done' | 'failed';
type IdemDoc = {
  key: string;
  status: IdemStatus;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  result?: any;
  error?: string;
};

export async function withIdempotency<T>(logicalOp: string, logicalInput: any, ttlSeconds: number, runner: () => Promise<T>): Promise<T> {
  const key = stableHash({ logicalOp, logicalInput });
  const ref = db().collection(COL).doc(key);
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttlSeconds * 1000);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { key, status: 'in_progress', createdAt: now, expiresAt } as IdemDoc);
      return;
    }
    const data = snap.data() as IdemDoc;
    if (data.status === 'done' && data.expiresAt.toMillis() > Date.now()) {
      throw { __RETURN_RESULT: data.result };
    }
    if (data.status === 'in_progress' && data.expiresAt.toMillis() > Date.now()) {
      throw { __IN_PROGRESS: true };
    }
    tx.update(ref, { status: 'in_progress', createdAt: now, expiresAt, error: admin.firestore.FieldValue.delete() });
  });

  try {
    const result = await runner();
    await ref.update({ status: 'done', result });
    return result;
  } catch (err: any) {
    if (err?.__RETURN_RESULT) return err.__RETURN_RESULT as T;
    if (err?.__IN_PROGRESS) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const snap = await ref.get();
        const data = snap.data() as IdemDoc | undefined;
        if (data?.status === 'done') return data.result as T;
      }
      throw new Error('Idempotent op still in progress; try again.');
    }
    await ref.set({ status: 'failed', error: String(err) } as Partial<IdemDoc>, { merge: true });
    throw err;
  }
}


