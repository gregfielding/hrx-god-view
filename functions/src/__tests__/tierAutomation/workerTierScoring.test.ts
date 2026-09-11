/**
 * Tier promotion scorer — the interview hard gate (Greg 2026-09-11): a
 * completed interview is required for Tier 2 no matter how high the total.
 */
import { expect } from 'chai';

import {
  DEFAULT_TIER_AUTOMATION_CONFIG,
  scoreTierPromotion,
} from '../../shared/workerTierScoring';
import type { TierScoreSignals, TierAutomationConfig } from '../../shared/workerTierScoring';

const config: TierAutomationConfig = { ...DEFAULT_TIER_AUTOMATION_CONFIG, mode: 'automatic', threshold: 50 };
const now = new Date('2026-09-11T12:00:00Z');

const signals = (over: Partial<TierScoreSignals> = {}): TierScoreSignals => ({
  profileScore100: 100,
  interviewScore100: null,
  hasResume: true,
  skillsCount: 3,
  hasProfilePhoto: true,
  appInstalled: null,
  backgroundCheckCompleted: false,
  drugScreenCompleted: false,
  ...over,
});

describe('scoreTierPromotion — interview required for Tier 2', () => {
  it('a maxed no-interview profile reaches the threshold but does not qualify', () => {
    const card = scoreTierPromotion(signals(), config, now);
    expect(card.total).to.equal(50);
    expect(card.qualifies).to.equal(false);
    expect(card.blockedBy).to.equal('no_interview');
  });

  it('no interview never qualifies, even far above the threshold', () => {
    const card = scoreTierPromotion(
      signals({ backgroundCheckCompleted: true, drugScreenCompleted: true }),
      config,
      now,
    );
    expect(card.total).to.equal(70);
    expect(card.qualifies).to.equal(false);
    expect(card.blockedBy).to.equal('no_interview');
  });

  it('a completed interview at or above the threshold qualifies', () => {
    const card = scoreTierPromotion(signals({ interviewScore100: 60 }), config, now);
    expect(card.total).to.equal(65);
    expect(card.qualifies).to.equal(true);
    expect(card.blockedBy).to.equal(undefined);
  });

  it('a completed interview of 0 counts as interviewed (the gate is completion, not score)', () => {
    const card = scoreTierPromotion(signals({ interviewScore100: 0 }), config, now);
    expect(card.total).to.equal(50);
    expect(card.qualifies).to.equal(true);
    expect(card.blockedBy).to.equal(undefined);
  });

  it('an interviewed worker below the threshold still does not qualify', () => {
    const card = scoreTierPromotion(
      signals({ interviewScore100: 40, hasResume: false, skillsCount: 0, profileScore100: 40 }),
      config,
      now,
    );
    expect(card.qualifies).to.equal(false);
    expect(card.blockedBy).to.equal(undefined);
  });
});
