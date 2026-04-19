/**
 * Canonical recruiter "Master Score" — single blended 0–100 + grade for all recruiter UI.
 * Lives under `src/shared/` so Create React App / webpack apply the TypeScript loader.
 * Repo `shared/recruiterMasterScore.ts` is a symlink here so `functions/src/shared` (→ repo `shared/`) resolves the same module for Cloud Functions.
 */

export const RECRUITER_MASTER_WEIGHTS_V1 = {
  categoryScore: 0.5,
  interviewScore: 0.35,
  profileScore: 0.15,
} as const;

/** Points added to the category component (before 0–100 cap) when transportation is own vehicle. */
export const OWN_VEHICLE_CATEGORY_BONUS = 3;

export type RecruiterMasterScore = {
  version: 'v1';
  score100: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  confidence: 'high' | 'medium' | 'low';
  riskLevel: 'low' | 'moderate' | 'high';
  decision?: 'advance' | 'review' | 'reject' | 'hold';
  summary?: string;
  components: {
    categoryScore: number | null;
    interviewScore: number | null;
    profileScore: number | null;
  };
  weights: {
    categoryScore: number;
    interviewScore: number;
    profileScore: number;
  };
  effectiveWeights: {
    categoryScore: number;
    interviewScore: number;
    profileScore: number;
  };
  reasoning?: {
    strengths?: string[];
    concerns?: string[];
    lastInterviewAt?: string | null;
    interviewsCount?: number;
  };
  sourceMeta?: {
    categorySource: string;
    interviewSource: string;
    profileSource: string;
    computedAt?: string;
    carOwnershipBoostApplied?: boolean;
  };
  inputSignature: string;
};

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

function gradeFromScore100(s: number): RecruiterMasterScore['grade'] {
  const x = Math.max(0, Math.min(100, Math.round(s)));
  if (x >= 90) return 'A';
  if (x >= 80) return 'B';
  if (x >= 70) return 'C';
  if (x >= 60) return 'D';
  return 'F';
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(2).slice(0, 40);
}

const CAT_KEYS = [
  'reliability',
  'punctuality',
  'workEthic',
  'teamFit',
  'jobReadiness',
  'stability',
] as const;

function parseCategoryEntryV2(x: unknown): number | null {
  if (!x || typeof x !== 'object') return null;
  const sc = finite((x as { score?: unknown }).score);
  return sc;
}

/** Extract 0–100 category average from `users.categoryScoresCurrent` (v1 or v2). */
export function averageCategoryScoreFromUserData(userData: Record<string, unknown>): {
  avg: number | null;
  source: string;
} {
  const raw = userData.categoryScoresCurrent;
  if (!raw || typeof raw !== 'object') return { avg: null, source: 'none' };
  const v = (raw as { version?: unknown }).version;
  const nums: number[] = [];
  if (v === 2) {
    for (const k of CAT_KEYS) {
      const n = parseCategoryEntryV2((raw as Record<string, unknown>)[k]);
      if (n != null) nums.push(n);
    }
    if (nums.length === 0) return { avg: null, source: 'none' };
    return {
      avg: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length),
      source: 'categoryScoresCurrent',
    };
  }
  for (const k of CAT_KEYS) {
    const n = finite((raw as Record<string, unknown>)[k]);
    if (n != null) nums.push(n);
  }
  if (nums.length === 0) return { avg: null, source: 'none' };
  return {
    avg: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length),
    source: 'categoryScoresCurrent',
  };
}

function averageFromSnapshotPartial(
  snap: Record<string, number | null | undefined> | null | undefined,
): { avg: number | null; source: string } {
  if (!snap || typeof snap !== 'object') return { avg: null, source: 'none' };
  const nums: number[] = [];
  for (const k of CAT_KEYS) {
    const n = finite(snap[k as string]);
    if (n != null) nums.push(n);
  }
  if (nums.length === 0) return { avg: null, source: 'none' };
  return {
    avg: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length),
    source: 'recruiterScoreSnapshot.categoryScores',
  };
}

