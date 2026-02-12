import { computeHiringScoreV1 } from './hiringScoreV1';

/** v1.1 Hiring Score components (C, D, R). */
export interface ScoreSummaryComponentsV1 {
  completeness: number;
  depth: number;
  reliability: number;
}

/** v1.1 explainability for "Top 3 ways to improve". */
export interface ScoreSummaryExplainabilityV1 {
  missingFields?: string[];
  nextActions?: { label: string; priority?: number }[];
}

export type ScoreSummary = {
  aiScore?: number;
  aiScoreUpdatedAt?: any;
  interviewAvg?: number;
  interviewCount?: number;
  interviewLastAt?: any;
  /** Most recent interview score (0..10). Used for list/table rendering. */
  interviewLastScore10?: number;
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
  /** v1.1 Hiring Score: components and explainability */
  components?: ScoreSummaryComponentsV1;
  explainability?: ScoreSummaryExplainabilityV1;
  hiringScoreVersion?: 'v1.1';
  hiringScoreComputedAt?: any;
};

const toNumberOrUndefined = (v: any): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function normalizeScoreSummary(raw: any): ScoreSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const aiWeightsRaw = raw.aiWeights && typeof raw.aiWeights === 'object' ? raw.aiWeights : undefined;

  const componentsRaw = raw.components && typeof raw.components === 'object' ? raw.components : undefined;
  const explainabilityRaw = raw.explainability && typeof raw.explainability === 'object' ? raw.explainability : undefined;

  return {
    aiScore: toNumberOrUndefined(raw.aiScore),
    aiScoreUpdatedAt: raw.aiScoreUpdatedAt,

    interviewAvg: toNumberOrUndefined(raw.interviewAvg),
    interviewCount: toNumberOrUndefined(raw.interviewCount),
    interviewLastAt: raw.interviewLastAt,
    interviewLastScore10: toNumberOrUndefined(raw.interviewLastScore10),

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

    components: componentsRaw
      ? {
          completeness: toNumberOrUndefined(componentsRaw.completeness) ?? 0,
          depth: toNumberOrUndefined(componentsRaw.depth) ?? 0,
          reliability: toNumberOrUndefined(componentsRaw.reliability) ?? 0,
        }
      : undefined,
    explainability: explainabilityRaw
      ? {
          missingFields: Array.isArray(explainabilityRaw.missingFields) ? explainabilityRaw.missingFields : undefined,
          nextActions: Array.isArray(explainabilityRaw.nextActions) ? explainabilityRaw.nextActions : undefined,
        }
      : undefined,
    hiringScoreVersion: raw.hiringScoreVersion === 'v1.1' ? 'v1.1' : undefined,
    hiringScoreComputedAt: raw.hiringScoreComputedAt,
  };
}

export function formatOneDecimal(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return (Math.round(n * 10) / 10).toFixed(1);
}

const DEFAULT_AI_WEIGHTS = { completeness: 0.45, responsiveness: 0.25, quality: 0.3 };

/**
 * Compute AI score from the three components (0–100 each) using the standard formula.
 * Used when quality/completeness/responsiveness change so the stored aiScore stays in sync.
 */
