/*
  normalizeAssociations.js
  Idempotent migration script to:
  - Normalize deal.associations (ensure arrays, remove undefined/null, convert strings→objects)
  - Backfill denormalized ID arrays: companyIds/contactIds/salespersonIds/locationIds
  - Set primaryCompanyId when missing (prefers legacy deal.companyId)
  - Build reverse indexes on entities: associations.deals += { id: dealId, addedAt }

  Usage examples:
    node scripts/migrations/normalizeAssociations.js --tenant BCiP2bQ9CgVOCTfV6MhD --dry-run
    node scripts/migrations/normalizeAssociations.js --tenant BCiP2bQ9CgVOCTfV6MhD --batch 200
    node scripts/migrations/normalizeAssociations.js --tenant BCiP2bQ9CgVOCTfV6MhD --deal 1xEcA2JdEdr20kjBSnKa

  Auth:
    Uses GOOGLE_APPLICATION_CREDENTIALS or application default creds.
*/

/* eslint-disable no-console */
const admin = require('firebase-admin');

function getArg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}

function hasFlag(name) {
  return process.argv.includes('--' + name);
}

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const tenantId = getArg('tenant');
  const dealIdFilter = getArg('deal');
  const batchSize = parseInt(getArg('batch', '250'), 10);
  const dryRun = hasFlag('dry-run');

  if (!tenantId) {
    console.error('Missing --tenant <tenantId>');
    process.exit(1);
  }

  const dealsCol = db.collection('tenants').doc(tenantId).collection('crm_deals');
  let q = dealsCol;
  if (dealIdFilter) q = dealsCol.where(admin.firestore.FieldPath.documentId(), '==', dealIdFilter);

  const snap = await q.get();
  console.log(`Found ${snap.size} deal(s) to process in tenant ${tenantId}`);

  let writes = 0;
  let batch = db.batch();

  const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const dedupeById = (arr) => {
    const map = new Map();
    arr.forEach((x) => {
      if (!x) return;
      const id = typeof x === 'string' ? x : x.id;
      if (!id) return;
      if (!map.has(id)) map.set(id, x);
    });
    return Array.from(map.values());
  };
  const clean = (obj) => {
    if (Array.isArray(obj)) return obj.map(clean).filter((v) => v !== undefined && v !== null);
    if (obj && typeof obj === 'object') {
      const out = {};
      Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if (v === undefined || v === null) return;
        out[k] = clean(v);
      });
      return out;
    }
    return obj;
  };
  const toAssocObject = (item, type) => {
    if (!item) return undefined;
    if (typeof item === 'string') return { id: item, snapshot: {}, isPrimary: type === 'companies' ? false : undefined };
    const id = item.id || item._id;
    if (!id) return undefined;
    // keep existing snapshot/name if present
    const snapshot = item.snapshot || {};
    return clean({ id, snapshot, isPrimary: item.isPrimary === true });
  };

  const commitMaybe = async () => {
    if (writes >= batchSize) {
      if (!dryRun) await batch.commit();
      writes = 0;
      batch = db.batch();
    }
  };

  let idxWrites = 0;
  const addReverseIndex = (ref, dealId) => {
    const FieldValue = admin.firestore.FieldValue;
    // Note: serverTimestamp() is not allowed inside array elements. Store id only.
    batch.set(ref, { associations: { deals: FieldValue.arrayUnion({ id: dealId }) } }, { merge: true });
    writes++;
  };

  for (const doc of snap.docs) {
    const dealId = doc.id;
    const data = doc.data() || {};
    const legacyCompanyId = data.companyId || null;
    const associations = data.associations || {};

    const companies = dedupeById(toArray(associations.companies).map((x) => toAssocObject(x, 'companies')).filter(Boolean));
    const contacts = dedupeById(toArray(associations.contacts).map((x) => toAssocObject(x, 'contacts')).filter(Boolean));
    const salespeople = dedupeById(toArray(associations.salespeople).map((x) => toAssocObject(x, 'salespeople')).filter(Boolean));
    const locations = dedupeById(toArray(associations.locations).map((x) => toAssocObject(x, 'locations')).filter(Boolean));

    // Seed from legacy if empty
    if (companies.length === 0 && legacyCompanyId) companies.push({ id: legacyCompanyId, snapshot: {}, isPrimary: true });

    // Primary company
    const primaryCompanyId = data.primaryCompanyId || (companies.find((c) => c.isPrimary)?.id || (companies[0] && companies[0].id) || null);
    if (primaryCompanyId && companies.length > 0 && !companies.find((c) => c.isPrimary)) {
      const i = companies.findIndex((c) => c.id === primaryCompanyId);
      if (i >= 0) companies[i].isPrimary = true;
    }

    const companyIds = companies.map((x) => x.id);
    const contactIds = contacts.map((x) => x.id);
    const salespersonIds = salespeople.map((x) => x.id);
    const locationIds = locations.map((x) => x.id);

    const newAssoc = clean({ companies, contacts, salespeople, locations, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
    const updates = clean({
      associations: newAssoc,
      companyIds,
      contactIds,
      salespersonIds,
      locationIds,
      primaryCompanyId: primaryCompanyId || null
    });

    if (dryRun) {
      console.log(`[DRY-RUN] Deal ${dealId}:`, { companyIds, contactIds, salespersonIds, locationIds, primaryCompanyId });
    } else {
      batch.update(doc.ref, updates);
      writes++;
      await commitMaybe();
    }

    // Reverse indexes (best-effort)
    if (!dryRun) {
      const tenantRef = db.collection('tenants').doc(tenantId);
      for (const c of companies) {
        addReverseIndex(tenantRef.collection('crm_companies').doc(c.id), dealId);
        idxWrites++;
      }
      for (const c of contacts) {
        addReverseIndex(tenantRef.collection('crm_contacts').doc(c.id), dealId);
        idxWrites++;
      }
      for (const s of salespeople) {
        addReverseIndex(db.collection('users').doc(s.id), dealId);
        idxWrites++;
      }
      // Locations: try top-level; skip if not present (company subcollection search is expensive)
      for (const l of locations) {
        const locRef = tenantRef.collection('crm_locations').doc(l.id);
        batch.set(locRef, { associations: { deals: admin.firestore.FieldValue.arrayUnion({ id: dealId }) } }, { merge: true });
        writes++;
        await commitMaybe();
      }
    }
  }

  if (!dryRun && writes > 0) await batch.commit();
  console.log('Done. Updated docs; reverse-index writes queued in batches.', { dryRun, batchSize, idxWrites });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