export type ComputeRecruiterMasterScoreInput = {
  userData: Record<string, unknown>;
  /** Latest worker_ai_prescreen interview `ai` map (or compatible). */
  prescreenAi: Record<string, unknown> | null;
  /** When live `categoryScoresCurrent` is empty, use snapshot category map from recruiterScoreSnapshot. */
  snapshotCategoryScores?: Record<string, number | null> | null;
  /** `answers.transportation_plan` from prescreen interview doc — drives small category boost. */
  prescreenTransportationPlan?: string | null;
};

function extractInterviewScore100(
  prescreenAi: Record<string, unknown> | null,
  scoreSummary: Record<string, unknown> | undefined,
): { score: number | null; source: string } {
  const pa = prescreenAi;
  const ss = scoreSummary;
  const o1 = finite(pa?.overrideAdjustedScore);
  if (o1 != null) return { score: o1, source: 'prescreen_ai.overrideAdjustedScore' };
  const o2 = finite(ss?.overrideAdjustedScore);
  if (o2 != null) return { score: o2, source: 'scoreSummary.overrideAdjustedScore' };
  const b1 = finite(pa?.baseInterviewScore);
  if (b1 != null) return { score: b1, source: 'prescreen_ai.baseInterviewScore' };
  const ov = finite(pa?.overallScore);
  if (ov != null) return { score: ov, source: 'prescreen_ai.overallScore' };
  const b2 = finite(ss?.baseInterviewScore);
  if (b2 != null) return { score: b2, source: 'scoreSummary.baseInterviewScore' };
  return { score: null, source: 'none' };
}

/** Canonical profile-quality score: stored Hiring Score composite `scoreSummary.aiScore`. */
function extractProfileScore100(scoreSummary: Record<string, unknown> | undefined): { score: number | null; source: string } {
  const n = finite(scoreSummary?.aiScore);
  if (n != null) return { score: n, source: 'scoreSummary.aiScore' };
  return { score: null, source: 'none' };
}

