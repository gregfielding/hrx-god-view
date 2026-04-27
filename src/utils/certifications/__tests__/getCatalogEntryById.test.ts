import type { CertificationCatalogManifestV1 } from '../../../shared/certifications/certificationCatalogManifest';
import { CERTIFICATION_CATALOG_SCHEMA_VERSION } from '../../../shared/certifications/certificationCatalogManifest';
import { getCatalogEntryById } from '../getCatalogEntryById';

const tiny: CertificationCatalogManifestV1 = {
  _meta: {
    generatedFrom: 'credentialsSeed.json',
    schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
    doNotEdit: true,
  },
  schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
  generatedFrom: 'src/data/credentialsSeed.json',
  entries: [
    {
      schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
      catalogEntryId: 'a',
      displayName: 'A',
      lookupKey: 'a',
      aliases: [],
      type: 'Certification',
      category: 'x',
      issuerHint: null,
      validityPeriodYears: null,
      isActive: true,
      requiresDocumentUpload: true,
      allowsSelfAttestation: false,
      hasExpiration: false,
    },
  ],
};

describe('getCatalogEntryById', () => {
  it('returns entry or null', () => {
    expect(getCatalogEntryById(tiny, 'a')?.displayName).toBe('A');
    expect(getCatalogEntryById(tiny, 'missing')).toBe(null);
  });
});
