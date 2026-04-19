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

function overallRiskIndexForDisplay(
  risk: WorkerRiskProfileV1 | null | undefined,
  rawRiskDoc?: unknown,
): number | null {
  const s = risk?.overallRiskScore;
  if (typeof s === 'number' && Number.isFinite(s)) return Math.round(s);
  if (rawRiskDoc && typeof rawRiskDoc === 'object' && 'overallRiskScore' in rawRiskDoc) {
    const v = (rawRiskDoc as { overallRiskScore?: unknown }).overallRiskScore;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  }
  return null;
}

/**
 * Single-line risk label: `Risk: Low(2)` when `overallRiskScore` is present; otherwise `Risk: Low`.
 * Pass `rawRiskDoc` when `risk` may be null but the user doc still has `overallRiskScore` (e.g. strict normalizer).
 */
export function riskBandLineWithIndex(
  riskBand: string,
  risk: WorkerRiskProfileV1 | null | undefined,
  rawRiskDoc?: unknown,
): string {
  const idx = overallRiskIndexForDisplay(risk, rawRiskDoc);
  if (idx == null) return `Risk: ${riskBand}`;
  return `Risk: ${riskBand}(${idx})`;
}

/**
 * Snapshot `riskSummary` often falls back to `Risk index N` — omit when index is shown on the band line.
 */
export function riskSummaryLineAfterIndexConsolidation(summary: string | null | undefined): string | null {
  const t = summary?.trim();
  if (!t) return null;
  if (/^Risk index \d+$/i.test(t)) return null;
  return t;
}
