import { buildCertificationShadowStats } from '../buildCertificationShadowStats';
import { certificationShadowMeetsAutomationThreshold } from '../buildCertificationShadowStatsThresholds';
import type { CertificationShadowEventLike } from '../../../types/certifications/certEngineShadowEvent';

function ev(partial: Partial<CertificationShadowEventLike>): CertificationShadowEventLike {
  return {
    userId: 'u1',
    surface: 'apply',
    requirementSource: 'job_posting',
    legacyLabels: [],
    engineLabels: [],
    mismatched: false,
    details: {},
    ...partial,
  };
}

describe('buildCertificationShadowStats', () => {
  it('computes mismatch rate and surface counts', () => {
    const events: CertificationShadowEventLike[] = [
      ev({ surface: 'apply', mismatched: false }),
      ev({ surface: 'apply', mismatched: true, details: { unmappedStrings: ['Foo'] } }),
      ev({ surface: 'placement', mismatched: true }),
    ];
    const s = buildCertificationShadowStats(events);
    expect(s.totalEvents).toBe(3);
    expect(s.mismatchRate).toBeCloseTo(2 / 3);
    expect(s.bySurface).toEqual({ apply: 2, placement: 1, readiness: 0 });
    expect(s.topUnmappedStrings[0]).toEqual({ label: 'Foo', count: 1 });
  });

  it('dedupes catalog ids for mismatch cert counts', () => {
    const events: CertificationShadowEventLike[] = [
      ev({
        mismatched: true,
        details: {
          resolvedCatalogIds: ['forklift-certification'],
          engine: {
            rows: [{ catalogEntryId: 'forklift-certification', status: 'gap' }],
          },
        },
      }),
    ];
    const s = buildCertificationShadowStats(events);
    expect(s.topMismatchCerts.length).toBe(1);
    expect(s.topMismatchCerts[0].catalogEntryId).toBe('forklift-certification');
    expect(s.topMismatchCerts[0].count).toBe(1);
  });
});

describe('certificationShadowMeetsAutomationThreshold', () => {
  it('rejects low sample size', () => {
    const r = certificationShadowMeetsAutomationThreshold({
      mismatchRate: 0,
      totalEvents: 10,
      topUnmappedStrings: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('insufficient'))).toBe(true);
  });

  it('accepts quiet sample above minimum', () => {
    const r = certificationShadowMeetsAutomationThreshold({
      mismatchRate: 0.03,
      totalEvents: 100,
      topUnmappedStrings: [{ count: 1 }],
    });
    expect(r.ok).toBe(true);
  });
});
