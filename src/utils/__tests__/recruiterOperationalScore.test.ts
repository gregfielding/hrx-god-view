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

  it('does not use interviewLastScore10×10 when latest interview was live recruiter (avoids 5/10 → 50)', () => {
    const r = resolveRecruiterOperationalScore100({
      scoreSummary: {
        aiScore: 72,
        interviewCount: 2,
        interviewLastScore10: 5,
        interviewLastInterviewKind: 'recruiter_live',
      } as ScoreSummary,
    });
    expect(r.adjustedScore).toBe(72);
    expect(r.adjustedSource).toBe('composite_ai');
  });

  it('uses interviewLastScore10×10 for worker_ai_prescreen when overrides missing', () => {
    const r = resolveRecruiterOperationalScore100({
      scoreSummary: {
        aiScore: 40,
        interviewCount: 1,
        interviewLastScore10: 8.8,
        interviewLastInterviewKind: 'worker_ai_prescreen',
      } as ScoreSummary,
    });
    // finite() rounds score10 to an integer before ×10 (8.8 → 9 → 90)
    expect(r.adjustedScore).toBe(90);
    expect(r.adjustedSource).toBe('interview_last10_proxy');
  });
});
