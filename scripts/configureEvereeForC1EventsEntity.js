#!/usr/bin/env node
/**
 * One-shot: opt the C1 Events entity into Everee — **production** tenant 3138.
 *
 * Merges onto `tenants/{tenantId}/entities/{entityId}`:
 *   - payrollProvider: "everee"
 *   - evereeEnabled: true
 *   - evereeTenantId: "3138"   (real C1 Events Everee tenant — not sandbox 2320)
 *   - evereeEnvironment: "production"
 *
 * **Secrets:** set `EVEREE_API_TOKEN_3138` and `EVEREE_WEBHOOK_SECRET_3138` in
 * functions/.env (or Secret Manager) — same Cloud Function webhook URL as other tenants.
 *
 * Usage:
 *   node scripts/configureEvereeForC1EventsEntity.js --tenant=BCiP2bQ9CgVOCTfV6MhD
 *   node scripts/configureEvereeForC1EventsEntity.js --tenant=... --write
 *
 * Default entity id: `c1_events_llc` (see `seedOnboardingEntitiesAndPackages.js`).
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
  let entityId = 'c1_events_llc';
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
  evereeTenantId: '3138',
  evereeEnvironment: 'production',
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
  console.log('Configure Everee — C1 Events entity');
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
