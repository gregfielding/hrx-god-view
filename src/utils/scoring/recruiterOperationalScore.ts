/**
 * Single precedence for recruiter-facing "operational" prescreen score (0–100).
 *
 * 1. Interview `ai.overrideAdjustedScore` when present
 * 2. Profile `scoreSummary.overrideAdjustedScore` (canonical denormalized operational score)
 * 3. Interview base: `baseInterviewScore` / `overallScore`
 * 4. Profile `scoreSummary.baseInterviewScore`
 * 5. Composite hiring snapshot: `scoreSummary.aiScore`
 */

import type { ScoreSummary } from '../scoreSummary';
import { getCanonicalStoredAiScore } from '../scoreSummary';

export type OperationalScoreSource =
  | 'interview_override'
  | 'summary_override'
  | 'interview_base'
  | 'summary_base'
  | 'composite_ai'
  | 'none';

export type ResolvedRecruiterOperationalScore = {
  /** How answers scored (interview layer). */
  baseScore: number | null;
  /** What recruiters should trust for decisions (operational layer). */
  adjustedScore: number | null;
  scoreDelta: number | null;
  baseSource: OperationalScoreSource;
  adjustedSource: OperationalScoreSource;
};

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;

/**
 * Resolve base vs adjusted using interview AI block + optional profile scoreSummary.
 * When no prescreen layer exists on the user, falls back to composite `aiScore` for both when needed.
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

  const interviewOverride = finite(ai?.overrideAdjustedScore);
  const summaryOverride = finite(s?.overrideAdjustedScore);

  const composite = getCanonicalStoredAiScore(s ?? undefined);

  const adjustedScore =
    interviewOverride ??
    summaryOverride ??
    interviewBase ??
    summaryBase ??
    composite ??
    null;

  let adjustedSource: OperationalScoreSource = 'none';
  if (interviewOverride != null) adjustedSource = 'interview_override';
  else if (summaryOverride != null) adjustedSource = 'summary_override';
  else if (interviewBase != null) adjustedSource = 'interview_base';
  else if (summaryBase != null) adjustedSource = 'summary_base';
  else if (adjustedScore != null && composite != null && adjustedScore === composite) adjustedSource = 'composite_ai';

  let scoreDelta: number | null = null;
  if (baseScore != null && adjustedScore != null) {
    scoreDelta = adjustedScore - baseScore;
  }
  const sd = finite(s?.overrideScoreDelta);
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
 * Primary 0–100 score for recruiter list/header when only `scoreSummary` is available.
 * Prefers denormalized operational prescreen score, then composite hiring score.
 */
export function getRecruiterPrimaryScore100FromSummary(summary: ScoreSummary | undefined | null): number | null {
  return resolveRecruiterOperationalScore100({ scoreSummary: summary }).adjustedScore;
}
