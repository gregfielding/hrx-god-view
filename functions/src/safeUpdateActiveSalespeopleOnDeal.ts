import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe active salespeople updates
const SAFE_CONFIG = {
  MAX_COMPANIES_PER_BATCH: 50,
  MAX_CONTACTS_PER_BATCH: 50,
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  BATCH_DELAY_MS: 200, // Small backoff between batches
  RELEVANT_FIELDS: ['companyId', 'companyIds', 'contactIds', 'associations', 'salespersonIds', 'salespeopleIds', 'salesOwnerId'],
  TAG: 'updateActiveSalespeopleOnDeal@v2'
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Check if relevant fields actually changed to prevent unnecessary updates
 * Per playbook §2.2: Change-only Processing
 */
function hasRelevantChanges(before: any, after: any): boolean {
  if (!before) return true; // New document
  
  return SAFE_CONFIG.RELEVANT_FIELDS.some(field => {
    const beforeValue = before[field];
    const afterValue = after[field];
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  });
}

/**
 * Extract unique company IDs from deal data
 */
function extractCompanyIds(dealData: any): string[] {
  const companyIds: string[] = [];
  
  // Single company ID
  if (dealData.companyId) companyIds.push(dealData.companyId);
  
  // Array of company IDs
  if (Array.isArray(dealData.companyIds)) {
    dealData.companyIds.forEach((id: string) => companyIds.push(id));
  }
  
  // Companies from associations
  if (Array.isArray(dealData.associations?.companies)) {
    dealData.associations.companies.forEach((c: any) => {
      const id = typeof c === 'string' ? c : c?.id;
      if (id) companyIds.push(id);
    });
  }
  
  return Array.from(new Set(companyIds.filter(Boolean)));
}

/**
 * Extract unique contact IDs from deal data
 */
function extractContactIds(dealData: any): string[] {
  const contactIds: string[] = [];
  
  // Array of contact IDs
  if (Array.isArray(dealData.contactIds)) {
    dealData.contactIds.forEach((id: string) => contactIds.push(id));
  }
  
  // Contacts from associations
  if (Array.isArray(dealData.associations?.contacts)) {
    dealData.associations.contacts.forEach((c: any) => {
      const id = typeof c === 'string' ? c : c?.id;
      if (id) contactIds.push(id);
    });
  }
  
  return Array.from(new Set(contactIds.filter(Boolean)));
}

/**
 * Safe batch operation with limits per playbook §2.6
 */
async function safeBatchOperation<T>(
  items: T[],
  operation: (batch: admin.firestore.WriteBatch, item: T) => void,
  batchSize: number = SAFE_CONFIG.MAX_COMPANIES_PER_BATCH
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = db.batch();
    const batchItems = items.slice(i, i + batchSize);
    
    batchItems.forEach(item => operation(batch, item));
    
    // Check safety limits before committing
    SafeFunctionUtils.checkSafetyLimits();
    
    await batch.commit();
    
    // Small backoff between batches per playbook §2.6
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.BATCH_DELAY_MS));
    }
  }
}

/**
 * Compute active salespeople for a company (simplified version)
 */
async function computeActiveSalespeopleSafely(tenantId: string, companyId: string): Promise<any> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('computeActiveSalespeople', 0.001);

    const activeIds = new Set<string>();
    const lastActiveMap: Record<string, number> = {};

    // Deals: salespeople connected to any deal for this company
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const [byField, byAssoc] = await Promise.all([
      SafeFunctionUtils.safeQuery(dealsRef.where('companyId', '==', companyId), 100),
      SafeFunctionUtils.safeQuery(dealsRef.where('companyIds', 'array-contains' as any, companyId), 100)
    ]);
    
    const dealDocs = [...byField, ...byAssoc];
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

    // Build snapshot map (simplified)
    const snapshots: Record<string, any> = {};
    await Promise.all(
      Array.from(activeIds).slice(0, 50).map(async (sid) => { // Limit to 50 salespeople
        try {
          const userDoc = await db.collection('users').doc(sid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            snapshots[sid] = {
              id: sid,
              displayName: userData?.displayName || userData?.firstName || userData?.email,
              email: userData?.email,
              lastActiveAt: lastActiveMap[sid] || Date.now()
            };
          }
        } catch (error) {
          console.warn(`Failed to get user snapshot for ${sid}:`, error);
        }
      })
    );

    return snapshots;
  } catch (error) {
    console.error('Error in computeActiveSalespeopleSafely:', error);
    return {};
  }
}

/**
 * Compute active salespeople for a contact (simplified version)
 */
