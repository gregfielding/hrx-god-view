/*
  Backfill companyName for companies where it's missing/empty.
  - Sets companyName from name or legalName if needed
  - Optionally also sets name from companyName if name is missing

  Usage:
    node scripts/migrations/backfillCompanyNames.js --tenant <tenantId> [--batch 400] [--dry-run]
*/

/* eslint-disable no-console */
const admin = require('firebase-admin');

function getArg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}
function hasFlag(name) { return process.argv.includes('--' + name); }

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const tenantId = getArg('tenant');
  const batchSize = parseInt(getArg('batch', '400'), 10);
  const dryRun = hasFlag('dry-run');
  if (!tenantId) { console.error('Missing --tenant <tenantId>'); process.exit(1); }

  const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
  const snap = await companiesRef.get();
  console.log(`Found ${snap.size} companies in tenant ${tenantId}`);

  let toUpdate = 0;
  let writes = 0;
  let batch = db.batch();

  const commitMaybe = async () => {
    if (!dryRun && writes >= batchSize) {
      await batch.commit();
      console.log(`Committed ${writes} updates...`);
      writes = 0;
      batch = db.batch();
    }
  };

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const currentCompanyName = (data.companyName || '').trim();
    const currentName = (data.name || '').trim();
    const legalName = (data.legalName || '').trim();

    const updates = {};

    // 1) Backfill companyName from name/legalName when missing
    if (!currentCompanyName) {
      const desiredCompanyName = currentName || legalName;
      if (desiredCompanyName) {
        updates.companyName = desiredCompanyName;
      }
    }

    // 2) Mirror companyName back into name when name is missing
    if (!currentName) {
      const mirrorName = currentCompanyName || legalName;
      if (mirrorName) {
        updates.name = mirrorName;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    toUpdate++;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    if (dryRun) {
      console.log(`[DRY-RUN] Would update ${docSnap.id}:`, updates);
    } else {
      batch.update(docSnap.ref, updates);
      writes++;
      await commitMaybe();
    }
  }

  if (!dryRun && writes > 0) {
    await batch.commit();
  }

  console.log(`Done. Companies evaluated: ${snap.size}, updated: ${toUpdate}${dryRun ? ' (dry-run)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


