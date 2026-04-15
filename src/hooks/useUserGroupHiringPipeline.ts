import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import type { UserGroupHiringConfigV1 } from '../types/userGroupHiringConfig';
import {
  aggregateGroupHiringPipeline,
  buildPolicyImpactRows,
  buildQueuedCandidatePreview,
  dedupeApplicationsForOnCallPool,
  extractStoredOrchestratorDecision,
  isOnCallMemberCentricPipeline,
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
  /** Firestore application docs loaded before on-call dedupe (union query size). */
  rawApplicationDocCount: number;
  /** When true, metrics and policy rows use one application doc per worker (on-call pool). */
  memberCentricOnCall: boolean;
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
        const appsCol = collection(db, 'tenants', tenantId, 'applications');
        const appById = new Map<string, Record<string, unknown>>();

        const groupSnap = await getDoc(doc(db, 'tenants', tenantId, 'userGroups', groupId));
        const groupData = groupSnap.exists() ? groupSnap.data() : {};
        const memberIds: string[] = Array.isArray(groupData.memberIds)
          ? (groupData.memberIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : [];

        const qGroup = query(appsCol, where('groupId', '==', groupId));
        const snapByGroup = await getDocs(qGroup);
        for (const d of snapByGroup.docs) {
          appById.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) });
        }

        const IN_MAX = 10;
        for (let i = 0; i < memberIds.length; i += IN_MAX) {
          const chunk = memberIds.slice(i, i + IN_MAX);
          if (chunk.length === 0) continue;
          const [snapUid, snapCand] = await Promise.all([
            getDocs(query(appsCol, where('userId', 'in', chunk))),
            getDocs(query(appsCol, where('candidateId', 'in', chunk))),
          ]);
          for (const d of snapUid.docs) {
            if (!appById.has(d.id)) {
              appById.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) });
            }
          }
          for (const d of snapCand.docs) {
            if (!appById.has(d.id)) {
              appById.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) });
            }
          }
        }

        if (cancelled) return;
        setDocs([...appById.values()]);
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

  const memberCentricOnCall = Boolean(tenantId && groupId && isOnCallMemberCentricPipeline(cfg));

  const pipelineDocs = useMemo(() => {
    if (!tenantId || !groupId || !memberCentricOnCall) return docs;
    return dedupeApplicationsForOnCallPool(docs, groupId);
  }, [tenantId, groupId, docs, memberCentricOnCall]);

  const rawApplicationDocCount = docs.length;

  const metrics = useMemo(() => {
    if (!tenantId || !groupId) return EMPTY_METRICS;
    return aggregateGroupHiringPipeline(pipelineDocs, cfg);
  }, [tenantId, groupId, pipelineDocs, cfg]);

  const metricsBeta = useMemo(() => {
    if (pipelineDocs.length === 0) return true;
    return pipelineDocs.some((d) => {
      const row = d as Record<string, unknown>;
      if (extractStoredOrchestratorDecision(row)) return false;
      const ai = row.aiAutomation as Record<string, unknown> | undefined;
      return !ai || typeof ai.decision !== 'string';
    });
  }, [pipelineDocs]);

  const queuedPreview = useMemo(() => buildQueuedCandidatePreview(pipelineDocs), [pipelineDocs]);

  const policyImpactRows = useMemo(() => buildPolicyImpactRows(pipelineDocs, cfg), [pipelineDocs, cfg]);

  return {
    loading,
    error,
    metrics,
    metricsBeta,
    queuedPreview,
    policyImpactRows,
    rawApplicationDocCount,
    memberCentricOnCall,
  };
}
