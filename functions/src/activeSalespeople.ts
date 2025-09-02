import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { onDocumentUpdated, onDocumentCreated } from 'firebase-functions/v2/firestore';

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

async function getUserSnapshot(tenantId: string, userId: string): Promise<ActiveSalespersonSnapshot | null> {
  try {
    if (Array.isArray(userId)) {
      return null;
    }
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
    console.warn('Failed to get user snapshot', [tenantId, userId], (e as Error).message);
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

  // Emails: look for email_logs sent to contacts associated with this company
  try {
    const emailsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
    
    // Get all contacts associated with this company
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnap = await contactsRef.where('companyId', '==', companyId).get();
    const contactIds = contactsSnap.docs.map(doc => doc.id);
    
    // Also check contacts via associations
    const assocContactsSnap = await contactsRef.where('associations.companies', 'array-contains', companyId).get();
    const assocContactIds = assocContactsSnap.docs.map(doc => doc.id);
    
    const allContactIds = [...contactIds, ...assocContactIds];
    
    if (allContactIds.length > 0) {
      // Query emails for each contact in batches
      const chunks: string[][] = [];
      for (let i = 0; i < allContactIds.length; i += 10) {
        chunks.push(allContactIds.slice(i, i + 10));
      }
      
      for (const batchIds of chunks) {
        const emailSnap = await emailsRef.where('matchingContacts', 'array-contains-any', batchIds).limit(100).get();
        emailSnap.docs.forEach((d) => {
          const data: any = d.data() || {};
          const sid = data.userId || data.salespersonId || data.senderId;
          if (sid) {
            activeIds.add(sid);
            const ts = data.date?.toMillis?.() || data.processedAt?.toMillis?.() || data.timestamp?.toMillis?.() || data.sentAt?.toMillis?.() || Date.now();
            lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
          }
        });
      }
      
      console.log(`📧 Found emails for ${allContactIds.length} contacts associated with company ${companyId}`);
    }
  } catch (e) {
    console.warn('Email logs scan failed for company active salespeople:', (e as Error).message);
  }

  // Build snapshot map
  const snapshots: Record<string, ActiveSalespersonSnapshot> = {};
  await Promise.all(
    Array.from(activeIds).map(async (sid) => {
      const snap = await getUserSnapshot(tenantId, sid);
      if (snap) {
        snapshots[sid] = removeUndefined({ ...snap, lastActiveAt: lastActiveMap[sid] || Date.now() });
      }
    })
  );

  return snapshots;
}

async function computeContactActiveSalespeople(tenantId: string, contactId: string, dealIds?: string[]): Promise<Record<string, ActiveSalespersonSnapshot>> {
  const activeIds = new Set<string>();
  const lastActiveMap: Record<string, number> = {};

  // Deals: salespeople connected to any deal for this contact
  try {
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    
    let allDeals: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    
    if (dealIds && dealIds.length > 0) {
      // Use the deal IDs provided from the frontend
      const dealDocs = await Promise.all(
        dealIds.map(async (dealId) => {
          try {
            const doc = await dealsRef.doc(dealId).get();
            return doc.exists ? doc : null;
          } catch (e) {
            console.warn('Failed to fetch deal:', dealId, e);
            return null;
          }
        })
      );
      allDeals = dealDocs.filter(doc => doc !== null) as FirebaseFirestore.QueryDocumentSnapshot[];
    } else {
      // Fallback to querying (original logic)
      const [assocSnap, contactIdsSnap] = await Promise.all([
        dealsRef.where('associations.contacts', 'array-contains' as any, contactId).get(),
        dealsRef.where('contactIds', 'array-contains' as any, contactId).get()
      ]);
      allDeals = [...assocSnap.docs, ...contactIdsSnap.docs];
    }
    
    allDeals.forEach((d) => {
      const data: any = d.data() || {};
      
      const idSet = new Set<string>();
      // Legacy array of IDs
      (Array.isArray(data.salespersonIds) ? data.salespersonIds : []).forEach((sid: string) => {
        if (typeof sid === 'string' && sid.trim()) {
          idSet.add(sid.trim());
        }
      });
      // Alternative salespeople IDs field
      (Array.isArray(data.salespeopleIds) ? data.salespeopleIds : []).forEach((sid: string) => {
        if (typeof sid === 'string' && sid.trim()) {
          idSet.add(sid.trim());
        }
      });
      // New associations array (objects or strings)
      (Array.isArray(data.associations?.salespeople) ? data.associations.salespeople : []).forEach((s: any) => {
        const id = typeof s === 'string' ? s : s?.id;
        if (typeof id === 'string' && id.trim()) {
          idSet.add(id.trim());
        }
      });
      // Single owner field
      if (data.salesOwnerId && typeof data.salesOwnerId === 'string') {
        idSet.add(data.salesOwnerId.trim());
      }
      
      // Additional fields that might contain salespeople
      if (data.salespeople && Array.isArray(data.salespeople)) {
        data.salespeople.forEach((s: any) => {
          const id = typeof s === 'string' ? s : s?.id;
          if (typeof id === 'string' && id.trim()) {
            idSet.add(id.trim());
          }
        });
      }
      if (data.assignedTo && typeof data.assignedTo === 'string') {
        idSet.add(data.assignedTo.trim());
      }
      if (data.owner && typeof data.owner === 'string') {
        idSet.add(data.owner.trim());
      }
      
      Array.from(idSet).filter(Boolean).forEach((sid) => {
        if (typeof sid === 'string' && !Array.isArray(sid)) {
          activeIds.add(sid);
          const ts = (data.updatedAt?.toMillis?.() ? data.updatedAt.toMillis() : Date.now());
          lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
        }
      });
    });
  } catch (e) {
    console.warn('Deals scan failed for contact active salespeople', (e as Error).message);
  }

  // Tasks: any tasks tied to this contact
  try {
    const tasksRef = db.collection('tenants').doc(tenantId).collection('tasks');
    const taskSnap = await tasksRef.where('associations.contacts', 'array-contains' as any, contactId).get();
    
    taskSnap.docs.forEach((t) => {
      const data: any = t.data() || {};
      const sid = data.assignedTo || data.createdBy;
      if (sid) {
        if (typeof sid === 'string' && !Array.isArray(sid)) {
          // Single string ID
          activeIds.add(sid);
          const ts = data.completedAt?.toMillis?.() || data.updatedAt?.toMillis?.() || Date.now();
          lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
        } else if (Array.isArray(sid)) {
          // Array of IDs - extract each one
          sid.forEach((id: any) => {
            if (typeof id === 'string' && id.trim()) {
              activeIds.add(id.trim());
              const ts = data.completedAt?.toMillis?.() || data.updatedAt?.toMillis?.() || Date.now();
              lastActiveMap[id.trim()] = Math.max(lastActiveMap[id.trim()] || 0, ts);
            }
          });
        }
      }
    });
  } catch (e) {
    console.warn('Tasks scan failed for contact active salespeople', (e as Error).message);
  }

  // Emails: look for email_logs referencing this contact
  try {
    const emailsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
    const emailSnap = await emailsRef.where('matchingContacts', 'array-contains', contactId).limit(100).get();
    
    emailSnap.docs.forEach((d) => {
      const data: any = d.data() || {};
      const sid = data.userId || data.salespersonId || data.senderId;
      if (sid) {
        if (typeof sid === 'string' && !Array.isArray(sid)) {
          activeIds.add(sid);
          const ts = data.date?.toMillis?.() || data.processedAt?.toMillis?.() || data.timestamp?.toMillis?.() || data.sentAt?.toMillis?.() || Date.now();
          lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
        }
      }
    });
    
    console.log(`📧 Found ${emailSnap.docs.length} email logs for contact ${contactId}`);
  } catch (e) {
    console.warn('Email logs scan failed for contact active salespeople:', (e as Error).message);
  }

  // Build snapshot map
  const snapshots: Record<string, ActiveSalespersonSnapshot> = {};
  await Promise.all(
    Array.from(activeIds).map(async (sid) => {
      const snap = await getUserSnapshot(tenantId, sid);
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

export const rebuildContactActiveSalespeople = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, contactId, dealIds } = request.data || {};
    if (!tenantId || !contactId) {
      return { ok: false, error: 'tenantId and contactId are required' };
    }
    const map = await computeContactActiveSalespeople(tenantId, contactId, dealIds);
    // Ensure no undefined values are written
    Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
    await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, count: Object.keys(map).length };
  } catch (e) {
    console.error('rebuildContactActiveSalespeople error', e);
    return { ok: false, error: (e as Error).message || 'unknown_error' };
  }
});

