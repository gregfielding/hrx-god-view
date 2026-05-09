/**
 * Recruiter-facing adjustment strings stored on interview `ai` (short lines, not raw engine tags).
 */
import type { AiHiringDecisionResult } from './evaluateAiHiringDecision';
import type { AiPrescreenScoreResult } from './scoreWorkerAiPrescreen';
import type { OperationalOverrideResult } from './operationalOverrideTypes';

const REASON_HUMAN: Record<string, string> = {
  operational_soft_block: 'Held at review because compliance or capacity gates still apply',
  operational_hard_block: 'Hard gate — cannot auto-advance until cleared',
  gig_path_eligible: 'Gig path noted — main hire path may still need review',
  interview_recommendation_review: 'Interview flagged for recruiter review before auto-advance',
  interview_recommendation_review_overridden:
    'Interview review flag overridden by group preset — score gates still applied',
  recommendation_decline: 'Interview recommendation is decline',
  failed_score_threshold: 'Score below configured threshold for auto-advance',
  moderate_flags_present: 'Moderate screening flags — review before auto-advance',
  critical_flag_drug: 'Drug screening needs resolution',
  critical_flag_background: 'Background screening needs resolution',
  critical_flag_physical: 'Physical requirement needs confirmation',
};

function humanizeReason(code: string): string {
  const k = String(code || '').trim();
  return REASON_HUMAN[k] ?? k.replace(/_/g, ' ');
}

export function buildPrescreenAdjustmentCopy(args: {
  scored: AiPrescreenScoreResult;
  operationalOverride: OperationalOverrideResult;
  hiringResult: AiHiringDecisionResult;
}): { scoreAdjustmentReasons: string[]; decisionAdjustmentReasons: string[] } {
  const { scored, operationalOverride, hiringResult } = args;
  const base = Math.round(scored.overallScore);
  const adj = Math.round(operationalOverride.adjustedScore);
  const scoreAdjustmentReasons: string[] = [];
  if (base !== adj) {
    scoreAdjustmentReasons.push(`Interview score ${base} → Operational score ${adj}`);
  }
  for (const item of operationalOverride.overridesApplied.slice(0, 5)) {
    const line = (item.reason || item.label || '').trim();
    if (line) scoreAdjustmentReasons.push(line);
  }
  if (scoreAdjustmentReasons.length === 0) {
    scoreAdjustmentReasons.push(`Operational score ${adj} (aligned with interview base)`);
  }

  const decisionAdjustmentReasons: string[] = [];
  for (const code of hiringResult.reasonCodes) {
    const h = humanizeReason(code);
    if (h && !decisionAdjustmentReasons.includes(h)) decisionAdjustmentReasons.push(h);
  }
  if (operationalOverride.softBlocks.length > 0) {
    decisionAdjustmentReasons.push(
      'Raised or held because transport, attendance, or compliance answers needed operational review',
    );
  }
  if (operationalOverride.hardBlocks.length > 0) {
    decisionAdjustmentReasons.push('Not auto-advanced because a hard screening gate is active');
  }

  return {
    scoreAdjustmentReasons: scoreAdjustmentReasons.slice(0, 8),
    decisionAdjustmentReasons: decisionAdjustmentReasons.slice(0, 8),
  };
}
