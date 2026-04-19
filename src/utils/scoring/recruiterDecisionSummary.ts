/**
 * Normalized recruiter-facing copy from a worker AI prescreen `ai` block (+ optional scoreSummary).
 * Use across Score tab, interview modal, action items, header tooltips.
 */

import type { ScoreSummary } from '../scoreSummary';
import {
  formatHiringDecisionLabel,
  formatScoreRecommendationLabel,
} from '../workerAiHiringDecisionDisplay';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import { resolveRecruiterOperationalScore100 } from './recruiterOperationalScore';

export type RecruiterDecisionSummary = {
  baseScoreLabel: string;
  adjustedScoreLabel: string;
  recommendationLabel: string;
  hiringDecisionLabel: string;
  autoAdvanceLabel: string;
  primaryReason: string | null;
  secondaryReasons: string[];
  confidenceLabel?: string;
};

function joinReasons(ai: WorkerInterviewAiBlock): string[] {
  const hd = ai.hiringDecision;
  const codes = hd?.reasonCodes?.length ? hd.reasonCodes : [];
  const soft = Array.isArray(ai.softBlocks) ? ai.softBlocks : [];
  const hard = Array.isArray(ai.hardBlocks) ? ai.hardBlocks : [];
  const merged = [...codes, ...soft, ...hard].map((x) => String(x).trim()).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, 8);
}

/**
 * Build plain-language summary lines for recruiter UI.
 */
export function buildRecruiterDecisionSummary(args: {
  ai: WorkerInterviewAiBlock;
  scoreSummary?: ScoreSummary | null;
}): RecruiterDecisionSummary {
  const { ai, scoreSummary } = args;
  const r = resolveRecruiterOperationalScore100({ interviewAi: ai, scoreSummary });

  const base = r.baseScore;
  const adj = r.adjustedScore;

  const baseScoreLabel = base != null ? `${base}/100` : '—';
  const adjustedScoreLabel = adj != null ? `${adj}/100` : '—';

  const recommendationLabel = formatScoreRecommendationLabel(ai.recommendation);
  const hiringDecisionLabel = ai.hiringDecision
    ? formatHiringDecisionLabel(ai.hiringDecision.decision)
    : 'Not evaluated';

  const aa =
    typeof ai.hiringDecision?.eligibleForAutoAdvance === 'boolean'
      ? ai.hiringDecision.eligibleForAutoAdvance
      : typeof scoreSummary?.autoAdvanceEligible === 'boolean'
        ? scoreSummary.autoAdvanceEligible
        : undefined;
  const autoAdvanceLabel = aa === true ? 'Yes' : aa === false ? 'No' : '—';

  const reasons = joinReasons(ai);
  const primaryReason = reasons[0] ? reasons[0].replace(/_/g, ' ') : null;
  const secondaryReasons = reasons.slice(1).map((x) => x.replace(/_/g, ' '));

  let confidenceLabel: string | undefined;
  const flags = Array.isArray(ai.flags) ? ai.flags : [];
  const moderateCompliance = flags.some((f) =>
    ['drug_risk_moderate', 'background_risk_moderate', 'drug_unknown', 'background_unknown'].includes(f),
  );
  if (moderateCompliance) {
    confidenceLabel = 'low confidence · based on limited detail · not an automatic disqualifier';
  } else if (flags.includes('vague_response') || flags.includes('low_effort_response')) {
    confidenceLabel = 'based on limited detail';
  }

  return {
    baseScoreLabel,
    adjustedScoreLabel,
    recommendationLabel,
    hiringDecisionLabel,
    autoAdvanceLabel,
    primaryReason,
    secondaryReasons,
    confidenceLabel,
  };
}
