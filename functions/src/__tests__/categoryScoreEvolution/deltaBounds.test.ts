import { expect } from 'chai';
import { clampDeltaForSource, MAX_ABS_DELTA_BY_SOURCE } from '../../categoryScoreEvolution/deltaBounds';

describe('categoryScoreEvolution deltaBounds', () => {
  it('caps positive and negative deltas per source', () => {
    const { appliedDelta: p } = clampDeltaForSource(100, 'interview');
    expect(p).to.equal(MAX_ABS_DELTA_BY_SOURCE.interview);
    const { appliedDelta: n } = clampDeltaForSource(-100, 'interview');
    expect(n).to.equal(-MAX_ABS_DELTA_BY_SOURCE.interview);
  });

  it('does not clamp when within cap', () => {
    const { appliedDelta, clamped } = clampDeltaForSource(5, 'shift_completion');
    expect(appliedDelta).to.equal(5);
    expect(clamped).to.equal(false);
  });

  it('caps recruiter_override', () => {
    const { appliedDelta } = clampDeltaForSource(100, 'recruiter_override');
    expect(appliedDelta).to.equal(MAX_ABS_DELTA_BY_SOURCE.recruiter_override);
  });
});
