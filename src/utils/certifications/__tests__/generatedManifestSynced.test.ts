/**
 * On-disk generated manifest must match builder output (CI / local guard).
 */
import fs from 'fs';
import path from 'path';

import seed from '../../../data/credentialsSeed.json';
import type { CertificationCatalogManifestV1 } from '../../../types/certifications/certificationCatalogManifest';
import { buildCatalogManifestFromSeed } from '../buildCatalogManifestFromSeed';

const DRIFT_MESSAGE =
  'Catalog seed changed — run `npm run build:cert-catalog-manifest` and review diff before committing.';

describe('certificationCatalogManifest.v1.json', () => {
  it('fails when entry count does not match seed length (catches silent catalog drift)', () => {
    const diskPath = path.join(__dirname, '../../../data/generated/certificationCatalogManifest.v1.json');
    const onDisk = fs.readFileSync(diskPath, 'utf8');
    const parsed = JSON.parse(onDisk) as CertificationCatalogManifestV1;
    if (parsed.entries.length !== seed.length) {
      throw new Error(
        `${DRIFT_MESSAGE} (entries: ${parsed.entries.length}, seed: ${seed.length})`,
      );
    }
  });

  it('matches deterministic output from credentialsSeed.json', () => {
    const expected = buildCatalogManifestFromSeed(
      seed as Parameters<typeof buildCatalogManifestFromSeed>[0],
    ).jsonText;
    const diskPath = path.join(__dirname, '../../../data/generated/certificationCatalogManifest.v1.json');
    const onDisk = fs.readFileSync(diskPath, 'utf8');
    if (onDisk !== expected) {
      throw new Error(DRIFT_MESSAGE);
    }
  });
});