async function computeContactActiveSalespeopleSafely(tenantId: string, contactId: string): Promise<any> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('computeContactActiveSalespeople', 0.001);

    const activeIds = new Set<string>();
    const lastActiveMap: Record<string, number> = {};

    // Deals: salespeople connected to any deal for this contact
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const [assocSnap, contactIdsSnap] = await Promise.all([
      SafeFunctionUtils.safeQuery(dealsRef.where('associations.contacts', 'array-contains' as any, contactId), 100),
      SafeFunctionUtils.safeQuery(dealsRef.where('contactIds', 'array-contains' as any, contactId), 100)
    ]);
    
    const allDeals = [...assocSnap, ...contactIdsSnap];
    allDeals.forEach((d) => {
      const data: any = d.data() || {};
      
      const idSet = new Set<string>();
      // Legacy array of IDs
      (Array.isArray(data.salespersonIds) ? data.salespersonIds : []).forEach((sid: string) => {
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
      if (data.salesOwnerId) idSet.add(data.salesOwnerId);

      Array.from(idSet).filter(Boolean).forEach((sid) => {
        activeIds.add(sid);
        const ts = (data.updatedAt?.toMillis?.() ? data.updatedAt.toMillis() : Date.now());
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      });
    });

    // Build snapshot map (simplified)
    const snapshots: Record<string, any> = {};
    await Promise.all(
      Array.from(activeIds).slice(0, 50).map(async (sid) => { // Limit to 50 salespeople
        try {
          const userDoc = await db.collection('users').doc(sid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            snapshots[sid] = {
              id: sid,
              displayName: userData?.displayName || userData?.firstName || userData?.email,
              email: userData?.email,
              lastActiveAt: lastActiveMap[sid] || Date.now()
            };
          }
        } catch (error) {
          console.warn(`Failed to get user snapshot for ${sid}:`, error);
        }
      })
    );

    return snapshots;
  } catch (error) {
    console.error('Error in computeContactActiveSalespeopleSafely:', error);
    return {};
  }
}

/**
 * Update company active salespeople safely
 */
async function updateCompanyActiveSalespeople(tenantId: string, companyId: string): Promise<void> {
  try {
    const map = await computeActiveSalespeopleSafely(tenantId, companyId);
    
    // Remove undefined values
    Object.keys(map).forEach((k) => { 
      if (map[k] === undefined) delete map[k]; 
    });
    
    await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set({
      activeSalespeople: map,
      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`Updated active salespeople for company ${companyId} in tenant ${tenantId}`);
  } catch (error) {
    console.error(`Error updating company active salespeople for ${companyId}:`, error);
  }
}

/**
 * Update contact active salespeople safely
 */
async function updateContactActiveSalespeople(tenantId: string, contactId: string): Promise<void> {
  try {
    const map = await computeContactActiveSalespeopleSafely(tenantId, contactId);
    
    // Remove undefined values
    Object.keys(map).forEach((k) => { 
      if (map[k] === undefined) delete map[k]; 
    });
    
    await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set({
      activeSalespeople: map,
      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`Updated active salespeople for contact ${contactId} in tenant ${tenantId}`);
  } catch (error) {
    console.error(`Error updating contact active salespeople for ${contactId}:`, error);
  }
}

/**
 * Safe version of updateActiveSalespeopleOnDeal with hardening playbook compliance
 */
const safeTrigger = createSafeFirestoreTrigger(
  async (event) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      const after = event.data?.after?.data();
      if (!after) {
        console.log('No after data, skipping active salespeople update');
        return;
      }

      const tenantId = event.params.tenantId as string;
      const dealId = event.params.dealId as string;

      // Self-write ignore per playbook §2.3
      if (after._processedBy === SAFE_CONFIG.TAG) {
        console.log('Ignoring self-write for active salespeople update');
        return;
      }

      // Check if relevant fields actually changed per playbook §2.2
      const before = event.data?.before?.data();
      if (!hasRelevantChanges(before, after)) {
        console.log('No relevant deal fields changed, skipping active salespeople update');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Extract company and contact IDs
      const companyIds = extractCompanyIds(after);
      const contactIds = extractContactIds(after);

      console.log(`Processing deal ${dealId}: ${companyIds.length} companies, ${contactIds.length} contacts`);

      // Update company active salespeople
      if (companyIds.length > 0) {
        // Use safe batch operation for companies
        await safeBatchOperation(companyIds, async (batch, companyId) => {
          const map = await computeActiveSalespeopleSafely(tenantId, companyId);
          Object.keys(map).forEach((k) => { 
            if (map[k] === undefined) delete map[k]; 
          });
          
          batch.set(db.doc(`tenants/${tenantId}/crm_companies/${companyId}`), {
            activeSalespeople: map,
            activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            _processedBy: SAFE_CONFIG.TAG,
            _processedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }, SAFE_CONFIG.MAX_COMPANIES_PER_BATCH);
      }

      // Update contact active salespeople
      if (contactIds.length > 0) {
        // Use safe batch operation for contacts
        await safeBatchOperation(contactIds, async (batch, contactId) => {
          const map = await computeContactActiveSalespeopleSafely(tenantId, contactId);
          Object.keys(map).forEach((k) => { 
            if (map[k] === undefined) delete map[k]; 
          });
          
          batch.set(db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`), {
            activeSalespeople: map,
            activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            _processedBy: SAFE_CONFIG.TAG,
            _processedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }, SAFE_CONFIG.MAX_CONTACTS_PER_BATCH);
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Active salespeople update completed for deal ${dealId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in updateActiveSalespeopleOnDeal:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  }
);

export const updateActiveSalespeopleOnDeal = safeTrigger.onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}');
