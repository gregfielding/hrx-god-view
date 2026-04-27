import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { WorkerProfileReadinessV1 } from '../types/workerReadinessV1';
import type { WorkerState } from '../types/workforceStateV1';

const WORKER_STATES = new Set<WorkerState>([
  'applicant',
  'profile_incomplete',
  'onboarding_in_progress',
  'ready_for_placement',
  'active',
  'blocked',
  'inactive',
  'terminated',
]);

function coerceProfileReadiness(raw: unknown): WorkerProfileReadinessV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.status !== 'string' || typeof o.completionPercent !== 'number') return null;
  if (!Array.isArray(o.sections) || !Array.isArray(o.blockingItemIds)) return null;
  if (!Array.isArray(o.importantItemIds) || !Array.isArray(o.recommendedItemIds)) return null;
  return o as unknown as WorkerProfileReadinessV1;
}

function coerceOverallState(raw: unknown): WorkerState | null {
  if (typeof raw !== 'string') return null;
  return WORKER_STATES.has(raw as WorkerState) ? (raw as WorkerState) : null;
}

export type WorkerReadinessV1Snapshot = {
  overallWorkerState: WorkerState | null;
  profileReadiness: WorkerProfileReadinessV1 | null;
};

export interface UseWorkerReadinessV1Result {
  snapshot: WorkerReadinessV1Snapshot | null;
  loading: boolean;
  error: string | null;
}

/**
 * Live `users.{uid}.workerReadinessV1` for recruiter Employment / readiness banner (C1-persisted).
 */
export function useWorkerReadinessV1(userId: string | undefined): UseWorkerReadinessV1Result {
  const [snapshot, setSnapshot] = useState<WorkerReadinessV1Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = String(userId || '').trim();
    if (!uid) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) {
          setSnapshot(null);
          setLoading(false);
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const wr = (data.workerReadinessV1 || {}) as Record<string, unknown>;
        setSnapshot({
          overallWorkerState: coerceOverallState(wr.overallWorkerState),
          profileReadiness: coerceProfileReadiness(wr.profileReadiness),
        });
        setLoading(false);
      },
      (e) => {
        const msg = e instanceof Error ? e.message : 'Could not load worker readiness';
        setError(msg);
        setSnapshot(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  return { snapshot, loading, error };
}
