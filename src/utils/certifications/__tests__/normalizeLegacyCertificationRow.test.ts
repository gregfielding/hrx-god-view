import manifestJson from '../../../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../../types/certifications/certificationCatalogManifest';
import { buildCatalogResolveIndex } from '../resolveCatalogEntry';
import { normalizeLegacyCertificationRow } from '../normalizeLegacyCertificationRow';

const manifest = manifestJson as CertificationCatalogManifestV1;

describe('normalizeLegacyCertificationRow', () => {
  const index = buildCatalogResolveIndex(manifest);

  it('normalizes strings and dates then resolves cdl class a from seed name', () => {
    const r = normalizeLegacyCertificationRow(
      {
        name: '  CDL Class A  ',
        issuer: ' DMV ',
        expirationDate: '2028-12-31',
      },
      manifest,
      index,
    );
    expect(r.name).toBe('cdl class a');
    expect(r.issuer).toBe('DMV');
    expect(r.expirationDate).toBe('2028-12-31');
    expect(r.catalogEntryId).toBe('cdl-class-a');
    expect(r.isUnmapped).toBe(false);
  });

  it('returns null catalogEntryId when name not in catalog', () => {
    const r = normalizeLegacyCertificationRow(
      { name: 'Completely Unknown Credential XYZ' },
      manifest,
      index,
    );
    expect(r.catalogEntryId).toBe(null);
    expect(r.isUnmapped).toBe(true);
  });
});
