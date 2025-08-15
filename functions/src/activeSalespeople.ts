import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type ActiveSalespersonSnapshot = {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  photoURL?: string;
  jobTitle?: string;
  department?: string;
  lastActiveAt?: number;
};

function removeUndefined<T extends Record<string, any>>(obj: T): T {
  const cleaned: Record<string, any> = {};
  Object.keys(obj || {}).forEach((key) => {
    const value = (obj as any)[key];
    if (value !== undefined) cleaned[key] = value;
  });
  return cleaned as T;
}

async function getUserSnapshot(userId: string): Promise<ActiveSalespersonSnapshot | null> {
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return null;
    const u = userSnap.data() as any;
    const displayName = u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || (u.email ? u.email.split('@')[0] : undefined);
    return removeUndefined({
      id: userId,
      displayName,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      photoURL: u.photoURL,
      jobTitle: u.jobTitle,
      department: u.department,
    });
  } catch (e) {
    console.warn('Failed to get user snapshot', userId, (e as Error).message);
    return null;
  }
}

async function collectCompanyContactIds(tenantId: string, companyId: string): Promise<string[]> {
  try {
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    // Prefer associations.companies array contains
    const snap = await contactsRef.where('associations.companies', 'array-contains' as any, companyId).get();
    const ids = new Set<string>();
    snap.docs.forEach((d) => ids.add(d.id));
    // Legacy fallback: companyId field
    const legacy = await contactsRef.where('companyId', '==', companyId).get();
    legacy.docs.forEach((d) => ids.add(d.id));
    return Array.from(ids);
  } catch (e) {
    console.warn('Failed to collect contacts for company', tenantId, companyId, (e as Error).message);
    return [];
  }
}

async function computeActiveSalespeople(tenantId: string, companyId: string): Promise<Record<string, ActiveSalespersonSnapshot>> {
  const activeIds = new Set<string>();
  const lastActiveMap: Record<string, number> = {};

  // Deals: salespeople connected to any deal for this company
  try {
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const [byField, byAssoc] = await Promise.all([
      dealsRef.where('companyId', '==', companyId).get(),
      dealsRef.where('companyIds', 'array-contains' as any, companyId).get()
    ]);
    const dealDocs = [...byField.docs, ...byAssoc.docs];
    for (const d of dealDocs) {
      const data: any = d.data() || {};
      const idSet = new Set<string>();
      // Legacy array of IDs
      (Array.isArray(data.salespersonIds) ? data.salespersonIds : []).forEach((sid: string) => idSet.add(sid));
      // New associations array (objects or strings)
      (Array.isArray(data.associations?.salespeople) ? data.associations.salespeople : []).forEach((s: any) => idSet.add(typeof s === 'string' ? s : s?.id));
      // Single owner field
      if (data.salesOwnerId) idSet.add(data.salesOwnerId);

      Array.from(idSet).filter(Boolean).forEach((sid) => {
        activeIds.add(sid);
        const ts = (data.updatedAt?.toMillis?.() ? data.updatedAt.toMillis() : Date.now());
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      });
    }
  } catch (e) {
    console.warn('Deals scan failed for active salespeople', (e as Error).message);
  }

  // Tasks: any tasks tied to this company or its contacts
  try {
    const tasksRef = db.collection('tenants').doc(tenantId).collection('tasks');
    const [companyTasksSnap, contacts] = await Promise.all([
      tasksRef.where('associations.companies', 'array-contains' as any, companyId).get(),
      collectCompanyContactIds(tenantId, companyId)
    ]);

    const contactIds = contacts;

    companyTasksSnap.docs.forEach((t) => {
      const data: any = t.data() || {};
      const sid = data.assignedTo || data.createdBy;
      if (sid) {
        activeIds.add(sid);
        const ts = data.completedAt?.toMillis?.() || data.updatedAt?.toMillis?.() || Date.now();
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      }
    });

    if (contactIds.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < contactIds.length; i += 10) chunks.push(contactIds.slice(i, i + 10));
      for (const batchIds of chunks) {
        const snap = await tasksRef.where('associations.contacts', 'array-contains-any' as any, batchIds as any).get();
        snap.docs.forEach((t) => {
          const data: any = t.data() || {};
          const sid = data.assignedTo || data.createdBy;
          if (sid) {
            activeIds.add(sid);
            const ts = data.completedAt?.toMillis?.() || data.updatedAt?.toMillis?.() || Date.now();
            lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
          }
        });
      }
    }
  } catch (e) {
    console.warn('Tasks scan failed for active salespeople', (e as Error).message);
  }

  // Emails (best-effort): look for email_logs referencing this company
  try {
    const emailsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
    const emailSnap = await emailsRef.where('companyId', '==', companyId).limit(100).get();
    emailSnap.docs.forEach((d) => {
      const data: any = d.data() || {};
      const sid = data.userId || data.salespersonId || data.senderId;
      if (sid) {
        activeIds.add(sid);
        const ts = data.timestamp?.toMillis?.() || data.sentAt?.toMillis?.() || Date.now();
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      }
    });
  } catch (e) {
    // email_logs may not exist; ignore
  }

  // Build snapshot map
  const snapshots: Record<string, ActiveSalespersonSnapshot> = {};
  await Promise.all(
    Array.from(activeIds).map(async (sid) => {
      const snap = await getUserSnapshot(sid);
      if (snap) {
        snapshots[sid] = removeUndefined({ ...snap, lastActiveAt: lastActiveMap[sid] || Date.now() });
      }
    })
  );

  return snapshots;
}

