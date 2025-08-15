/*
  backfillAssociationSnapshots.js
  - Populates minimal snapshot fields for associations on deals (companies, locations)
  - Focus: ensure locations have snapshot.nickname/name/city so UI label is friendly
  Usage:
    node scripts/migrations/backfillAssociationSnapshots.js --tenant <tenantId> --dry-run
*/

/* eslint-disable no-console */
const admin = require('firebase-admin');

function getArg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}
function hasFlag(name) { return process.argv.includes('--' + name); }

function clean(obj) {
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
}

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const tenantId = getArg('tenant');
  const dealIdFilter = getArg('deal');
  const dryRun = hasFlag('dry-run');
  const batchSize = parseInt(getArg('batch', '200'), 10);
  if (!tenantId) { console.error('Missing --tenant <tenantId>'); process.exit(1); }

  const dealsCol = db.collection('tenants').doc(tenantId).collection('crm_deals');
  let q = dealsCol;
  if (dealIdFilter) q = dealsCol.where(admin.firestore.FieldPath.documentId(), '==', dealIdFilter);
  const snap = await q.get();
  console.log(`Found ${snap.size} deal(s)`);

  let writes = 0; let batch = db.batch();
  const commitMaybe = async () => { if (writes >= batchSize) { if (!dryRun) await batch.commit(); writes = 0; batch = db.batch(); } };

  for (const doc of snap.docs) {
    const deal = doc.data() || {};
    const associations = deal.associations || {};
    const companies = Array.isArray(associations.companies) ? associations.companies : [];
    const locations = Array.isArray(associations.locations) ? associations.locations : [];
    if (locations.length === 0) continue;

    const companyIds = companies.map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean);
    let changed = false;

    const enrichLocation = async (loc) => {
      const id = typeof loc === 'string' ? loc : loc.id;
      if (!id) return loc;
      const snapshot = (loc && loc.snapshot) || {};
      if (snapshot.nickname || snapshot.name || snapshot.city) return loc; // already good
      // Try company subcollections first
      let data = null;
      for (const cid of companyIds) {
        try {
          const ref = db.doc(`tenants/${tenantId}/crm_companies/${cid}/locations/${id}`);
          const ds = await ref.get();
          if (ds.exists) { data = ds.data(); break; }
        } catch {}
      }
      // Fallback: top-level
      if (!data) {
        try {
          const refTop = db.doc(`tenants/${tenantId}/crm_locations/${id}`);
          const dsTop = await refTop.get();
          if (dsTop.exists) data = dsTop.data();
        } catch {}
      }
      if (!data) return loc; // nothing found
      const nickname = data.nickname || null;
      const name = data.name || null;
      const city = data.city || null;
      const newSnap = clean({ ...(snapshot || {}), nickname, name, city });
      const updated = clean({ ...(typeof loc === 'string' ? { id } : loc), snapshot: newSnap });
      changed = true;
      return updated;
    };

    const newLocations = [];
    for (const l of locations) newLocations.push(await enrichLocation(l));

    if (changed) {
      const newAssoc = clean({ ...associations, locations: newLocations });
      if (dryRun) {
        console.log(`[DRY-RUN] Deal ${doc.id}: updating ${locations.length} → ${newLocations.length} locations with snapshots`);
      } else {
        batch.update(doc.ref, { associations: newAssoc, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        writes++; await commitMaybe();
      }
    }
  }

  if (!dryRun && writes > 0) await batch.commit();
  console.log('Done.', { dryRun });
}

main().catch((e) => { console.error(e); process.exit(1); });


