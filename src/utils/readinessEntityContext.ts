/**
 * Resolve C1 entity employment + onboarding pipeline for an assignment’s job order (hiring entity),
 * aligned with `useEntityEmploymentOverview` / `loadEntityOnboardingEngineBuildContextAdmin`.
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { EntityEmploymentRecord, WorkerOnboardingPipeline } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { WorkerComplianceItem } from '../types/compliance';
import type { WorkerPayrollAccount } from '../types/payroll';
import { EMPLOYMENT_ENTITY_KEYS, resolveEntityFirestoreIdForTab } from './employmentEntityPresentation';
import { getWorkerPayrollAccount } from './workerPayrollAccount';
import {
  deriveC1EntityKeyFromEntityName,
  employmentRecordEntityKey,
  pipelineEntityKey,
  type ReadinessEntityBundle,
  type ReadinessJobOrderHiringBrief,
  complianceItemRelevantToAssignment as complianceItemRelevantToAssignmentPure,
  hiringEntityIdForAssignment as hiringEntityIdForAssignmentPure,
  resolveAssignmentEntityKey as resolveAssignmentEntityKeyPure,
  type AssignmentComplianceContext,
  type EmploymentEntityKey,
} from '../shared/readinessEntityResolve';

export type { ReadinessEntityBundle, ReadinessJobOrderHiringBrief, AssignmentComplianceContext, EmploymentEntityKey };

/**
 * Everee readiness mirror as read client-side (Timestamps arrive as
 * Firestore Timestamp objects — only truthiness/nullness is consumed).
 * @see functions/src/integrations/everee/evereeReadinessMirror.ts
 */
export interface EvereeReadinessMirrorWebLike {
  directDepositReady?: boolean;
  i9SignedAt?: unknown;
  employerI9SignedAt?: unknown;
  w4SignedAt?: unknown;
  w9SignedAt?: unknown;
  payable?: boolean;
  onboardingComplete?: boolean;
  hasWorkbrightDocs?: boolean;
}

/** Web bundle uses full employment types; structurally compatible with shared `ReadinessEntityBundle`. */
export type ReadinessEntityBundleWeb = ReadinessEntityBundle & {
  employmentsByKey: Record<EmploymentEntityKey, EntityEmploymentRecord | null>;
  pipelinesByKey: Record<EmploymentEntityKey, WorkerOnboardingPipeline | null>;
  /** Per tab — same doc as Employment onboarding payroll card. */
  payrollByKey: Record<EmploymentEntityKey, (WorkerPayrollAccount & { id: string }) | null>;
  /** `entities.{id}.workerType` for TempWorks W-4 vs W-9 branch. */
  entityWorkerTypeRawByKey: Record<EmploymentEntityKey, string | null>;
  /** Everee readiness mirror per entity (everee_workers.readinessMirror) —
   *  the authoritative signed/verified stamps (2026-09-03). */
  evereeMirrorByKey: Record<EmploymentEntityKey, EvereeReadinessMirrorWebLike | null>;
};

