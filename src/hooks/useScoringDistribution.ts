/**
 * Fetch tenants/{tenantId}/scoringDistribution/current for relative AI score display.
 * Written by Cloud Functions (scheduled + callable); read by client for getRelativeAiScore().
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { ScoringDistribution } from '../utils/scoreSummary';

function parseDistribution(data: Record<string, unknown> | undefined): ScoringDistribution | null {
  if (!data || typeof data.userCount !== 'number') return null;
  const p = (raw: unknown): ScoringDistribution['aiScore'] | null => {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const n = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : undefined);
    const p10 = n('p10'), p25 = n('p25'), p50 = n('p50'), p75 = n('p75'), p90 = n('p90');
    if (p10 == null || p25 == null || p50 == null || p75 == null || p90 == null) return null;
    return { p10, p25, p50, p75, p90 };
  };
  const aiScore = p(data.aiScore);
  const completenessScore = p(data.completenessScore) ?? aiScore;
  const responsivenessScore = p(data.responsivenessScore) ?? aiScore;
  const qualityScore = p(data.qualityScore) ?? aiScore;
  if (!aiScore) return null;
  return {
    updatedAt: data.updatedAt,
    userCount: data.userCount as number,
    aiScore,
    completenessScore,
    responsivenessScore,
    qualityScore,
  };
}

export function useScoringDistribution(tenantId: string | undefined): {
  distribution: ScoringDistribution | null;
  loading: boolean;
  error: Error | null;
} {
  const [distribution, setDistribution] = useState<ScoringDistribution | null>(null);
  const [loading, setLoading] = useState(!!tenantId);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setDistribution(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = doc(db, 'tenants', tenantId, 'scoringDistribution', 'current');
    getDoc(ref)
      .then((snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
        setDistribution(parseDistribution(data));
      })
      .catch((e) => {
        setError(e instanceof Error ? e : new Error(String(e)));
        setDistribution(null);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  return { distribution, loading, error };
}