export const rebuildCompanyActiveSalespeople = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, companyId } = request.data || {};
    if (!tenantId || !companyId) {
      return { ok: false, error: 'tenantId and companyId are required' };
    }
    const map = await computeActiveSalespeople(tenantId, companyId);
    // Ensure no undefined values are written
    Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
    await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, count: Object.keys(map).length };
  } catch (e) {
    console.error('rebuildCompanyActiveSalespeople error', e);
    return { ok: false, error: (e as Error).message || 'unknown_error' };
  }
});

// Batch rebuild for all companies in a tenant (or all tenants if none provided)
export const rebuildAllCompanyActiveSalespeople = onCall({ cors: true, timeoutSeconds: 540 }, async (request) => {
  const inputTenantId: string | undefined = request.data?.tenantId;
  try {
    const tenantIds: string[] = [];
    if (inputTenantId) {
      tenantIds.push(inputTenantId);
    } else {
      const tenantsSnap = await db.collection('tenants').get();
      tenantsSnap.docs.forEach((d) => tenantIds.push(d.id));
    }

    let companiesProcessed = 0;
    let totalUpdated = 0;

    for (const tenantId of tenantIds) {
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      // Page through companies to avoid timeouts/memory spikes
      while (true) {
        let q = db.collection('tenants').doc(tenantId).collection('crm_companies').orderBy(admin.firestore.FieldPath.documentId()).limit(200) as FirebaseFirestore.Query;
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty) break;
        for (const d of snap.docs) {
          const companyId = d.id;
          const map = await computeActiveSalespeople(tenantId, companyId);
          Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
          await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          companiesProcessed += 1;
          totalUpdated += Object.keys(map).length;
        }
        lastDoc = snap.docs[snap.docs.length - 1];
      }
    }

    return { ok: true, tenants: tenantIds.length, companiesProcessed, totalUpdated };
  } catch (e) {
    console.error('rebuildAllCompanyActiveSalespeople error', e);
    return { ok: false, error: (e as Error).message || 'unknown_error' };
  }
});

// Trigger updates when deals change
export const updateActiveSalespeopleOnDeal = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  const after = event.data?.after?.data();
  if (!after) return;
  const tenantId = event.params.tenantId as string;
  const companyIds: string[] = [];
  if (after.companyId) companyIds.push(after.companyId);
  if (Array.isArray(after.companyIds)) after.companyIds.forEach((id: string) => companyIds.push(id));
  if (Array.isArray(after.associations?.companies)) after.associations.companies.forEach((c: any) => companyIds.push(typeof c === 'string' ? c : c?.id));
  const uniq = Array.from(new Set(companyIds.filter(Boolean)));
  await Promise.all(uniq.map(async (cid) => {
    const map = await computeActiveSalespeople(tenantId, cid);
    Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
    await db.doc(`tenants/${tenantId}/crm_companies/${cid}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }));
});

// Trigger updates when tasks change
export const updateActiveSalespeopleOnTask = onDocumentUpdated('tenants/{tenantId}/tasks/{taskId}', async (event) => {
  const after = event.data?.after?.data();
  if (!after) return;
  const tenantId = event.params.tenantId as string;
  const companyIds: any[] = Array.isArray(after.associations?.companies) ? after.associations.companies : [];
  const contactIds: any[] = Array.isArray(after.associations?.contacts) ? after.associations.contacts : [];
  const companySet = new Set<string>();
  companyIds.forEach((entry: any) => companySet.add(typeof entry === 'string' ? entry : entry?.id));
  // If only contacts are present, resolve their companies
  if (companySet.size === 0 && contactIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < contactIds.length; i += 10) chunks.push(contactIds.slice(i, i + 10));
    for (const batchIds of chunks) {
      const snap = await db.collection('tenants').doc(tenantId).collection('crm_contacts').where(admin.firestore.FieldPath.documentId(), 'in' as any, batchIds as any).get();
      snap.docs.forEach((d) => {
        const data: any = d.data() || {};
        if (Array.isArray(data.associations?.companies)) {
          data.associations.companies.forEach((c: any) => companySet.add(typeof c === 'string' ? c : c?.id));
        } else if (data.companyId) {
          companySet.add(data.companyId);
        }
      });
    }
  }
  const uniq = Array.from(companySet).filter(Boolean);
  await Promise.all(uniq.map(async (cid) => {
    const map = await computeActiveSalespeople(tenantId, cid);
    Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
    await db.doc(`tenants/${tenantId}/crm_companies/${cid}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }));
});

// Data cleanup callable: normalize size field values across companies
export const normalizeCompanySizes = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId } = request.data || {};
    if (!tenantId) return { ok: false, error: 'tenantId required' };
    const snap = await db.collection('tenants').doc(tenantId).collection('crm_companies').where('size', '==', '50-100').get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { size: '51-100' }));
    if (snap.docs.length > 0) await batch.commit();
    return { ok: true, updated: snap.docs.length };
  } catch (e) {
    console.error('normalizeCompanySizes error', e);
    return { ok: false, error: (e as Error).message };
  }
});