function normTransport(s: string | null | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function isOwnVehiclePlan(plan: string | null | undefined): boolean {
  return normTransport(plan) === 'own_vehicle';
}

function riskFromUserData(userData: Record<string, unknown>): RecruiterMasterScore['riskLevel'] {
  const rp = userData.riskProfile as { overallRiskScore?: unknown } | undefined;
  const r = finite(rp?.overallRiskScore);
  if (r == null) return 'low';
  if (r >= 70) return 'high';
  if (r >= 40) return 'moderate';
  return 'low';
}

function deriveConfidence(
  score100: number,
  present: { cat: boolean; int: boolean; prof: boolean },
): RecruiterMasterScore['confidence'] {
  const n = [present.cat, present.int, present.prof].filter(Boolean).length;
  if (n >= 3 && score100 >= 72) return 'high';
  if (n >= 2 && score100 >= 68) return 'high';
  if (n >= 2) return 'medium';
  if (n === 1) return 'medium';
  return 'low';
}

function extractDecision(prescreenAi: Record<string, unknown> | null): RecruiterMasterScore['decision'] | undefined {
  const hd = prescreenAi?.hiringDecision as { decision?: string } | undefined;
  const d = typeof hd?.decision === 'string' ? hd.decision : null;
  if (d === 'advance' || d === 'review' || d === 'reject' || d === 'hold') return d;
  return undefined;
}

/**
 * Blend category / interview / profile with default v1 weights; renormalizes when components are missing.
 */
export function computeRecruiterMasterScore(input: ComputeRecruiterMasterScoreInput): RecruiterMasterScore {
  const { userData, prescreenAi, snapshotCategoryScores, prescreenTransportationPlan } = input;
  const scoreSummary = (userData.scoreSummary as Record<string, unknown>) || undefined;

  let catSrc = averageCategoryScoreFromUserData(userData);
  if (catSrc.avg == null && snapshotCategoryScores) {
    catSrc = averageFromSnapshotPartial(snapshotCategoryScores);
  }

  let categoryScore = catSrc.avg;
  let carBoost = false;
  if (isOwnVehiclePlan(prescreenTransportationPlan)) {
    carBoost = true;
    if (categoryScore != null) {
      categoryScore = Math.max(0, Math.min(100, categoryScore + OWN_VEHICLE_CATEGORY_BONUS));
    }
  }

  const intEx = extractInterviewScore100(prescreenAi, scoreSummary);
  const profEx = extractProfileScore100(scoreSummary);

  const w0 = { ...RECRUITER_MASTER_WEIGHTS_V1 };
  const present = {
    cat: categoryScore != null,
    int: intEx.score != null,
    prof: profEx.score != null,
  };

  let wc = present.cat ? w0.categoryScore : 0;
  let wi = present.int ? w0.interviewScore : 0;
  let wp = present.prof ? w0.profileScore : 0;
  const sumW = wc + wi + wp;
  let ew = { categoryScore: 0, interviewScore: 0, profileScore: 0 };
  if (sumW <= 0) {
    const score100 = 0;
    const sigPayload = JSON.stringify({
      categoryScore,
      interviewScore: intEx.score,
      profileScore: profEx.score,
      carBoost,
      weights: w0,
      effective: ew,
    });
    return {
      version: 'v1',
      score100,
      grade: 'F',
      confidence: 'low',
      riskLevel: riskFromUserData(userData),
      decision: extractDecision(prescreenAi),
      summary: 'Insufficient data for Master Recruiter Score.',
      components: {
        categoryScore: categoryScore,
        interviewScore: intEx.score,
        profileScore: profEx.score,
      },
      weights: { ...w0 },
      effectiveWeights: ew,
      reasoning: {},
      sourceMeta: {
        categorySource: catSrc.source,
        interviewSource: intEx.source,
        profileSource: profEx.source,
        computedAt: new Date().toISOString(),
        carOwnershipBoostApplied: carBoost && catSrc.avg != null,
      },
      inputSignature: simpleHash(sigPayload),
    };
  }

  wc /= sumW;
  wi /= sumW;
  wp /= sumW;
  ew = { categoryScore: wc, interviewScore: wi, profileScore: wp };

  const raw =
    (categoryScore != null ? categoryScore * wc : 0) +
    (intEx.score != null ? intEx.score * wi : 0) +
    (profEx.score != null ? profEx.score * wp : 0);

  const score100 = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = gradeFromScore100(score100);
  const confidence = deriveConfidence(score100, present);

  const strengths: string[] = [];
  if (carBoost) strengths.push('Reliable transportation (own vehicle)');
  if (categoryScore != null && categoryScore >= 80) strengths.push('Strong category profile signals');

  const sigPayload = JSON.stringify({
    categoryScore,
    interviewScore: intEx.score,
    profileScore: profEx.score,
    carBoost,
    weights: w0,
    effective: ew,
    present,
  });

  const interviewLastAt = scoreSummary?.interviewLastAt;
  let lastIso: string | null = null;
  try {
    const ts = interviewLastAt as { toDate?: () => Date } | undefined;
    const d = ts?.toDate?.() ?? (interviewLastAt instanceof Date ? interviewLastAt : null);
    if (d instanceof Date && !Number.isNaN(d.getTime())) lastIso = d.toISOString();
  } catch {
    lastIso = null;
  }

  const ic = finite(scoreSummary?.interviewCount);

  return {
    version: 'v1',
    score100,
    grade,
    confidence,
    riskLevel: riskFromUserData(userData),
    decision: extractDecision(prescreenAi),
    summary: `Master ${score100} (${grade}) — category ${categoryScore ?? '—'} · interview ${intEx.score ?? '—'} · profile ${profEx.score ?? '—'}`,
    components: {
      categoryScore: categoryScore,
      interviewScore: intEx.score,
      profileScore: profEx.score,
    },
    weights: { ...w0 },
    effectiveWeights: ew,
    reasoning: {
      strengths: strengths.length ? strengths : undefined,
      lastInterviewAt: lastIso,
      interviewsCount: ic ?? undefined,
    },
    sourceMeta: {
      categorySource: catSrc.source,
      interviewSource: intEx.source,
      profileSource: profEx.source,
      computedAt: new Date().toISOString(),
      carOwnershipBoostApplied: carBoost && catSrc.avg != null,
    },
    inputSignature: simpleHash(sigPayload),
  };
}
