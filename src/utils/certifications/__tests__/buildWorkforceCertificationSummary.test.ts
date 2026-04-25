import { buildWorkforceCertificationSummary } from '../buildWorkforceCertificationSummary';
import {
  CERT_EXPIRING_SOON_DAYS,
  CERT_GAP_PENDING_MIN_COUNT,
  CERT_GAP_PENDING_WORKFORCE_SHARE,
  CERT_MIN_APPROVED_WORKERS,
} from '../certificationIntelligenceConstants';
import { EXPIRING_SOON_DAYS } from '../../../shared/certifications/evaluateCertificationRequirement';
import {
  approvedActiveRecord,
  EXPIRING_SOON_DATE_ISO,
  FAR_EXPIRATION_ISO,
  FAR_FUTURE_NOT_SOON_ISO,
  FIXTURE_TODAY_ISO,
  pendingReviewRecord,
  PAST_EXPIRATION_ISO,
  reqRequiredTemplate,
  expiredRecord,
} from '../certificationIntelligenceFixtures';

describe('buildWorkforceCertificationSummary', () => {
  const CAT = 'forklift-certification';
  const r = reqRequiredTemplate(CAT, 'req-fk');

  it('A. empty workers / no records → empty aggregates', () => {
    const s = buildWorkforceCertificationSummary({
      workers: [],
      recordsByUserId: {},
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(s.totalWorkers).toBe(0);
    expect(s.certificationCoverage).toEqual({});
    expect(s.expiringSoon).toEqual({});
    expect(s.highRiskGaps).toEqual([]);
  });

  it('A. no workers but requirements present → still zero workforce', () => {
    const s = buildWorkforceCertificationSummary({
      workers: [],
      recordsByUserId: { x: [approvedActiveRecord(CAT, FAR_EXPIRATION_ISO, 'a')] },
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(s.totalWorkers).toBe(0);
    expect(s.certificationCoverage).toEqual({});
  });

  it('B. single catalog — mixed statuses hit correct buckets', () => {
    const workers = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }, { id: 'u5' }];
    const recordsByUserId = {
      u1: [approvedActiveRecord(CAT, FAR_EXPIRATION_ISO, 'c1')],
      u2: [approvedActiveRecord(CAT, FAR_EXPIRATION_ISO, 'c2')],
      u3: [pendingReviewRecord(CAT, FAR_EXPIRATION_ISO, 'c3')],
      u4: [],
      u5: [expiredRecord(CAT, 'c5')],
    };
    const s = buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    const cell = s.certificationCoverage[CAT];
    expect(cell).toBeDefined();
    expect(cell.approved).toBe(2);
    expect(cell.pending).toBe(1);
    expect(cell.missing).toBe(1);
    expect(cell.expired).toBe(1);
    expect(s.expiringSoon[CAT] ?? 0).toBe(0);
  });

  it('C. multiple catalogs — counts isolated', () => {
    const fork = reqRequiredTemplate('forklift-certification', 'r1');
    const food = reqRequiredTemplate('food-handler-card', 'r2');
    const cpr = reqRequiredTemplate('cpr-cert', 'r3');
    const workers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const recordsByUserId = {
      a: [approvedActiveRecord(fork.catalogEntryId, FAR_EXPIRATION_ISO, 'x1')],
      b: [approvedActiveRecord(food.catalogEntryId, FAR_EXPIRATION_ISO, 'x2')],
      c: [pendingReviewRecord(cpr.catalogEntryId, FAR_EXPIRATION_ISO, 'x3')],
    };
    const s = buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements: [fork, food, cpr],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(s.certificationCoverage['forklift-certification'].approved).toBe(1);
    expect(s.certificationCoverage['food-handler-card'].approved).toBe(1);
    expect(s.certificationCoverage['cpr-cert'].pending).toBe(1);
    expect(s.certificationCoverage['forklift-certification'].pending ?? 0).toBe(0);
  });

  it('D. expiring soon — only certs in renewal window increment expiringSoon', () => {
    const workers = [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }];
    const recordsByUserId = {
      w1: [approvedActiveRecord(CAT, EXPIRING_SOON_DATE_ISO, 'e1')],
      w2: [expiredRecord(CAT, 'e2')],
      w3: [approvedActiveRecord(CAT, FAR_FUTURE_NOT_SOON_ISO, 'e3')],
    };
    const s = buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(s.expiringSoon[CAT]).toBe(1);
    expect(s.certificationCoverage[CAT].expired).toBe(1);
    expect(s.certificationCoverage[CAT].approved).toBe(2);
  });

  it('D. aligns with engine EXPIRING_SOON_DAYS', () => {
    expect(EXPIRING_SOON_DAYS).toBe(CERT_EXPIRING_SOON_DAYS);
  });

  it('E. high-risk gaps — low approved required cert', () => {
    const workers = [{ id: 'only' }];
    const recordsByUserId = {
      only: [approvedActiveRecord(CAT, FAR_EXPIRATION_ISO, 'z')],
    };
    const s = buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(s.highRiskGaps.some((g) => g.includes('fewer than') && g.includes(CAT))).toBe(true);
    expect(s.highRiskGaps.some((g) => g.includes(String(CERT_MIN_APPROVED_WORKERS)))).toBe(true);
  });

  it('E. high-risk gaps — many expiring soon vs approval pool', () => {
    const workers = [{ id: 'x' }];
    const recordsByUserId = {
      x: [approvedActiveRecord(CAT, EXPIRING_SOON_DATE_ISO, 'solo')],
    };
    const s = buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(s.highRiskGaps.some((g) => g.includes('many approvals expiring soon'))).toBe(true);
  });

  it('E. high-risk gaps — pending volume vs workforce', () => {
    const n = 4;
    const workers = Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
    const recordsByUserId: Record<string, ReturnType<typeof pendingReviewRecord>[]> = {};
    for (let i = 0; i < n; i++) {
      recordsByUserId[`p${i}`] = [pendingReviewRecord(CAT, FAR_EXPIRATION_ISO, `rid${i}`)];
    }
    const s = buildWorkforceCertificationSummary({
      workers,
      recordsByUserId,
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    const threshold = Math.max(CERT_GAP_PENDING_MIN_COUNT, Math.floor(n * CERT_GAP_PENDING_WORKFORCE_SHARE));
    expect(s.certificationCoverage[CAT].pending).toBeGreaterThan(threshold);
    expect(s.highRiskGaps.some((g) => g.includes('elevated pending'))).toBe(true);
  });
});