// Trigger updates when email logs are created
export const updateActiveSalespeopleOnEmailLog = onDocumentCreated('tenants/{tenantId}/email_logs/{emailId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const tenantId = event.params.tenantId as string;

  const contactIds: string[] = [];
  const companyIds: string[] = [];

  // Collect contact IDs from various shapes
  try {
    if (Array.isArray((data as any).matchingContacts)) {
      (data as any).matchingContacts.forEach((id: any) => {
        if (typeof id === 'string') contactIds.push(id);
      });
    }
    if (Array.isArray((data as any).associations?.contacts)) {
      (data as any).associations.contacts.forEach((c: any) => {
        const id = typeof c === 'string' ? c : c?.id;
        if (typeof id === 'string') contactIds.push(id);
      });
    }
    if (typeof (data as any).contactId === 'string') {
      contactIds.push((data as any).contactId);
    }
  } catch {}

  // Collect company IDs directly from the email log
  try {
    if (typeof (data as any).companyId === 'string') {
      companyIds.push((data as any).companyId);
    }
    if (Array.isArray((data as any).associations?.companies)) {
      (data as any).associations.companies.forEach((c: any) => {
        const id = typeof c === 'string' ? c : c?.id;
        if (typeof id === 'string') companyIds.push(id);
      });
    }
  } catch {}

  // If company not present, resolve from contacts
  if (companyIds.length === 0 && contactIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < contactIds.length; i += 10) chunks.push(contactIds.slice(i, i + 10));
    for (const batch of chunks) {
      const snap = await db
        .collection('tenants').doc(tenantId)
        .collection('crm_contacts')
        .where(admin.firestore.FieldPath.documentId(), 'in' as any, batch as any)
        .get();
      snap.docs.forEach((d) => {
        const cd: any = d.data() || {};
        if (Array.isArray(cd.associations?.companies)) {
          cd.associations.companies.forEach((c: any) => {
            const id = typeof c === 'string' ? c : c?.id;
            if (typeof id === 'string') companyIds.push(id);
          });
        } else if (typeof cd.companyId === 'string') {
          companyIds.push(cd.companyId);
        }
      });
    }
  }

  const uniqCompanies = Array.from(new Set(companyIds.filter(Boolean)));
  const uniqContacts = Array.from(new Set(contactIds.filter(Boolean)));

  // Recompute maps and write back
  await Promise.all([
    ...uniqCompanies.map(async (cid) => {
      const map = await computeActiveSalespeople(tenantId, cid);
      Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
      await db.doc(`tenants/${tenantId}/crm_companies/${cid}`).set(
        { activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }),
    ...uniqContacts.map(async (contactId) => {
      const map = await computeContactActiveSalespeople(tenantId, contactId);
      Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
      await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set(
        { activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    })
  ]);
});

// Trigger updates when activity logs are created (for email activities)
export const updateActiveSalespeopleOnActivityLog = onDocumentCreated('tenants/{tenantId}/activity_logs/{activityId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  
  const tenantId = event.params.tenantId as string;
  const activityType = data.activityType || data.type;
  const entityType = data.entityType;
  const entityId = data.entityId;
  const userId = data.userId;
  
  // Only process email activities for contacts
  if (activityType !== 'email' || entityType !== 'contact' || !entityId || !userId) {
    return;
  }
  
  try {
    // Get contact data to find associated entities
    const contactDoc = await db.collection('tenants').doc(tenantId)
      .collection('crm_contacts')
      .doc(entityId)
      .get();
    
    if (!contactDoc.exists) return;
    
    const contactData = contactDoc.data();
    const associatedEntities = {
      companies: new Set<string>(),
      locations: new Set<string>(),
      deals: new Set<string>()
    };

    // Collect company associations
    if (contactData.companyId) {
      associatedEntities.companies.add(contactData.companyId);
    }
    if (contactData.associations?.companies) {
      contactData.associations.companies.forEach((company: any) => {
        const companyId = typeof company === 'string' ? company : company?.id;
        if (companyId) associatedEntities.companies.add(companyId);
      });
    }

    // Collect location associations
    if (contactData.locationId) {
      associatedEntities.locations.add(contactData.locationId);
    }
    if (contactData.associations?.locations) {
      contactData.associations.locations.forEach((location: any) => {
        const locationId = typeof location === 'string' ? location : location?.id;
        if (locationId) associatedEntities.locations.add(locationId);
      });
    }

    // Collect deal associations
    if (contactData.associations?.deals) {
      contactData.associations.deals.forEach((deal: any) => {
        const dealId = typeof deal === 'string' ? deal : deal?.id;
        if (dealId) associatedEntities.deals.add(dealId);
      });
    }

    // Update contact's active salespeople
    const currentActiveSalespeople = contactData?.activeSalespeople || {};
    const updatedActiveSalespeople = {
      ...currentActiveSalespeople,
      [userId]: {
        id: userId,
        displayName: data.userName || 'Unknown',
        email: data.metadata?.emailFrom || '',
        lastActiveAt: data.timestamp?.toMillis?.() || Date.now(),
        _processedBy: 'activity_log_trigger',
        _processedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };
    
    await db.collection('tenants').doc(tenantId)
      .collection('crm_contacts')
      .doc(entityId)
      .set({
        activeSalespeople: updatedActiveSalespeople,
        activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    // Update active salespeople for associated companies
    for (const companyId of associatedEntities.companies) {
      try {
        const companyDoc = await db.collection('tenants').doc(tenantId)
          .collection('crm_companies')
          .doc(companyId)
          .get();
        
        if (companyDoc.exists) {
          const companyData = companyDoc.data();
          const currentActiveSalespeople = companyData?.activeSalespeople || {};
          
          const updatedActiveSalespeople = {
            ...currentActiveSalespeople,
            [userId]: {
              id: userId,
              displayName: data.userName || 'Unknown',
              email: data.metadata?.emailFrom || '',
              lastActiveAt: data.timestamp?.toMillis?.() || Date.now(),
              _processedBy: 'activity_log_trigger',
              _processedAt: admin.firestore.FieldValue.serverTimestamp()
            }
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('crm_companies')
            .doc(companyId)
            .set({
              activeSalespeople: updatedActiveSalespeople,
              activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
      } catch (companyError) {
        console.warn(`Failed to update active salespeople for company ${companyId}:`, companyError);
      }
    }

    // Update active salespeople for associated locations
    for (const locationId of associatedEntities.locations) {
      try {
        const locationDoc = await db.collection('tenants').doc(tenantId)
          .collection('crm_companies')
          .doc(contactData.companyId || '')
          .collection('locations')
          .doc(locationId)
          .get();
        
        if (locationDoc.exists) {
          const locationData = locationDoc.data();
          const currentActiveSalespeople = locationData?.activeSalespeople || {};
          
          const updatedActiveSalespeople = {
            ...currentActiveSalespeople,
            [userId]: {
              id: userId,
              displayName: data.userName || 'Unknown',
              email: data.metadata?.emailFrom || '',
              lastActiveAt: data.timestamp?.toMillis?.() || Date.now(),
              _processedBy: 'activity_log_trigger',
              _processedAt: admin.firestore.FieldValue.serverTimestamp()
            }
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('crm_companies')
            .doc(contactData.companyId || '')
            .collection('locations')
            .doc(locationId)
            .set({
              activeSalespeople: updatedActiveSalespeople,
              activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
      } catch (locationError) {
        console.warn(`Failed to update active salespeople for location ${locationId}:`, locationError);
      }
    }

    // Update active salespeople for associated deals
    for (const dealId of associatedEntities.deals) {
      try {
        const dealDoc = await db.collection('tenants').doc(tenantId)
          .collection('crm_deals')
          .doc(dealId)
          .get();
        
        if (dealDoc.exists) {
          const dealData = dealDoc.data();
          const currentActiveSalespeople = dealData?.activeSalespeople || {};
          
          const updatedActiveSalespeople = {
            ...currentActiveSalespeople,
            [userId]: {
              id: userId,
              displayName: data.userName || 'Unknown',
              email: data.metadata?.emailFrom || '',
              lastActiveAt: data.timestamp?.toMillis?.() || Date.now(),
              _processedBy: 'activity_log_trigger',
              _processedAt: admin.firestore.FieldValue.serverTimestamp()
            }
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('crm_deals')
            .doc(dealId)
            .set({
              activeSalespeople: updatedActiveSalespeople,
              activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
      } catch (dealError) {
        console.warn(`Failed to update active salespeople for deal ${dealId}:`, dealError);
      }
    }
    
    console.log(`✅ Activity log trigger: Updated active salespeople for contact ${entityId} and ${associatedEntities.companies.size} companies, ${associatedEntities.locations.size} locations, ${associatedEntities.deals.size} deals to include user ${userId}`);
  } catch (error) {
    console.warn(`Failed to update active salespeople for contact ${entityId} via activity log trigger:`, error);
    // Continue processing - this is not critical
  }
});

// Batch rebuild for all companies in a tenant (or all tenants if none provided)
export const rebuildAllCompanyActiveSalespeople = onCall(async (request) => {
  const { tenantIds } = request.data;
  if (!tenantIds || !Array.isArray(tenantIds)) {
    return { ok: false, error: 'tenantIds array required' };
  }

  try {
    let companiesProcessed = 0;
    let totalUpdated = 0;
    const MAX_COMPANIES_PER_TENANT = 1000; // Add safety limit
    const MAX_TOTAL_COMPANIES = 5000; // Add global safety limit

    for (const tenantId of tenantIds) {
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      let companiesInTenant = 0;
      
      // Page through companies to avoid timeouts/memory spikes
      while (true) {
        // Add safety checks to prevent infinite loops
        if (companiesInTenant >= MAX_COMPANIES_PER_TENANT) {
          console.log(`⚠️ Safety limit reached for tenant ${tenantId}: ${companiesInTenant} companies`);
          break;
        }
        
        if (companiesProcessed >= MAX_TOTAL_COMPANIES) {
          console.log(`⚠️ Global safety limit reached: ${companiesProcessed} total companies`);
          break;
        }

        let q = db.collection('tenants').doc(tenantId).collection('crm_companies').orderBy(admin.firestore.FieldPath.documentId()).limit(200) as FirebaseFirestore.Query;
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        
        if (snap.empty) {
          console.log(`✅ Completed processing tenant ${tenantId}: ${companiesInTenant} companies`);
          break;
        }
        
        for (const d of snap.docs) {
          const companyId = d.id;
          const map = await computeActiveSalespeople(tenantId, companyId);
          Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
          await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          companiesProcessed += 1;
          companiesInTenant += 1;
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

// Trigger updates when deals change - EMERGENCY: Aggressive filtering to prevent runaway costs
export const updateActiveSalespeopleOnDeal = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  // EMERGENCY: Apply sampling to prevent excessive calls
  if (Math.random() > 0.1) { // Only process 10% of deal updates
    return;
  }
  
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  
  // Skip if no relevant changes to associations
  if (before && after) {
    const beforeAssociations = JSON.stringify(before.associations || {});
    const afterAssociations = JSON.stringify(after.associations || {});
    const beforeCompanyId = before.companyId;
    const afterCompanyId = after.companyId;
    
    if (beforeAssociations === afterAssociations && beforeCompanyId === afterCompanyId) {
      return; // No relevant changes, skip processing
    }
  }
  
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
  
  // Also update contacts' active salespeople
  const contactIds: string[] = [];
  if (Array.isArray(after.contactIds)) after.contactIds.forEach((id: string) => contactIds.push(id));
  if (Array.isArray(after.associations?.contacts)) after.associations.contacts.forEach((c: any) => contactIds.push(typeof c === 'string' ? c : c?.id));
  const uniqueContactIds = Array.from(new Set(contactIds.filter(Boolean)));
  await Promise.all(uniqueContactIds.map(async (contactId) => {
    const map = await computeContactActiveSalespeople(tenantId, contactId);
    Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
    await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }));
});

// Trigger updates when tasks change - EMERGENCY: Aggressive filtering to prevent runaway costs
export const updateActiveSalespeopleOnTask = onDocumentUpdated('tenants/{tenantId}/tasks/{taskId}', async (event) => {
  // EMERGENCY: Apply sampling to prevent excessive calls
  if (Math.random() > 0.1) { // Only process 10% of task updates
    return;
  }
  
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  
  // Skip if no relevant changes to associations
  if (before && after) {
    const beforeAssociations = JSON.stringify(before.associations || {});
    const afterAssociations = JSON.stringify(after.associations || {});
    
    if (beforeAssociations === afterAssociations) {
      return; // No relevant changes, skip processing
    }
  }
  
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
  
  // Also update contacts' active salespeople
  contactIds.forEach(async (contactId: any) => {
    if (typeof contactId === 'string') {
      const map = await computeContactActiveSalespeople(tenantId, contactId);
      Object.keys(map).forEach((k) => { (map as any)[k] = removeUndefined((map as any)[k]); });
      await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set({ activeSalespeople: map, activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  });
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


