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

// Helper to load a company and construct a lightweight object for UI denormalization
async function getCompanyObj(tenantId: string, companyId: string) {
  const snap = await admin.firestore().doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
  const d = snap.data() || {} as any;
  const name = (d.companyName || d.name || '') as string;
  const logo = (d.logo || d.logoUrl || d.logo_url || d.avatar || null) as string | null;
  return { id: companyId, companyName: name, name, logo } as any;
}

// Create or update a relationship with reciprocal writes
export const setCompanyRelationship = onCall({ cors: true }, async (request) => {
  const { tenantId, sourceCompanyId, targetCompanyId, relationType } = (request.data || {}) as {
    tenantId: string; sourceCompanyId: string; targetCompanyId: string; relationType: 'parent' | 'child' | 'sibling' | 'msp';
  };
  if (!tenantId || !sourceCompanyId || !targetCompanyId || !relationType) {
    return { ok: false, error: 'tenantId, sourceCompanyId, targetCompanyId, relationType are required' };
  }
  if (sourceCompanyId === targetCompanyId) {
    return { ok: false, error: 'sourceCompanyId and targetCompanyId must differ' };
  }

  const db = admin.firestore();
  const sourceRef = db.doc(`tenants/${tenantId}/crm_companies/${sourceCompanyId}`);
  const targetRef = db.doc(`tenants/${tenantId}/crm_companies/${targetCompanyId}`);

  const [sourceObj, targetObj] = await Promise.all([
    getCompanyObj(tenantId, sourceCompanyId),
    getCompanyObj(tenantId, targetCompanyId)
  ]);

  const batch = db.batch();

  if (relationType === 'parent') {
    // Source sets its parent; target adds source as child
    batch.set(sourceRef, { parentCompany: targetObj }, { merge: true });
    batch.set(targetRef, {
      childCompanies: admin.firestore.FieldValue.arrayUnion(sourceCompanyId),
      [`childCompaniesMap.${sourceCompanyId}`]: sourceObj
    }, { merge: true });
  } else if (relationType === 'child') {
    // Source adds target as child; target sets parent
    batch.set(sourceRef, {
      childCompanies: admin.firestore.FieldValue.arrayUnion(targetCompanyId),
      [`childCompaniesMap.${targetCompanyId}`]: targetObj
    }, { merge: true });
    batch.set(targetRef, { parentCompany: sourceObj }, { merge: true });
  } else if (relationType === 'sibling') {
    batch.set(sourceRef, { [`siblingsMap.${targetCompanyId}`]: targetObj }, { merge: true });
    batch.set(targetRef, { [`siblingsMap.${sourceCompanyId}`]: sourceObj }, { merge: true });
  } else if (relationType === 'msp') {
    batch.set(sourceRef, { msp: targetObj }, { merge: true });
    batch.set(targetRef, { [`mspClientsMap.${sourceCompanyId}`]: sourceObj }, { merge: true });
  }

  await batch.commit();
  return { ok: true };
});

// Remove a relationship and its reciprocal
export const removeCompanyRelationship = onCall({ cors: true }, async (request) => {
  const { tenantId, sourceCompanyId, targetCompanyId, relationType } = (request.data || {}) as {
    tenantId: string; sourceCompanyId: string; targetCompanyId: string; relationType: 'parent' | 'child' | 'sibling' | 'msp';
  };
  if (!tenantId || !sourceCompanyId || !targetCompanyId || !relationType) {
    return { ok: false, error: 'tenantId, sourceCompanyId, targetCompanyId, relationType are required' };
  }

  const db = admin.firestore();
  const sourceRef = db.doc(`tenants/${tenantId}/crm_companies/${sourceCompanyId}`);
  const targetRef = db.doc(`tenants/${tenantId}/crm_companies/${targetCompanyId}`);

  const batch = db.batch();
  const del = admin.firestore.FieldValue.delete();
  const rmSource = admin.firestore.FieldValue.arrayRemove(sourceCompanyId);
  const rmTarget = admin.firestore.FieldValue.arrayRemove(targetCompanyId);

  if (relationType === 'parent') {
    batch.set(sourceRef, { parentCompany: del }, { merge: true });
    batch.set(targetRef, {
      childCompanies: rmSource,
      [`childCompaniesMap.${sourceCompanyId}`]: del
    }, { merge: true });
  } else if (relationType === 'child') {
    batch.set(sourceRef, {
      childCompanies: rmTarget,
      [`childCompaniesMap.${targetCompanyId}`]: del
    }, { merge: true });
    batch.set(targetRef, { parentCompany: del }, { merge: true });
  } else if (relationType === 'sibling') {
    batch.set(sourceRef, { [`siblingsMap.${targetCompanyId}`]: del }, { merge: true });
    batch.set(targetRef, { [`siblingsMap.${sourceCompanyId}`]: del }, { merge: true });
  } else if (relationType === 'msp') {
    batch.set(sourceRef, { msp: del }, { merge: true });
    batch.set(targetRef, { [`mspClientsMap.${sourceCompanyId}`]: del }, { merge: true });
  }

  await batch.commit();
  return { ok: true };
});


