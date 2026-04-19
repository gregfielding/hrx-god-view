import {
  buildRecruiterDecisionSummary,
  deriveAutoAdvanceBlockedReasons,
} from '../scoring/recruiterDecisionSummary';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
function baseAi(partial: Partial<WorkerInterviewAiBlock>): WorkerInterviewAiBlock {
  return {
    overallScore: 60,
    recommendation: 'review',
    flags: [],
    ...partial,
  } as WorkerInterviewAiBlock;
}

describe('recruiterDecisionSummary', () => {
  it('prefers overrideAdjustedScore in labels (operational layer)', () => {
    const s = buildRecruiterDecisionSummary({
      ai: baseAi({
        baseInterviewScore: 53,
        overrideAdjustedScore: 71,
        overallScore: 53,
        hiringDecision: {
          decision: 'review',
          eligibleForAutoAdvance: false,
          reasonCodes: ['operational_soft_block'],
        },
      }),
    });
    expect(s.adjustedScoreLabel).toBe('71/100');
    expect(s.baseScoreLabel).toBe('53/100');
  });

  it('strong operational signals + moderate compliance → review path surfaces blocked reasons, not empty', () => {
    const ai = baseAi({
      overallScore: 72,
      baseInterviewScore: 72,
      overrideAdjustedScore: 74,
      recommendation: 'review',
      flags: ['drug_risk_moderate'],
      hiringDecision: {
        decision: 'review',
        eligibleForAutoAdvance: false,
        reasonCodes: ['moderate_flags_present', 'interview_recommendation_review'],
      },
    });
    const blockers = deriveAutoAdvanceBlockedReasons({
      ai,
      operationalScore100: 80,
    });
    expect(blockers.length).toBeGreaterThan(0);
  });

  it('auto-advance false with strong score returns human-readable blocker reasons', () => {
    const ai = baseAi({
      overallScore: 82,
      baseInterviewScore: 80,
      overrideAdjustedScore: 82,
      recommendation: 'review',
      hiringDecision: {
        decision: 'review',
        eligibleForAutoAdvance: false,
        reasonCodes: ['operational_soft_block', 'interview_recommendation_review'],
      },
    });
    const r = deriveAutoAdvanceBlockedReasons({ ai, operationalScore100: 82 });
    expect(r.some((x) => x.toLowerCase().includes('review') || x.toLowerCase().includes('compliance'))).toBe(true);
  });
});
