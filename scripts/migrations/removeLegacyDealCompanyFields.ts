import * as admin from 'firebase-admin';

/**
 * Removes legacy fields from deals after migration soak and clean integrity report.
 * - Removes companyId and companyName from deals
 * - Optionally removes contactIds/salespersonIds/locationIds if flag set
 * Usage: ts-node scripts/migrations/removeLegacyDealCompanyFields.ts [--removeIdArrays]
 */

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const removeIdArrays = process.argv.includes('--removeIdArrays');
  const tenantsSnap = await db.collection('tenants').get();
  let updated = 0;
  for (const t of tenantsSnap.docs) {
    const tenantId = t.id;
    // Gate by integrity report: require zero issues
    try {
      const integritySnap = await db.collection('associations_integrity')
        .where('tenantId', '==', tenantId)
        .orderBy('_at', 'desc')
        .limit(1)
        .get();
      const last = integritySnap.docs[0]?.data();
      const totalIssues = (last?.missingCompanyIds || 0) + (last?.missingPrimaryCompany || 0) +
        (last?.companiesWithNoSnapshot || 0) + (last?.contactsWithNoSnapshot || 0) +
        (last?.salespeopleWithNoSnapshot || 0) + (last?.locationsWithNoSnapshot || 0);
      if (totalIssues > 0) {
        console.warn(`Skipping tenant ${tenantId}: integrity issues present (${totalIssues})`);
        continue;
      }
    } catch (e) {
      console.warn(`Skipping tenant ${tenantId}: failed to read integrity report`);
      continue;
    }
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      const q = last ? dealsRef.orderBy(admin.firestore.FieldPath.documentId()).startAfter(last.id).limit(500) : dealsRef.orderBy(admin.firestore.FieldPath.documentId()).limit(500);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const doc of snap.docs) {
        const data = doc.data();
        const update: Record<string, any> = {};
        if ('companyId' in data) update['companyId'] = admin.firestore.FieldValue.delete();
        if ('companyName' in data) update['companyName'] = admin.firestore.FieldValue.delete();
        if (removeIdArrays) {
          if ('contactIds' in data) update['contactIds'] = admin.firestore.FieldValue.delete();
          if ('salespersonIds' in data) update['salespersonIds'] = admin.firestore.FieldValue.delete();
          if ('locationIds' in data) update['locationIds'] = admin.firestore.FieldValue.delete();
        }
        if (Object.keys(update).length > 0) {
          batch.update(doc.ref, update);
          updated++;
        }
      }
      await batch.commit();
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 500) break;
    }
    console.log(`Tenant ${tenantId}: updated ${updated} deal docs`);
  }
  console.log(`Done. Total updated: ${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


