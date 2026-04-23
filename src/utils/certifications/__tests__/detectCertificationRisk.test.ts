import { detectCertificationRisk } from '../detectCertificationRisk';
import type { WorkforceCertificationSummary } from '../buildWorkforceCertificationSummary';
import {
  CERT_GAP_PENDING_MIN_COUNT,
  CERT_HIGH_RISK_PERCENT,
  CERT_MIN_APPROVED_WORKERS,
  CERT_RISK_MEDIUM_EXPIRING_SHARE,
  CERT_RISK_MEDIUM_PENDING_SHARE,
} from '../certificationIntelligenceConstants';
import { buildTestManifest } from '../certificationIntelligenceFixtures';
import type { Phase1CertificationRequirement } from '../../../types/certifications/certificationRequirement';

describe('detectCertificationRisk', () => {
  const CAT = 'forklift-certification';
  const manifest = buildTestManifest([{ catalogEntryId: CAT, displayName: 'Forklift' }]);

  function summarize(partial: Partial<WorkforceCertificationSummary>): WorkforceCertificationSummary {
    return {
      totalWorkers: 10,
      certificationCoverage: {},
      expiringSoon: {},
      highRiskGaps: [],
      ...partial,
    };
  }

  const reqRequired: Phase1CertificationRequirement = {
    requirementId: 'r1',
    catalogEntryId: CAT,
    scope: 'required',
    evidencePolicy: 'either',
    reviewPolicy: 'must_be_approved',
    expirationPolicy: 'must_be_valid',
  };

  it('A. low risk — high approved, no expiring soon', () => {
    const signals = detectCertificationRisk({
      manifest,
      requirements: [reqRequired],
      summary: summarize({
        totalWorkers: 20,
        certificationCoverage: {
          [CAT]: { approved: 18, pending: 1, missing: 1, expired: 0 },
        },
        expiringSoon: { [CAT]: 0 },
      }),
    });
    const row = signals.find((s) => s.catalogEntryId === CAT);
    expect(row?.riskLevel).toBe('low');
  });

  it('B. medium risk — expiringSoon share between medium and high thresholds', () => {
    const denom = 10;
    const soon = 2;
    const signals = detectCertificationRisk({
      manifest,
      summary: summarize({
        totalWorkers: 20,
        certificationCoverage: {
          [CAT]: { approved: 8, pending: 0, missing: 2, expired: 0 },
        },
        expiringSoon: { [CAT]: soon },
      }),
    });
    const soonShare = soon / denom;
    expect(soonShare).toBeGreaterThanOrEqual(CERT_RISK_MEDIUM_EXPIRING_SHARE);
    expect(soonShare).toBeLessThan(CERT_HIGH_RISK_PERCENT);
    expect(signals.find((s) => s.catalogEntryId === CAT)?.riskLevel).toBe('medium');
  });

  it('B. medium risk — pending volume vs workforce (above threshold, not high)', () => {
    const total = 10;
    const pendingFloor = Math.max(CERT_GAP_PENDING_MIN_COUNT, Math.floor(total * CERT_RISK_MEDIUM_PENDING_SHARE));
    const pending = pendingFloor + 1;
    const signals = detectCertificationRisk({
      manifest,
      summary: summarize({
        totalWorkers: total,
        certificationCoverage: {
          [CAT]: { approved: 0, pending, missing: 0, expired: 0 },
        },
        expiringSoon: {},
      }),
    });
    expect(signals.find((s) => s.catalogEntryId === CAT)?.riskLevel).toBe('medium');
  });

  it('C. high risk — expiring share >= CERT_HIGH_RISK_PERCENT', () => {
    const denom = 10;
    const soon = 3;
    const signals = detectCertificationRisk({
      manifest,
      summary: summarize({
        totalWorkers: denom,
        certificationCoverage: {
          [CAT]: { approved: 7, pending: 0, missing: 3, expired: 0 },
        },
        expiringSoon: { [CAT]: soon },
      }),
    });
    const row = signals.find((s) => s.catalogEntryId === CAT);
    expect(row?.riskLevel).toBe('high');
    expect(row?.recommendation.length).toBeGreaterThan(10);
  });

  it('C. high risk — required cert below CERT_MIN_APPROVED_WORKERS approvals', () => {
    const signals = detectCertificationRisk({
      manifest,
      requirements: [reqRequired],
      summary: summarize({
        totalWorkers: 20,
        certificationCoverage: {
          [CAT]: { approved: CERT_MIN_APPROVED_WORKERS - 1, pending: 0, missing: 5, expired: 0 },
        },
        expiringSoon: {},
      }),
    });
    expect(signals.find((s) => s.catalogEntryId === CAT)?.riskLevel).toBe('high');
  });

  it('C. high risk — many expired vs workforce', () => {
    const signals = detectCertificationRisk({
      manifest,
      summary: summarize({
        totalWorkers: 5,
        certificationCoverage: {
          [CAT]: { approved: 0, pending: 0, missing: 0, expired: 4 },
        },
        expiringSoon: {},
      }),
    });
    expect(signals.find((s) => s.catalogEntryId === CAT)?.riskLevel).toBe('high');
  });

  it('D. unknown catalog id — no throw; displayName falls back to id', () => {
    const unknownId = 'not-in-manifest-xyz';
    const signals = detectCertificationRisk({
      manifest,
      summary: summarize({
        certificationCoverage: {
          [unknownId]: { approved: 1, pending: 0, missing: 0, expired: 0 },
        },
        expiringSoon: {},
      }),
    });
    expect(() => detectCertificationRisk({ manifest, summary: summarize({ certificationCoverage: {}, expiringSoon: {} }) })).not.toThrow();
    const row = signals.find((s) => s.catalogEntryId === unknownId);
    expect(row?.displayName).toBe(unknownId);
    expect(row).toBeDefined();
  });

  it('E. deterministic sort — same risk band ordered by displayName', () => {
    const m = buildTestManifest([
      { catalogEntryId: 'z-cat', displayName: 'Zulu' },
      { catalogEntryId: 'a-cat', displayName: 'Alpha' },
      { catalogEntryId: 'm-cat', displayName: 'Mike' },
    ]);
    const signals = detectCertificationRisk({
      manifest: m,
      summary: summarize({
        totalWorkers: 8,
        certificationCoverage: {
          'a-cat': { approved: 5, pending: 0, missing: 0, expired: 0 },
          'm-cat': { approved: 5, pending: 0, missing: 0, expired: 0 },
          'z-cat': { approved: 5, pending: 0, missing: 0, expired: 0 },
        },
        expiringSoon: {},
      }),
    });
    expect(signals.every((s) => s.riskLevel === 'low')).toBe(true);
    expect(signals.map((s) => s.displayName)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('E. stable across runs — snapshot order for fixed summary', () => {
    const summary = summarize({
      totalWorkers: 3,
      certificationCoverage: {
        [CAT]: { approved: 1, pending: 2, missing: 0, expired: 0 },
        'other-cat': { approved: 0, pending: 1, missing: 1, expired: 0 },
      },
      expiringSoon: { [CAT]: 0 },
    });
    const a = detectCertificationRisk({ manifest, summary });
    const b = detectCertificationRisk({ manifest, summary });
    expect(a).toEqual(b);
  });
});
