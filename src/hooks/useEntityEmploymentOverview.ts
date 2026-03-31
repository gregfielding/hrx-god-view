import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type {
  EmploymentEntityKey,
  EmploymentEntityOverview,
  EmploymentEverifySummary,
  EntityEmploymentRecord,
  EntityTabSettingsSnapshot,
  OnboardingInstanceSnapshot,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS, resolveEntityFirestoreIdForTab } from '../utils/employmentEntityPresentation';
import { buildEmploymentEntityOverview } from '../utils/employmentReadiness';
import {
  buildEverifyCaseBriefsForSelectEntity,
  filterAutomationDispatchBriefsForEntityTab,
  onboardingAutomationDispatchBriefFromRaw,
  type EverifyCaseNarrativeBrief,
  type OnboardingAutomationDispatchBrief,
} from '../utils/employmentOnboardingNarrative';
import { deriveC1EntityKeyFromEntityName, resolveC1SelectEntityId } from '../utils/c1EntityWorkAuthorizationUi';
import { getWorkerPayrollAccount } from '../utils/workerPayrollAccount';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { SignatureEnvelopeStatus } from '../types/phase1cOnboarding';

function pipelineEntityKey(pipe: WorkerOnboardingPipeline, userId: string): EmploymentEntityKey | null {
  const fromField = String(pipe.entityKey || '').toLowerCase();
  if (fromField === 'select' || fromField === 'workforce' || fromField === 'events') return fromField;
  const prefix = `${userId}__`;
  if (pipe.id.startsWith(prefix)) {
    const tail = pipe.id.slice(prefix.length).toLowerCase();
    if (tail === 'select' || tail === 'workforce' || tail === 'events') return tail as EmploymentEntityKey;
  }
  return null;
}

function employmentRecordEntityKey(rec: EntityEmploymentRecord, userId: string): EmploymentEntityKey | null {
  const k = String(rec.entityKey || '').toLowerCase();
  if (k === 'select' || k === 'workforce' || k === 'events') return k as EmploymentEntityKey;
  const prefix = `${userId}__`;
  if (rec.id.startsWith(prefix)) {
    const tail = rec.id.slice(prefix.length).toLowerCase();
    if (tail === 'select' || tail === 'workforce' || tail === 'events') return tail as EmploymentEntityKey;
  }
  return null;
}

