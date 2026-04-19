/**
 * Display-only freshness for recruiter score trust (no writes).
 */

import { computeHiringScoreStaleness, type HiringScoreStalenessLabel } from '../hiringScoreStaleness';

export type ScoreFreshnessLevel = 'fresh' | 'possibly_stale' | 'stale';

export type ScoreFreshnessInputs = {
  interviewAt?: unknown;
  interviewAiComputedAt?: unknown;
  scoreSummaryAiUpdatedAt?: unknown;
  scoreSummaryHiringComputedAt?: unknown;
  categoryScoresCurrentUpdatedAt?: unknown;
  riskProfileLastUpdatedAt?: unknown;
  userUpdatedAt?: unknown;
  /** Optional: latest compliance / onboarding touch on user doc */
  complianceTouchAt?: unknown;
};

function toMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (ts as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (ts instanceof Date) {
    const t = ts.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return Number.isNaN(p) ? null : p;
  }
  if (typeof ts === 'object') {
    const o = ts as { _seconds?: number; seconds?: number };
    if (typeof o._seconds === 'number') return o._seconds * 1000;
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return null;
}

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Classifies how current the **score story** is vs newer profile / risk / compliance signals.
 *
 * Rules (summary):
 * - **fresh** — score truth time is recent vs inputs, or no newer competing signals.
 * - **possibly_stale** — borderline lag (1–7d) or indeterminate timestamps.
 * - **stale** — profile/category/risk/user activity newer than score truth by a wide margin (>7d gap) or composite AI clearly behind inputs.
 */
export function classifyScoreFreshness(input: ScoreFreshnessInputs): {
  level: ScoreFreshnessLevel;
  headline: string;
  /** Extra line for interview modal when interview is old vs newer signals */
  interviewHistoricalHint: string | null;
} {
  const interviewAt = toMillis(input.interviewAt);
  const aiComputed = toMillis(input.interviewAiComputedAt);
  const ssAi = toMillis(input.scoreSummaryAiUpdatedAt);
  const ssHire = toMillis(input.scoreSummaryHiringComputedAt);
  const cat = toMillis(input.categoryScoresCurrentUpdatedAt);
  const risk = toMillis(input.riskProfileLastUpdatedAt);
  const user = toMillis(input.userUpdatedAt);
  const compliance = toMillis(input.complianceTouchAt);

  const scoreTruthMs = Math.max(
    aiComputed ?? 0,
    ssHire ?? 0,
    ssAi ?? 0,
    interviewAt ?? 0,
  );
  const hasTruth = scoreTruthMs > 0;

  const signalMs = Math.max(cat ?? 0, risk ?? 0, user ?? 0, compliance ?? 0);
  const hasSignals = signalMs > 0;

  let level: ScoreFreshnessLevel = 'fresh';
  let headline = 'Fresh';

  if (!hasTruth) {
    level = 'possibly_stale';
    headline = 'Possibly stale';
  } else if (hasSignals && signalMs > scoreTruthMs) {
    const gap = signalMs - scoreTruthMs;
    if (gap > 7 * MS_DAY) {
      level = 'stale';
      headline = 'Refresh recommended';
    } else if (gap > 1 * MS_DAY) {
      level = 'possibly_stale';
      headline = 'Possibly stale';
    }
  }

  let interviewHistoricalHint: string | null = null;
  if (interviewAt && signalMs > 0 && signalMs > interviewAt + MS_DAY && interviewAt + 14 * MS_DAY < signalMs) {
    interviewHistoricalHint =
      'Interview is historical; decision may reflect newer operational data on the profile.';
  }

  return { level, headline, interviewHistoricalHint };
}

/**
 * Reuses shared composite AI staleness (`scoreSummary.aiScore` vs inputs) for the profile card line.
 */
export function hiringCompositeLabelFromUserDoc(userDoc: Record<string, unknown>): HiringScoreStalenessLabel {
  return computeHiringScoreStaleness(userDoc);
}
