/*
  backfillAssociationSnapshotsFull.js
  - Populates minimal snapshot fields for associations on deals:
    companies, contacts, salespeople, and locations
  - Safe to re-run; only fills missing snapshots/fields
  Usage:
    node scripts/migrations/backfillAssociationSnapshotsFull.js --tenant <tenantId> --batch 200
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

function toId(value) {
  return typeof value === 'string' ? value : (value && value.id) || null;
}

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const tenantId = getArg('tenant');
  const dealIdFilter = getArg('deal');
  const batchSize = parseInt(getArg('batch', '200'), 10);
  if (!tenantId) { console.error('Missing --tenant <tenantId>'); process.exit(1); }

  const dealsCol = db.collection('tenants').doc(tenantId).collection('crm_deals');
  let q = dealsCol;
  if (dealIdFilter) q = dealsCol.where(admin.firestore.FieldPath.documentId(), '==', dealIdFilter);
  const snap = await q.get();
  console.log(`Found ${snap.size} deal(s)`);

  let writes = 0; let batch = db.batch();
  const commitMaybe = async () => {
    if (writes >= batchSize) { await batch.commit(); writes = 0; batch = db.batch(); }
  };

  // Simple in-memory caches to avoid duplicate reads
  const companyCache = new Map();
  const contactCache = new Map();
  const userCache = new Map();
  const companyLocationCache = new Map(); // key: `${companyId}:${locId}`
  const topLocationCache = new Map();

  async function getCompanyDoc(id) {
    if (!id) return null;
    if (companyCache.has(id)) return companyCache.get(id);
    const ref = db.doc(`tenants/${tenantId}/crm_companies/${id}`);
    const ds = await ref.get();
    const data = ds.exists ? ds.data() : null;
    companyCache.set(id, data);
    return data;
  }

  async function getContactDoc(id) {
    if (!id) return null;
    if (contactCache.has(id)) return contactCache.get(id);
    const ref = db.doc(`tenants/${tenantId}/crm_contacts/${id}`);
    const ds = await ref.get();
    const data = ds.exists ? ds.data() : null;
    contactCache.set(id, data);
    return data;
  }

  async function getUserDoc(id) {
    if (!id) return null;
    if (userCache.has(id)) return userCache.get(id);
    const ref = db.doc(`users/${id}`);
    const ds = await ref.get();
    const data = ds.exists ? ds.data() : null;
    userCache.set(id, data);
    return data;
  }

  async function getCompanyLocDoc(companyId, locId) {
    const key = `${companyId}:${locId}`;
    if (companyLocationCache.has(key)) return companyLocationCache.get(key);
    const ref = db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${locId}`);
    const ds = await ref.get();
    const data = ds.exists ? ds.data() : null;
    companyLocationCache.set(key, data);
    return data;
  }

  async function getTopLocationDoc(locId) {
    if (topLocationCache.has(locId)) return topLocationCache.get(locId);
    const ref = db.doc(`tenants/${tenantId}/crm_locations/${locId}`);
    const ds = await ref.get();
    const data = ds.exists ? ds.data() : null;
    topLocationCache.set(locId, data);
    return data;
  }

  for (const doc of snap.docs) {
    const deal = doc.data() || {};
    const associations = deal.associations || {};
    const companies = Array.isArray(associations.companies) ? associations.companies : [];
    const contacts = Array.isArray(associations.contacts) ? associations.contacts : [];
    const salespeople = Array.isArray(associations.salespeople) ? associations.salespeople : [];
    const locations = Array.isArray(associations.locations) ? associations.locations : [];

    const companyIds = companies.map(toId).filter(Boolean);
    let changed = false;

    // Companies snapshot
    const newCompanies = [];
    for (const c of companies) {
      const id = toId(c);
      if (!id) { newCompanies.push(c); continue; }
      const snapC = (c && c.snapshot) || {};
      const hasName = !!(snapC.name || snapC.companyName);
      const hasLogo = !!(snapC.logo || snapC.logoUrl);
      if (hasName && hasLogo) { newCompanies.push(c); continue; }
      const cd = await getCompanyDoc(id);
      if (!cd) { newCompanies.push(c); continue; }
      const name = cd.companyName || cd.name || cd.legalName || null;
      const logo = cd.logo || cd.logoUrl || null;
      const companyUrl = cd.companyUrl || cd.website || cd.domain || null;
      const industry = cd.industry || null;
      const city = cd.city || null;
      const state = cd.state || null;
      const newSnap = clean({ ...snapC, companyName: name, name, logo, companyUrl, industry, city, state });
      const updated = clean({ ...(typeof c === 'string' ? { id } : c), snapshot: newSnap });
      newCompanies.push(updated); changed = true;
    }

    // Contacts snapshot
    const newContacts = [];
    for (const c of contacts) {
      const id = toId(c);
      if (!id) { newContacts.push(c); continue; }
      const snapC = (c && c.snapshot) || {};
      const hasCore = !!(snapC.fullName || snapC.name || snapC.email);
      if (hasCore) { newContacts.push(c); continue; }
      const cd = await getContactDoc(id);
      if (!cd) { newContacts.push(c); continue; }
      const fullName = cd.fullName || [cd.firstName, cd.lastName].filter(Boolean).join(' ') || null;
      const email = cd.email || null;
      const phone = cd.phone || null;
      const title = cd.title || null;
      const companyId = cd.companyId || null;
      const companyName = cd.companyName || null;
      const newSnap = clean({ ...snapC, fullName, name: fullName, email, phone, title, companyId, companyName });
      const updated = clean({ ...(typeof c === 'string' ? { id } : c), snapshot: newSnap });
      newContacts.push(updated); changed = true;
    }

    // Salespeople snapshot (users)
    const newSalespeople = [];
    for (const s of salespeople) {
      const id = toId(s);
      if (!id) { newSalespeople.push(s); continue; }
      const snapS = (s && s.snapshot) || {};
      const hasCore = !!(snapS.displayName || snapS.email);
      if (hasCore) { newSalespeople.push(s); continue; }
      const ud = await getUserDoc(id);
      if (!ud) { newSalespeople.push(s); continue; }
      const displayName = ud.displayName || [ud.firstName, ud.lastName].filter(Boolean).join(' ') || ud.email || null;
      const email = ud.email || null;
      const phone = ud.phone || ud.phoneNumber || null;
      const department = ud.department || null;
      const newSnap = clean({ ...snapS, displayName, email, phone, department });
      const updated = clean({ ...(typeof s === 'string' ? { id } : s), snapshot: newSnap });
      newSalespeople.push(updated); changed = true;
    }

    // Locations snapshot (company subcollection first, then top-level)
    const newLocations = [];
    for (const l of locations) {
      const id = toId(l);
      if (!id) { newLocations.push(l); continue; }
      const snapL = (l && l.snapshot) || {};
      const hasCore = !!(snapL.nickname || snapL.name || snapL.city);
      if (hasCore) { newLocations.push(l); continue; }
      let data = null;
      for (const cid of companyIds) {
        data = await getCompanyLocDoc(cid, id);
        if (data) break;
      }
      if (!data) data = await getTopLocationDoc(id);
      if (!data) { newLocations.push(l); continue; }
      const nickname = data.nickname || null;
      const name = data.name || null;
      const city = data.city || null;
      const state = data.state || null;
      const newSnap = clean({ ...snapL, nickname, name, city, state });
      const updated = clean({ ...(typeof l === 'string' ? { id } : l), snapshot: newSnap });
      newLocations.push(updated); changed = true;
    }

    if (changed) {
      const newAssoc = clean({ ...associations, companies: newCompanies, contacts: newContacts, salespeople: newSalespeople, locations: newLocations });
      batch.update(doc.ref, { associations: newAssoc, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      writes++; await commitMaybe();
    }
  }

  if (writes > 0) await batch.commit();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });


