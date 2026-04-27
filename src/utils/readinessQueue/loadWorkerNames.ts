/**
 * Batched best-effort name + avatar lookup for worker / recruiter uids.
 *
 * Extracted from `RecruiterMyQueue.tsx`. Reads the top-level `users`
 * collection in chunks of 10 (Firestore `where(documentId(), 'in', […])`
 * cap). Failures fall back silently — rows degrade to "uid" rather than
 * failing the whole render.
 *
 * Workforce uses this for both worker rows and owner avatars (the same uid
 * may appear as a worker on one row and an owner on another — one fetch
 * covers both).
 */

import {
  collection,
  documentId,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

export interface WorkerNameInfo {
  name: string;
  avatar?: string;
}

export type WorkerNameMap = Map<string, WorkerNameInfo>;

const CHUNK_SIZE = 10;

export async function loadWorkerNames(
  db: Firestore,
  uids: ReadonlyArray<string>,
): Promise<WorkerNameMap> {
  const out: WorkerNameMap = new Map();
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where(documentId(), 'in', chunk)),
      );
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const name =
          (asString(data.displayName)) ||
          [asString(data.firstName), asString(data.lastName)].filter(Boolean).join(' ') ||
          asString(data.email) ||
          d.id;
        const avatar = asString(data.avatar) || asString(data.photoURL) || undefined;
        out.set(d.id, { name, avatar });
      });
    } catch {
      // Best-effort — individual rows fall back to uid.
    }
  }
  return out;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
