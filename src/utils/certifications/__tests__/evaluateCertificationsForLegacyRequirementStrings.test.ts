import manifestJson from '../../../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../../types/certifications/certificationCatalogManifest';
import type { CertificationRecordV1 } from '../../../types/certifications/certificationRecord';
import { evaluateCertificationsForLegacyRequirementStrings } from '../evaluateCertificationsForLegacyRequirementStrings';

const manifest = manifestJson as CertificationCatalogManifestV1;

function makeRecord(
  id: string,
  catalogEntryId: string,
  partial: Partial<CertificationRecordV1>,
): { certificationRecordId: string; record: CertificationRecordV1 } {
  return {
    certificationRecordId: id,
    record: {
      schemaVersion: 1,
      catalogEntryId,
      source: 'worker_upload',
      review: { status: 'approved', rejectionReason: null },
      recordStatus: 'active',
      expirationDate: '2030-01-01',
      evidenceFileRefs: [{ storageUrl: 'https://x/f.pdf' }],
      ...partial,
    } as CertificationRecordV1,
  };
}

describe('evaluateCertificationsForLegacyRequirementStrings', () => {
  const today = '2026-06-01';

  it('no requirements → empty rows', () => {
    const r = evaluateCertificationsForLegacyRequirementStrings({
      requiredCertifications: [],
      requiredLicenses: [],
      records: [],
      context: 'generic',
      todayISO: today,
      manifest,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.summary.missingRequiredCount).toBe(0);
  });

  it('one required approved', () => {
    const r = evaluateCertificationsForLegacyRequirementStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: [],
      records: [makeRecord('a', 'food-handler-card', {})],
      context: 'generic',
      todayISO: today,
      manifest,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].result.status).toBe('approved');
    expect(r.summary.approvedCount).toBe(1);
  });

  it('one missing when no record', () => {
    const r = evaluateCertificationsForLegacyRequirementStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: [],
      records: [],
      context: 'generic',
      todayISO: today,
      manifest,
    });
    expect(r.rows[0].result.status).toBe('missing');
    expect(r.summary.missingRequiredCount).toBe(1);
  });

  it('one expired', () => {
    const r = evaluateCertificationsForLegacyRequirementStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: [],
      records: [
        makeRecord('a', 'food-handler-card', {
          expirationDate: '2020-01-01',
        }),
      ],
      context: 'generic',
      todayISO: today,
      manifest,
    });
    expect(r.rows[0].result.status).toBe('expired');
  });

  it('pending_review', () => {
    const r = evaluateCertificationsForLegacyRequirementStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: [],
      records: [
        makeRecord('a', 'food-handler-card', {
          recordStatus: 'pending_review',
          review: { status: 'submitted', rejectionReason: null },
        }),
      ],
      context: 'generic',
      todayISO: today,
      manifest,
    });
    expect(r.rows[0].result.status).toBe('pending_review');
  });

  it('mixed cert + license arrays merge to one bridge list', () => {
    const r = evaluateCertificationsForLegacyRequirementStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: ['CDL Class A'],
      records: [],
      context: 'generic',
      todayISO: today,
      manifest,
    });
    const ids = new Set(r.rows.map((x) => x.requirement.catalogEntryId));
    expect(ids.has('food-handler-card')).toBe(true);
    expect(ids.has('cdl-class-a')).toBe(true);
  });
});
