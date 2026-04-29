#!/usr/bin/env node
/**
 * One-shot: opt the C1 Select entity into Everee (manual sync + future triggers).
 *
 * Merges onto `tenants/{tenantId}/entities/{entityId}`:
 *   - payrollProvider: "everee"
 *   - evereeEnabled: true
 *   - evereeTenantId: "2320"   (C1 Staffing **sandbox** — swap when prod tenant is ready)
 *   - evereeEnvironment: "sandbox"
 *
 * **Host name:** do **not** set `evereeApiBaseUrl` to `https://api.sandbox.everee.com`
 * — that hostname does not resolve. Everee uses `https://api.everee.com` for all
 * environments; sandbox vs prod is enforced by the per-tenant API token
 * (`EVEREE_API_TOKEN_<evereeTenantId>`). Omit `evereeApiBaseUrl` on the entity
 * doc so Cloud Functions use the code default (or set `EVEREE_BASE_URL` globally).
 *
 * Usage:
 *   node scripts/configureEvereeForC1SelectEntity.js --tenant=BCiP2bQ9CgVOCTfV6MhD
 *   node scripts/configureEvereeForC1SelectEntity.js --tenant=... --write
 *
 * Default entity id matches `seedOnboardingEntitiesAndPackages.js`: `c1_select_llc`.
 * Override: `--entity=my_entity_doc_id`
 *
 * Requires Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  let tenantId =
    process.env.TENANT_ID ||
    process.env.GCLOUD_PROJECT_TENANT ||
    '';
  let entityId = 'c1_select_llc';
  let write = false;

  for (const a of argv) {
    if (a.startsWith('--tenant=')) tenantId = a.slice('--tenant='.length).trim();
    else if (a.startsWith('--entity=')) entityId = a.slice('--entity='.length).trim();
    else if (a === '--write') write = true;
  }

  return { tenantId, entityId, write };
}

const { tenantId, entityId, write } = parseArgs(process.argv.slice(2));

if (!tenantId) {
  console.error('Missing --tenant=<tenantId> (or set TENANT_ID).');
  process.exit(1);
}

let credential;
const possibleKeyPaths = [
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'firebase-adminsdk.json'),
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
].filter(Boolean);

for (const keyPath of possibleKeyPaths) {
  if (keyPath && fs.existsSync(keyPath)) {
    console.log('Using service account key:', keyPath);
    credential = admin.credential.cert(require(keyPath));
    break;
  }
}

if (!credential) {
  credential = admin.credential.applicationDefault();
}

try {
  admin.initializeApp({
    credential,
    projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'hrx1-d3beb',
  });
} catch (e) {
  if (!e.message?.includes('already exists')) throw e;
}

const db = admin.firestore();

const patch = {
  payrollProvider: 'everee',
  evereeEnabled: true,
  evereeTenantId: '2320',
  evereeEnvironment: 'sandbox',
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};

async function main() {
  const ref = db.doc(`tenants/${tenantId}/entities/${entityId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Entity doc does not exist: ${ref.path}`);
    process.exit(1);
  }

  console.log('─────────────────────────────────────────');
  console.log('Configure Everee — C1 Select entity');
  console.log('─────────────────────────────────────────');
  console.log(`Path:    ${ref.path}`);
  console.log(`Mode:    ${write ? 'WRITE' : 'DRY-RUN (omit --write)'}`);
  console.log(`Patch:   ${JSON.stringify({ ...patch, updatedAt: '(serverTimestamp)' }, null, 2)}`);
  console.log('─────────────────────────────────────────');

  if (!write) {
    console.log('Dry-run only. Re-run with --write to apply.');
    return;
  }

  await ref.set(patch, { merge: true });
  console.log('✓ Merged Everee fields onto entity doc.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
