import { classifyScoreFreshness } from '../scoring/scoreFreshness';

describe('scoreFreshness', () => {
  const day = 24 * 60 * 60 * 1000;

  it('classifies fresh when signals are not newer than score truth', () => {
    const t0 = Date.now();
    const r = classifyScoreFreshness({
      interviewAt: new Date(t0),
      interviewAiComputedAt: new Date(t0 + 1000),
      scoreSummaryAiUpdatedAt: new Date(t0 + 2000),
      scoreSummaryHiringComputedAt: new Date(t0 + 2000),
      categoryScoresCurrentUpdatedAt: new Date(t0 - day),
      riskProfileLastUpdatedAt: new Date(t0 - day),
      userUpdatedAt: new Date(t0 - day),
    });
    expect(r.level).toBe('fresh');
  });

  it('classifies stale when profile signals are much newer than score truth', () => {
    const base = new Date('2026-01-01T12:00:00Z').getTime();
    const r = classifyScoreFreshness({
      interviewAt: new Date(base),
      interviewAiComputedAt: new Date(base),
      scoreSummaryAiUpdatedAt: new Date(base),
      scoreSummaryHiringComputedAt: new Date(base),
      categoryScoresCurrentUpdatedAt: new Date(base + 10 * day),
      riskProfileLastUpdatedAt: new Date(base + 10 * day),
      userUpdatedAt: new Date(base + 10 * day),
    });
    expect(r.level).toBe('stale');
    expect(r.headline).toMatch(/refresh/i);
  });

  it('possibly_stale in the border band between 1d and 7d lag', () => {
    const base = new Date('2026-02-01T12:00:00Z').getTime();
    const r = classifyScoreFreshness({
      interviewAt: new Date(base),
      interviewAiComputedAt: new Date(base),
      scoreSummaryAiUpdatedAt: new Date(base),
      scoreSummaryHiringComputedAt: new Date(base),
      categoryScoresCurrentUpdatedAt: new Date(base + 3 * day),
      riskProfileLastUpdatedAt: new Date(base),
      userUpdatedAt: new Date(base),
    });
    expect(r.level).toBe('possibly_stale');
  });
});
