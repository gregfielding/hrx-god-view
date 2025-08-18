/*
  Delete duplicate companies within a tenant, keeping any that have deals.
  Usage:
    node scripts/cleanup/deleteDuplicateCompanies.js --tenant TENANT_ID [--apply] [--by name|domain|both]
*/

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin using local service account (same pattern as other scripts)
const serviceAccount = require(path.resolve(__dirname, '../../firebase.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false, by: 'both' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') out.apply = true;
    if (a === '--tenant') out.tenantId = args[++i];
    if (a === '--by') out.by = args[++i];
  }
  if (!out.tenantId) {
    console.error('❌ Missing required --tenant TENANT_ID');
    process.exit(1);
  }
  if (!['name', 'domain', 'both'].includes(out.by)) out.by = 'both';
  return out;
}

function normalizeName(name) {
  return (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // collapse non-alphanumerics
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(urlOrDomain) {
  if (!urlOrDomain) return '';
  try {
    let d = urlOrDomain.toString().trim();
    if (!d) return '';
    if (!/^https?:\/\//.test(d)) d = 'http://' + d;
    const u = new URL(d);
    let host = u.hostname || '';
    if (host.startsWith('www.')) host = host.slice(4);
    return host.toLowerCase();
  } catch {
    return urlOrDomain.toString().toLowerCase();
  }
}

function hasDeals(company) {
  const arr = (company.associations && company.associations.deals) || [];
  if (!Array.isArray(arr)) return false;
  return arr.filter(Boolean).length > 0;
}

function getTimestampValue(company) {
  // Prefer updatedAt then createdAt
  const updated = company.updatedAt?.toDate?.() || company.updatedAt || null;
  const created = company.createdAt?.toDate?.() || company.createdAt || null;
  return (updated || created || new Date(0)).getTime();
}

async function deleteInBatches(refs) {
  let batch = db.batch();
  let count = 0;
  for (const ref of refs) {
    batch.delete(ref);
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (count % 400 !== 0) await batch.commit();
}

async function main() {
  const { tenantId, apply, by } = parseArgs();
  console.log(`\n🔎 Scanning companies in tenant ${tenantId} (by=${by})`);
  const companiesSnap = await db.collection(`tenants/${tenantId}/crm_companies`).get();
  console.log(`Found ${companiesSnap.size} companies`);

  // Group by key
  const groups = new Map();
  for (const doc of companiesSnap.docs) {
    const data = { id: doc.id, ...doc.data() };
    const nameKey = normalizeName(data.companyName || data.name || data.legalName || '');
    const domainKey = extractDomain(data.domain || data.websiteUrl || data.companyUrl || data.url || '');
    let key = nameKey;
    if (by === 'domain' && domainKey) key = `domain:${domainKey}`;
    if (by === 'both' && domainKey) key = `domain:${domainKey}`; // prefer domain when present
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(data);
  }

  let totalDupGroups = 0;
  const toDelete = [];
  for (const [key, list] of groups) {
    if (!key || list.length <= 1) continue;
    totalDupGroups++;
    const withDeals = list.filter(hasDeals);
    const withoutDeals = list.filter((c) => !hasDeals(c));
    // We never delete anything that has deals
    // From the ones without deals, keep the most recently touched, delete others
    if (withoutDeals.length > 1) {
      const sorted = withoutDeals.sort((a, b) => getTimestampValue(b) - getTimestampValue(a));
      const keep = sorted.shift();
      const remove = sorted;
      console.log(`\nGroup key: ${key} — duplicates=${list.length}, withDeals=${withDeals.length}`);
      console.log(`Keeping (no deals): ${keep?.id} :: ${keep?.companyName || keep?.name}`);
      remove.forEach((c) => {
        console.log(`  Marking for delete: ${c.id} :: ${c.companyName || c.name}`);
        toDelete.push(db.doc(`tenants/${tenantId}/crm_companies/${c.id}`));
      });
    }
  }

  console.log(`\n📊 Duplicate groups: ${totalDupGroups}`);
  console.log(`🗑️  Candidates to delete (no deals): ${toDelete.length}`);
  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to perform deletions.');
    return;
  }

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  await deleteInBatches(toDelete);
  console.log(`\n✅ Deleted ${toDelete.length} duplicate companies (without deals).`);
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});


