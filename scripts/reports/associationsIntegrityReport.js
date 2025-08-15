/*
  Associations Integrity Report (Tenant-scoped)
  Usage: node scripts/reports/associationsIntegrityReport.js --tenant TENANT_ID
*/

const admin = require('firebase-admin');

// Initialize Admin SDK (service account if available, else ADC)
function initAdmin() {
  try {
    const serviceAccount = require('../../firebase.json');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
  } catch (e) {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--tenant' || args[i] === '-t') && args[i + 1]) {
      out.tenantId = args[i + 1];
      i++;
    }
  }
  return out;
}

function toIdArray(mixedArray) {
  if (!Array.isArray(mixedArray)) return [];
  return mixedArray
    .map((v) => (typeof v === 'string' ? v : v && (v.id || v.dealId)))
    .filter(Boolean);
}

function normalizeAssocIds(associations, key) {
  if (!associations || !Array.isArray(associations[key])) return [];
  return associations[key]
    .map((v) => (typeof v === 'string' ? v : v && v.id))
    .filter(Boolean);
}

function countMissingSnapshots(associations, key, fields = []) {
  if (!associations || !Array.isArray(associations[key])) return 0;
  let missing = 0;
  for (const item of associations[key]) {
    const snap = item && item.snapshot;
    if (!snap) {
      missing++;
      continue;
    }
    if (fields.length > 0) {
      const hasAny = fields.some((f) => snap[f]);
      if (!hasAny) missing++;
    }
  }
  return missing;
}

async function run() {
  initAdmin();
  const db = admin.firestore();
  const { tenantId } = parseArgs();
  if (!tenantId) {
    console.error('Missing --tenant TENANT_ID');
    process.exit(1);
  }

  const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
  const dealsSnap = await dealsRef.get();

  let totalDeals = dealsSnap.size;
  let missingCompanyIds = 0;
  let missingPrimaryCompany = 0;
  let companiesNoSnapshot = 0;
  let contactsNoSnapshot = 0;
  let salespeopleNoSnapshot = 0;
  let locationsNoSnapshot = 0;

  for (const d of dealsSnap.docs) {
    const deal = d.data() || {};
    const associations = deal.associations || {};

    const assocCompanyIds = normalizeAssocIds(associations, 'companies');
    const companyIds = toIdArray(deal.companyIds);
    const primaryCompanyId = deal.primaryCompanyId || associations.primaryCompanyId || assocCompanyIds[0] || null;

    if (assocCompanyIds.length > 0 && companyIds.length === 0) missingCompanyIds++;
    if (assocCompanyIds.length > 0 && !primaryCompanyId) missingPrimaryCompany++;

    companiesNoSnapshot += countMissingSnapshots(associations, 'companies', ['name', 'companyName']);
    contactsNoSnapshot += countMissingSnapshots(associations, 'contacts', ['fullName', 'name', 'email']);
    salespeopleNoSnapshot += countMissingSnapshots(associations, 'salespeople', ['displayName', 'email']);
    locationsNoSnapshot += countMissingSnapshots(associations, 'locations', ['nickname', 'name', 'city']);
  }

  const result = {
    tenantId,
    totalDeals,
    missingCompanyIds,
    missingPrimaryCompany,
    companiesNoSnapshot,
    contactsNoSnapshot,
    salespeopleNoSnapshot,
    locationsNoSnapshot,
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

run().catch((e) => {
  console.error('Error running integrity report:', e);
  process.exit(1);
});


