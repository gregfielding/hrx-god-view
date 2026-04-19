/**
 * Single precedence for recruiter-facing "operational" prescreen score (0–100).
 *
 * 1. Interview `ai.overrideAdjustedScore` when present
 * 2. Profile `scoreSummary.overrideAdjustedScore` (canonical denormalized operational score)
 * 3. Interview base: `baseInterviewScore` / `overallScore`
 * 4. Profile `scoreSummary.baseInterviewScore`
 * 5. `interviewLastScore10 × 10` only when the **latest** interview is `worker_ai_prescreen`
 *    (avoids treating a live 5/10 recruiter interview as “50/100” while category scores reflect AI prescreen).
 * 6. Composite hiring snapshot: `scoreSummary.aiScore`
 */

import type { ScoreSummary } from '../scoreSummary';
import { getCanonicalStoredAiScore } from '../scoreSummary';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';

export type OperationalScoreSource =
  | 'interview_override'
  | 'summary_override'
  | 'interview_base'
  | 'summary_base'
  /** Prescreen-only: last interview score10×10 when operational fields missing — before legacy composite */
  | 'interview_last10_proxy'
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

  const last10 = finite(s?.interviewLastScore10);
  const kindRaw = s?.interviewLastInterviewKind;
  const lastKind = typeof kindRaw === 'string' ? kindRaw.trim() : '';
  /**
   * `interviewLastScore10` is 0–10 from the **latest** interview of any kind. Multiplying by 10 yields 50 when
   * that interview is ~5/10 — including default live recruiter scores — which contradicts prescreen category
   * bars. Only use this proxy when the denormalized latest kind is **worker_ai_prescreen** (see recompute /
   * InterviewTab). If the field is missing (legacy), do not invent a proxy — fall through to composite.
   */
  const last10IsPrescreenProxy = lastKind === 'worker_ai_prescreen';
  const interviewLastAs100 =
    last10 != null &&
    typeof s?.interviewCount === 'number' &&
    s.interviewCount > 0 &&
    last10IsPrescreenProxy
      ? Math.round(Math.max(0, Math.min(100, last10 * 10)))
      : null;

  const adjustedScore =
    interviewOverride ??
    summaryOverride ??
    interviewBase ??
    summaryBase ??
    interviewLastAs100 ??
    composite ??
    null;

  let adjustedSource: OperationalScoreSource = 'none';
  if (interviewOverride != null) adjustedSource = 'interview_override';
  else if (summaryOverride != null) adjustedSource = 'summary_override';
  else if (interviewBase != null) adjustedSource = 'interview_base';
  else if (summaryBase != null) adjustedSource = 'summary_base';
  else if (interviewLastAs100 != null && adjustedScore === interviewLastAs100) adjustedSource = 'interview_last10_proxy';
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
 * Primary 0–100 recruiter score. Pass latest prescreen `ai` on profile views so the header matches interviews.
 */
export function getRecruiterPrimaryScore100(
  summary: ScoreSummary | undefined | null,
  latestInterviewAi?: Pick<
    WorkerInterviewAiBlock,
    'overrideAdjustedScore' | 'baseInterviewScore' | 'overallScore'
  > | null,
): number | null {
  return resolveRecruiterOperationalScore100({
    scoreSummary: summary ?? undefined,
    interviewAi: latestInterviewAi ?? undefined,
  }).adjustedScore;
}

/**
 * List/table views: only `scoreSummary` (pass latest interview AI from profile when available).
 * Prefer {@link getRecruiterPrimaryScore100} with latest interview `ai` when you have it.
 */
export function getRecruiterPrimaryScore100FromSummary(summary: ScoreSummary | undefined | null): number | null {
  return getRecruiterPrimaryScore100(summary, null);
}
