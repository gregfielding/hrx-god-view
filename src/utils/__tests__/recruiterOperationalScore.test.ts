import { resolveRecruiterOperationalScore100, getRecruiterPrimaryScore100FromSummary } from '../scoring/recruiterOperationalScore';
import type { ScoreSummary } from '../scoreSummary';

describe('recruiterOperationalScore', () => {
  it('prefers interview overrideAdjustedScore over summary and base', () => {
    const r = resolveRecruiterOperationalScore100({
      interviewAi: { overallScore: 40, baseInterviewScore: 40, overrideAdjustedScore: 72 },
      scoreSummary: { overrideAdjustedScore: 65, baseInterviewScore: 40 } as ScoreSummary,
    });
    expect(r.adjustedScore).toBe(72);
    expect(r.baseScore).toBe(40);
  });

  it('falls back to scoreSummary.overrideAdjustedScore when interview has no override', () => {
    const r = resolveRecruiterOperationalScore100({
      interviewAi: { overallScore: 55 },
      scoreSummary: { overrideAdjustedScore: 80, baseInterviewScore: 55 } as ScoreSummary,
    });
    expect(r.adjustedScore).toBe(80);
  });

  it('getRecruiterPrimaryScore100FromSummary uses operational layer', () => {
    const n = getRecruiterPrimaryScore100FromSummary({
      aiScore: 45,
      overrideAdjustedScore: 88,
    } as ScoreSummary);
    expect(n).toBe(88);
  });
});
