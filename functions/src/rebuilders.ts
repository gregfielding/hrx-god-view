import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const rebuildDealAssociations = onCall({ cors: true }, async (request) => {
  const { tenantId, dealId } = request.data || {};
  if (!tenantId || !dealId) throw new Error('tenantId and dealId are required');

  const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
  const dealSnap = await dealRef.get();
  if (!dealSnap.exists) throw new Error('Deal not found');

  const deal = dealSnap.data() || {};
  const associations = deal.associations || {};

  // Recompute id arrays and primaryCompanyId
  const toIds = (arr: any[]) => (Array.isArray(arr) ? arr.map((v) => (typeof v === 'string' ? v : v?.id)).filter(Boolean) : []);
  const companyIds = toIds(associations.companies);
  const contactIds = toIds(associations.contacts);
  const salespersonIds = toIds(associations.salespeople);
  const locationIds = toIds(associations.locations);
  const primaryCompanyId = associations.primaryCompanyId || companyIds[0] || null;

  await dealRef.update({
    companyIds,
    contactIds,
    salespersonIds,
    locationIds,
    primaryCompanyId,
    _rebuiltAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true, companyIds, contactIds, salespersonIds, locationIds, primaryCompanyId };
});

export const rebuildEntityReverseIndex = onCall({ cors: true }, async (request) => {
  const { tenantId, entityType, entityId } = request.data || {};
  if (!tenantId || !entityType || !entityId) throw new Error('tenantId, entityType, entityId are required');

  const entityPath = entityType === 'user'
    ? db.collection('users').doc(entityId)
    : db.collection('tenants').doc(tenantId).collection(`crm_${entityType}s`).doc(entityId);

  const entitySnap = await entityPath.get();
  if (!entitySnap.exists) throw new Error('Entity not found');

  // Scan deals that reference this entityId
  const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
  const idField = `${entityType}Ids`;
  const snapshot = await dealsRef.where(idField as any, 'array-contains' as any, entityId).get();
  const deals = snapshot.docs.map((d) => ({ id: d.id }));

  await (entityPath as FirebaseFirestore.DocumentReference).set(
    {
      associations: {
        deals,
        _rebuiltAt: admin.firestore.FieldValue.serverTimestamp()
      }
    },
    { merge: true }
  );

  return { ok: true, deals: deals.length };
});


