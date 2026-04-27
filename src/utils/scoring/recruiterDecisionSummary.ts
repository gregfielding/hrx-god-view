/**
 * Normalized recruiter-facing copy from a worker AI prescreen `ai` block (+ optional scoreSummary).
 * Use across Score tab, interview modal, action items, header tooltips.
 */

import type { ScoreSummary } from '../scoreSummary';
import {
  formatHiringDecisionLabel,
  formatScoreRecommendationLabel,
  labelForAiHiringReasonCode,
} from '../workerAiHiringDecisionDisplay';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import { resolveRecruiterOperationalScore100 } from './recruiterOperationalScore';

export type RecruiterDecisionSourceKey = 'rules_v1' | 'corrected_rules' | 'operational_override';

export type RecruiterDecisionSummary = {
  baseScoreLabel: string;
  adjustedScoreLabel: string;
  /** Profile / composite hiring score when materially different from operational layer. */
  compositeScoreLabel: string | null;
  recommendationLabel: string;
  hiringDecisionLabel: string;
  autoAdvanceLabel: string;
  autoAdvanceEligible: boolean | null;
  autoAdvanceBlockedReasons: string[];
  primaryReason: string | null;
  secondaryReasons: string[];
  confidenceLabel?: string;
  decisionSourceKey: RecruiterDecisionSourceKey;
  decisionSourceLabel: string;
  correctionApplied: boolean;
  lastUpdatedLabel: string;
  /** Combined narrative lines for adjustment summary UI */
  adjustmentSummaryLines: string[];
  scoreAdjustmentReasons: string[];
  decisionAdjustmentReasons: string[];
};

function joinReasons(ai: WorkerInterviewAiBlock): string[] {
  const hd = ai.hiringDecision;
  const codes = hd?.reasonCodes?.length ? hd.reasonCodes : [];
  const soft = Array.isArray(ai.softBlocks) ? ai.softBlocks : [];
  const hard = Array.isArray(ai.hardBlocks) ? ai.hardBlocks : [];
  const merged = [...codes, ...soft, ...hard].map((x) => String(x).trim()).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, 8);
}

