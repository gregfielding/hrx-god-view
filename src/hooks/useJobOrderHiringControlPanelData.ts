import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { aggregatePeerApplicationStats } from '../utils/jobOrderApplicationHiringStats';
import { parseApplicationHiringLifecycle } from '../utils/applicationHiringLifecycle';
import {
  countRecruiterLifecycleBuckets,
  type RecruiterLifecycleFilterBucket,
} from '../utils/recruiterApplicationLifecycleBucket';
import type { ApplicationHiringLifecycle } from '../types/applicationHiringLifecycle';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import { formatAiAutomationRecruiterTooltip } from '../utils/formatAiAutomationRecruiterTooltip';

export type HiringDecisionKind = 'advance' | 'review' | 'hold' | 'reject' | 'unknown';

export type RecentHiringDecisionRow = {
  applicationId: string;
  candidateName: string;
  decision: HiringDecisionKind;
  reasonCodes: string[];
  evaluatedAtMs: number | null;
  hiringLifecycle?: ApplicationHiringLifecycle;
  /** Humanized legacy `status` for tooltip fallback alongside lifecycle. */
  legacyStatusLabel?: string | null;
  /** Orchestrator line for tooltip only. */
  aiAutomationSummary?: string | null;
};

function extractFinalDecision(data: Record<string, unknown>): {
  decision: HiringDecisionKind;
  reasonCodes: string[];
  evaluatedAtMs: number | null;
  appNoShowBand: string | null;
  asgNoShowBand: string | null;
} | null {
  const aa = data.aiAutomation as Record<string, unknown> | undefined;
  const v1 = aa?.orchestratorV1 as Record<string, unknown> | undefined;
  if (!v1 || typeof v1 !== 'object') return null;
  const final = v1.finalResult as Record<string, unknown> | undefined;
  const policyEngine = v1.policyEngineResult as Record<string, unknown> | undefined;
  const fr =
    final && typeof final.decision === 'string'
      ? final
      : policyEngine && typeof policyEngine.decision === 'string'
        ? policyEngine
        : final ?? policyEngine;
  const decRaw = fr && typeof fr.decision === 'string' ? fr.decision : '';
  const decision: HiringDecisionKind =
    decRaw === 'advance' || decRaw === 'review' || decRaw === 'hold' || decRaw === 'reject'
      ? decRaw
      : 'unknown';
  const reasonCodes = Array.isArray(fr?.reasonCodes)
    ? (fr!.reasonCodes as unknown[]).map((x) => String(x))
    : [];
  let evaluatedAtMs: number | null = null;
  const ev = v1.evaluatedAt;
  if (ev && typeof ev === 'object' && 'toMillis' in (ev as object)) {
    evaluatedAtMs = (ev as { toMillis: () => number }).toMillis();
  } else if (typeof ev === 'number' && Number.isFinite(ev)) {
    evaluatedAtMs = ev;
  }
  const inputs = v1.inputs as Record<string, unknown> | undefined;
  const appNoShowBand =
    inputs && typeof inputs.applicationNoShowBand === 'string' ? inputs.applicationNoShowBand : null;
  const asgNoShowBand =
    inputs && typeof inputs.assignmentNoShowBand === 'string' ? inputs.assignmentNoShowBand : null;
  return { decision, reasonCodes, evaluatedAtMs, appNoShowBand, asgNoShowBand };
}

function applicantDisplayName(data: Record<string, unknown>): string {
  const direct = String(data.applicantName || data.displayName || '').trim();
  if (direct) return direct;
  const fn = String(data.firstName || '').trim();
  const ln = String(data.lastName || '').trim();
  const joined = [fn, ln].filter(Boolean).join(' ');
  return joined || 'Unknown applicant';
}

