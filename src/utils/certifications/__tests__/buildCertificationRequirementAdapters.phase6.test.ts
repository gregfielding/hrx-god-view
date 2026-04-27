import certificationCatalogManifest from '../../../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../../shared/certifications/certificationCatalogManifest';
import { buildCertificationRequirementsFromAssignment } from '../buildCertificationRequirementsFromAssignment';
import { buildCertificationRequirementsFromJobOrder } from '../../../shared/certifications/buildCertificationRequirementsFromJobOrder';
import { buildCertificationRequirementsFromJobPosting } from '../buildCertificationRequirementsFromJobPosting';

const manifest = certificationCatalogManifest as CertificationCatalogManifestV1;

describe('Phase 6 — certification requirement adapters', () => {
  /** Strings that resolve via catalog `displayName` / `lookupKey` in the generated manifest. */
  const forkliftLabel = 'Forklift Certification (Class I–VII)';
  const foodLabel = 'Food Handler Card';

  it('job posting — maps known strings; respects showLicensesCerts', () => {
    const on = buildCertificationRequirementsFromJobPosting({
      posting: { id: 'p1', showLicensesCerts: true, licensesCerts: [forkliftLabel, foodLabel] },
      manifest,
    });
    expect(on.sourceLabels).toEqual([forkliftLabel, foodLabel]);
    expect(on.requirements.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(on.requirements.map((r) => r.catalogEntryId));
    expect(ids.size).toBe(on.requirements.length);
    expect(on.requirements.every((r) => r.scope === 'required')).toBe(true);

    const off = buildCertificationRequirementsFromJobPosting({
      posting: { id: 'p2', showLicensesCerts: false, licensesCerts: [forkliftLabel] },
      manifest,
    });
    expect(off.requirements).toEqual([]);
  });

  it('job order — merges licenses + certifications and dedupes by catalog', () => {
    const out = buildCertificationRequirementsFromJobOrder({
      jobOrder: {
        requiredCertifications: [forkliftLabel],
        requiredLicenses: [forkliftLabel],
      } as any,
      manifest,
      jobOrderId: 'jo1',
    });
    expect(out.sourceLabels.filter((x) => x === forkliftLabel).length).toBe(2);
    expect(out.requirements.filter((r) => r.catalogEntryId === 'forklift-certification').length).toBeLessThanOrEqual(1);
  });

  it('job order — unknown string is unmapped, not in requirements', () => {
    const out = buildCertificationRequirementsFromJobOrder({
      jobOrder: {
        requiredCertifications: ['Totally Unknown Cert Label XYZ 999'],
        requiredLicenses: [],
      } as any,
      manifest,
    });
    expect(out.requirements).toEqual([]);
    expect(out.unmappedStrings).toContain('Totally Unknown Cert Label XYZ 999');
  });

  it('assignment — delegates to job order when JO present', () => {
    const out = buildCertificationRequirementsFromAssignment({
      assignment: { id: 'a1', jobOrderId: 'jo9' },
      jobOrder: {
        requiredCertifications: [foodLabel],
        requiredLicenses: [],
      } as any,
      manifest,
    });
    expect(out.sourceLabels).toContain(foodLabel);
    expect(out.requirements.some((r) => r.legacySourceLabel === foodLabel)).toBe(true);
  });

  it('assignment — empty when job order not loaded', () => {
    const out = buildCertificationRequirementsFromAssignment({
      assignment: { id: 'a2', jobOrderId: 'missing' },
      jobOrder: null,
      manifest,
    });
    expect(out.requirements).toEqual([]);
  });
});
