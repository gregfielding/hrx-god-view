import { expect } from 'chai';
import {
  confidenceIncrementForSource,
  interviewDeltaWeight,
  SOURCE_WEIGHT,
  sourceWeightFor,
} from '../../categoryScoreEvolution/categoryScoreRules';
import { diminishFactorForPositiveDelta } from '../../categoryScoreEvolution/categoryScoreDiminishing';

describe('categoryScoreEvolution V2 math', () => {
  it('SOURCE_WEIGHT matches spec', () => {
    expect(SOURCE_WEIGHT.interview).to.equal(1.0);
    expect(SOURCE_WEIGHT.background_check).to.equal(1.2);
    expect(SOURCE_WEIGHT.shift_completion).to.equal(1.3);
    expect(SOURCE_WEIGHT.no_show).to.equal(1.5);
    expect(SOURCE_WEIGHT.activity).to.equal(0.4);
    expect(SOURCE_WEIGHT.recruiter_override).to.equal(2.0);
  });

  it('confidenceIncrementForSource matches fixed V1 table', () => {
    expect(confidenceIncrementForSource('interview')).to.equal(10);
    expect(confidenceIncrementForSource('background_check')).to.equal(15);
    expect(confidenceIncrementForSource('shift_completion')).to.equal(12);
    expect(confidenceIncrementForSource('no_show')).to.equal(12);
    expect(confidenceIncrementForSource('activity')).to.equal(3);
    expect(confidenceIncrementForSource('recruiter_override')).to.equal(20);
  });

  it('diminishFactorForPositiveDelta follows 1/(1+0.5*t)', () => {
    expect(diminishFactorForPositiveDelta(0)).to.be.closeTo(1, 1e-9);
    expect(diminishFactorForPositiveDelta(1)).to.be.closeTo(1 / 1.5, 1e-9);
    expect(diminishFactorForPositiveDelta(2)).to.be.closeTo(0.5, 1e-9);
    expect(diminishFactorForPositiveDelta(3)).to.be.closeTo(0.4, 1e-9);
  });

  it('interviewDeltaWeight dampens after 5 and 15 prior applies', () => {
    expect(interviewDeltaWeight(0)).to.equal(1.0);
    expect(interviewDeltaWeight(5)).to.equal(1.0);
    expect(interviewDeltaWeight(6)).to.equal(0.5);
    expect(interviewDeltaWeight(15)).to.equal(0.5);
    expect(interviewDeltaWeight(16)).to.equal(0.2);
  });

  it('sourceWeightFor is defensive', () => {
    expect(sourceWeightFor('activity')).to.equal(0.4);
  });
});
