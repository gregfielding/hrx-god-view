import { hasRecruiterInterviewCompletionEvidence } from '../scoreSummary';

describe('hasRecruiterInterviewCompletionEvidence', () => {
  it('returns false when no summary and no doc signals', () => {
    expect(hasRecruiterInterviewCompletionEvidence(undefined, undefined)).toBe(false);
  });

  it('is true for worker AI prescreen flag without scoreSummary aggregates', () => {
    expect(
      hasRecruiterInterviewCompletionEvidence(undefined, { hasWorkerAiPrescreenInterview: true }),
    ).toBe(true);
  });

  it('is true when summary has interviewLastScore10 but count/lastAt missing', () => {
    expect(
      hasRecruiterInterviewCompletionEvidence({ interviewLastScore10: 8.7 }, undefined),
    ).toBe(true);
  });

  it('keeps legacy behavior for interviewCount', () => {
    expect(hasRecruiterInterviewCompletionEvidence({ interviewCount: 1 }, undefined)).toBe(true);
  });
});
