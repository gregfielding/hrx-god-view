import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { OnboardingEverifyQueueRow } from '../types/onboardingQueue';
import {
  buildEverifyQueueRows,
  resolveSelectEntityIdFromBriefs,
  type EverifyCaseInput,
  type UserProfileLite,
  userProfileLiteFromUserDoc,
} from '../utils/onboardingQueueBuilders';

const CASE_LIMIT = 300;

export function useOnboardingEverifyQueue(tenantId: string | undefined) {
  const [cases, setCases] = useState<EverifyCaseInput[]>([]);
  const [selectEntityId, setSelectEntityId] = useState<string | null>(null);
  const [entityIdToName, setEntityIdToName] = useState<Map<string, string>>(new Map());
  const [userById, setUserById] = useState<Record<string, UserProfileLite | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    if (!tenantId) {
      setSelectEntityId(null);
      setEntityIdToName(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const entSnap = await getDocs(collection(db, p.entities(tenantId)));
      const brief = entSnap.docs.map((d) => {
        const x = d.data() as { name?: string; entityCode?: string };
        return { id: d.id, name: String(x.name || d.id), entityCode: String(x.entityCode || '') };
      });
      const map = new Map<string, string>();
      brief.forEach((e) => map.set(e.id, e.name));
      if (!cancelled) {
        setEntityIdToName(map);
        setSelectEntityId(resolveSelectEntityIdFromBriefs(brief));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setCases([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const ref = collection(db, p.everifyCasesPublic(tenantId));
    const q = query(ref, orderBy('updatedAt', 'desc'), limit(CASE_LIMIT));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: EverifyCaseInput[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            userId: (x.userId as string) ?? null,
            entityId: (x.entityId as string) ?? null,
            userEmploymentId: (x.userEmploymentId as string) ?? null,
            assignmentId: (x.assignmentId as string) ?? null,
            status: x.status as string | undefined,
            updatedAt: x.updatedAt,
            public: x.public as EverifyCaseInput['public'],
          };
        });
        setCases(list);
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to load E-Verify cases.');
        setCases([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tenantId]);

  const userIdsKey = useMemo(() => {
    const u = new Set<string>();
    cases.forEach((c) => {
      const id = String(c.userId || '').trim();
      if (id) u.add(id);
    });
    return Array.from(u).sort().join(',');
  }, [cases]);

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

  const allRows = useMemo(
    () => buildEverifyQueueRows(cases, selectEntityId, entityIdToName, userById),
    [cases, selectEntityId, entityIdToName, userById]
  );

  const totalCount = allRows.length;
  const rows: OnboardingEverifyQueueRow[] = useMemo(
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
    selectEntityResolved: Boolean(selectEntityId),
  };
}
