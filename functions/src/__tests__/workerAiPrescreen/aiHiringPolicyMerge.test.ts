import assert from 'assert';
import { mergeGroupUserDocAiHiringPartial } from '../../workerAiPrescreen/aiHiringPolicyResolution';

describe('aiHiring policy merge — group hiringConfig vs aiHiring doc', () => {
  it('sparse userGroup.aiHiring does not wipe Aggressive preset advanceOnReviewRecommendation or score floor', () => {
    const g = {
      hiringConfig: {
        quality: { preset: 'aggressive' },
      },
      // Typical legacy / partial doc: only automation flags, no advanceOnReviewRecommendation
      aiHiring: { autoAdvanceEnabled: true },
    };
    const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
    assert.strictEqual(merged.advanceOnReviewRecommendation, true);
    assert.strictEqual(merged.minimumScoreToAdvance, 60);
    assert.strictEqual(merged.minimumJobScoreToAdvance, 50);
    assert.strictEqual(merged.autoAdvanceEnabled, true);
  });

  it('legacy userGroup.aiHiring.advanceOnReviewRecommendation: false cannot disable group rule', () => {
    const g = {
      hiringConfig: { quality: { preset: 'aggressive' } },
      aiHiring: { advanceOnReviewRecommendation: false },
    };
    const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
    assert.strictEqual(merged.advanceOnReviewRecommendation, true);
  });

  it('Conservative preset still gets advanceOnReviewRecommendation from group hiringConfig', () => {
    const g = {
      hiringConfig: { quality: { preset: 'conservative' } },
      aiHiring: { autoAdvanceEnabled: true },
    };
    const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
    assert.strictEqual(merged.advanceOnReviewRecommendation, true);
    assert.strictEqual(merged.minimumScoreToAdvance, 80);
  });

  describe('maximumNoShowRiskToAdvance preset defaults', () => {
    it('aggressive preset defaults max no-show risk to 100 (lift the overlay)', () => {
      const g = { hiringConfig: { quality: { preset: 'aggressive' } } };
      const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
      assert.strictEqual(merged.maximumNoShowRiskToAdvance, 100);
    });

    it('hire_everyone preset defaults max no-show risk to 100', () => {
      const g = { hiringConfig: { quality: { preset: 'hire_everyone' } } };
      const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
      assert.strictEqual(merged.maximumNoShowRiskToAdvance, 100);
    });

    it('conservative preset defaults max no-show risk to 49 (block high/critical)', () => {
      const g = { hiringConfig: { quality: { preset: 'conservative' } } };
      const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
      assert.strictEqual(merged.maximumNoShowRiskToAdvance, 49);
    });

    it('balanced preset defaults max no-show risk to 49', () => {
      const g = { hiringConfig: { quality: { preset: 'balanced' } } };
      const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
      assert.strictEqual(merged.maximumNoShowRiskToAdvance, 49);
    });

    it('explicit maximumNoShowRiskToAdvance overrides preset default', () => {
      const g = {
        hiringConfig: { quality: { preset: 'aggressive', maximumNoShowRiskToAdvance: 60 } },
      };
      const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
      assert.strictEqual(merged.maximumNoShowRiskToAdvance, 60);
    });

    it('aiHiring override wins over preset default', () => {
      const g = {
        hiringConfig: { quality: { preset: 'aggressive' } },
        aiHiring: { maximumNoShowRiskToAdvance: 30 },
      };
      const merged = mergeGroupUserDocAiHiringPartial(g as Record<string, unknown>);
      assert.strictEqual(merged.maximumNoShowRiskToAdvance, 30);
    });
  });
});
