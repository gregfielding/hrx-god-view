import { useEffect, useState } from 'react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { HiringLifecycleStage } from '../types/applicationHiringLifecycle';

const COUNTED_STAGES: HiringLifecycleStage[] = [
  'profile_incomplete',
  'interview_pending',
  'qualified',
  'review',
  'waitlisted',
];

export type TenantHiringLifecycleStageCounts = Partial<Record<HiringLifecycleStage, number>>;

/**
 * Tenant-wide count aggregations by hiringLifecycle.stage (same queries as settings UI).
 */
export function useTenantHiringLifecycleStageCounts(tenantId: string | null | undefined): {
  loading: boolean;
  error: string | null;
  counts: TenantHiringLifecycleStageCounts;
} {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<TenantHiringLifecycleStageCounts>({});

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      setCounts({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const col = collection(db, 'tenants', tenantId, 'applications');
        const results = await Promise.all(
          COUNTED_STAGES.map((stage) =>
            getCountFromServer(query(col, where('hiringLifecycle.stage', '==', stage))),
          ),
        );
        if (cancelled) return;
        const next: TenantHiringLifecycleStageCounts = {};
        COUNTED_STAGES.forEach((stage, i) => {
          next[stage] = results[i].data().count;
        });
        setCounts(next);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setCounts({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return { loading, error, counts };
}
