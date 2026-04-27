import {
  computeRecruiterMasterScore,
  computeFallbackProfileScore,
  RECRUITER_MASTER_WEIGHTS_V1,
} from '../../shared/recruiterMasterScore';

describe('computeRecruiterMasterScore', () => {
  it('blends 50/35/15 when all components present', () => {
    const r = computeRecruiterMasterScore({
      userData: {
        scoreSummary: { aiScore: 40 },
        categoryScoresCurrent: {
          version: 1,
          reliability: 80,
          punctuality: 80,
          workEthic: 80,
          teamFit: 80,
          jobReadiness: 80,
          stability: 80,
        },
      },
      prescreenAi: { overrideAdjustedScore: 100 },
      snapshotCategoryScores: null,
      prescreenTransportationPlan: null,
    });
    expect(RECRUITER_MASTER_WEIGHTS_V1.categoryScore).toBe(0.5);
    expect(r.score100).toBe(Math.round(80 * 0.5 + 100 * 0.35 + 40 * 0.15));
    expect(r.grade).toBe('B');
  });

  it('uses profile fallback when aiScore is missing (still 50/35/15)', () => {
    const r = computeRecruiterMasterScore({
      userData: {
        scoreSummary: {},
        categoryScoresCurrent: {
          version: 1,
          reliability: 60,
          punctuality: 60,
          workEthic: 60,
          teamFit: 60,
          jobReadiness: 60,
          stability: 60,
        },
      },
      prescreenAi: { overallScore: 80 },
      prescreenTransportationPlan: null,
    });
    // Profile falls back to 40 (floor); all three weights apply.
    expect(r.score100).toBe(Math.round(60 * 0.5 + 80 * 0.35 + 40 * 0.15));
    expect(r.sourceMeta?.profileFallbackPartial).toBe(true);
  });

  it('applies own-vehicle boost to category when plan is own_vehicle', () => {
    const withCar = computeRecruiterMasterScore({
      userData: {
        scoreSummary: { aiScore: 50 },
        categoryScoresCurrent: {
          version: 1,
          reliability: 70,
          punctuality: 70,
          workEthic: 70,
          teamFit: 70,
          jobReadiness: 70,
          stability: 70,
        },
      },
      prescreenAi: { overallScore: 70 },
      prescreenTransportationPlan: 'own_vehicle',
    });
    const without = computeRecruiterMasterScore({
      userData: {
        scoreSummary: { aiScore: 50 },
        categoryScoresCurrent: {
          version: 1,
          reliability: 70,
          punctuality: 70,
          workEthic: 70,
          teamFit: 70,
          jobReadiness: 70,
          stability: 70,
        },
      },
      prescreenAi: { overallScore: 70 },
      prescreenTransportationPlan: 'public_transportation',
    });
    expect(withCar.score100).toBeGreaterThan(without.score100);
    expect(withCar.sourceMeta?.carOwnershipBoostApplied).toBe(true);
  });

  it('returns N/A when there is no category, interview, ai profile, or partial profile fields', () => {
    const r = computeRecruiterMasterScore({
      userData: { scoreSummary: {} },
      prescreenAi: null,
    });
    expect(r.grade).toBe('N/A');
    expect(r.score100).toBeNull();
  });

  it('partial profile (phone + email + language) yields non-zero blended score, not F', () => {
    const r = computeRecruiterMasterScore({
      userData: {
        scoreSummary: {},
        phone: '555-0100',
        email: 'a@b.co',
        preferredLanguage: 'en',
      },
      prescreenAi: null,
    });
    expect(r.score100).not.toBeNull();
    expect(r.score100).toBeGreaterThanOrEqual(40);
    expect(r.grade).not.toBe('F');
    expect(r.sourceMeta?.profileFallbackPartial).toBe(true);
  });

  it('computeFallbackProfileScore matches expected partial credit', () => {
    const s = computeFallbackProfileScore({
      phone: '1',
      email: 'a@b.co',
      preferredLanguage: 'en',
    });
    expect(s).toBe(40 + 5 + 5 + 5);
  });
});
