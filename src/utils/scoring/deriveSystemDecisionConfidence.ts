/**
 * System decision confidence — operational readiness to act, not model confidence from the snapshot.
 * Derived from score, risk, blockers, and override tension.
 */
import type { RecruiterScoreSnapshot } from '../../types/recruiterScoreSnapshot';

export type SystemConfidenceLevel = 'high' | 'medium' | 'low';

export type SystemDecisionConfidence = {
  level: SystemConfidenceLevel;
  /** Single recruiter-facing line */
  message: string;
};

export function deriveSystemDecisionConfidence(input: {
  hiringScore: number | null;
  riskLevel: RecruiterScoreSnapshot['riskLevel'] | null;
  decision: RecruiterScoreSnapshot['decision'] | null;
  recommendation: RecruiterScoreSnapshot['recommendation'] | null;
  hardBlockCount: number;
  overrideApplied: boolean;
  scoreConflictDetected?: boolean;
}): SystemDecisionConfidence {
  const { hiringScore, riskLevel, decision, recommendation, hardBlockCount, overrideApplied, scoreConflictDetected } =
    input;

  const blocked = hardBlockCount > 0;
  const riskHigh = riskLevel === 'high';
  const riskMed = riskLevel === 'medium';
  const scoreLow = hiringScore != null && hiringScore < 55;
  const scoreUncertain = hiringScore == null;
  const hostileDecision =
    decision === 'reject' || decision === 'hold' || recommendation === 'decline' || recommendation === 'caution';

  if (blocked || decision === 'reject' || recommendation === 'decline' || riskHigh || scoreLow) {
    return { level: 'low', message: 'Requires recruiter review' };
  }

  if (
    hostileDecision ||
    riskMed ||
    scoreUncertain ||
    overrideApplied ||
    scoreConflictDetected ||
    decision === 'review' ||
    recommendation === 'review'
  ) {
    return { level: 'medium', message: 'Recommended with quick review' };
  }

  const strongAdvance =
    (decision === 'advance' || (recommendation === 'proceed' && decision !== 'review')) &&
    !riskHigh &&
    !blocked &&
    hiringScore != null &&
    hiringScore >= 68;

  if (strongAdvance) {
    return { level: 'high', message: 'Safe to proceed automatically' };
  }

  return { level: 'medium', message: 'Recommended with quick review' };
}
