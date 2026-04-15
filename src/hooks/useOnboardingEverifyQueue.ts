import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { OnboardingEverifyQueueRow, OnboardingQueuePagination } from '../types/onboardingQueue';
import { rowMatchesOnboardingWorkerSearch } from '../utils/onboardingQueueSearch';
import {
  buildEverifyQueueRows,
  resolveSelectEntityIdFromBriefs,
  type EverifyCaseInput,
  type EntityEmploymentLite,
  type TaxPayrollPipelineInput,
  type UserProfileLite,
  userProfileLiteFromUserDoc,
} from '../utils/onboardingQueueBuilders';

const CASE_LIMIT = 300;
const PIPELINE_LIMIT = 400;
const ENTITY_EMPLOYMENT_CHUNK_SIZE = 64;
const ENTITY_EMPLOYMENT_PARALLEL_CHUNKS = 2;

async function mergeEntityEmploymentChunk(
  tenantId: string,
  chunk: string[],
  out: Record<string, EntityEmploymentLite | undefined>,
): Promise<void> {
  const settled = await Promise.allSettled(
    chunk.map(async (id) => {
      const snap = await getDoc(doc(db, p.entityEmployment(tenantId, id)));
      return { id, snap };
    }),
  );
  for (let j = 0; j < settled.length; j++) {
    const entry = settled[j];
    const pipelineId = chunk[j];
    if (entry.status === 'fulfilled') {
      const { snap } = entry.value;
      if (snap.exists()) {
        out[pipelineId] = snap.data() as EntityEmploymentLite;
      }
    }
  }
}

export function useOnboardingEverifyQueue(
  tenantId: string | undefined,
  controlledPagination?: OnboardingQueuePagination,
  searchQuery?: string,
) {
  const [cases, setCases] = useState<EverifyCaseInput[]>([]);
  const [pipelines, setPipelines] = useState<TaxPayrollPipelineInput[]>([]);
  const [employmentByPipelineId, setEmploymentByPipelineId] = useState<
    Record<string, EntityEmploymentLite | undefined>
  >({});
  const [selectEntityId, setSelectEntityId] = useState<string | null>(null);
  const [entityIdToName, setEntityIdToName] = useState<Map<string, string>>(new Map());
  const [userById, setUserById] = useState<Record<string, UserProfileLite | undefined>>({});
  const [casesReady, setCasesReady] = useState(false);
  const [pipelinesReady, setPipelinesReady] = useState(false);
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
      setCasesReady(false);
      return;
    }
    setCasesReady(false);
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
        setCasesReady(true);
      },
      (err) => {
        setError(err.message || 'Failed to load E-Verify cases.');
        setCases([]);
        setCasesReady(true);
      },
    );
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setPipelines([]);
      setPipelinesReady(false);
      return;
    }
    setPipelinesReady(false);
    const ref = collection(db, p.workerOnboarding(tenantId));
    const q = query(ref, orderBy('updatedAt', 'desc'), limit(PIPELINE_LIMIT));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPipelines(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          })) as TaxPayrollPipelineInput[],
        );
        setPipelinesReady(true);
      },
      (err) => {
        setError(err.message || 'Failed to load onboarding pipelines.');
        setPipelines([]);
        setPipelinesReady(true);
      },
    );
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || pipelines.length === 0) {
      setEmploymentByPipelineId({});
      return;
    }
    const allIds = pipelines.map((r) => r.id);
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += ENTITY_EMPLOYMENT_CHUNK_SIZE) {
      chunks.push(allIds.slice(i, i + ENTITY_EMPLOYMENT_CHUNK_SIZE));
    }

    let cancelled = false;
    (async () => {
      const out: Record<string, EntityEmploymentLite | undefined> = {};
      try {
        for (let i = 0; i < chunks.length; i += ENTITY_EMPLOYMENT_PARALLEL_CHUNKS) {
          if (cancelled) return;
          const group = chunks.slice(i, i + ENTITY_EMPLOYMENT_PARALLEL_CHUNKS);
          await Promise.all(group.map((chunk) => mergeEntityEmploymentChunk(tenantId, chunk, out)));
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        setEmploymentByPipelineId(out);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, pipelines]);

  const userIdsKey = useMemo(() => {
    const u = new Set<string>();
    cases.forEach((c) => {
      const id = String(c.userId || '').trim();
      if (id) u.add(id);
    });
    pipelines.forEach((pipe) => {
      const id = String(pipe.userId || '').trim();
      if (id) u.add(id);
    });
    return Array.from(u).sort().join(',');
  }, [cases, pipelines]);

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
        ids.slice(0, 200).map(async (uid) => {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            out[uid] = userProfileLiteFromUserDoc(snap.data() as Record<string, unknown>);
          }
        }),
      );
      if (!cancelled) setUserById(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [userIdsKey]);

  const allRows = useMemo(
    () =>
      buildEverifyQueueRows(
        cases,
        selectEntityId,
        entityIdToName,
        userById,
        pipelines,
        employmentByPipelineId,
      ),
    [cases, selectEntityId, entityIdToName, userById, pipelines, employmentByPipelineId],
  );

  const unfilteredCount = allRows.length;
  const filteredRows = useMemo(() => {
    if (!searchQuery?.trim()) return allRows;
    return allRows.filter((r) => rowMatchesOnboardingWorkerSearch(searchQuery, r));
  }, [allRows, searchQuery]);

  const totalCount = filteredRows.length;
  const rows: OnboardingEverifyQueueRow[] = useMemo(
    () => filteredRows.slice(page * pageSize, page * pageSize + pageSize),
    [filteredRows, page, pageSize],
  );

  useEffect(() => {
    const maxPage = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize) - 1;
    if (page > maxPage) setPage(Math.max(0, maxPage));
  }, [totalCount, pageSize, page, setPage]);

  const loading = Boolean(tenantId && (!casesReady || !pipelinesReady));

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
    selectEntityResolved: Boolean(selectEntityId),
  };
}
