import type { CertificationRecordV1 } from '../../../shared/certifications/certificationRecord';
import type { Phase1CertificationRequirement } from '../../../shared/certifications/certificationRequirement';
import { deriveCertificationConfidence } from '../../../shared/certifications/deriveCertificationConfidence';
import {
  evaluateCertificationRequirement,
  EXPIRING_SOON_DAYS,
} from '../../../shared/certifications/evaluateCertificationRequirement';

const cat = 'forklift-certification';

function req(
  partial: Partial<Phase1CertificationRequirement> = {},
): Phase1CertificationRequirement {
  return {
    requirementId: 'r1',
    catalogEntryId: cat,
    scope: 'required',
    evidencePolicy: 'either',
    reviewPolicy: 'must_be_approved',
    expirationPolicy: 'must_be_valid',
    ...partial,
  };
}

function record(partial: Partial<CertificationRecordV1>): CertificationRecordV1 {
  return {
    schemaVersion: 1,
    catalogEntryId: cat,
    source: 'worker_upload',
    review: { status: 'approved', rejectionReason: null },
    recordStatus: 'active',
    ...partial,
  } as CertificationRecordV1;
}

describe('evaluateCertificationRequirement', () => {
  const today = '2026-06-01';

  it('missing when no record (required)', () => {
    const r = evaluateCertificationRequirement({
      requirement: req(),
      record: null,
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('missing');
    expect(r.blocking).toBe(true);
    expect(r.confidence).toBe('low');
  });

  it('attested_only when upload required and active approved without files', () => {
    const r = evaluateCertificationRequirement({
      requirement: req({ evidencePolicy: 'upload_required' }),
      record: record({
        recordStatus: 'active',
        review: { status: 'approved', rejectionReason: null },
        evidenceFileRefs: [],
      }),
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('attested_only');
    expect(r.blocking).toBe(true);
    expect(r.confidence).toBe('low');
  });

  it('pending_review blocks for must_be_approved (generic)', () => {
    const r = evaluateCertificationRequirement({
      requirement: req({ reviewPolicy: 'must_be_approved' }),
      record: record({
        recordStatus: 'pending_review',
        review: { status: 'submitted', rejectionReason: null },
        evidenceFileRefs: [{ storageUrl: 'https://x/f.pdf' }],
      }),
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('pending_review');
    expect(r.blocking).toBe(true);
    expect(r.passesHardRequirement).toBe(false);
  });

  it('pending_review allowed for apply when pending_ok_for_apply', () => {
    const r = evaluateCertificationRequirement({
      requirement: req({ reviewPolicy: 'pending_ok_for_apply' }),
      record: record({
        recordStatus: 'pending_review',
        review: { status: 'submitted', rejectionReason: null },
        evidenceFileRefs: [{ storageUrl: 'https://x/f.pdf' }],
      }),
      context: 'apply',
      todayISO: today,
    });
    expect(r.status).toBe('pending_review');
    expect(r.blocking).toBe(false);
    expect(r.passesHardRequirement).toBe(true);
  });

  it('approved when active, approved review, valid expiration', () => {
    const r = evaluateCertificationRequirement({
      requirement: req(),
      record: record({
        expirationDate: '2030-01-15',
        evidenceFileRefs: [{ storageUrl: 'https://x/f.pdf' }],
      }),
      certificationRecordId: 'doc-1',
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('approved');
    expect(r.confidence).toBe('high');
    expect(r.certificationRecordId).toBe('doc-1');
  });

  it('expired when calendar past end date (must_be_valid)', () => {
    const r = evaluateCertificationRequirement({
      requirement: req(),
      record: record({
        expirationDate: '2020-01-01',
        review: { status: 'approved', rejectionReason: null },
        evidenceFileRefs: [{ storageUrl: 'https://x/f.pdf' }],
      }),
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('expired');
    expect(r.blocking).toBe(true);
  });

  it('expiring_soon inside window', () => {
    // 20 days ahead of 2026-06-01 → within EXPIRING_SOON_DAYS
    const exp = '2026-06-20';
    const r = evaluateCertificationRequirement({
      requirement: req(),
      record: record({
        expirationDate: exp,
        evidenceFileRefs: [{ storageUrl: 'https://x/f.pdf' }],
      }),
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('expiring_soon');
    expect(r.reason).toBe(`within_${EXPIRING_SOON_DAYS}_days`);
    expect(r.passesHardRequirement).toBe(true);
    expect(r.confidence).toBe('medium');
  });

  it('rejected when review.rejected', () => {
    const r = evaluateCertificationRequirement({
      requirement: req(),
      record: record({
        review: { status: 'rejected', rejectionReason: 'bad scan' },
        recordStatus: 'rejected',
      }),
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('rejected');
    expect(r.confidence).toBe('low');
  });

  it('preferred_unmet collapses missing for preferred scope', () => {
    const r = evaluateCertificationRequirement({
      requirement: req({ scope: 'preferred' }),
      record: null,
      context: 'generic',
      todayISO: today,
    });
    expect(r.status).toBe('preferred_unmet');
    expect(r.blocking).toBe(false);
    expect(r.passesHardRequirement).toBe(true);
  });
});

describe('deriveCertificationConfidence', () => {
  it('returns high for approved with evidence and reviewer approval', () => {
    const rec = {
      schemaVersion: 1 as const,
      catalogEntryId: cat,
      source: 'worker_upload' as const,
      recordStatus: 'active' as const,
      review: { status: 'approved' as const, rejectionReason: null },
      evidenceFileRefs: [{ storageUrl: 'https://x/a.png' }],
    } as CertificationRecordV1;
    expect(deriveCertificationConfidence(rec, 'approved')).toBe('high');
  });
});
