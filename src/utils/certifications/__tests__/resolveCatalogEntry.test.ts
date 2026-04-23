import type { CertificationCatalogManifestV1 } from '../../../types/certifications/certificationCatalogManifest';
import { CERTIFICATION_CATALOG_SCHEMA_VERSION } from '../../../types/certifications/certificationCatalogManifest';
import { buildCatalogResolveIndex, resolveCatalogEntryId } from '../resolveCatalogEntry';

const tinyManifest: CertificationCatalogManifestV1 = {
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
      catalogEntryId: 'a-cert',
      displayName: 'Alpha Cert',
      lookupKey: 'alpha cert',
      aliases: ['Old Alpha'],
      type: 'Certification',
      category: 'Test',
      issuerHint: null,
      validityPeriodYears: null,
      isActive: true,
      requiresDocumentUpload: false,
      allowsSelfAttestation: true,
      hasExpiration: false,
    },
    {
      schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
      catalogEntryId: 'b-cert',
      displayName: 'Beta Cert',
      lookupKey: 'beta cert',
      aliases: [],
      type: 'Certification',
      category: 'Test',
      issuerHint: null,
      validityPeriodYears: 2,
      isActive: true,
      requiresDocumentUpload: true,
      allowsSelfAttestation: false,
      hasExpiration: true,
    },
  ],
};

describe('resolveCatalogEntry', () => {
  it('resolves by lookupKey and displayName', () => {
    const index = buildCatalogResolveIndex(tinyManifest);
    expect(resolveCatalogEntryId('alpha cert', index)).toBe('a-cert');
    expect(resolveCatalogEntryId('beta cert', index)).toBe('b-cert');
  });

  it('resolves alias', () => {
    const index = buildCatalogResolveIndex(tinyManifest);
    expect(resolveCatalogEntryId('old alpha', index)).toBe('a-cert');
  });

  it('returns null when unmapped', () => {
    const index = buildCatalogResolveIndex(tinyManifest);
    expect(resolveCatalogEntryId('nope', index)).toBe(null);
  });

  it('throws on duplicate catalog entry ids in manifest', () => {
    const bad: CertificationCatalogManifestV1 = {
      ...tinyManifest,
      entries: [...tinyManifest.entries, { ...tinyManifest.entries[0] }],
    };
    expect(() => buildCatalogResolveIndex(bad)).toThrow(/Duplicate catalogEntryId/);
  });

  it('throws in dev when two entries compete for same lookup key', () => {
    const collision: CertificationCatalogManifestV1 = {
      ...tinyManifest,
      entries: [
        {
          ...tinyManifest.entries[0],
          catalogEntryId: 'x-one',
          lookupKey: 'same',
          displayName: 'Same',
        },
        {
          ...tinyManifest.entries[1],
          catalogEntryId: 'x-two',
          lookupKey: 'same',
          displayName: 'Other',
        },
      ],
    };
    expect(() => buildCatalogResolveIndex(collision)).toThrow(/Lookup key "same"/);
  });
});
