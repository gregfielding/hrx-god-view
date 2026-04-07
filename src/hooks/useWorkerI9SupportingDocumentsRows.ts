import { useEffect, useState } from 'react';
import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';

export type I9SupportingDocRow = { id: string; data: Record<string, unknown> };

/**
 * Live rows for `tenants/{tid}/worker_i9_supporting_documents` for one user.
 * @param enabled Set false to skip subscription (e.g. parent passes rows into workspace).
 */
export function useWorkerI9SupportingDocumentsRows(
  tenantId: string | null | undefined,
  workerUserId: string | undefined,
  enabled = true,
): {
  rows: I9SupportingDocRow[];
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = useState<I9SupportingDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId || !workerUserId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const q = query(
      collection(db, p.workerI9SupportingDocuments(tenantId)),
      where('userId', '==', workerUserId),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
        list.sort((a, b) => {
          const ta =
            (a.data.updatedAt as Timestamp | undefined)?.toMillis?.() ??
            (a.data.createdAt as Timestamp | undefined)?.toMillis?.() ??
            0;
          const tb =
            (b.data.updatedAt as Timestamp | undefined)?.toMillis?.() ??
            (b.data.createdAt as Timestamp | undefined)?.toMillis?.() ??
            0;
          return tb - ta;
        });
        setRows(list);
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to subscribe to documents');
        setRows([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tenantId, workerUserId, enabled]);

  return { rows, loading, error };
}
