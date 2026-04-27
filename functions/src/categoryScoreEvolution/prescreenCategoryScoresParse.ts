/**
 * Validates `PrescreenCategoryScoresV1` / v2 and reads category scores from interview `ai` maps.
 * Kept in functions/ to match `src/types/prescreenCategoryScores.ts` field names.
 */

export type PrescreenCategoryId =
  | 'reliability'
  | 'punctuality'
  | 'workEthic'
  | 'teamFit'
  | 'jobReadiness'
  | 'stability';

export const PREENSCREEN_CATEGORY_IDS: PrescreenCategoryId[] = [
  'reliability',
  'punctuality',
  'workEthic',
  'teamFit',
  'jobReadiness',
  'stability',
];

export type PrescreenCategoryScoresV1 = {
  version: 1;
  reliability: number;
  punctuality: number;
  workEthic: number;
  teamFit: number;
  jobReadiness: number;
  stability: number;
};

export type PrescreenCategoryConfidenceV1 = {
  version: 1;
  reliability: number;
  punctuality: number;
  workEthic: number;
  teamFit: number;
  jobReadiness: number;
  stability: number;
};

export type CategoryScoreEntryV2 = {
  score: number;
  confidence: number;
  updatedAt?: unknown;
};

export type PrescreenCategoryScoresV2 = {
  version: 2;
  reliability: CategoryScoreEntryV2;
  punctuality: CategoryScoreEntryV2;
  workEthic: CategoryScoreEntryV2;
  teamFit: CategoryScoreEntryV2;
  jobReadiness: CategoryScoreEntryV2;
  stability: CategoryScoreEntryV2;
};

/** When migrating plain v1 scores or bare numeric category entries (no confidence stored). */
const DEFAULT_CONFIDENCE_V1_FALLBACK = 20;

export function parsePrescreenCategoryScoresV1(data: unknown): PrescreenCategoryScoresV1 | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as Record<string, unknown>;
  if (c.version !== 1) return null;
  const out: Partial<PrescreenCategoryScoresV1> = { version: 1 };
  for (const k of PREENSCREEN_CATEGORY_IDS) {
    const n = c[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = Math.round(Math.max(0, Math.min(100, n)));
  }
  return out as PrescreenCategoryScoresV1;
}

export function parsePrescreenCategoryConfidenceV1(data: unknown): PrescreenCategoryConfidenceV1 | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as Record<string, unknown>;
  if (c.version !== 1) return null;
  const out: Partial<PrescreenCategoryConfidenceV1> = { version: 1 };
  for (const k of PREENSCREEN_CATEGORY_IDS) {
    const n = c[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = Math.round(Math.max(0, Math.min(100, n)));
  }
  return out as PrescreenCategoryConfidenceV1;
}

function parseCategoryScoreEntryV2(x: unknown): CategoryScoreEntryV2 | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const score = o.score;
  const confidence = o.confidence;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    confidence: Math.round(Math.max(0, Math.min(100, confidence))),
    ...(o.updatedAt !== undefined ? { updatedAt: o.updatedAt } : {}),
  };
}

/** Bare number → { score, confidence: 20 } for backward compatibility. */
function parseCategoryScoreEntryV2Flexible(x: unknown): CategoryScoreEntryV2 | null {
  if (typeof x === 'number' && Number.isFinite(x)) {
    return {
      score: Math.round(Math.max(0, Math.min(100, x))),
      confidence: DEFAULT_CONFIDENCE_V1_FALLBACK,
    };
  }
  return parseCategoryScoreEntryV2(x);
}

function parseImplicitV1FromPlainMap(c: Record<string, unknown>): PrescreenCategoryScoresV1 | null {
  if (c.version !== undefined) return null;
  const out: Partial<PrescreenCategoryScoresV1> = { version: 1 };
  for (const k of PREENSCREEN_CATEGORY_IDS) {
    const n = c[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = Math.round(Math.max(0, Math.min(100, n)));
  }
  return out as PrescreenCategoryScoresV1;
}

export function parsePrescreenCategoryScoresV2(data: unknown): PrescreenCategoryScoresV2 | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as Record<string, unknown>;
  if (c.version !== 2) return null;
  const out: Partial<PrescreenCategoryScoresV2> = { version: 2 };
  for (const k of PREENSCREEN_CATEGORY_IDS) {
    const e = parseCategoryScoreEntryV2Flexible(c[k]);
    if (!e) return null;
    out[k] = e;
  }
  return out as PrescreenCategoryScoresV2;
}

/** Reads `categoryScores` from an interview `ai` object (immutable snapshot on interview doc). */
export function parsePrescreenCategoryScoresFromInterviewAi(ai: unknown): PrescreenCategoryScoresV1 | null {
  if (!ai || typeof ai !== 'object') return null;
  const o = ai as Record<string, unknown>;
  return parsePrescreenCategoryScoresV1(o.categoryScores);
}

export function parsePrescreenCategoryConfidenceFromInterviewAi(ai: unknown): PrescreenCategoryConfidenceV1 | null {
  if (!ai || typeof ai !== 'object') return null;
  const o = ai as Record<string, unknown>;
  return parsePrescreenCategoryConfidenceV1(o.categoryConfidence);
}

export type InterviewCategoryBootstrap = {
  scores: PrescreenCategoryScoresV1;
  confidence: PrescreenCategoryConfidenceV1 | null;
};

export function parseInterviewCategoryBootstrapFromAi(ai: unknown): InterviewCategoryBootstrap | null {
  const scores = parsePrescreenCategoryScoresFromInterviewAi(ai);
  if (!scores) return null;
  if (!ai || typeof ai !== 'object') return { scores, confidence: null };
  return {
    scores,
    confidence: parsePrescreenCategoryConfidenceFromInterviewAi(ai),
  };
}

export function migrateV1ToV2(
  scores: PrescreenCategoryScoresV1,
  confidence: PrescreenCategoryConfidenceV1 | null,
): PrescreenCategoryScoresV2 {
  const entry = (k: PrescreenCategoryId): CategoryScoreEntryV2 => ({
    score: scores[k],
    confidence: confidence ? confidence[k] : DEFAULT_CONFIDENCE_V1_FALLBACK,
  });
  return {
    version: 2,
    reliability: entry('reliability'),
    punctuality: entry('punctuality'),
    workEthic: entry('workEthic'),
    teamFit: entry('teamFit'),
    jobReadiness: entry('jobReadiness'),
    stability: entry('stability'),
  };
}

/**
 * Parse `users.{uid}.categoryScoresCurrent` — v1 (plain numbers) or v2 (score + confidence).
 */
export function parseCategoryScoresCurrent(data: unknown): PrescreenCategoryScoresV2 | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as Record<string, unknown>;
  if (c.version === 2) {
    return parsePrescreenCategoryScoresV2(data);
  }
  if (c.version === 1) {
    const v1 = parsePrescreenCategoryScoresV1(data);
    return v1 ? migrateV1ToV2(v1, null) : null;
  }
  const implicit = parseImplicitV1FromPlainMap(c);
  return implicit ? migrateV1ToV2(implicit, null) : null;
}

/** Flat snapshot for APIs / legacy readers (numbers only). */
export function prescreenCategoryScoresV1FromV2(v: PrescreenCategoryScoresV2): PrescreenCategoryScoresV1 {
  return {
    version: 1,
    reliability: v.reliability.score,
    punctuality: v.punctuality.score,
    workEthic: v.workEthic.score,
    teamFit: v.teamFit.score,
    jobReadiness: v.jobReadiness.score,
    stability: v.stability.score,
  };
}
