import type {
  PrescreenCategoryEvidenceV1,
  PrescreenCategoryId,
  PrescreenCategoryScoresV1,
  PrescreenCategoryScoresV2,
} from '../types/prescreenCategoryScores';

const CATEGORY_KEYS: PrescreenCategoryId[] = [
  'reliability',
  'punctuality',
  'workEthic',
  'teamFit',
  'jobReadiness',
  'stability',
];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Validates a raw `PrescreenCategoryScoresV1` object (plain 0–100 numbers). */
export function parsePrescreenCategoryScoresV1(data: unknown): PrescreenCategoryScoresV1 | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as Record<string, unknown>;
  if (c.version !== 1) return null;

  const out: Partial<PrescreenCategoryScoresV1> = { version: 1 };
  for (const k of CATEGORY_KEYS) {
    const n = c[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = Math.round(Math.max(0, Math.min(100, n)));
  }
  return out as PrescreenCategoryScoresV1;
}

function parseCategoryScoreEntryV2(x: unknown): { score: number; confidence: number } | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const score = o.score;
  const confidence = o.confidence;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    confidence: Math.round(Math.max(0, Math.min(100, confidence))),
  };
}

/** Validates evolving profile scores v2 (`score` + `confidence` per category). */
export function parsePrescreenCategoryScoresV2(data: unknown): PrescreenCategoryScoresV2 | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as Record<string, unknown>;
  if (c.version !== 2) return null;
  const out: Partial<PrescreenCategoryScoresV2> = { version: 2 };
  for (const k of CATEGORY_KEYS) {
    const e = parseCategoryScoreEntryV2(c[k]);
    if (!e) return null;
    out[k] = e;
  }
  return out as PrescreenCategoryScoresV2;
}

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

/**
 * Reads `users/{uid}.categoryScoresCurrent` — v1 (legacy) or v2 (score + confidence).
 * Returns the v1 number snapshot for existing UI.
 */
export function parseCategoryScoresCurrentFromUserDoc(userData: unknown): PrescreenCategoryScoresV1 | null {
  if (!userData || typeof userData !== 'object') return null;
  const raw = (userData as Record<string, unknown>).categoryScoresCurrent;
  const v2 = parsePrescreenCategoryScoresV2(raw);
  if (v2) return prescreenCategoryScoresV1FromV2(v2);
  return parsePrescreenCategoryScoresV1(raw);
}

/**
 * Reads `categoryScores` / `categoryEvidence` from an interview `ai` map or application `aiAutomation` map.
 */
export function parsePrescreenCategoryScoresFromFirestore(source: unknown): {
  scores: PrescreenCategoryScoresV1 | null;
  evidence: PrescreenCategoryEvidenceV1 | null;
} {
  if (!source || typeof source !== 'object') return { scores: null, evidence: null };
  const o = source as Record<string, unknown>;
  const cs = o.categoryScores;
  const scores = parsePrescreenCategoryScoresV1(cs);
  if (!scores) return { scores: null, evidence: null };

  let evidence: PrescreenCategoryEvidenceV1 | null = null;
  const ev = o.categoryEvidence;
  if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
    const e = ev as Record<string, unknown>;
    const built: PrescreenCategoryEvidenceV1 = {
      reliability: [],
      punctuality: [],
      workEthic: [],
      teamFit: [],
      jobReadiness: [],
      stability: [],
    };
    let any = false;
    for (const k of CATEGORY_KEYS) {
      const arr = e[k];
      if (isStringArray(arr)) {
        built[k] = arr.slice(0, 80);
        any = true;
      }
    }
    if (any) evidence = built;
  }

  return { scores, evidence };
}

export function averageCategoryScore(scores: PrescreenCategoryScoresV1): number {
  const n =
    (scores.reliability +
      scores.punctuality +
      scores.workEthic +
      scores.teamFit +
      scores.jobReadiness +
      scores.stability) /
    6;
  return Math.round(Math.max(0, Math.min(100, n)));
}

export function categoryScoreBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

/** Abbreviated labels for compact recruiter table preview (e.g. Rel 88). */
const CATEGORY_PREVIEW_ABBREV: Record<
  'reliability' | 'punctuality' | 'workEthic' | 'teamFit' | 'jobReadiness' | 'stability',
  string
> = {
  reliability: 'Rel',
  punctuality: 'Punc',
  workEthic: 'Eth',
  teamFit: 'Team',
  jobReadiness: 'Job',
  stability: 'Stab',
};

const CATEGORY_PREVIEW_KEYS = [
  'reliability',
  'punctuality',
  'workEthic',
  'teamFit',
  'jobReadiness',
  'stability',
] as const;

/** Short segments like "Rel 88" for table rows; omit if scores are null. */
export function formatCategoryScoresCompactPreview(scores: PrescreenCategoryScoresV1 | null): string[] {
  if (!scores) return [];
  return CATEGORY_PREVIEW_KEYS.map((k) => `${CATEGORY_PREVIEW_ABBREV[k]} ${scores[k]}`);
}
