import { collection, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import type { UserGroupHiringConfigV1 } from '../types/userGroupHiringConfig';
import {
  aggregateGroupHiringPipeline,
  buildPolicyImpactRows,
  buildQueuedCandidatePreview,
  type GroupHiringPipelineMetrics,
  type GroupQueuedCandidateRow,
  type PolicyImpactCandidateRow,
} from '../utils/userGroupHiringPipeline';

const EMPTY_METRICS: GroupHiringPipelineMetrics = {
  totalApplications: 0,
  interviewed: 0,
  qualified: 0,
  autoAdvanced: 0,
  onboardingAccepted: 0,
  onboardingInFlow: 0,
  currentOnboardingForTarget: 0,
  queued: 0,
  hiringState: 'inactive',
};

export type UseUserGroupHiringPipelineResult = {
  loading: boolean;
  error: string | null;
  metrics: GroupHiringPipelineMetrics;
  /** True when definitions are best-effort (e.g. sparse aiAutomation fields). */
  metricsBeta: boolean;
  queuedPreview: GroupQueuedCandidateRow[];
  /** Applications for this group, interpreted against the current effective hiring config. */
  policyImpactRows: PolicyImpactCandidateRow[];
};

export function useUserGroupHiringPipeline(
  tenantId: string | undefined,
  groupId: string | undefined,
  cfg: UserGroupHiringConfigV1,
): UseUserGroupHiringPipelineResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (!tenantId || !groupId) {
      setDocs([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = collection(db, 'tenants', tenantId, 'applications');
        const q = query(ref, where('groupId', '==', groupId));
        const snap = await getDocs(q);
        if (cancelled) return;
        setDocs(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          })),
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load pipeline data');
          setDocs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, groupId]);

  const metrics = useMemo(() => {
    if (!tenantId || !groupId) return EMPTY_METRICS;
    return aggregateGroupHiringPipeline(docs, cfg);
  }, [tenantId, groupId, docs, cfg]);

  const metricsBeta = useMemo(() => {
    if (docs.length === 0) return true;
    return docs.some((d) => {
      const ai = d.aiAutomation as Record<string, unknown> | undefined;
      return !ai || typeof ai.decision !== 'string';
    });
  }, [docs]);

  const queuedPreview = useMemo(() => buildQueuedCandidatePreview(docs), [docs]);

  const policyImpactRows = useMemo(() => buildPolicyImpactRows(docs, cfg), [docs, cfg]);

  return { loading, error, metrics, metricsBeta, queuedPreview, policyImpactRows };
}
