import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { OnboardingQueuePagination, OnboardingTaxPayrollQueueRow } from '../types/onboardingQueue';
import { rowMatchesOnboardingWorkerSearch } from '../utils/onboardingQueueSearch';
import {
  buildTaxPayrollQueueRows,
  type AssignmentQueueLite,
  type EverifyCaseInput,
  type EntityEmploymentLite,
  type JobOrderQueueLite,
  latestSelectEverifyCaseByUserId,
  resolveSelectEntityIdFromBriefs,
  type TaxPayrollPipelineInput,
  type UserProfileLite,
  userProfileLiteFromUserDoc,
} from '../utils/onboardingQueueBuilders';
import type { EmploymentEntityKey } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { deriveC1EntityKeyFromEntityName } from '../utils/c1EntityWorkAuthorizationUi';
import { normalizeEntityKey } from '../utils/employmentEntityPresentation';
import type { WorkerPayrollAccount } from '../types/payroll';
import { workerPayrollAccountId } from '../types/payroll';

const PIPELINE_LIMIT = 400;
const EV_CASE_LIMIT = 300;
/** Firestore reads per chunk (inside one Promise.allSettled). */
const ENTITY_EMPLOYMENT_CHUNK_SIZE = 64;
/** How many chunks run in parallel; keeps concurrency ~2× chunk size reads at a time. */
const ENTITY_EMPLOYMENT_PARALLEL_CHUNKS = 2;
const PAYROLL_ACCOUNT_CHUNK_SIZE = 40;

async function loadAssignmentAndJobOrderMaps(
  tenantId: string,
  assignmentIds: string[],
): Promise<{
  assignmentById: Record<string, AssignmentQueueLite | undefined>;
  jobOrderById: Record<string, JobOrderQueueLite | undefined>;
}> {
  const assignmentById: Record<string, AssignmentQueueLite | undefined> = {};
  const jobOrderIds = new Set<string>();
  const chunkSize = 40;

  for (let i = 0; i < assignmentIds.length; i += chunkSize) {
    const chunk = assignmentIds.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (aid) => {
        try {
          const snap = await getDoc(doc(db, p.assignment(tenantId, aid)));
          if (!snap.exists()) return;
          const d = snap.data() as Record<string, unknown>;
          assignmentById[aid] = {
            jobOrderId: (d.jobOrderId as string) ?? null,
            startDate: (d.startDate as string) ?? null,
            status: (d.status as string) ?? null,
          };
          const jid = String(d.jobOrderId || '').trim();
          if (jid) jobOrderIds.add(jid);
        } catch {
          /* ignore */
        }
      }),
    );
  }

  const jobOrderById: Record<string, JobOrderQueueLite | undefined> = {};
  const joList = Array.from(jobOrderIds);
  const accountHiringCache: Record<string, string | null> = {};

  async function hiringEntityFromRecruiterAccount(recruiterAccountId: string): Promise<string | null> {
    if (Object.prototype.hasOwnProperty.call(accountHiringCache, recruiterAccountId)) {
      return accountHiringCache[recruiterAccountId];
    }
    try {
      const accSnap = await getDoc(doc(db, p.recruiterAccount(tenantId, recruiterAccountId)));
      const hid = accSnap.exists()
        ? String((accSnap.data() as { hiringEntityId?: string }).hiringEntityId || '').trim() || null
        : null;
      accountHiringCache[recruiterAccountId] = hid;
      return hid;
    } catch {
      accountHiringCache[recruiterAccountId] = null;
      return null;
    }
  }

  for (let i = 0; i < joList.length; i += chunkSize) {
    const chunk = joList.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (jid) => {
        try {
          let joSnap = await getDoc(doc(db, p.jobOrder(tenantId, jid)));
          if (!joSnap.exists()) {
            joSnap = await getDoc(doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jid));
          }
          if (!joSnap.exists()) return;
          const jd = joSnap.data() as Record<string, unknown>;
          const title = String(jd.jobTitle || jd.title || '').trim();
          const name = String(jd.jobOrderName || jd.title || jd.jobTitle || jid).trim();
          const joHiring = String(jd.hiringEntityId || '').trim() || null;
          const recAcc = String(jd.recruiterAccountId || '').trim() || null;
          let effective = joHiring;
          if (!effective && recAcc) {
            effective = await hiringEntityFromRecruiterAccount(recAcc);
          }
          jobOrderById[jid] = {
            jobOrderName: name,
            jobTitle: title,
            hiringEntityId: joHiring,
            effectiveHiringEntityId: effective,
          };
        } catch {
          /* ignore */
        }
      }),
    );
  }

  return { assignmentById, jobOrderById };
}

