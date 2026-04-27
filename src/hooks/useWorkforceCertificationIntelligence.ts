import { useEffect, useState, useMemo } from 'react';
import type { EvaluationContext } from '../shared/certifications/certificationRequirement';
import type { Phase1CertificationRequirement } from '../shared/certifications/certificationRequirement';
import certificationCatalogManifest from '../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../shared/certifications/certificationCatalogManifest';
import { getCanonicalCertificationRecordsWithIds } from '../utils/certifications/getCanonicalCertificationRecords';
import type { CanonicalRecordWithId } from '../utils/certifications/evaluateCertificationsForRequirements';
import { buildWorkforceCertificationSummary } from '../utils/certifications/buildWorkforceCertificationSummary';
import { detectCertificationRisk } from '../utils/certifications/detectCertificationRisk';
import { buildCertificationPriorityQueue } from '../utils/certifications/buildCertificationPriorityQueue';
import { normalizeDateToISODateString } from '../shared/certifications/normalizeDateToISODateString';

const manifest = certificationCatalogManifest as CertificationCatalogManifestV1;

export type WorkforceCertificationIntelligenceState = {
  loading: boolean;
  error: string | null;
  summary: ReturnType<typeof buildWorkforceCertificationSummary> | null;
  riskSignals: ReturnType<typeof detectCertificationRisk>;
  priorityQueue: ReturnType<typeof buildCertificationPriorityQueue>;
};

/**
 * Loads canonical certification rows for a bounded list of workers and runs Phase 5.5 intelligence (insight only).
 */
export function useWorkforceCertificationIntelligence(input: {
  enabled: boolean;
  workerIds: string[];
  requirements: Phase1CertificationRequirement[];
  context?: EvaluationContext;
  maxWorkers?: number;
}): WorkforceCertificationIntelligenceState {
  const { enabled, workerIds, requirements, context = 'assignment', maxWorkers = 50 } = input;
  /** Stable key so parent can pass a new array literal each render without re-fetching the same ids (order preserved). */
  const workerIdsKey = useMemo(() => workerIds.filter(Boolean).join('\u0001'), [workerIds]);
  const cappedIds = useMemo(
    () => Array.from(new Set(workerIds.filter(Boolean))).slice(0, maxWorkers),
    [workerIdsKey, maxWorkers],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordsByUserId, setRecordsByUserId] = useState<Record<string, CanonicalRecordWithId[]>>({});

  useEffect(() => {
    if (!enabled || cappedIds.length === 0 || requirements.length === 0) {
      setRecordsByUserId({});
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const entries = await Promise.all(
          cappedIds.map(async (id) => {
            const rows = await getCanonicalCertificationRecordsWithIds(id);
            return [id, rows] as const;
          }),
        );
        if (cancelled) return;
        const map: Record<string, CanonicalRecordWithId[]> = {};
        for (const [id, rows] of entries) {
          map[id] = rows;
        }
        setRecordsByUserId(map);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Certification intelligence load failed');
          setRecordsByUserId({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, cappedIds, requirements]);

  const todayISO = useMemo(() => normalizeDateToISODateString(new Date()) ?? '1970-01-01', []);

  const summary = useMemo(() => {
    if (!enabled || cappedIds.length === 0 || requirements.length === 0) return null;
    const workers = cappedIds.map((id) => ({ id }));
    return buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements,
      context,
      todayISO,
    });
  }, [enabled, cappedIds, recordsByUserId, requirements, context, todayISO]);

  const riskSignals = useMemo(() => {
    if (!summary) return [];
    return detectCertificationRisk({ summary, manifest, requirements });
  }, [summary, requirements]);

  const priorityQueue = useMemo(() => {
    if (!enabled || cappedIds.length === 0 || requirements.length === 0) return [];
    const workers = cappedIds.map((id) => ({ id }));
    return buildCertificationPriorityQueue({
      workers,
      recordsByUserId,
      requirements,
      context,
      todayISO,
    });
  }, [enabled, cappedIds, recordsByUserId, requirements, context, todayISO]);

  return {
    loading,
    error,
    summary,
    riskSignals,
    priorityQueue,
  };
}
