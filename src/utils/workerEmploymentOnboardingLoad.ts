/**
 * Loads Firestore inputs for `buildOnboardingPathFromSettings` for the signed-in worker
 * and a single entity employment (My Employment detail).
 */

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
  EmploymentAssignmentSummary,
  EmploymentEntityKey,
  EntityTabSettingsSnapshot,
  OnboardingInstanceSnapshot,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { deriveC1EntityKeyFromEntityName, resolveC1SelectEntityId } from './c1EntityWorkAuthorizationUi';
import { getWorkerPayrollAccount } from './workerPayrollAccount';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { SignatureEnvelopeStatus } from '../types/phase1cOnboarding';
import type { BuildOnboardingPathArgs } from './employmentOnboardingPath';
import { buildEverifyCaseBriefsForSelectEntity, buildEverifySummaryFromCaseDocs } from './employmentOnboardingNarrative';

export interface LoadWorkerOnboardingPathParams {
  tenantId: string;
  userId: string;
  entityKey: EmploymentEntityKey;
  entityFirestoreId: string;
  onboardingPipelineId: string | null | undefined;
  /** `entity_employments.workerType` — gates TempWorks external step overlay vs entity settings alone. */
  employmentWorkerType?: string | null;
}

/**
 * Same data family as `useEntityEmploymentOverview`, scoped to one entity for the worker.
 */
export async function loadBuildOnboardingPathArgsForWorkerEmployment(
  params: LoadWorkerOnboardingPathParams
): Promise<BuildOnboardingPathArgs | null> {
  const { tenantId, userId, entityKey, entityFirestoreId, onboardingPipelineId, employmentWorkerType } = params;
  if (!entityFirestoreId?.trim()) return null;

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

    let everifyCaseDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
    try {
      const casesSnap = await getDocs(
        query(collection(db, p.everifyCases(tenantId)), where('userId', '==', userId), limit(80))
      );
      everifyCaseDocs = casesSnap.docs.map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }));
    } catch {
      everifyCaseDocs = [];
    }

    const [entitySnap, assignUserSnap, assignCandSnap, bgSnap] = await Promise.all([
      getDoc(doc(db, p.entity(tenantId, entityFirestoreId))),
      getDocs(query(collection(db, p.assignments(tenantId)), where('userId', '==', userId))),
      getDocs(query(collection(db, p.assignments(tenantId)), where('candidateId', '==', userId))),
      getDocs(query(collection(db, 'backgroundChecks'), where('candidateId', '==', userId), limit(120))),
    ]);

    let entitySettings: EntityTabSettingsSnapshot | null = null;
    if (entitySnap.exists()) {
      const d = entitySnap.data() as {
        name?: string;
        workerType?: string;
        onboardingWorkflowSteps?: Record<string, boolean>;
      };
      entitySettings = {
        entityFirestoreId,
        entityName: String(d.name || entityFirestoreId),
        onboardingWorkflowSteps:
          d.onboardingWorkflowSteps && typeof d.onboardingWorkflowSteps === 'object'
            ? d.onboardingWorkflowSteps
            : {},
        workerType: String(d.workerType || 'W2'),
      };
    }

    let pipeline: WorkerOnboardingPipeline | null = null;
    if (onboardingPipelineId) {
      const pipeSnap = await getDoc(doc(db, p.workerOnboardingPipeline(tenantId, onboardingPipelineId)));
      if (pipeSnap.exists()) {
        pipeline = { id: pipeSnap.id, ...(pipeSnap.data() as Record<string, unknown>) } as WorkerOnboardingPipeline;
      }
    }

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

    const assignmentsForEntity: EmploymentAssignmentSummary[] = [];
    const onboardingInstanceIds: string[] = [];

    assignmentsMap.forEach((data, aid) => {
      const jobOrderId = data.jobOrderId as string | undefined;
      const ek = assignmentEntityKey(jobOrderId ?? null);
      if (ek !== entityKey) return;
      const row: EmploymentAssignmentSummary = {
        assignmentId: aid,
        jobOrderId: jobOrderId ?? null,
        status: (data.status as string) ?? null,
        startDate: (data.startDate as string) ?? null,
        onboardingInstanceId: (data.onboardingInstanceId as string | null | undefined) ?? null,
        onboardingStatus: (data.onboardingStatus as string | undefined) ?? null,
        onboardingPercent: (data.onboardingPercent as number | undefined) ?? null,
        title: jobOrderId
          ? jobOrderById.get(jobOrderId)?.jobTitle ?? jobOrderById.get(jobOrderId)?.jobOrderName ?? null
          : null,
      };
      assignmentsForEntity.push(row);
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
      assignmentsForEntity.map(async ({ assignmentId }) => {
        try {
          const q = query(collection(db, p.signatureEnvelopes(tenantId)), where('assignmentId', '==', assignmentId));
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

    const everifySummary =
      entityKey === 'select' ? buildEverifySummaryFromCaseDocs(everifyCaseDocs, selectEntityId) : null;

    const payrollAccount = await getWorkerPayrollAccount(tenantId, userId, entityKey);

    const bgList = bgSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<BackgroundCheckRecord, 'id'>) }))
      .filter((r) => String(r.tenantId || '') === tenantId);

    const jobOrderSet = new Set<string>();
    assignmentsForEntity.forEach((a) => {
      if (a.jobOrderId) jobOrderSet.add(a.jobOrderId);
    });
    const backgroundChecksForEntity = bgList.filter((b) => {
      if (!b.jobOrderId) return false;
      return jobOrderSet.has(b.jobOrderId);
    });

    return {
      entityKey,
      entitySettings,
      pipeline,
      assignments: assignmentsForEntity,
      onboardingByInstanceId,
      envelopesByAssignmentId,
      everifySummary,
      everifyCaseBriefs:
        entityKey === 'select' ? buildEverifyCaseBriefsForSelectEntity(everifyCaseDocs, selectEntityId) : undefined,
      payrollAccount,
      backgroundChecksForEntity,
      allTenantWorkerBackgroundChecks: bgList,
      employmentRecordWorkerType: employmentWorkerType ?? null,
      pathLabelAudience: 'worker',
    };
  } catch (e) {
    console.warn('[workerEmploymentOnboardingLoad]', e);
    return null;
  }
}