async function mergeWorkerPayrollAccountChunk(
  tenantId: string,
  docIds: string[],
  out: Record<string, WorkerPayrollAccount | undefined>,
): Promise<void> {
  const settled = await Promise.allSettled(
    docIds.map(async (docId) => {
      const snap = await getDoc(doc(db, p.workerPayrollAccount(tenantId, docId)));
      return { docId, snap };
    }),
  );
  for (let j = 0; j < settled.length; j++) {
    const entry = settled[j];
    const docId = docIds[j];
    if (entry.status === 'fulfilled') {
      const { snap } = entry.value;
      if (snap.exists()) {
        out[docId] = snap.data() as WorkerPayrollAccount;
      }
    } else {
      console.error('[useOnboardingTaxPayrollQueue] worker payroll account getDoc failed', {
        tenantId,
        docId,
        reason: entry.reason,
      });
    }
  }
}

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
    } else {
      console.error('[useOnboardingTaxPayrollQueue] entityEmployment getDoc failed', {
        tenantId,
        pipelineId,
        reason: entry.reason,
      });
    }
  }
}

export function useOnboardingTaxPayrollQueue(
  tenantId: string | undefined,
  controlledPagination?: OnboardingQueuePagination,
  searchQuery?: string,
) {
  const [pipelines, setPipelines] = useState<TaxPayrollPipelineInput[]>([]);
  const [employmentByPipelineId, setEmploymentByPipelineId] = useState<
    Record<string, EntityEmploymentLite | undefined>
  >({});
  const [assignmentById, setAssignmentById] = useState<Record<string, AssignmentQueueLite | undefined>>({});
  const [jobOrderById, setJobOrderById] = useState<Record<string, JobOrderQueueLite | undefined>>({});
  const [userById, setUserById] = useState<Record<string, UserProfileLite | undefined>>({});
  const [selectEntityId, setSelectEntityId] = useState<string | null>(null);
  const [entityBriefForQueue, setEntityBriefForQueue] = useState<
    Array<{ id: string; name: string; entityCode: string }>
  >([]);
  const [everifyCases, setEverifyCases] = useState<EverifyCaseInput[]>([]);
  const [payrollAccountByDocId, setPayrollAccountByDocId] = useState<
    Record<string, WorkerPayrollAccount | undefined>
  >({});
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
      setPipelines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
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
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to load onboarding pipelines.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setSelectEntityId(null);
      setEntityBriefForQueue([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const entSnap = await getDocs(collection(db, p.entities(tenantId)));
      const brief = entSnap.docs.map((d) => {
        const x = d.data() as { name?: string; entityCode?: string };
        return { id: d.id, name: String(x.name || d.id), entityCode: String(x.entityCode || '') };
      });
      if (!cancelled) {
        setSelectEntityId(resolveSelectEntityIdFromBriefs(brief));
        setEntityBriefForQueue(brief);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setEverifyCases([]);
      return;
    }
    const ref = collection(db, p.everifyCasesPublic(tenantId));
    const qEv = query(ref, orderBy('updatedAt', 'desc'), limit(EV_CASE_LIMIT));
    const unsub = onSnapshot(
      qEv,
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
        setEverifyCases(list);
      },
      () => {
        setEverifyCases([]);
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
      } catch (e) {
        console.error(
          '[useOnboardingTaxPayrollQueue] unexpected error loading entity employments',
          e,
        );
      }
      if (!cancelled) {
        setEmploymentByPipelineId(out);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, pipelines]);

  useEffect(() => {
    if (!tenantId) {
      setAssignmentById({});
      setJobOrderById({});
      return;
    }
    const ids = new Set<string>();
    Object.values(employmentByPipelineId).forEach((emp) => {
      const aid = String(emp?.currentAssignmentId || emp?.sourceAssignmentId || '').trim();
      if (aid) ids.add(aid);
    });
    pipelines.forEach((pipe) => {
      const raw = pipe.assignmentIds;
      if (!Array.isArray(raw)) return;
      raw.forEach((x) => {
        const a = String(x || '').trim();
        if (a) ids.add(a);
      });
    });
    const list = Array.from(ids).sort();
    if (list.length === 0) {
      setAssignmentById({});
      setJobOrderById({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { assignmentById: aMap, jobOrderById: jMap } = await loadAssignmentAndJobOrderMaps(
          tenantId,
          list,
        );
        if (!cancelled) {
          setAssignmentById(aMap);
          setJobOrderById(jMap);
        }
      } catch (e) {
        console.error('[useOnboardingTaxPayrollQueue] assignment/job order load failed', e);
        if (!cancelled) {
          setAssignmentById({});
          setJobOrderById({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, employmentByPipelineId, pipelines]);

  useEffect(() => {
    if (!tenantId || pipelines.length === 0) {
      setPayrollAccountByDocId({});
      return;
    }
    const ids = new Set<string>();
    for (const pipe of pipelines) {
      const uid = String(pipe.userId || '').trim();
      const ek =
        normalizeEntityKey(pipe.entityKey as string | undefined) ||
        String(pipe.entityKey || '').trim().toLowerCase();
      if (!uid || !ek) continue;
      ids.add(workerPayrollAccountId(uid, ek));
    }
    const list = Array.from(ids).sort();
    if (list.length === 0) {
      setPayrollAccountByDocId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const out: Record<string, WorkerPayrollAccount | undefined> = {};
      try {
        for (let i = 0; i < list.length; i += PAYROLL_ACCOUNT_CHUNK_SIZE) {
          if (cancelled) return;
          const chunk = list.slice(i, i + PAYROLL_ACCOUNT_CHUNK_SIZE);
          await mergeWorkerPayrollAccountChunk(tenantId, chunk, out);
        }
      } catch (e) {
        console.error('[useOnboardingTaxPayrollQueue] payroll account batch load failed', e);
      }
      if (!cancelled) setPayrollAccountByDocId(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, pipelines]);

  const userIdsKey = useMemo(() => {
    const u = new Set<string>();
    pipelines.forEach((p) => {
      const id = String(p.userId || '').trim();
      if (id) u.add(id);
    });
    return Array.from(u).sort().join(',');
  }, [pipelines]);

  useEffect(() => {
    if (userIdsKey.length === 0) {
      setUserById({});
      return;
    }
    const ids = userIdsKey.split(',').filter(Boolean);
    let cancelled = false;
    (async () => {
      const out: Record<string, UserProfileLite | undefined> = {};
      const chunk = ids.slice(0, 120);
      await Promise.all(
        chunk.map(async (uid) => {
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

  const everifySelectCaseByUserId = useMemo(
    () => latestSelectEverifyCaseByUserId(everifyCases, selectEntityId),
    [everifyCases, selectEntityId],
  );

  const entityIdToKey = useMemo(() => {
    const m = new Map<string, EmploymentEntityKey>();
    entityBriefForQueue.forEach((e) => {
      m.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
    });
    return m;
  }, [entityBriefForQueue]);

  const allRows = useMemo(
    () =>
      buildTaxPayrollQueueRows(
        pipelines,
        employmentByPipelineId,
        userById,
        assignmentById,
        jobOrderById,
        everifySelectCaseByUserId,
        entityIdToKey,
        payrollAccountByDocId,
      ),
    [
      pipelines,
      employmentByPipelineId,
      userById,
      assignmentById,
      jobOrderById,
      everifySelectCaseByUserId,
      entityIdToKey,
      payrollAccountByDocId,
    ],
  );

  const unfilteredCount = allRows.length;
  const filteredRows = useMemo(() => {
    if (!searchQuery?.trim()) return allRows;
    return allRows.filter((r) => rowMatchesOnboardingWorkerSearch(searchQuery, r));
  }, [allRows, searchQuery]);

  const totalCount = filteredRows.length;
  const rows: OnboardingTaxPayrollQueueRow[] = useMemo(
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
