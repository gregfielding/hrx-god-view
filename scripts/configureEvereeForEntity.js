#!/usr/bin/env node
/**
 * Generic: opt any HRX entity into Everee payroll. Use this whenever a new
 * entity is onboarded onto an Everee tenant (Events on 3138, Select on 3133,
 * etc.) instead of copy-pasting `configureEvereeForC1EventsEntity.js`.
 *
 * Merges onto `tenants/{tenantId}/entities/{entityId}`:
 *   - payrollProvider: "everee"
 *   - evereeEnabled: true
 *   - evereeTenantId: <numeric Everee tenant id, as string>
 *   - evereeEnvironment: "sandbox" | "production"  (default: production)
 *   - evereeApprovalGroupId: <string>              (optional; routes both W2 + 1099 to a group)
 *   - evereeWorkerKind:    "employee" | "contractor"  (optional override; defaults
 *                          to `resolveEvereeWorkerTypeForOnCall(entityId)` server-side)
 *
 * **Secrets:** `EVEREE_API_TOKEN_<evereeTenantId>` and `EVEREE_WEBHOOK_SECRET_<evereeTenantId>`
 * must be set in `functions/.env` (or Secret Manager) for the integration to function.
 *
 * Usage:
 *   node scripts/configureEvereeForEntity.js \
 *     --tenant=BCiP2bQ9CgVOCTfV6MhD \
 *     --entity=c1_select_llc \
 *     --evereeTenantId=3133 \
 *     --environment=production \
 *     [--workerKind=employee] \
 *     [--approvalGroupId=12345] \
 *     [--write]
 *
 * Default mode is dry-run. Add `--write` to apply.
 *
 * Requires Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    tenantId: process.env.TENANT_ID || process.env.GCLOUD_PROJECT_TENANT || '',
    entityId: '',
    evereeTenantId: '',
    environment: 'production',
    workerKind: '',
    approvalGroupId: '',
    write: false,
  };
  for (const a of argv) {
    if (a.startsWith('--tenant=')) args.tenantId = a.slice('--tenant='.length).trim();
    else if (a.startsWith('--entity=')) args.entityId = a.slice('--entity='.length).trim();
    else if (a.startsWith('--evereeTenantId='))
      args.evereeTenantId = a.slice('--evereeTenantId='.length).trim();
    else if (a.startsWith('--environment='))
      args.environment = a.slice('--environment='.length).trim();
    else if (a.startsWith('--workerKind=')) args.workerKind = a.slice('--workerKind='.length).trim();
    else if (a.startsWith('--approvalGroupId='))
      args.approvalGroupId = a.slice('--approvalGroupId='.length).trim();
    else if (a === '--write') args.write = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const errs = [];
if (!args.tenantId) errs.push('Missing --tenant=<HRX tenantId>');
if (!args.entityId) errs.push('Missing --entity=<entity doc id, e.g. c1_select_llc>');
if (!args.evereeTenantId) errs.push('Missing --evereeTenantId=<Everee tenant id, e.g. 3133>');
if (args.environment && !['sandbox', 'production'].includes(args.environment)) {
  errs.push(`Invalid --environment=${args.environment} (expected sandbox|production)`);
}
if (args.workerKind && !['employee', 'contractor'].includes(args.workerKind)) {
  errs.push(`Invalid --workerKind=${args.workerKind} (expected employee|contractor)`);
}
if (args.approvalGroupId && !/^\d+$/.test(args.approvalGroupId)) {
  errs.push(`Invalid --approvalGroupId=${args.approvalGroupId} (expected integer)`);
}
if (errs.length) {
  for (const e of errs) console.error(e);
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
if (!credential) credential = admin.credential.applicationDefault();

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
  evereeTenantId: args.evereeTenantId,
  evereeEnvironment: args.environment,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};
if (args.workerKind) patch.evereeWorkerKind = args.workerKind;
// Everee API types `approvalGroupId` as string — store it that way even when
// the value is all digits ("7900"). May 2026 type migration.
if (args.approvalGroupId) patch.evereeApprovalGroupId = String(args.approvalGroupId).trim();

async function main() {
  const ref = db.doc(`tenants/${args.tenantId}/entities/${args.entityId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Entity doc does not exist: ${ref.path}`);
    process.exit(1);
  }

  console.log('─────────────────────────────────────────');
  console.log('Configure Everee — entity opt-in');
  console.log('─────────────────────────────────────────');
  console.log(`Path:    ${ref.path}`);
  console.log(`Mode:    ${args.write ? 'WRITE' : 'DRY-RUN (omit --write)'}`);
  console.log(
    'Patch:  ',
    JSON.stringify({ ...patch, updatedAt: '(serverTimestamp)' }, null, 2),
  );
  console.log('─────────────────────────────────────────');
  console.log('Reminder — secrets:');
  console.log(`  EVEREE_API_TOKEN_${args.evereeTenantId}`);
  console.log(`  EVEREE_WEBHOOK_SECRET_${args.evereeTenantId}`);
  console.log('  (must exist in functions/.env or Secret Manager)');
  console.log('─────────────────────────────────────────');

  if (!args.write) {
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