function toDateLabel(d: Date | undefined | null): string {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function lastUpdatedFromSources(ai: WorkerInterviewAiBlock, scoreSummary?: ScoreSummary | null): string {
  if (ai.computedAt instanceof Date) return toDateLabel(ai.computedAt);
  const hs = scoreSummary?.hiringScoreComputedAt as { toDate?: () => Date } | undefined;
  if (hs && typeof hs.toDate === 'function') return toDateLabel(hs.toDate());
  const aiUp = scoreSummary?.aiScoreUpdatedAt as { toDate?: () => Date } | undefined;
  if (aiUp && typeof aiUp.toDate === 'function') return toDateLabel(aiUp.toDate());
  return '—';
}

function resolveDecisionSource(ai: WorkerInterviewAiBlock): { key: RecruiterDecisionSourceKey; label: string } {
  const base = ai.baseInterviewScore ?? ai.overallScore;
  const adj = ai.overrideAdjustedScore;
  const deltaKnown =
    typeof ai.overrideScoreDelta === 'number'
      ? ai.overrideScoreDelta
      : typeof base === 'number' && typeof adj === 'number'
        ? Math.round(adj) - Math.round(base)
        : null;
  const materialDelta = deltaKnown != null && Math.abs(deltaKnown) >= 1;
  const soft = ai.softBlocks?.length ?? 0;
  const hard = ai.hardBlocks?.length ?? 0;
  if (materialDelta || soft > 0 || hard > 0) {
    return { key: 'operational_override', label: 'Operational override' };
  }
  const model = String(ai.model || '').trim();
  if (model === 'rules_v1') return { key: 'rules_v1', label: 'rules_v1' };
  return { key: 'corrected_rules', label: 'Corrected rules' };
}

function compositeLabelIfRelevant(
  operational: number | null,
  scoreSummary: ScoreSummary | undefined | null,
): string | null {
  const comp = scoreSummary?.aiScore;
  if (typeof comp !== 'number' || !Number.isFinite(comp) || operational == null) return null;
  if (Math.abs(Math.round(comp) - Math.round(operational)) < 6) return null;
  return `${Math.round(comp)}/100`;
}

/**
 * When auto-advance is false but the operational score is strong, explain likely gates in short lines.
 */
export function deriveAutoAdvanceBlockedReasons(args: {
  ai: WorkerInterviewAiBlock;
  scoreSummary?: ScoreSummary | null;
  operationalScore100?: number | null;
}): string[] {
  const { ai, scoreSummary } = args;
  const op =
    args.operationalScore100 ??
    resolveRecruiterOperationalScore100({ interviewAi: ai, scoreSummary }).adjustedScore;
  const strong = typeof op === 'number' && op >= 78;
  const aa =
    typeof ai.hiringDecision?.eligibleForAutoAdvance === 'boolean'
      ? ai.hiringDecision.eligibleForAutoAdvance
      : typeof scoreSummary?.autoAdvanceEligible === 'boolean'
        ? scoreSummary.autoAdvanceEligible
        : null;
  if (aa !== false || !strong) return [];

  const lines: string[] = [];
  const hd = ai.hiringDecision;
  const codes = hd?.reasonCodes ?? [];
  for (const c of codes) {
    const t = labelForAiHiringReasonCode(c).trim();
    if (t && !lines.includes(t)) lines.push(t);
  }
  const rec = ai.recommendation;
  if (rec === 'review' || rec === 'caution') {
    lines.push('Interview recommendation is review — auto-advance stays off until cleared');
  }
  if (rec === 'decline') {
    lines.push('Interview recommendation is decline');
  }
  if (ai.flags?.some((f) => f.includes('everify') || f.includes('e_verify'))) {
    lines.push('E-Verify / onboarding gate still applies');
  }
  if (lines.length === 0) {
    lines.push('Compliance review or policy gate still required');
  }
  return Array.from(new Set(lines)).slice(0, 4);
}

function buildFallbackAdjustmentLines(
  ai: WorkerInterviewAiBlock,
  base: number | null,
  adj: number | null,
  delta: number | null,
): string[] {
  const out: string[] = [];
  if (base != null && adj != null && Math.round(base) !== Math.round(adj)) {
    out.push(`Interview score ${Math.round(base)} → Operational score ${Math.round(adj)}`);
  } else if (typeof delta === 'number' && delta !== 0 && base != null && adj != null) {
    out.push(`Interview score ${Math.round(base)} → Operational score ${Math.round(adj)}`);
  }
  if (out.length === 0 && base != null && adj != null) {
    out.push(`Operational score ${Math.round(adj)} (interview base ${Math.round(base)})`);
  }
  const soft = ai.softBlocks ?? [];
  const hard = ai.hardBlocks ?? [];
  if (soft.length || hard.length) {
    out.push('Raised or held based on transport, attendance, and compliance gates');
  }
  const flags = ai.flags ?? [];
  if (flags.some((f) => f === 'drug_unknown' || f === 'background_unknown')) {
    out.push('Held at review because compliance detail was limited');
  }
  if (flags.some((f) => f.includes('everify'))) {
    out.push('Not auto-advanced because E-Verify / onboarding gate still applies');
  }
  return out.slice(0, 5);
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

  const baseScoreLabel = base != null ? `${Math.round(base)}/100` : '—';
  const adjustedScoreLabel = adj != null ? `${Math.round(adj)}/100` : '—';

  const recommendationLabel = formatScoreRecommendationLabel(ai.recommendation);
  const hiringDecisionLabel = ai.hiringDecision
    ? formatHiringDecisionLabel(ai.hiringDecision.decision)
    : 'Not evaluated';

  const aa =
    typeof ai.hiringDecision?.eligibleForAutoAdvance === 'boolean'
      ? ai.hiringDecision.eligibleForAutoAdvance
      : typeof scoreSummary?.autoAdvanceEligible === 'boolean'
        ? scoreSummary.autoAdvanceEligible
        : null;
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

  const correctionApplied =
    typeof ai.overrideAdjustedScore === 'number' &&
    typeof (ai.baseInterviewScore ?? ai.overallScore) === 'number' &&
    Math.round(ai.overrideAdjustedScore) !== Math.round((ai.baseInterviewScore ?? ai.overallScore) as number);

  const { key: decisionSourceKey, label: decisionSourceLabel } = resolveDecisionSource(ai);

  const storedScoreAdj = Array.isArray(ai.scoreAdjustmentReasons) ? ai.scoreAdjustmentReasons : [];
  const storedDecAdj = Array.isArray(ai.decisionAdjustmentReasons) ? ai.decisionAdjustmentReasons : [];
  const adjustmentSummaryLines =
    storedScoreAdj.length || storedDecAdj.length
      ? [...storedScoreAdj, ...storedDecAdj].slice(0, 8)
      : buildFallbackAdjustmentLines(ai, base, adj, r.scoreDelta);

  const autoAdvanceBlockedReasons = deriveAutoAdvanceBlockedReasons({
    ai,
    scoreSummary,
    operationalScore100: adj,
  });

  return {
    baseScoreLabel,
    adjustedScoreLabel,
    compositeScoreLabel: compositeLabelIfRelevant(adj, scoreSummary),
    recommendationLabel,
    hiringDecisionLabel,
    autoAdvanceLabel,
    autoAdvanceEligible: aa,
    autoAdvanceBlockedReasons,
    primaryReason,
    secondaryReasons,
    confidenceLabel,
    decisionSourceKey,
    decisionSourceLabel,
    correctionApplied,
    lastUpdatedLabel: lastUpdatedFromSources(ai, scoreSummary),
    adjustmentSummaryLines,
    scoreAdjustmentReasons: storedScoreAdj,
    decisionAdjustmentReasons: storedDecAdj,
  };
}

/** Alias for callers that prefer `get*` naming. */
export const getRecruiterDecisionSummary = buildRecruiterDecisionSummary;