function buildEverifySummary(
  caseDocs: Array<{ id: string; data: () => Record<string, unknown> }>,
  selectEntityId: string | null
): EmploymentEverifySummary | null {
  if (!selectEntityId) {
    return { applicable: false, statusDisplay: 'No C1 Select entity', caseCount: 0 };
  }
  const selectCases = caseDocs.filter((d) => {
    const raw = d.data();
    return String(raw.entityId || '') === selectEntityId;
  });
  if (selectCases.length === 0) {
    return {
      applicable: true,
      statusDisplay: 'No cases',
      caseCount: 0,
      actionNeeded: false,
    };
  }
  const sorted = [...selectCases].sort((a, b) => {
    const ta = (a.data().updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
    const tb = (b.data().updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
    return tb - ta;
  });
  const latest = sorted[0];
  const data = latest.data();
  const pub = data.public as { status?: string } | undefined;
  const statusDisplay = String(pub?.status ?? data.status ?? '—');
  const closed = ['closed', 'closure_duplicate', 'completed', 'authorized', 'final_nonconfirmation'].some((x) =>
    statusDisplay.toLowerCase().includes(x)
  );
  return {
    applicable: true,
    statusDisplay,
    caseCount: selectCases.length,
    latestCaseId: latest.id,
    actionNeeded: !closed && !statusDisplay.includes('—'),
  };
}

export interface UseEntityEmploymentOverviewArgs {
  userId: string | undefined;
  tenantId: string | null | undefined;
}

export interface UseEntityEmploymentOverviewResult {
  byEntityKey: Record<EmploymentEntityKey, EmploymentEntityOverview>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEntityEmploymentOverview({
  userId,
  tenantId,
}: UseEntityEmploymentOverviewArgs): UseEntityEmploymentOverviewResult {
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<{
    employmentsByKey: Record<EmploymentEntityKey, EntityEmploymentRecord | null>;
    pipelinesByKey: Record<EmploymentEntityKey, WorkerOnboardingPipeline | null>;
    assignmentsByKey: Record<
      EmploymentEntityKey,
      Array<{
        assignmentId: string;
        jobOrderId?: string | null;
        status?: string | null;
        startDate?: string | null;
        onboardingInstanceId?: string | null;
        onboardingStatus?: string | null;
        onboardingPercent?: number | null;
        jobTitle?: string | null;
      }>
    >;
    onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
    envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
    everifySummary: EmploymentEverifySummary | null;
    everifyCaseBriefs: EverifyCaseNarrativeBrief[];
    payrollByKey: Record<EmploymentEntityKey, Awaited<ReturnType<typeof getWorkerPayrollAccount>>>;
    backgroundByKey: Record<EmploymentEntityKey, BackgroundCheckRecord[]>;
    /** Full tenant list for this worker (cross–job-order reuse heuristics). */
    allWorkerBackgroundChecks: BackgroundCheckRecord[];
    entitySettingsByKey: Record<EmploymentEntityKey, EntityTabSettingsSnapshot | null>;
    automationDispatchAll: OnboardingAutomationDispatchBrief[];
  } | null>(null);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!userId || !tenantId) {
      setPayload(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const entitiesSnap = await getDocs(collection(db, p.entities(tenantId)));
        const entityBrief = entitiesSnap.docs.map((d) => {
          const data = d.data() as { name?: string; entityCode?: string };
          return { id: d.id, name: String(data.name || d.id), entityCode: String(data.entityCode || '') };
        });
        const entityIdToKey = new Map<string, EmploymentEntityKey>();
        entityBrief.forEach((e) => {
          entityIdToKey.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
        });

        const selectEntityId = resolveC1SelectEntityId(entityBrief);

        const [eeSnap, woSnap, assignUserSnap, assignCandSnap, casesSnap, bgSnap, dispatchSnap] = await Promise.all([
          getDocs(query(collection(db, p.entityEmployments(tenantId)), where('userId', '==', userId))),
          getDocs(query(collection(db, p.workerOnboarding(tenantId)), where('userId', '==', userId))),
          getDocs(query(collection(db, p.assignments(tenantId)), where('userId', '==', userId))),
          getDocs(query(collection(db, p.assignments(tenantId)), where('candidateId', '==', userId))),
          // Recruiter/admin: read private everify_cases (rules allow tenant role); linkage fields are authoritative.
          getDocs(query(collection(db, p.everifyCases(tenantId)), where('userId', '==', userId), limit(80))),
          getDocs(query(collection(db, 'backgroundChecks'), where('candidateId', '==', userId), limit(120))),
          getDocs(
            query(
              collection(db, p.onboardingAutomationDispatch(tenantId)),
              where('userId', '==', userId),
              limit(120)
            )
          ),
        ]);

        const automationDispatchAll = dispatchSnap.docs.map((d) =>
          onboardingAutomationDispatchBriefFromRaw(d.id, d.data() as Record<string, unknown>)
        );

        const assignmentsMap = new Map<string, Record<string, unknown>>();
        assignUserSnap.docs.forEach((d) => assignmentsMap.set(d.id, d.data() as Record<string, unknown>));
        assignCandSnap.docs.forEach((d) => {
          if (!assignmentsMap.has(d.id)) assignmentsMap.set(d.id, d.data() as Record<string, unknown>);
        });

        const jobOrderIds = new Set<string>();
        assignmentsMap.forEach((data) => {
          const jo = data.jobOrderId as string | undefined;
          if (jo) jobOrderIds.add(jo);
        });

        const jobOrderById = new Map<string, { hiringEntityId?: string | null; jobTitle?: string; jobOrderName?: string }>();
        await Promise.all(
          Array.from(jobOrderIds).map(async (jid) => {
            try {
              let joSnap = await getDoc(doc(db, p.jobOrder(tenantId, jid)));
              if (!joSnap.exists()) {
                joSnap = await getDoc(doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jid));
              }
              if (joSnap.exists()) {
                const jd = joSnap.data() as Record<string, unknown>;
                jobOrderById.set(jid, {
                  hiringEntityId: (jd.hiringEntityId as string | null | undefined) ?? null,
                  jobTitle: jd.jobTitle as string | undefined,
                  jobOrderName: (jd.jobOrderName || jd.title) as string | undefined,
                });
              }
            } catch {
              /* ignore */
            }
          })
        );

        const assignmentEntityKey = (jobOrderId: string | undefined | null): EmploymentEntityKey | null => {
          if (!jobOrderId) return null;
          const jo = jobOrderById.get(jobOrderId);
          const hid = jo?.hiringEntityId;
          if (!hid) return null;
          return entityIdToKey.get(hid) ?? null;
        };

        type AssignmentRow = {
          assignmentId: string;
          jobOrderId?: string | null;
          status?: string | null;
          startDate?: string | null;
          onboardingInstanceId?: string | null;
          onboardingStatus?: string | null;
          onboardingPercent?: number | null;
          jobTitle?: string | null;
        };
        const assignmentsByKey: Record<EmploymentEntityKey, AssignmentRow[]> = {
          select: [],
          workforce: [],
          events: [],
        };

        const onboardingInstanceIds: string[] = [];
        assignmentsMap.forEach((data, aid) => {
          const jobOrderId = data.jobOrderId as string | undefined;
          const ek = assignmentEntityKey(jobOrderId ?? null);
          if (!ek) return;
          const row = {
            assignmentId: aid,
            jobOrderId: jobOrderId ?? null,
            status: (data.status as string) ?? null,
            startDate: (data.startDate as string) ?? null,
            onboardingInstanceId: (data.onboardingInstanceId as string | null | undefined) ?? null,
            onboardingStatus: (data.onboardingStatus as string | undefined) ?? null,
            onboardingPercent: (data.onboardingPercent as number | undefined) ?? null,
            jobTitle: jobOrderId ? jobOrderById.get(jobOrderId)?.jobTitle ?? jobOrderById.get(jobOrderId)?.jobOrderName ?? null : null,
          };
          assignmentsByKey[ek].push(row);
          if (row.onboardingInstanceId) onboardingInstanceIds.push(row.onboardingInstanceId);
        });

        const onboardingByInstanceId = new Map<string, OnboardingInstanceSnapshot>();
        await Promise.all(
          [...new Set(onboardingInstanceIds)].map(async (instanceId) => {
            try {
              const instRef = doc(db, 'tenants', tenantId, 'onboarding_instances', instanceId);
              const instSnap = await getDoc(instRef);
              if (instSnap.exists()) {
                const d = instSnap.data();
                onboardingByInstanceId.set(instanceId, {
                  status: (d.status as string) || 'unknown',
                  percentComplete: (d.percentComplete as number) ?? 0,
                  resolvedDocuments: Array.isArray(d.resolvedDocuments) ? d.resolvedDocuments : [],
                  resolvedSteps: Array.isArray(d.resolvedSteps) ? d.resolvedSteps : [],
                  resolvedChecks: Array.isArray(d.resolvedChecks) ? d.resolvedChecks : [],
                  blockedReason: (d.blockedReason as string | null) ?? null,
                });
              }
            } catch {
              /* ignore */
            }
          })
        );

        const envelopesByAssignmentId = new Map<string, Map<string, SignatureEnvelopeStatus>>();
        await Promise.all(
          Array.from(assignmentsMap.keys()).map(async (assignmentId) => {
            try {
              const q = query(
                collection(db, p.signatureEnvelopes(tenantId)),
                where('assignmentId', '==', assignmentId)
              );
              const snap = await getDocs(q);
              const byDocKey = new Map<string, SignatureEnvelopeStatus>();
              snap.docs.forEach((d) => {
                const data = d.data() as { docKey?: string; status?: SignatureEnvelopeStatus };
                if (data.docKey && data.status) byDocKey.set(data.docKey, data.status);
              });
              envelopesByAssignmentId.set(assignmentId, byDocKey);
            } catch {
              envelopesByAssignmentId.set(assignmentId, new Map());
            }
          })
        );

        const employmentsByKey: Record<EmploymentEntityKey, EntityEmploymentRecord | null> = {
          select: null,
          workforce: null,
          events: null,
        };
        eeSnap.docs.forEach((d) => {
          const rec = { id: d.id, ...(d.data() as Omit<EntityEmploymentRecord, 'id'>) };
          const ek = employmentRecordEntityKey(rec, userId);
          if (ek) employmentsByKey[ek] = rec;
        });

        const pipelinesByKey: Record<EmploymentEntityKey, WorkerOnboardingPipeline | null> = {
          select: null,
          workforce: null,
          events: null,
        };
        woSnap.docs.forEach((d) => {
          const pipe = { id: d.id, ...(d.data() as Record<string, unknown>) } as WorkerOnboardingPipeline;
          const ek = pipelineEntityKey(pipe, userId);
          if (ek) pipelinesByKey[ek] = pipe;
        });

        const everifyCaseDocRefs = casesSnap.docs.map((d) => ({
          id: d.id,
          data: () => d.data() as Record<string, unknown>,
        }));
        const everifySummary = buildEverifySummary(everifyCaseDocRefs, selectEntityId);
        const everifyCaseBriefs = buildEverifyCaseBriefsForSelectEntity(everifyCaseDocRefs, selectEntityId);

        const payrollByKey: Record<EmploymentEntityKey, Awaited<ReturnType<typeof getWorkerPayrollAccount>>> = {
          select: null,
          workforce: null,
          events: null,
        };
        await Promise.all(
          EMPLOYMENT_ENTITY_KEYS.map(async (ek) => {
            payrollByKey[ek] = await getWorkerPayrollAccount(tenantId, userId, ek);
          })
        );

        const bgList = bgSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<BackgroundCheckRecord, 'id'>) }))
          .filter((r) => String(r.tenantId || '') === tenantId);

        const jobOrdersByEntity: Record<EmploymentEntityKey, Set<string>> = {
          select: new Set(),
          workforce: new Set(),
          events: new Set(),
        };
        (['select', 'workforce', 'events'] as EmploymentEntityKey[]).forEach((ek) => {
          assignmentsByKey[ek].forEach((a) => {
            if (a.jobOrderId) jobOrdersByEntity[ek].add(a.jobOrderId);
          });
        });

        const backgroundByKey: Record<EmploymentEntityKey, BackgroundCheckRecord[]> = {
          select: [],
          workforce: [],
          events: [],
        };
        EMPLOYMENT_ENTITY_KEYS.forEach((ek) => {
          const jset = jobOrdersByEntity[ek];
          const eidForEk = resolveEntityFirestoreIdForTab(ek, entityBrief, employmentsByKey[ek]);
          backgroundByKey[ek] = bgList.filter((b) => {
            if (b.jobOrderId && jset.has(b.jobOrderId)) return true;
            if (eidForEk && b.automationHiringEntityId === eidForEk) return true;
            if (b.relationshipEntityKey === ek) return true;
            return false;
          });
        });

        const entitySettingsByKey: Record<EmploymentEntityKey, EntityTabSettingsSnapshot | null> = {
          select: null,
          workforce: null,
          events: null,
        };
        await Promise.all(
          EMPLOYMENT_ENTITY_KEYS.map(async (ek) => {
            const eid = resolveEntityFirestoreIdForTab(ek, entityBrief, employmentsByKey[ek]);
            if (!eid) return;
            try {
              const es = await getDoc(doc(db, p.entity(tenantId, eid)));
              if (!es.exists()) return;
              const d = es.data() as {
                name?: string;
                workerType?: string;
                onboardingWorkflowSteps?: Record<string, boolean>;
                payrollSettings?: { onboardingUrl?: string | null; portalUrl?: string | null };
              };
              const ps = d.payrollSettings;
              const ob = String(ps?.onboardingUrl || '').trim() || null;
              const pu = String(ps?.portalUrl || '').trim() || null;
              entitySettingsByKey[ek] = {
                entityFirestoreId: eid,
                entityName: String(d.name || eid),
                onboardingWorkflowSteps:
                  d.onboardingWorkflowSteps && typeof d.onboardingWorkflowSteps === 'object'
                    ? d.onboardingWorkflowSteps
                    : {},
                workerType: String(d.workerType || 'W2'),
                payrollOnboardingUrl: ob,
                payrollPortalUrl: pu,
              };
            } catch {
              /* ignore */
            }
          })
        );

        if (!cancelled) {
          setPayload({
            employmentsByKey,
            pipelinesByKey,
            assignmentsByKey,
            onboardingByInstanceId,
            envelopesByAssignmentId,
            everifySummary,
            everifyCaseBriefs,
            payrollByKey,
            backgroundByKey,
            allWorkerBackgroundChecks: bgList,
            entitySettingsByKey,
            automationDispatchAll,
          });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load employment overview');
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [userId, tenantId, tick]);

  const byEntityKey = useMemo(() => {
    const result = {} as Record<EmploymentEntityKey, EmploymentEntityOverview>;
    EMPLOYMENT_ENTITY_KEYS.forEach((entityKey) => {
      const eid = payload?.entitySettingsByKey[entityKey]?.entityFirestoreId;
      const assignmentIdsForTab = (payload?.assignmentsByKey[entityKey] ?? []).map((a) => a.assignmentId);
      const automationDispatchBriefs = filterAutomationDispatchBriefsForEntityTab(
        payload?.automationDispatchAll,
        eid,
        assignmentIdsForTab
      );
      result[entityKey] = buildEmploymentEntityOverview({
        entityKey,
        entityEmployment: payload?.employmentsByKey[entityKey] ?? null,
        workerOnboarding: payload?.pipelinesByKey[entityKey] ?? null,
        entitySettings: payload?.entitySettingsByKey[entityKey] ?? null,
        assignmentsRows: payload?.assignmentsByKey[entityKey] ?? [],
        onboardingByInstanceId: payload?.onboardingByInstanceId ?? new Map(),
        envelopesByAssignmentId: payload?.envelopesByAssignmentId ?? new Map(),
        everifySummary: entityKey === 'select' ? (payload?.everifySummary ?? null) : null,
        payrollAccount: payload?.payrollByKey[entityKey] ?? null,
        backgroundChecksForEntity: payload?.backgroundByKey[entityKey] ?? [],
        allTenantWorkerBackgroundChecks: payload?.allWorkerBackgroundChecks ?? [],
        everifyCaseBriefs: payload?.everifyCaseBriefs ?? [],
        automationDispatchBriefs,
      });
    });
    return result;
  }, [payload]);

  return { byEntityKey, loading, error, refetch };
}
