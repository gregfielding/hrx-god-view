import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import type { WorkerRiskProfileV1 } from '../../../types/workerRiskProfile';

const CATEGORY_HEADER_ORDER: { key: keyof PrescreenCategoryScoresV1; label: string }[] = [
  { key: 'reliability', label: 'Reliability' },
  { key: 'punctuality', label: 'Attendance' },
  { key: 'workEthic', label: 'Work ethic' },
  { key: 'teamFit', label: 'Team fit' },
  { key: 'jobReadiness', label: 'Experience' },
  { key: 'stability', label: 'Stability' },
];

/**
 * Top N category labels by score (for record header “strengths” line).
 */
export function topCategoryLabelsForRecordHeader(scores: PrescreenCategoryScoresV1 | null, n = 3): string[] {
  if (!scores) return [];
  const ranked = CATEGORY_HEADER_ORDER.map(({ key, label }) => ({
    label,
    v: typeof scores[key] === 'number' ? scores[key] : 0,
  })).sort((a, b) => b.v - a.v);
  return ranked.slice(0, n).map((r) => r.label);
}

/** Maps persisted risk index to a recruiter-facing band (same thresholds as risk chip colors). */
export function overallRiskBandLabel(risk: WorkerRiskProfileV1 | null | undefined): 'Low' | 'Medium' | 'High' | '—' {
  const s = risk?.overallRiskScore;
  if (typeof s !== 'number' || !Number.isFinite(s)) return '—';
  if (s >= 70) return 'High';
  if (s >= 40) return 'Medium';
  return 'Low';
}
