import manifestJson from '../../../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../../types/certifications/certificationCatalogManifest';
import { buildCertificationRequirementsFromLegacyStrings } from '../buildCertificationRequirementsFromLegacyStrings';

const manifest = manifestJson as CertificationCatalogManifestV1;

describe('buildCertificationRequirementsFromLegacyStrings', () => {
  it('exact manifest displayName resolution path (normalized alias)', () => {
    const r = buildCertificationRequirementsFromLegacyStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: [],
      manifest,
    });
    expect(r.requirements).toHaveLength(1);
    expect(r.requirements[0].catalogEntryId).toBe('food-handler-card');
    expect(r.requirements[0].legacySourceLabel).toBe('Food Handler Card');
    expect(r.unmappedStrings).toHaveLength(0);
  });

  it('alias-style string maps to the same catalog entry', () => {
    const r = buildCertificationRequirementsFromLegacyStrings({
      requiredCertifications: ['  CDL Class A  '],
      requiredLicenses: [],
      manifest,
    });
    expect(r.requirements.some((q) => q.catalogEntryId === 'cdl-class-a')).toBe(true);
  });

  it('unmapped string is skipped with entry in unmappedStrings', () => {
    const r = buildCertificationRequirementsFromLegacyStrings({
      requiredCertifications: ['Totally Unknown Credential XYZ 99999'],
      requiredLicenses: [],
      manifest,
    });
    expect(r.requirements).toHaveLength(0);
    expect(r.unmappedStrings.some((u) => u.includes('Unknown'))).toBe(true);
  });

  it('dedupes duplicate raw strings', () => {
    const r = buildCertificationRequirementsFromLegacyStrings({
      requiredCertifications: ['Food Handler Card', 'Food Handler Card'],
      requiredLicenses: [],
      manifest,
    });
    expect(r.requirements).toHaveLength(1);
  });

  it('dedupes two strings that normalize to the same catalog entry', () => {
    const r = buildCertificationRequirementsFromLegacyStrings({
      requiredCertifications: ['Food Handler Card'],
      requiredLicenses: ['food handler card'],
      manifest,
    });
    expect(r.requirements).toHaveLength(1);
  });
});
