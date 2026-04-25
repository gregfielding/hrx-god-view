import type { CertificationRecordV1 } from '../../../shared/certifications/certificationRecord';
import {
  chooseBestCertificationRecordForCatalogEntry,
} from '../chooseBestCertificationRecordForCatalogEntry';
import type { ChooseCertificationCandidate } from '../chooseBestCertificationRecordForCatalogEntry';

function canon(
  id: string,
  partial: Partial<CertificationRecordV1> & Pick<CertificationRecordV1, 'recordStatus' | 'review'> ,
): CertificationRecordV1 {
  return {
    schemaVersion: 1,
    catalogEntryId: 'cdl-class-a',
    source: 'admin_manual',
    ...partial,
  } as CertificationRecordV1;
}

describe('chooseBestCertificationRecordForCatalogEntry', () => {
  const evalDate = '2026-04-20';

  it('approved/active canonical beats pending_review', () => {
    const active = canon('a', {
      recordStatus: 'active',
      review: { status: 'approved', rejectionReason: null },
      expirationDate: null,
      updatedAt: { toMillis: () => 10 },
    });
    const pending = canon('b', {
      recordStatus: 'pending_review',
      review: { status: 'submitted', rejectionReason: null },
      expirationDate: null,
      updatedAt: { toMillis: () => 999 },
    });
    const candidates: ChooseCertificationCandidate[] = [
      { kind: 'canonical', certificationRecordId: 'b', record: pending, updatedAtMs: 999 },
      { kind: 'canonical', certificationRecordId: 'a', record: active, updatedAtMs: 10 },
    ];
    const { best } = chooseBestCertificationRecordForCatalogEntry(candidates, evalDate);
    expect(best?.kind).toBe('canonical');
    expect(best?.kind === 'canonical' && best.certificationRecordId).toBe('a');
  });

  it('valid expiration beats expired within same tier', () => {
    const expired = canon('x', {
      recordStatus: 'active',
      review: { status: 'approved', rejectionReason: null },
      expirationDate: '2020-01-01',
      updatedAt: { toMillis: () => 999 },
    });
    const valid = canon('y', {
      recordStatus: 'active',
      review: { status: 'approved', rejectionReason: null },
      expirationDate: '2030-01-01',
      updatedAt: { toMillis: () => 1 },
    });
    const candidates: ChooseCertificationCandidate[] = [
      { kind: 'canonical', certificationRecordId: 'x', record: expired, updatedAtMs: 999 },
      { kind: 'canonical', certificationRecordId: 'y', record: valid, updatedAtMs: 1 },
    ];
    const { best } = chooseBestCertificationRecordForCatalogEntry(candidates, evalDate);
    expect(best?.kind === 'canonical' && best.certificationRecordId).toBe('y');
  });

  it('canonical draft beats legacy row with certificationRecordId (tier 3 vs 4)', () => {
    const draft = canon('d1', {
      recordStatus: 'draft',
      review: { status: 'not_required', rejectionReason: null },
      expirationDate: null,
      updatedAt: { toMillis: () => 5 },
    });
    const candidates: ChooseCertificationCandidate[] = [
      { kind: 'legacy', legacyIndex: 0, certificationRecordId: 'legacy-link', expirationDate: null },
      { kind: 'canonical', certificationRecordId: 'd1', record: draft, updatedAtMs: 5 },
    ];
    const { best } = chooseBestCertificationRecordForCatalogEntry(candidates, evalDate);
    expect(best?.kind).toBe('canonical');
    expect(best?.kind === 'canonical' && best.certificationRecordId).toBe('d1');
  });

  it('deterministic tie-break: higher updatedAt wins for canonical; lexicographic id if equal ms', () => {
    const r1 = canon('id-aaa', {
      recordStatus: 'active',
      review: { status: 'approved', rejectionReason: null },
      expirationDate: null,
      updatedAt: { toMillis: () => 100 },
    });
    const r2 = canon('id-bbb', {
      recordStatus: 'active',
      review: { status: 'approved', rejectionReason: null },
      expirationDate: null,
      updatedAt: { toMillis: () => 100 },
    });
    const candidates: ChooseCertificationCandidate[] = [
      { kind: 'canonical', certificationRecordId: 'id-bbb', record: r2, updatedAtMs: 100 },
      { kind: 'canonical', certificationRecordId: 'id-aaa', record: r1, updatedAtMs: 100 },
    ];
    const { best } = chooseBestCertificationRecordForCatalogEntry(candidates, evalDate);
    expect(best?.kind === 'canonical' && best.certificationRecordId).toBe('id-aaa');
  });

  it('legacy with same tier: lower legacyIndex wins', () => {
    const candidates: ChooseCertificationCandidate[] = [
      { kind: 'legacy', legacyIndex: 3, expirationDate: null },
      { kind: 'legacy', legacyIndex: 1, expirationDate: null },
    ];
    const { best } = chooseBestCertificationRecordForCatalogEntry(candidates, evalDate);
    expect(best?.kind === 'legacy' && best.legacyIndex).toBe(1);
  });
});
