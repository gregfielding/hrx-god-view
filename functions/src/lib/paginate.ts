import * as admin from 'firebase-admin';

const db = admin.firestore();

export async function paginateCollection<T = FirebaseFirestore.DocumentData>(
  path: string,
  opts: {
    batchSize?: number;
    orderBy?: string;
    startAfter?: FirebaseFirestore.DocumentSnapshot | null;
    where?: [string, FirebaseFirestore.WhereFilterOp, any][];
  } = {}
) {
  const batchSize = opts.batchSize ?? 500;
  let q: FirebaseFirestore.Query = db.collection(path);
  if (opts.where) for (const [f, op, v] of opts.where) q = q.where(f, op, v);
  q = q.orderBy(opts.orderBy ?? 'createdAt').limit(batchSize);
  if (opts.startAfter) q = q.startAfter(opts.startAfter);
  const snap = await q.get();
  return { docs: snap.docs as FirebaseFirestore.QueryDocumentSnapshot<T>[], last: snap.docs.at(-1) ?? null };
}


