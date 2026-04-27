import seed from '../../../data/credentialsSeed.json';
import { CERTIFICATION_CATALOG_SCHEMA_VERSION } from '../../../shared/certifications/certificationCatalogManifest';
import { buildCatalogManifestFromSeed } from '../buildCatalogManifestFromSeed';

describe('buildCatalogManifestFromSeed', () => {
  it('produces identical output on repeated runs (deterministic)', () => {
    const a = buildCatalogManifestFromSeed(seed as Parameters<typeof buildCatalogManifestFromSeed>[0]).jsonText;
    const b = buildCatalogManifestFromSeed(seed as Parameters<typeof buildCatalogManifestFromSeed>[0]).jsonText;
    expect(a).toBe(b);
  });

  it('includes one manifest entry per seed row with stable catalogEntryId = seed id', () => {
    const { manifest } = buildCatalogManifestFromSeed(
      seed as Parameters<typeof buildCatalogManifestFromSeed>[0],
    );
    expect(manifest.schemaVersion).toBe(CERTIFICATION_CATALOG_SCHEMA_VERSION);
    expect(manifest._meta.schemaVersion).toBe(CERTIFICATION_CATALOG_SCHEMA_VERSION);
    expect(manifest._meta.doNotEdit).toBe(true);
    expect(manifest.generatedFrom).toBe('src/data/credentialsSeed.json');
    expect(manifest.entries.length).toBe(seed.length);
    expect(manifest.entries.every((e) => e.schemaVersion === CERTIFICATION_CATALOG_SCHEMA_VERSION)).toBe(true);
    const ids = new Set(manifest.entries.map((e) => e.catalogEntryId));
    expect(ids.size).toBe(seed.length);
    for (const row of seed) {
      const entry = manifest.entries.find((e) => e.catalogEntryId === row.id);
      expect(entry).toBeDefined();
      expect(entry!.displayName).toBe(row.name);
    }
  });

  it('throws on duplicate seed id', () => {
    const one = seed[0];
    expect(() =>
      buildCatalogManifestFromSeed([one, one] as Parameters<typeof buildCatalogManifestFromSeed>[0]),
    ).toThrow(/Duplicate catalogEntryId/);
  });
});
