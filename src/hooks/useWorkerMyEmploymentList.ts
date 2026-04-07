import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import type { EmploymentAssignmentSummary, EmploymentEntityKey } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { EntityEmploymentRecord } from '../utils/workerMyEmploymentListRowModel';
import { loadWorkerAssignmentsByEntityKey } from '../utils/loadWorkerAssignmentsByEntityKey';
import { countPipelineProgressForEntity } from '../utils/onboardingPipelineProgress';

export function useWorkerMyEmploymentList(tenantId: string | null, uid: string | null) {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<EntityEmploymentRecord[]>([]);
  const [assignmentsByEntityKey, setAssignmentsByEntityKey] = useState<Record<
    EmploymentEntityKey,
    EmploymentAssignmentSummary[]
  > | null>(null);
  const [stepCounts, setStepCounts] = useState<Record<string, { complete: number; total: number }>>({});

  useEffect(() => {
    if (!tenantId || !uid) {
      setRecords([]);
      setAssignmentsByEntityKey(null);
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const ref = collection(db, 'tenants', tenantId, 'entity_employments');
        const q = query(ref, where('userId', '==', uid));
        const [snap, byKey] = await Promise.all([getDocs(q), loadWorkerAssignmentsByEntityKey(tenantId, uid)]);
        const list: EntityEmploymentRecord[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<EntityEmploymentRecord, 'id'>),
        }));
        setRecords(list);
        setAssignmentsByEntityKey(byKey);
      } catch {
        setRecords([]);
        setAssignmentsByEntityKey({ select: [], workforce: [], events: [] });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tenantId, uid]);

  useEffect(() => {
    if (!tenantId || records.length === 0) {
      setStepCounts({});
      return;
    }
    const loadCounts = async () => {
      const counts: Record<string, { complete: number; total: number }> = {};
      await Promise.all(
        records.map(async (rec) => {
          if (!rec.onboardingPipelineId) return;
          try {
            const pipelineRef = doc(db, 'tenants', tenantId, 'worker_onboarding', rec.onboardingPipelineId);
            const snap = await getDoc(pipelineRef);
            const data = snap.data();
            const steps = Array.isArray(data?.steps) ? data.steps : [];
            counts[rec.onboardingPipelineId] = countPipelineProgressForEntity(steps, rec.entityKey);
          } catch {
            counts[rec.onboardingPipelineId] = { complete: 0, total: 0 };
          }
        })
      );
      setStepCounts(counts);
    };
    void loadCounts();
  }, [tenantId, records]);

  return { loading, records, assignmentsByEntityKey, stepCounts };
}
