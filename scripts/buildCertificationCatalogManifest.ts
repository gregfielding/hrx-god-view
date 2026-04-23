/**
 * Writes `src/data/generated/certificationCatalogManifest.v1.json` from credentialsSeed.json.
 * Run: `npx ts-node --project scripts/tsconfig.json scripts/buildCertificationCatalogManifest.ts`
 */
import * as fs from 'fs';
import * as path from 'path';

import seed from '../src/data/credentialsSeed.json';
import { buildCatalogManifestFromSeed } from '../src/utils/certifications/buildCatalogManifestFromSeed';

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'src/data/generated/certificationCatalogManifest.v1.json');

const { jsonText } = buildCatalogManifestFromSeed(seed as Parameters<typeof buildCatalogManifestFromSeed>[0]);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, jsonText, 'utf8');
// eslint-disable-next-line no-console
console.log(`Wrote ${outPath}`);