export function computeAiScoreFromComponents(
  completeness: number | undefined | null,
  responsiveness: number | undefined | null,
  quality: number | undefined | null,
  weights: { completeness: number; responsiveness: number; quality: number } = DEFAULT_AI_WEIGHTS
): number | null {
  const c = typeof completeness === 'number' && Number.isFinite(completeness) ? completeness : null;
  const r = typeof responsiveness === 'number' && Number.isFinite(responsiveness) ? responsiveness : null;
  const q = typeof quality === 'number' && Number.isFinite(quality) ? quality : null;
  if (c === null || r === null || q === null) return null;
  const raw =
    weights.completeness * c + weights.responsiveness * r + weights.quality * q;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/**
 * Returns completenessScore and aiScore to persist when profile-derived completeness is used.
 * Uses existing responsiveness and quality from scoreSummary (defaults 50 and 0).
 */
export function getScoreSummaryUpdateFromCompleteness(
  completeness: number,
  existingSummary: ScoreSummary | undefined
): { completenessScore: number; aiScore: number } {
  const responsiveness =
    typeof existingSummary?.responsivenessScore === 'number' ? existingSummary.responsivenessScore! : 50;
  const quality =
    typeof existingSummary?.qualityScore === 'number' ? existingSummary.qualityScore! : 0;
  const aiScore = computeAiScoreFromComponents(completeness, responsiveness, quality);
  return {
    completenessScore: Math.max(0, Math.min(100, Math.round(completeness))),
    aiScore: aiScore ?? 0,
  };
}

/** Percentiles for one metric (from tenants/{tenantId}/scoringDistribution/current). */
export interface ScoringPercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** Cached distribution per tenant (read from Firestore). */
export interface ScoringDistribution {
  updatedAt?: any;
  userCount: number;
  aiScore: ScoringPercentiles;
  completenessScore: ScoringPercentiles;
  responsivenessScore: ScoringPercentiles;
  qualityScore: ScoringPercentiles;
}

const MIN_USERS_FOR_RELATIVE = 10;

/**
 * Map raw AI score (0–100) to a relative score (0–100) using the tenant's distribution.
 * Median pool score ≈ 50; top of pool → 90+. Returns null if distribution is missing or too thin.
 */
export function getRelativeAiScore(
  rawAiScore: number | undefined | null,
  distribution: ScoringDistribution | undefined | null
): number | null {
  if (rawAiScore == null || !Number.isFinite(rawAiScore)) return null;
  if (!distribution || distribution.userCount < MIN_USERS_FOR_RELATIVE) return null;
  const p = distribution.aiScore;
  if (!p || typeof p.p50 !== 'number') return null;

  const raw = Math.max(0, Math.min(100, rawAiScore));

  if (raw <= p.p10) {
    const t = p.p10 > 0 ? raw / p.p10 : 1;
    return Math.round(t * 10);
  }
  if (raw <= p.p25) {
    const d = p.p25 - p.p10;
    const t = d > 0 ? (raw - p.p10) / d : 0.5;
    return Math.round(10 + t * 15);
  }
  if (raw <= p.p50) {
    const d = p.p50 - p.p25;
    const t = d > 0 ? (raw - p.p25) / d : 0.5;
    return Math.round(25 + t * 25);
  }
  if (raw <= p.p75) {
    const d = p.p75 - p.p50;
    const t = d > 0 ? (raw - p.p50) / d : 0.5;
    return Math.round(50 + t * 25);
  }
  if (raw <= p.p90) {
    const d = p.p90 - p.p75;
    const t = d > 0 ? (raw - p.p75) / d : 0.5;
    return Math.round(75 + t * 15);
  }
  const d = 100 - p.p90;
  const t = d > 0 ? (raw - p.p90) / d : 1;
  return Math.round(Math.min(100, 90 + t * 10));
}

// ─── One Score System (source of truth) ─────────────────────────────────────
// Where AI score is computed: getScoreSummaryUpdateFromCompleteness() in this file;
//   completeness comes from calculateCompletenessScore() in applicantScoring.ts.
// Where it's stored: users/{uid}.scoreSummary.aiScore (and scoreSummary.completenessScore,
//   scoreSummary.aiScoreUpdatedAt). Optional legacy: top-level users.{uid}.score or .profileScore.
// What triggers compute: (1) UserProfile on load can backfill when missing; (2) persistScoreSummaryFromProfile()
//   is called after profile updates (e.g. skills, overview) so stored score stays in sync.
// TODO: Admin screen may show "stale" if score is only recomputed on profile save/backfill;
//   consider: trigger persistScoreSummaryFromProfile on blur/navigation from profile, or
//   expose "Refresh score" in admin until we have a single recompute path (e.g. Cloud Function on user update).

/**
 * Returns the Firestore update payload for scoreSummary using Hiring Score v1.1.
 * Use when persisting after profile load or profile update.
 */
export function getScoreSummaryUpdateFromHiringScoreV1(userDoc: any): {
  'scoreSummary.aiScore': number;
  'scoreSummary.completenessScore': number;
  'scoreSummary.components': ScoreSummaryComponentsV1;
  'scoreSummary.explainability': ScoreSummaryExplainabilityV1;
  'scoreSummary.hiringScoreVersion': 'v1.1';
  'scoreSummary.hiringScoreComputedAt': any;
  'scoreSummary.aiScoreUpdatedAt': any;
} {
  const result = computeHiringScoreV1(userDoc);
  return {
    'scoreSummary.aiScore': result.score,
    'scoreSummary.completenessScore': result.components.completeness,
    'scoreSummary.components': result.components,
    'scoreSummary.explainability': result.explainability,
    'scoreSummary.hiringScoreVersion': 'v1.1',
    'scoreSummary.hiringScoreComputedAt': result.computedAt,
    'scoreSummary.aiScoreUpdatedAt': result.computedAt,
  };
}

/**
 * Single adapter for "Hiring Score" / "AI Score" from a user document.
 * Prefers stored scoreSummary; supports legacy top-level numeric fields.
 * Use this in worker Job Readiness hero and anywhere we want one consistent score value.
 */
export function getUserScore(userDoc: any): number | undefined {
  if (!userDoc || typeof userDoc !== 'object') return undefined;
  const raw = userDoc.scoreSummary;
  const fromSummary =
    raw && typeof raw === 'object'
      ? toNumberOrUndefined(raw.aiScore) ?? toNumberOrUndefined(raw.qualityScore)
      : undefined;
  if (typeof fromSummary === 'number' && Number.isFinite(fromSummary)) return fromSummary;
  const legacy = toNumberOrUndefined(userDoc.aiScore) ?? toNumberOrUndefined(userDoc.score) ?? toNumberOrUndefined(userDoc.profileScore);
  return legacy;
}