export async function fetchReadinessEntityBundle(
  tenantId: string,
  userId: string,
  assignmentRows: Array<{ data: Record<string, unknown> }>
): Promise<ReadinessEntityBundleWeb> {
  const entitiesSnap = await getDocs(collection(db, p.entities(tenantId)));
  const entityBrief = entitiesSnap.docs.map((d) => {
    const data = d.data() as { name?: string; entityCode?: string };
    return { id: d.id, name: String(data.name || d.id), entityCode: String(data.entityCode || '') };
  });
  const entityIdToKey = new Map<string, EmploymentEntityKey>();
  entityBrief.forEach((e) => {
    entityIdToKey.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
  });

  const [eeSnap, woSnap, ewSnap] = await Promise.all([
    getDocs(query(collection(db, p.entityEmployments(tenantId)), where('userId', '==', userId))),
    getDocs(query(collection(db, p.workerOnboarding(tenantId)), where('userId', '==', userId))),
    getDocs(query(collection(db, p.evereeWorkers(tenantId)), where('userId', '==', userId))).catch(
      () => null,
    ),
  ]);

  const evereeMirrorByKey: Record<EmploymentEntityKey, EvereeReadinessMirrorWebLike | null> = {
    select: null,
    events: null,
    workforce: null,
  };
  ewSnap?.docs.forEach((d) => {
    const data = d.data() as { entityId?: string; readinessMirror?: EvereeReadinessMirrorWebLike };
    if (!data.readinessMirror) return;
    const entityId = String(data.entityId || d.id.split('__')[0] || '');
    // everee_workers.entityId matches the entities doc id; fall back to
    // token-derivation for safety (ids read like "c1_select_llc").
    const ek = entityIdToKey.get(entityId) ?? deriveC1EntityKeyFromEntityName(entityId);
    if (ek) evereeMirrorByKey[ek] = data.readinessMirror;
  });

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

  const jobOrderIds = new Set<string>();
  assignmentRows.forEach((r) => {
    const jo = r.data.jobOrderId;
    if (typeof jo === 'string' && jo.trim()) jobOrderIds.add(jo.trim());
  });

  const jobOrderById = new Map<string, ReadinessJobOrderHiringBrief>();
  const accountHiringCache: Record<string, string | null> = {};

  const hiringEntityFromRecruiterAccount = async (recruiterAccountId: string): Promise<string | null> => {
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
  };

  await Promise.all(
    Array.from(jobOrderIds).map(async (jid) => {
      try {
        let joSnap = await getDoc(doc(db, p.jobOrder(tenantId, jid)));
        if (!joSnap.exists()) {
          joSnap = await getDoc(doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jid));
        }
        if (joSnap.exists()) {
          const jd = joSnap.data() as Record<string, unknown>;
          const joHiring = (jd.hiringEntityId as string | null | undefined) ?? null;
          const recAcc = String(jd.recruiterAccountId || '').trim() || null;
          let effective = joHiring;
          if (!effective && recAcc) {
            effective = await hiringEntityFromRecruiterAccount(recAcc);
          }
          jobOrderById.set(jid, {
            hiringEntityId: joHiring,
            effectiveHiringEntityId: effective,
          });
        }
      } catch {
        /* ignore */
      }
    })
  );

  const payrollByKey = {
    select: null,
    workforce: null,
    events: null,
  } as Record<EmploymentEntityKey, (WorkerPayrollAccount & { id: string }) | null>;
  const entityWorkerTypeRawByKey: Record<EmploymentEntityKey, string | null> = {
    select: null,
    workforce: null,
    events: null,
  };

  await Promise.all(
    EMPLOYMENT_ENTITY_KEYS.flatMap((ek) => [
      (async () => {
        payrollByKey[ek] = await getWorkerPayrollAccount(tenantId, userId, ek);
      })(),
      (async () => {
        const eid = resolveEntityFirestoreIdForTab(ek, entityBrief, employmentsByKey[ek]);
        if (!eid) return;
        try {
          const es = await getDoc(doc(db, p.entity(tenantId, eid)));
          if (!es.exists()) return;
          const wt = String((es.data() as { workerType?: string }).workerType || '').trim();
          entityWorkerTypeRawByKey[ek] = wt || null;
        } catch {
          /* ignore */
        }
      })(),
    ]),
  );

  return {
    entityIdToKey,
    employmentsByKey,
    pipelinesByKey,
    jobOrderById,
    payrollByKey,
    entityWorkerTypeRawByKey,
    evereeMirrorByKey,
  };
}

export function resolveAssignmentEntityKey(
  assignmentData: Record<string, unknown>,
  bundle: ReadinessEntityBundle
): EmploymentEntityKey | null {
  return resolveAssignmentEntityKeyPure(assignmentData, bundle);
}

export function hiringEntityIdForAssignment(
  assignmentData: Record<string, unknown>,
  bundle: ReadinessEntityBundle
): string | null {
  return hiringEntityIdForAssignmentPure(assignmentData, bundle);
}

export function complianceItemRelevantToAssignment(
  item: WorkerComplianceItem & { id: string },
  ctx: AssignmentComplianceContext
): boolean {
  return complianceItemRelevantToAssignmentPure(item, ctx);
}
