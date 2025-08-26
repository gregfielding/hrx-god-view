import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const registerChildCompany = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, parentCompanyId, childCompanyId } = request.data || {};
    if (!tenantId || !parentCompanyId || !childCompanyId) {
      return { ok: false, error: 'tenantId, parentCompanyId, childCompanyId are required' };
    }

    const parentRef = db.doc(`tenants/${tenantId}/crm_companies/${parentCompanyId}`);
    await parentRef.set({
      childCompanies: admin.firestore.FieldValue.arrayUnion(childCompanyId),
      childCompaniesMap: { [childCompanyId]: true },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true };
  } catch (e) {
    console.error('registerChildCompany error', e);
    return { ok: false, error: (e as Error).message || 'unknown_error' };
  }
});


