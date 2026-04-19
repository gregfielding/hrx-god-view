import { expect } from 'chai';
import { analyzePrescreenInterviewIntegrity } from '../../utils/prescreenDecisionIntegrityQa';

describe('prescreenDecisionIntegrityQa', () => {
  it('flags high adjusted score with reject decision', () => {
    const f = analyzePrescreenInterviewIntegrity({
      ai: {
        overallScore: 50,
        overrideAdjustedScore: 85,
        recommendation: 'proceed',
        flags: [],
        hiringDecision: { decision: 'reject', eligibleForAutoAdvance: false, reasonCodes: [] },
      },
    });
    expect(f.some((x) => x.code === 'high_adj_reject')).to.equal(true);
  });

  it('flags proceed vs reject without hard signal', () => {
    const f = analyzePrescreenInterviewIntegrity({
      ai: {
        overallScore: 60,
        recommendation: 'proceed',
        flags: [],
        hiringDecision: { decision: 'reject', eligibleForAutoAdvance: false, reasonCodes: [] },
      },
    });
    expect(f.some((x) => x.code === 'proceed_vs_reject')).to.equal(true);
  });
});
