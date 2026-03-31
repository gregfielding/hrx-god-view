/**
 * Buckets a worker’s assignment docs by C1 employment entity tab key (Select / Workforce / Events).
 * Same resolution rules as `useEntityEmploymentOverview` — used where we need demand signals without full overview.
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { EmploymentAssignmentSummary, EmploymentEntityKey } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { deriveC1EntityKeyFromEntityName } from './c1EntityWorkAuthorizationUi';

const emptyByKey = (): Record<EmploymentEntityKey, EmploymentAssignmentSummary[]> => ({
  select: [],
  workforce: [],
  events: [],
});

export async function loadWorkerAssignmentsByEntityKey(
  tenantId: string,
  userId: string
): Promise<Record<EmploymentEntityKey, EmploymentAssignmentSummary[]>> {
  const entitiesSnap = await getDocs(collection(db, p.entities(tenantId)));
  const entityBrief = entitiesSnap.docs.map((d) => {
    const data = d.data() as { name?: string };
    return { id: d.id, name: String(data.name || d.id) };
  });
  const entityIdToKey = new Map<string, EmploymentEntityKey>();
  entityBrief.forEach((e) => {
    entityIdToKey.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
  });

  const [assignUserSnap, assignCandSnap] = await Promise.all([
    getDocs(query(collection(db, p.assignments(tenantId)), where('userId', '==', userId))),
    getDocs(query(collection(db, p.assignments(tenantId)), where('candidateId', '==', userId))),
  ]);

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

  const assignmentsByKey = emptyByKey();

  assignmentsMap.forEach((data, aid) => {
    const jobOrderId = data.jobOrderId as string | undefined;
    const ek = assignmentEntityKey(jobOrderId ?? null);
    if (!ek) return;
    const joMeta = jobOrderId ? jobOrderById.get(jobOrderId) : undefined;
    const title = joMeta?.jobTitle ?? joMeta?.jobOrderName ?? null;
    assignmentsByKey[ek].push({
      assignmentId: aid,
      jobOrderId: jobOrderId ?? null,
      title,
      status: (data.status as string) ?? null,
      startDate: (data.startDate as string) ?? null,
      onboardingInstanceId: (data.onboardingInstanceId as string | null | undefined) ?? null,
      onboardingStatus: (data.onboardingStatus as string | undefined) ?? null,
      onboardingPercent: (data.onboardingPercent as number | undefined) ?? null,
    });
  });

  return assignmentsByKey;
}
