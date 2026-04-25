/**
 * On-disk generated manifest must match builder output (CI / local guard).
 *
 * Phase B.5.1 moved the manifest from src/data/generated/ to two mirrored
 * locations (shared/data/ canonical + src/shared/data/ CRA-readable copy).
 * The build script writes both atomically. This test verifies both copies
 * stay byte-identical AND match the builder output, so any hand-edit or
 * partial regenerate gets caught here.
 */
import fs from 'fs';
import path from 'path';

import seed from '../../../data/credentialsSeed.json';
import type { CertificationCatalogManifestV1 } from '../../../shared/certifications/certificationCatalogManifest';
import { buildCatalogManifestFromSeed } from '../buildCatalogManifestFromSeed';

const DRIFT_MESSAGE =
  'Catalog seed changed — run `npm run build:cert-catalog-manifest` and review diff before committing.';

const CRA_MIRROR_PATH = path.join(
  __dirname,
  '../../../shared/data/certificationCatalogManifest.v1.json',
);
const CANONICAL_PATH = path.join(
  __dirname,
  '../../../../shared/data/certificationCatalogManifest.v1.json',
);

describe('certificationCatalogManifest.v1.json', () => {
  it('fails when entry count does not match seed length (catches silent catalog drift)', () => {
    const onDisk = fs.readFileSync(CRA_MIRROR_PATH, 'utf8');
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
    const onDisk = fs.readFileSync(CRA_MIRROR_PATH, 'utf8');
    if (onDisk !== expected) {
      throw new Error(DRIFT_MESSAGE);
    }
  });

  it('CRA mirror is byte-identical to the canonical shared/ copy', () => {
    // The build script writes both paths atomically; if one was hand-edited
    // or the script was bypassed, this catches it before drift hits prod.
    const cra = fs.readFileSync(CRA_MIRROR_PATH, 'utf8');
    const canonical = fs.readFileSync(CANONICAL_PATH, 'utf8');
    if (cra !== canonical) {
      throw new Error(
        'shared/data/ canonical and src/shared/data/ mirror have diverged. ' +
          'Re-run `npm run build:cert-catalog-manifest` to restore.',
      );
    }
  });
});
