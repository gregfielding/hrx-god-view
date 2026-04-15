import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import type { OnboardingBackgroundQueueRow, OnboardingQueuePagination } from '../types/onboardingQueue';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import {
  buildBackgroundQueueRows,
  type UserProfileLite,
  userProfileLiteFromUserDoc,
} from '../utils/onboardingQueueBuilders';
import { rowMatchesOnboardingWorkerSearch } from '../utils/onboardingQueueSearch';

const BG_LIMIT = 250;

function docToRecord(id: string, data: Record<string, unknown>): BackgroundCheckRecord {
  return { id, ...data } as BackgroundCheckRecord;
}

export function useOnboardingBackgroundQueue(
  tenantId: string | undefined,
  controlledPagination?: OnboardingQueuePagination,
  searchQuery?: string,
) {
  const [records, setRecords] = useState<BackgroundCheckRecord[]>([]);
  const [userById, setUserById] = useState<Record<string, UserProfileLite | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalPage, setInternalPage] = useState(0);
  const [internalPageSize, setInternalPageSize] = useState(20);

  const page = controlledPagination?.page ?? internalPage;
  const pageSize = controlledPagination?.pageSize ?? internalPageSize;
  const setPage = useCallback(
    (n: number) => {
      if (controlledPagination) controlledPagination.setPage(n);
      else setInternalPage(n);
    },
    [controlledPagination],
  );
  const setPageSize = useCallback(
    (n: number) => {
      if (controlledPagination) controlledPagination.setPageSize(n);
      else setInternalPageSize(n);
    },
    [controlledPagination],
  );

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

  const unfilteredCount = allRows.length;
  const filteredRows = useMemo(() => {
    if (!searchQuery?.trim()) return allRows;
    return allRows.filter((r) => rowMatchesOnboardingWorkerSearch(searchQuery, r));
  }, [allRows, searchQuery]);

  const totalCount = filteredRows.length;
  const rows: OnboardingBackgroundQueueRow[] = useMemo(
    () => filteredRows.slice(page * pageSize, page * pageSize + pageSize),
    [filteredRows, page, pageSize],
  );

  useEffect(() => {
    const maxPage = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize) - 1;
    if (page > maxPage) setPage(Math.max(0, maxPage));
  }, [totalCount, pageSize, page, setPage]);

  return {
    rows,
    loading,
    error,
    totalCount,
    unfilteredCount,
    page,
    pageSize,
    setPage,
    setPageSize,
  };
}