function tsMillis(v: unknown): number {
  if (v && typeof v === 'object' && v !== null && 'toMillis' in v) {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function useJobOrderHiringControlPanelData(
  tenantId: string | null | undefined,
  jobOrderId: string | null | undefined,
  workerAiPrescreenRequired: boolean,
): {
  loading: boolean;
  error: string | null;
  totalApplicants: number;
  interviewed: number;
  ready: number;
  onboardingPipeline: number;
  assigned: number;
  /** advance / review / hold / reject / unknown */
  decisionCounts: Record<string, number>;
  /** band string → count (application + assignment no-show overlays) */
  noShowBandCounts: Record<string, number>;
  recentDecisions: RecentHiringDecisionRow[];
  /** Raw rows for optional extra UI */
  applicationDocs: QueryDocumentSnapshot[];
  /** Recruiter lifecycle buckets (same derivation as Applications table). */
  lifecycleBucketCounts: Record<RecruiterLifecycleFilterBucket, number>;
  /** Apps with score / job-fit gate blockers on hiring lifecycle. */
  thresholdBlockerCount: number;
} {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigned, setAssigned] = useState(0);
  const [applicationDocs, setApplicationDocs] = useState<QueryDocumentSnapshot[]>([]);

  useEffect(() => {
    if (!tenantId || !jobOrderId) {
      setLoading(false);
      setApplicationDocs([]);
      setAssigned(0);
      return;
    }
    setLoading(true);
    setError(null);

    const appsRef = collection(db, 'tenants', tenantId, 'applications');
    const appsQ = query(appsRef, where('jobOrderId', '==', jobOrderId));
    const unsubApps = onSnapshot(
      appsQ,
      (snap) => {
        setApplicationDocs(snap.docs);
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to subscribe to applications');
        setLoading(false);
      },
    );

    const placRef = collection(db, 'tenants', tenantId, 'placements');
    const placQ = query(placRef, where('jobOrderId', '==', jobOrderId));
    const unsubPlac = onSnapshot(
      placQ,
      (snap) => setAssigned(snap.size),
      () => {
        /* non-fatal */
      },
    );

    return () => {
      unsubApps();
      unsubPlac();
    };
  }, [tenantId, jobOrderId]);

  const pipeline = useMemo(
    () => aggregatePeerApplicationStats(applicationDocs, workerAiPrescreenRequired),
    [applicationDocs, workerAiPrescreenRequired],
  );

  const onboardingPipeline = pipeline.onboardingPipeline;

  const lifecycleBucketCounts = useMemo(
    () =>
      countRecruiterLifecycleBuckets(
        applicationDocs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            hiringLifecycle: data.hiringLifecycle as { stage?: string } | undefined,
            rawApplicationStatus: String(data.status ?? ''),
          };
        }),
      ),
    [applicationDocs],
  );

  const thresholdBlockerCount = useMemo(() => {
    let n = 0;
    for (const d of applicationDocs) {
      const data = d.data() as Record<string, unknown>;
      const hl = data.hiringLifecycle as { blockers?: unknown } | undefined;
      const blockers = Array.isArray(hl?.blockers) ? (hl!.blockers as unknown[]) : [];
      const strs = blockers.map((x) => String(x));
      if (strs.includes('SCORE_BELOW_MINIMUM') || strs.includes('JOB_FIT_GATE_FAILED')) n += 1;
    }
    return n;
  }, [applicationDocs]);

  const aggregates = useMemo(() => {
    const decisionCounts: Record<string, number> = {};
    const noShowBandCounts: Record<string, number> = {};
    const recent: RecentHiringDecisionRow[] = [];

    for (const d of applicationDocs) {
      const data = d.data() as Record<string, unknown>;
      const ext = extractFinalDecision(data);
      if (ext) {
        const k = ext.decision;
        decisionCounts[k] = (decisionCounts[k] ?? 0) + 1;
        const band = ext.asgNoShowBand || ext.appNoShowBand;
        if (band) {
          noShowBandCounts[band] = (noShowBandCounts[band] ?? 0) + 1;
        }
        const t = ext.evaluatedAtMs ?? tsMillis(data.updatedAt) ?? tsMillis(data.createdAt);
        const legacyRaw = String(data.status || 'submitted');
        const legacyStatusLabel = (
          normalizeApplicationStatus(legacyRaw) ?? legacyRaw
        ).replace(/_/g, ' ');
        recent.push({
          applicationId: d.id,
          candidateName: applicantDisplayName(data),
          decision: ext.decision,
          reasonCodes: ext.reasonCodes,
          evaluatedAtMs: ext.evaluatedAtMs ?? (t || null),
          hiringLifecycle: parseApplicationHiringLifecycle(data.hiringLifecycle),
          legacyStatusLabel,
          aiAutomationSummary: formatAiAutomationRecruiterTooltip(data),
        });
      }
    }

    recent.sort((a, b) => (b.evaluatedAtMs ?? 0) - (a.evaluatedAtMs ?? 0));
    const recentDecisions = recent.slice(0, 5);

    return { decisionCounts, noShowBandCounts, recentDecisions };
  }, [applicationDocs]);

  return {
    loading,
    error,
    totalApplicants: pipeline.totalApplicants,
    interviewed: pipeline.interviewed,
    ready: pipeline.ready,
    onboardingPipeline,
    assigned,
    decisionCounts: aggregates.decisionCounts,
    noShowBandCounts: aggregates.noShowBandCounts,
    recentDecisions: aggregates.recentDecisions,
    applicationDocs,
    lifecycleBucketCounts,
    thresholdBlockerCount,
  };
}
