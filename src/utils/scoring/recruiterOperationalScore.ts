/**
 * Canonical recruiter primary score (0–100) — single precedence to avoid composite vs prescreen mismatch.
 *
 * **Primary path** (`resolveRecruiterPrimaryScore100`):
 * - If latest Worker AI prescreen `ai` is available: `overrideAdjustedScore ?? overallScore` → `prescreen_operational`
 * - Else: `scoreSummary.aiScore` (composite) → `profile_composite`
 *
 * `resolveRecruiterOperationalScore100` uses the same primary for `adjustedScore` and keeps separate **base** lines for UI/deltas.
 */

import type { ScoreSummary } from '../scoreSummary';
import { getCanonicalStoredAiScore } from '../scoreSummary';

export type RecruiterPrimaryScoreSource = 'prescreen_operational' | 'profile_composite';

export type ResolvedRecruiterPrimaryScore100 = {
  score: number | null;
  source: RecruiterPrimaryScoreSource;
};

export type OperationalScoreSource =
  | 'interview_override'
  | 'summary_override'
  | 'interview_base'
  | 'summary_base'
  /** @deprecated for primary — kept for legacy `adjustedSource` mapping only */
  | 'interview_last10_proxy'
  | 'composite_ai'
  | 'none';

export type ResolvedRecruiterOperationalScore = {
  /** How answers scored (interview layer). */
  baseScore: number | null;
  /** Same as {@link resolveRecruiterPrimaryScore100} — single recruiter truth. */
  adjustedScore: number | null;
  scoreDelta: number | null;
  baseSource: OperationalScoreSource;
  adjustedSource: OperationalScoreSource;
};

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;

/**
 * Required precedence for header, tables, and any “Hiring score” that must match prescreen when present.
 *
 * If any prescreen `ai` is provided (nested or flat), **never** falls back to composite for that user —
 * missing numbers yield `score: null` with `prescreen_operational` so callers can detect drift.
 */
export function resolveRecruiterPrimaryScore100(args: {
  scoreSummary?: ScoreSummary | null;
  /** Firestore interview shape: use `interview.ai` when available */
  latestPrescreenInterview?: { ai?: { overrideAdjustedScore?: number; overallScore?: number } | null } | null;
  /** Same as `latestPrescreenInterview.ai` — preferred for callers that already extracted `ai` */
  latestPrescreenInterviewAi?: {
    overrideAdjustedScore?: number;
    overallScore?: number;
  } | null;
}): ResolvedRecruiterPrimaryScore100 {
  const ai =
    (args.latestPrescreenInterview?.ai != null && typeof args.latestPrescreenInterview.ai === 'object'
      ? args.latestPrescreenInterview.ai
      : null) ??
    (args.latestPrescreenInterviewAi != null && typeof args.latestPrescreenInterviewAi === 'object'
      ? args.latestPrescreenInterviewAi
      : null);

  if (ai != null && typeof ai === 'object') {
    const fromOverride = finite(ai.overrideAdjustedScore);
    const fromOverall = finite(ai.overallScore);
    const score = fromOverride ?? fromOverall;
    if (score != null) {
      return { score, source: 'prescreen_operational' };
    }
    return { score: null, source: 'prescreen_operational' };
  }

  const composite = getCanonicalStoredAiScore(args.scoreSummary ?? undefined);
  return { score: composite, source: 'profile_composite' };
}

function mapPrimaryToAdjustedSource(
  primary: ResolvedRecruiterPrimaryScore100,
  ai: { overrideAdjustedScore?: number; overallScore?: number } | null | undefined,
): OperationalScoreSource {
  if (primary.source === 'profile_composite') {
    return primary.score != null ? 'composite_ai' : 'none';
  }
  const op = finite(ai?.overrideAdjustedScore);
  if (op != null && primary.score === op) return 'interview_override';
  return primary.score != null ? 'interview_base' : 'none';
}

/**
 * Resolve base vs adjusted for detailed UI; **adjusted** always matches {@link resolveRecruiterPrimaryScore100}.
 */
export function resolveRecruiterOperationalScore100(args: {
  interviewAi?: {
    overrideAdjustedScore?: number;
    baseInterviewScore?: number;
    overallScore?: number;
  } | null;
  scoreSummary?: ScoreSummary | null;
}): ResolvedRecruiterOperationalScore {
  const ai = args.interviewAi;
  const s = args.scoreSummary;

  const interviewBase = finite(ai?.baseInterviewScore) ?? finite(ai?.overallScore);
  const summaryBase = finite(s?.baseInterviewScore);

  const baseScore = interviewBase ?? summaryBase ?? null;
  const baseSource: OperationalScoreSource =
    interviewBase != null ? 'interview_base' : summaryBase != null ? 'summary_base' : 'none';

  const primary = resolveRecruiterPrimaryScore100({
    scoreSummary: s ?? undefined,
    latestPrescreenInterviewAi: ai ?? undefined,
  });
  const adjustedScore = primary.score;
  const adjustedSource = mapPrimaryToAdjustedSource(primary, ai);

  let scoreDelta: number | null = null;
  if (baseScore != null && adjustedScore != null) {
    scoreDelta = adjustedScore - baseScore;
  }
  const sd = finite(s?.overrideScoreDelta);
  const interviewOverride = finite(ai?.overrideAdjustedScore);
  const summaryOverride = finite(s?.overrideAdjustedScore);
  if (sd != null && (interviewOverride != null || summaryOverride != null)) {
    scoreDelta = sd;
  }

  return {
    baseScore,
    adjustedScore,
    scoreDelta,
    baseSource,
    adjustedSource,
  };
}

/**
 * Primary 0–100 recruiter score. Pass latest prescreen `ai` whenever available so the header matches the interview record.
 */
export function getRecruiterPrimaryScore100(
  summary: ScoreSummary | undefined | null,
  latestInterviewAi?: {
    overrideAdjustedScore?: number;
    baseInterviewScore?: number;
    overallScore?: number;
  } | null,
): number | null {
  return resolveRecruiterPrimaryScore100({
    scoreSummary: summary ?? undefined,
    latestPrescreenInterviewAi: latestInterviewAi ?? undefined,
  }).score;
}

/**
 * List/table views with only `scoreSummary` (no interview `ai` on the row): uses composite {@link getCanonicalStoredAiScore}.
 * When you have the latest prescreen interview for a user, call {@link getRecruiterPrimaryScore100} with `ai` instead.
 */
export function getRecruiterPrimaryScore100FromSummary(summary: ScoreSummary | undefined | null): number | null {
  return getRecruiterPrimaryScore100(summary, null);
}
