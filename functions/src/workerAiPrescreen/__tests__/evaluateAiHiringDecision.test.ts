/**
 * Decision-ladder tests (2026-08-29, interview review F5): this function
 * auto-advances/holds/rejects candidates and had ZERO coverage. These lock
 * the 8-step ladder's observable behavior before anyone tunes thresholds.
 */
import {
  evaluateAiHiringDecision,
  type EvaluateAiHiringDecisionParams,
} from '../evaluateAiHiringDecision';

const APP = { applicationId: 'app_1', jobOrderId: 'jo_1' };

function params(overrides: {
  score?: number;
  recommendation?: 'proceed' | 'review' | 'decline';
  flags?: string[];
  dynamicAnswers?: Record<string, string>;
  policy?: EvaluateAiHiringDecisionParams['hiringPolicy'];
  operationalTrust?: { promoteDeclineToReview: boolean };
}): EvaluateAiHiringDecisionParams {
  return {
    interviewResult: {
      overallScore: overrides.score ?? 90,
      flags: overrides.flags ?? [],
      recommendation: overrides.recommendation ?? 'proceed',
      ...(overrides.dynamicAnswers ? { dynamicAnswers: overrides.dynamicAnswers } : {}),
    },
    hiringPolicy: overrides.policy ?? { autoAdvanceEnabled: true },
    application: APP,
    ...(overrides.operationalTrust ? { operationalTrust: overrides.operationalTrust } : {}),
  };
}

describe('evaluateAiHiringDecision — the 8-step ladder', () => {
  test('clean high score with proceed recommendation advances', () => {
    const r = evaluateAiHiringDecision(params({ score: 92 }));
    expect(r.decision).toBe('advance');
    expect(r.reasonCodes).toContain('passed_all_checks');
  });

  test('decline recommendation rejects (step 1)', () => {
    const r = evaluateAiHiringDecision(params({ score: 92, recommendation: 'decline' }));
    expect(r.decision).toBe('reject');
  });

  test('operational trust promotes decline to review, never advance', () => {
    const r = evaluateAiHiringDecision(
      params({
        score: 70,
        recommendation: 'decline',
        operationalTrust: { promoteDeclineToReview: true },
      }),
    );
    expect(r.decision).toBe('review');
  });

  test('review recommendation reviews by default (step 1b)', () => {
    const r = evaluateAiHiringDecision(params({ score: 92, recommendation: 'review' }));
    expect(r.decision).toBe('review');
  });

  test('advanceOnReviewRecommendation lifts a review band when all gates pass', () => {
    const r = evaluateAiHiringDecision(
      params({
        score: 92,
        recommendation: 'review',
        policy: { autoAdvanceEnabled: true, advanceOnReviewRecommendation: true },
      }),
    );
    expect(r.decision).toBe('advance');
  });

  test('score below the default minimum (80) reviews (step 3)', () => {
    const r = evaluateAiHiringDecision(params({ score: 79 }));
    expect(r.decision).toBe('review');
  });

  test('policy can lower the minimum score', () => {
    const r = evaluateAiHiringDecision(
      params({ score: 65, policy: { autoAdvanceEnabled: true, minimumScoreToAdvance: 60 } }),
    );
    expect(r.decision).toBe('advance');
  });

  test('hire_everyone-style zero threshold advances a weak-but-not-declined candidate', () => {
    const r = evaluateAiHiringDecision(
      params({
        score: 30,
        recommendation: 'review',
        policy: {
          autoAdvanceEnabled: true,
          minimumScoreToAdvance: 0,
          advanceOnReviewRecommendation: true,
        },
      }),
    );
    expect(r.decision).toBe('advance');
  });

  test('critical dynamic "no" holds even a top scorer (step 5)', () => {
    const r = evaluateAiHiringDecision(
      params({ score: 95, dynamicAnswers: { dyn_shift_punctuality: 'no' } }),
    );
    expect(r.decision).toBe('hold');
  });

  test('capacity target reached holds instead of advancing (step 6)', () => {
    const r = evaluateAiHiringDecision({
      ...params({ score: 95 }),
      hiringPolicy: { autoAdvanceEnabled: true, targetReadyCount: 5, stopWhenTargetReached: true },
      containerStats: { currentReadyCount: 5 },
    });
    expect(r.decision).toBe('hold');
  });

  test('deterministic: same input, same output', () => {
    const p = params({ score: 84, flags: ['attendance_risk'] });
    const a = evaluateAiHiringDecision(p);
    const b = evaluateAiHiringDecision(p);
    expect(a).toEqual(b);
  });
});
