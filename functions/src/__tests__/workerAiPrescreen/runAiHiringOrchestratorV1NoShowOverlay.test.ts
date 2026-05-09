/**
 * Regression: orchestrator step 2 (no-show overlay) must respect
 * `resolvedPolicy.maximumNoShowRiskToAdvance` instead of unconditionally
 * blocking on band ∈ {high, critical}.
 *
 * Without this behavior, the "Aggressive" preset still held everyone above
 * the no-show threshold (`userGroups/DgpS7tIHXPcm65I8xR97` symptom: 19 of 20
 * "below score threshold / orchestrator hold" rows traced to this overlay).
 */
import assert from 'assert';
import { runAiHiringOrchestratorV1 } from '../../workerAiPrescreen/runAiHiringOrchestratorV1';
import type { ResolvedAiHiringPolicy } from '../../workerAiPrescreen/aiHiringPolicyResolution';

const baseInterview = {
  overallScore: 80,
  score10: 8,
  flags: [] as string[],
  recommendation: 'review' as const,
  dynamicAnswers: undefined,
};
const application = { applicationId: 'app-1', groupId: 'group-1' };

function makePolicy(over: Partial<ResolvedAiHiringPolicy> = {}): ResolvedAiHiringPolicy {
  return {
    autoAdvanceEnabled: false,
    advanceOnReviewRecommendation: true,
    minimumScoreToAdvance: 60,
    minimumJobScoreGateEnabled: false,
    ...over,
  };
}

describe('runAiHiringOrchestratorV1 — no-show overlay threshold', () => {
  it('legacy band-based block when policy.maximumNoShowRiskToAdvance is unset', () => {
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy(),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'critical',
    });
    assert.strictEqual(out.finalResult.decision, 'review');
    assert(out.finalResult.reasonCodes.includes('no_show_overlay_review'));
  });

  it('aggressive preset (max=100) lets a critical-band candidate advance', () => {
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy({ maximumNoShowRiskToAdvance: 100 }),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'critical',
      applicationNoShowScore: 88,
    });
    assert.strictEqual(out.finalResult.decision, 'advance');
    assert(!out.finalResult.reasonCodes.includes('no_show_overlay_review'));
  });

  it('numeric threshold of 70 blocks score 75 even when band is high', () => {
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy({ maximumNoShowRiskToAdvance: 70 }),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'high',
      applicationNoShowScore: 75,
    });
    assert.strictEqual(out.finalResult.decision, 'review');
    assert(out.finalResult.reasonCodes.includes('no_show_overlay_review'));
  });

  it('numeric threshold of 70 lets score 65 advance', () => {
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy({ maximumNoShowRiskToAdvance: 70 }),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'high',
      applicationNoShowScore: 65,
    });
    assert.strictEqual(out.finalResult.decision, 'advance');
  });

  it('threshold falls back to band-derived approximation when no numeric score available', () => {
    // band=high → approxScore=50; threshold=49; 50 > 49 → blocks (preserves legacy behavior).
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy({ maximumNoShowRiskToAdvance: 49 }),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'high',
    });
    assert.strictEqual(out.finalResult.decision, 'review');
  });

  it('assignment-level score also evaluated against threshold', () => {
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy({ maximumNoShowRiskToAdvance: 60 }),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'low',
      applicationNoShowScore: 10,
      assignmentNoShowBand: 'critical',
      assignmentNoShowScore: 90,
    });
    assert.strictEqual(out.finalResult.decision, 'review');
  });

  it('records the threshold used in inputs for audit', () => {
    const out = runAiHiringOrchestratorV1({
      interviewResult: baseInterview,
      resolvedPolicy: makePolicy({ maximumNoShowRiskToAdvance: 100 }),
      application,
      jobFitScore: null,
      applicationNoShowBand: 'critical',
      applicationNoShowScore: 88,
    });
    assert.strictEqual(out.inputs.maximumNoShowRiskToAdvance, 100);
    assert.strictEqual(out.inputs.applicationNoShowScore, 88);
  });
});
