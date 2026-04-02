import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import type { OnboardingBackgroundQueueRow } from '../types/onboardingQueue';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import {
  buildBackgroundQueueRows,
  type UserProfileLite,
  userProfileLiteFromUserDoc,
} from '../utils/onboardingQueueBuilders';

const BG_LIMIT = 250;

function docToRecord(id: string, data: Record<string, unknown>): BackgroundCheckRecord {
  return { id, ...data } as BackgroundCheckRecord;
}

export function useOnboardingBackgroundQueue(tenantId: string | undefined) {
  const [records, setRecords] = useState<BackgroundCheckRecord[]>([]);
  const [userById, setUserById] = useState<Record<string, UserProfileLite | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    if (!tenantId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const q = query(
      collection(db, 'backgroundChecks'),
      where('tenantId', '==', tenantId),
      orderBy('updatedAt', 'desc'),
      limit(BG_LIMIT)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRecords(snap.docs.map((d) => docToRecord(d.id, d.data() as Record<string, unknown>)));
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to load background checks.');
        setRecords([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tenantId]);

  const userIdsKey = useMemo(() => {
    const u = new Set<string>();
    records.forEach((r) => {
      const id = String(r.candidateId || '').trim();
      if (id) u.add(id);
    });
    return Array.from(u).sort().join(',');
  }, [records]);

  useEffect(() => {
    if (userIdsKey.length === 0) {
      setUserById({});
      return;
    }
    const ids = userIdsKey.split(',').filter(Boolean);
    let cancelled = false;
    (async () => {
      const out: Record<string, UserProfileLite | undefined> = {};
      await Promise.all(
        ids.slice(0, 150).map(async (uid) => {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            out[uid] = userProfileLiteFromUserDoc(snap.data() as Record<string, unknown>);
          }
        })
      );
      if (!cancelled) setUserById(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [userIdsKey]);

  const allRows = useMemo(() => buildBackgroundQueueRows(records, userById), [records, userById]);

  const totalCount = allRows.length;
  const rows: OnboardingBackgroundQueueRow[] = useMemo(
    () => allRows.slice(page * pageSize, page * pageSize + pageSize),
    [allRows, page, pageSize]
  );

  const setPageCb = useCallback((n: number) => setPage(n), []);
  const setPageSizeCb = useCallback((n: number) => setPageSize(n), []);

  return {
    rows,
    loading,
    error,
    totalCount,
    page,
    pageSize,
    setPage: setPageCb,
    setPageSize: setPageSizeCb,
  };
}
