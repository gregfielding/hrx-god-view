/**
 * Writes the certification catalog manifest from credentialsSeed.json to two
 * locations that must stay byte-identical:
 *   - shared/data/...                 → canonical (functions reads via the
 *                                        functions/src/shared symlink)
 *   - src/shared/data/...             → CRA-readable mirror (CRA's
 *                                        ModuleScopePlugin blocks imports
 *                                        from outside src/, so we keep a
 *                                        physical copy inside the tree).
 *
 * The drift guard at
 * src/utils/certifications/__tests__/generatedManifestSynced.test.ts
 * verifies on-disk content matches builder output. If you only update one
 * copy by hand, that test catches it.
 *
 * Run: `npx ts-node --project scripts/tsconfig.json scripts/buildCertificationCatalogManifest.ts`
 */
import * as fs from 'fs';
import * as path from 'path';

import seed from '../src/data/credentialsSeed.json';
import { buildCatalogManifestFromSeed } from '../src/utils/certifications/buildCatalogManifestFromSeed';

const root = path.join(__dirname, '..');
const canonicalOutPath = path.join(root, 'shared/data/certificationCatalogManifest.v1.json');
const craMirrorOutPath = path.join(root, 'src/shared/data/certificationCatalogManifest.v1.json');

const { jsonText } = buildCatalogManifestFromSeed(seed as Parameters<typeof buildCatalogManifestFromSeed>[0]);

for (const outPath of [canonicalOutPath, craMirrorOutPath]) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, jsonText, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
}
