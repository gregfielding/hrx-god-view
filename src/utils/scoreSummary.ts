export type ScoreSummary = {
  aiScore?: number;
  aiScoreUpdatedAt?: any;
  interviewAvg?: number;
  interviewCount?: number;
  interviewLastAt?: any;
  reviewAvg?: number;
  reviewCount?: number;
  reviewLastAt?: any;
  responsivenessScore?: number;
  completenessScore?: number;
  qualityScore?: number;
  aiWeights?: {
    completeness: number;
    responsiveness: number;
    quality: number;
  };
};

const toNumberOrUndefined = (v: any): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function normalizeScoreSummary(raw: any): ScoreSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const aiWeightsRaw = raw.aiWeights && typeof raw.aiWeights === 'object' ? raw.aiWeights : undefined;

  return {
    aiScore: toNumberOrUndefined(raw.aiScore),
    aiScoreUpdatedAt: raw.aiScoreUpdatedAt,

    interviewAvg: toNumberOrUndefined(raw.interviewAvg),
    interviewCount: toNumberOrUndefined(raw.interviewCount),
    interviewLastAt: raw.interviewLastAt,

    reviewAvg: toNumberOrUndefined(raw.reviewAvg),
    reviewCount: toNumberOrUndefined(raw.reviewCount),
    reviewLastAt: raw.reviewLastAt,

    responsivenessScore: toNumberOrUndefined(raw.responsivenessScore),
    completenessScore: toNumberOrUndefined(raw.completenessScore),
    qualityScore: toNumberOrUndefined(raw.qualityScore),

    aiWeights: aiWeightsRaw
      ? {
          completeness: toNumberOrUndefined(aiWeightsRaw.completeness) ?? 0,
          responsiveness: toNumberOrUndefined(aiWeightsRaw.responsiveness) ?? 0,
          quality: toNumberOrUndefined(aiWeightsRaw.quality) ?? 0,
        }
      : undefined,
  };
}

export function formatOneDecimal(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return (Math.round(n * 10) / 10).toFixed(1);
}

