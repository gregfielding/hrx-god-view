import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { buildCertificationShadowStats } from '../utils/certifications/buildCertificationShadowStats';
import type { CertificationShadowEventLike } from '../types/certifications/certEngineShadowEvent';
import { CERT_ENGINE_SHADOW_COLLECTION } from '../utils/certifications/certEngineShadowTelemetryConstants';

const DEFAULT_QUERY_LIMIT = 1500;

function docToEventLike(id: string, data: Record<string, unknown>): CertificationShadowEventLike | null {
  try {
    const surface = data.surface;
    const requirementSource = data.requirementSource;
    if (surface !== 'apply' && surface !== 'placement' && surface !== 'readiness') return null;
    if (requirementSource !== 'job_posting' && requirementSource !== 'job_order' && requirementSource !== 'assignment') {
      return null;
    }
    return {
      userId: String(data.userId ?? ''),
      jobOrderId: data.jobOrderId ? String(data.jobOrderId) : undefined,
      jobPostingId: data.jobPostingId ? String(data.jobPostingId) : undefined,
      assignmentId: data.assignmentId ? String(data.assignmentId) : undefined,
      surface,
      requirementSource,
      legacyLabels: Array.isArray(data.legacyLabels) ? (data.legacyLabels as string[]) : [],
      engineLabels: Array.isArray(data.engineLabels) ? (data.engineLabels as string[]) : [],
      mismatched: Boolean(data.mismatched),
      details: (data.details && typeof data.details === 'object') ? (data.details as CertificationShadowEventLike['details']) : {},
      createdAt: data.createdAt as CertificationShadowEventLike['createdAt'],
    };
  } catch {
    return null;
  }
}

export function useCertificationShadowStats(options?: { queryLimit?: number }) {
  const qLimit = options?.queryLimit ?? DEFAULT_QUERY_LIMIT;
  const [refreshKey, setRefreshKey] = useState(0);
  const [events, setEvents] = useState<CertificationShadowEventLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, CERT_ENGINE_SHADOW_COLLECTION),
          orderBy('createdAt', 'desc'),
          limit(qLimit),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const list: CertificationShadowEventLike[] = [];
        snap.forEach((d) => {
          const ev = docToEventLike(d.id, d.data() as Record<string, unknown>);
          if (ev) list.push(ev);
        });
        setEvents(list);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'query_failed');
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qLimit, refreshKey]);

  const stats = useMemo(() => buildCertificationShadowStats(events), [events]);

  return { stats, events, loading, error, refresh: () => setRefreshKey((k) => k + 1) };
}
