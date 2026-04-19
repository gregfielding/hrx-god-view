import {
  resolveRecruiterOperationalScore100,
  resolveRecruiterPrimaryScore100,
  getRecruiterPrimaryScore100FromSummary,
} from '../scoring/recruiterOperationalScore';
import type { ScoreSummary } from '../scoreSummary';

describe('recruiterOperationalScore', () => {
  it('resolveRecruiterPrimaryScore100 prefers prescreen override then overall over composite', () => {
    const r = resolveRecruiterPrimaryScore100({
      latestPrescreenInterviewAi: { overallScore: 40, overrideAdjustedScore: 72 },
      scoreSummary: { aiScore: 40 } as ScoreSummary,
    });
    expect(r.score).toBe(72);
    expect(r.source).toBe('prescreen_operational');
  });

  it('resolveRecruiterPrimaryScore100 uses overallScore when override missing', () => {
    const r = resolveRecruiterPrimaryScore100({
      latestPrescreenInterviewAi: { overallScore: 82 },
      scoreSummary: { aiScore: 40, overrideAdjustedScore: 99 } as ScoreSummary,
    });
    expect(r.score).toBe(82);
    expect(r.source).toBe('prescreen_operational');
  });

  it('resolveRecruiterPrimaryScore100 uses profile composite when no prescreen ai', () => {
    const r = resolveRecruiterPrimaryScore100({
      scoreSummary: { aiScore: 45, overrideAdjustedScore: 88 } as ScoreSummary,
    });
    expect(r.score).toBe(45);
    expect(r.source).toBe('profile_composite');
  });

  it('resolveRecruiterPrimaryScore100 reads nested latestPrescreenInterview.ai', () => {
    const r = resolveRecruiterPrimaryScore100({
      latestPrescreenInterview: { ai: { overallScore: 88, overrideAdjustedScore: 90 } },
      scoreSummary: { aiScore: 40 } as ScoreSummary,
    });
    expect(r.score).toBe(90);
    expect(r.source).toBe('prescreen_operational');
  });

  it('prescreen ai present but no finite scores: operational source, null score (never composite)', () => {
    const r = resolveRecruiterPrimaryScore100({
      latestPrescreenInterviewAi: {},
      scoreSummary: { aiScore: 40 } as ScoreSummary,
    });
    expect(r.source).toBe('prescreen_operational');
    expect(r.score).toBeNull();
  });

  it('prefers interview overrideAdjustedScore in resolveRecruiterOperationalScore100', () => {
    const r = resolveRecruiterOperationalScore100({
      interviewAi: { overallScore: 40, baseInterviewScore: 40, overrideAdjustedScore: 72 },
      scoreSummary: { overrideAdjustedScore: 65, baseInterviewScore: 40 } as ScoreSummary,
    });
    expect(r.adjustedScore).toBe(72);
    expect(r.adjustedSource).toBe('interview_override');
    expect(r.baseScore).toBe(40);
  });

  it('uses prescreen overallScore, not summary override, when interview has no override field', () => {
    const r = resolveRecruiterOperationalScore100({
      interviewAi: { overallScore: 55 },
      scoreSummary: { overrideAdjustedScore: 80, baseInterviewScore: 55 } as ScoreSummary,
    });
    expect(r.adjustedScore).toBe(55);
    expect(r.adjustedSource).toBe('interview_base');
  });

  it('getRecruiterPrimaryScore100FromSummary uses aiScore only (no interview ai)', () => {
    const n = getRecruiterPrimaryScore100FromSummary({
      aiScore: 45,
      overrideAdjustedScore: 88,
    } as ScoreSummary);
    expect(n).toBe(45);
  });

  it('does not use interviewLastScore10×10 when latest interview was live recruiter', () => {
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

  it('without prescreen ai, uses composite even when last interview was prescreen (last10 proxy removed from primary)', () => {
    const r = resolveRecruiterOperationalScore100({
      scoreSummary: {
        aiScore: 40,
        interviewCount: 1,
        interviewLastScore10: 8.8,
        interviewLastInterviewKind: 'worker_ai_prescreen',
      } as ScoreSummary,
    });
    expect(r.adjustedScore).toBe(40);
    expect(r.adjustedSource).toBe('composite_ai');
  });
});
