import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Active Salespeople Update System
 * 
 * This system replaces the problematic Firestore trigger with a callable function
 * that only runs when explicitly needed, preventing infinite loops and cascading updates.
 */

// Configuration for optimized active salespeople updates
const UPDATE_CONFIG = {
  // Only update these specific fields (reduced scope to prevent loops)
  RELEVANT_FIELDS: ['companyId', 'companyIds', 'contactIds', 'salespersonIds', 'salesOwnerId'],
  
  // Batch processing limits
  MAX_COMPANIES_PER_BATCH: 20, // Reduced from unlimited to prevent runaway operations
  MAX_CONTACTS_PER_BATCH: 20,  // Reduced from unlimited to prevent runaway operations
  
  // Rate limiting
  MAX_UPDATES_PER_HOUR_PER_DEAL: 3, // Prevent excessive updates for the same deal
  MAX_UPDATES_PER_HOUR_GLOBAL: 30,  // Global rate limit
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.3, // Only process 30% of requests during high volume
  
  // Loop prevention
  MAX_RECURSIVE_DEPTH: 2, // Maximum depth of recursive updates
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
};

/**
 * Check if fields actually changed and are relevant
 */
function hasRelevantChanges(before: any, after: any): boolean {
  if (!before) return true; // New document
  
  return UPDATE_CONFIG.RELEVANT_FIELDS.some(field => {
    const beforeValue = before[field];
    const afterValue = after[field];
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  });
}

/**
 * Check rate limiting for update operations
 */
async function checkRateLimiting(dealId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Check global rate limiting
    const globalKey = `active_salespeople_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    const globalSnap = await globalRef.get();
    
    if (globalSnap.exists) {
      const globalData = globalSnap.data() as any;
      if (globalData.count >= UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_GLOBAL) {
        console.log('🚫 Global rate limit exceeded for active salespeople updates');
        return false;
      }
    }
    
    // Check deal-specific rate limiting
    const dealKey = `active_salespeople_rate_limit:deal:${dealId}:${hourKey}`;
    const dealRef = db.collection('ai_cache').doc(dealKey);
    const dealSnap = await dealRef.get();
    
    if (dealSnap.exists) {
      const dealData = dealSnap.data() as any;
      if (dealData.count >= UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_PER_DEAL) {
        console.log(`🚫 Deal rate limit exceeded for active salespeople updates: ${dealId}`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error checking rate limiting:', error);
    return false; // Fail safe - don't process if we can't check rate limits
  }
}

/**
 * Update rate limiting counters
 */
async function updateRateLimiting(dealId: string): Promise<void> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Update global counter
    const globalKey = `active_salespeople_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    await globalRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Update deal counter
    const dealKey = `active_salespeople_rate_limit:deal:${dealId}:${hourKey}`;
    const dealRef = db.collection('ai_cache').doc(dealKey);
    await dealRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error updating rate limiting:', error);
  }
}

/**
 * Check for potential infinite loops
 */
async function checkForLoop(tenantId: string, dealId: string, companyIds: string[], contactIds: string[]): Promise<boolean> {
  try {
    const now = Date.now();
    const loopKey = `loop_prevention:${dealId}:${now}`;
    const loopRef = db.collection('ai_cache').doc(loopKey);
    
    // Check if we've processed this deal recently
    const loopSnap = await loopRef.get();
    if (loopSnap.exists) {
      const loopData = loopSnap.data() as any;
      if (loopData.updatedAt && (now - loopData.updatedAt.toMillis()) < UPDATE_CONFIG.LOOP_PREVENTION_TTL) {
        console.log(`🚫 Loop prevention: Deal ${dealId} processed too recently`);
        return true; // Potential loop detected
      }
    }
    
    // Check if any of the target entities have been updated by this function recently
    const entitiesToCheck = [...companyIds, ...contactIds];
    for (const entityId of entitiesToCheck) {
      const entityKey = `loop_prevention:entity:${entityId}:${now}`;
      const entityRef = db.collection('ai_cache').doc(entityKey);
      const entitySnap = await entityRef.get();
      
      if (entitySnap.exists) {
        const entityData = entitySnap.data() as any;
        if (entityData.updatedAt && (now - entityData.updatedAt.toMillis()) < UPDATE_CONFIG.LOOP_PREVENTION_TTL) {
          console.log(`🚫 Loop prevention: Entity ${entityId} updated too recently`);
          return true; // Potential loop detected
        }
      }
    }
    
    return false; // No loop detected
  } catch (error) {
    console.error('Error checking for loops:', error);
    return true; // Fail safe - assume loop if we can't check
  }
}

/**
 * Mark entities as recently updated to prevent loops
 */
async function markEntitiesAsUpdated(dealId: string, companyIds: string[], contactIds: string[]): Promise<void> {
  try {
    const now = Date.now();
    const batch = db.batch();
    
    // Mark deal as processed
    const dealKey = `loop_prevention:${dealId}:${now}`;
    const dealRef = db.collection('ai_cache').doc(dealKey);
    batch.set(dealRef, {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: 'updateActiveSalespeopleOnDealOptimized'
    });
    
    // Mark entities as updated
    const entitiesToMark = [...companyIds, ...contactIds];
    for (const entityId of entitiesToMark) {
      const entityKey = `loop_prevention:entity:${entityId}:${now}`;
      const entityRef = db.collection('ai_cache').doc(entityKey);
      batch.set(entityRef, {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: 'updateActiveSalespeopleOnDealOptimized'
      });
    }
    
    await batch.commit();
  } catch (error) {
    console.error('Error marking entities as updated:', error);
  }
}

/**
 * Compute active salespeople for a company (simplified, loop-safe version)
 */
async function computeActiveSalespeopleSafely(tenantId: string, companyId: string): Promise<any> {
  try {
    const activeIds = new Set<string>();
    const lastActiveMap: Record<string, number> = {};

    // Get deals for this company (limited query to prevent runaway operations)
    const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
    const [byField, byAssoc] = await Promise.all([
      dealsRef.where('companyId', '==', companyId).limit(50).get(),
      dealsRef.where('companyIds', 'array-contains', companyId).limit(50).get()
    ]);
    
    const dealDocs = [...byField.docs, ...byAssoc.docs];
    for (const d of dealDocs) {
      const data: any = d.data() || {};
      const idSet = new Set<string>();
      
      // Legacy array of IDs
      if (Array.isArray(data.salespersonIds)) {
        data.salespersonIds.forEach((sid: string) => idSet.add(sid));
      }
      
      // New associations array (objects or strings)
      if (Array.isArray(data.associations?.salespeople)) {
        data.associations.salespeople.forEach((s: any) => idSet.add(typeof s === 'string' ? s : s?.id));
      }
      
      // Single owner field
      if (data.salesOwnerId) idSet.add(data.salesOwnerId);

      Array.from(idSet).filter(Boolean).forEach((sid) => {
        activeIds.add(sid);
        const ts = data.updatedAt?.toMillis?.() || Date.now();
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      });
    }

    // Build snapshot map (simplified, limited to prevent runaway operations)
    const snapshots: Record<string, any> = {};
    const activeIdsArray = Array.from(activeIds).slice(0, 20); // Limit to 20 salespeople
    
    for (const sid of activeIdsArray) {
      try {
        const userDoc = await db.collection('users').doc(sid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          snapshots[sid] = {
            id: sid,
            displayName: userData?.displayName || [userData?.firstName, userData?.lastName].filter(Boolean).join(' ').trim() || userData?.email?.split('@')[0] || 'Unknown',
            firstName: userData?.firstName || '',
            lastName: userData?.lastName || '',
            email: userData?.email || '',
            lastActiveAt: lastActiveMap[sid] || Date.now(),
            _processedBy: 'updateActiveSalespeopleOnDealOptimized',
            _processedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        }
      } catch (error) {
        console.warn(`Failed to get user data for ${sid}:`, error);
      }
    }

    return snapshots;
  } catch (error) {
    console.error(`Error computing active salespeople for company ${companyId}:`, error);
    return {};
  }
}

/**
 * Compute active salespeople for a contact (simplified, loop-safe version)
 */
async function computeContactActiveSalespeopleSafely(tenantId: string, contactId: string): Promise<any> {
  try {
    const activeIds = new Set<string>();
    const lastActiveMap: Record<string, number> = {};

    // Get deals for this contact (limited query to prevent runaway operations)
    const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
    const [assocSnap, contactIdsSnap] = await Promise.all([
      dealsRef.where('associations.contacts', 'array-contains', contactId).limit(50).get(),
      dealsRef.where('contactIds', 'array-contains', contactId).limit(50).get()
    ]);
    
    const allDeals = [...assocSnap.docs, ...contactIdsSnap.docs];
    allDeals.forEach((d) => {
      const data: any = d.data() || {};
      
      const idSet = new Set<string>();
      // Legacy array of IDs
      if (Array.isArray(data.salespersonIds)) {
        data.salespersonIds.forEach((sid: string) => {
          if (typeof sid === 'string' && sid.trim()) {
            idSet.add(sid.trim());
          }
        });
      }
      
      // New associations array (objects or strings)
      if (Array.isArray(data.associations?.salespeople)) {
        data.associations.salespeople.forEach((s: any) => {
          const id = typeof s === 'string' ? s : s?.id;
          if (typeof id === 'string' && id.trim()) {
            idSet.add(id.trim());
          }
        });
      }
      
      // Single owner field
      if (data.salesOwnerId) idSet.add(data.salesOwnerId);

      Array.from(idSet).filter(Boolean).forEach((sid) => {
        activeIds.add(sid);
        const ts = data.updatedAt?.toMillis?.() || Date.now();
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      });
    });

    // Build snapshot map (simplified, limited to prevent runaway operations)
    const snapshots: Record<string, any> = {};
    const activeIdsArray = Array.from(activeIds).slice(0, 20); // Limit to 20 salespeople
    
    for (const sid of activeIdsArray) {
      try {
        const userDoc = await db.collection('users').doc(sid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          snapshots[sid] = {
            id: sid,
            displayName: userData?.displayName || [userData?.firstName, userData?.lastName].filter(Boolean).join(' ').trim() || userData?.email?.split('@')[0] || 'Unknown',
            firstName: userData?.firstName || '',
            lastName: userData?.lastName || '',
            email: userData?.email || '',
            lastActiveAt: lastActiveMap[sid] || Date.now(),
            _processedBy: 'updateActiveSalespeopleOnDealOptimized',
            _processedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        }
      } catch (error) {
        console.warn(`Failed to get user data for ${sid}:`, error);
      }
    }

    return snapshots;
  } catch (error) {
    console.error(`Error computing active salespeople for contact ${contactId}:`, error);
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
      _processedBy: 'updateActiveSalespeopleOnDealOptimized',
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
      _processedBy: 'updateActiveSalespeopleOnDealOptimized',
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`Updated active salespeople for contact ${contactId} in tenant ${tenantId}`);
  } catch (error) {
    console.error(`Error updating contact active salespeople for ${contactId}:`, error);
  }
}

/**
 * Optimized callable function for updating active salespeople on deal changes
 * Only runs when explicitly called, preventing infinite loops and cascading updates
 */
export const updateActiveSalespeopleOnDealCallable = onCall({
  timeoutSeconds: 120, // 2 minutes for batch operations
  memory: '512MiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { tenantId, dealId, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !dealId) {
      throw new Error('tenantId and dealId are required');
    }

    console.log('🔍 Active salespeople update requested for deal', {
      tenantId,
      dealId,
      requestedBy: request.auth.uid,
      force
    });

    // Get deal data to check what changed
    const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${dealId}`);
    const dealSnap = await dealRef.get();
    
    if (!dealSnap.exists) {
      throw new Error('Deal not found');
    }
    
    const dealData = dealSnap.data();
    
    // Check rate limiting (unless forced)
    if (!force && !(await checkRateLimiting(dealId))) {
      return {
        success: false,
        message: 'Rate limit exceeded for this deal',
        rateLimited: true
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > UPDATE_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping active salespeople update due to sampling');
      return {
        success: true,
        message: 'Skipped due to sampling',
        sampled: true
      };
    }
    
    // Extract company and contact IDs
    const companyIds: string[] = [];
    if (dealData.companyId) companyIds.push(dealData.companyId);
    if (Array.isArray(dealData.companyIds)) dealData.companyIds.forEach((id: string) => companyIds.push(id));
    if (Array.isArray(dealData.associations?.companies)) {
      dealData.associations.companies.forEach((c: any) => companyIds.push(typeof c === 'string' ? c : c?.id));
    }
    const uniqueCompanyIds = Array.from(new Set(companyIds.filter(Boolean))).slice(0, UPDATE_CONFIG.MAX_COMPANIES_PER_BATCH);
    
    const contactIds: string[] = [];
    if (Array.isArray(dealData.contactIds)) dealData.contactIds.forEach((id: string) => contactIds.push(id));
    if (Array.isArray(dealData.associations?.contacts)) {
      dealData.associations.contacts.forEach((c: any) => contactIds.push(typeof c === 'string' ? c : c?.id));
    }
    const uniqueContactIds = Array.from(new Set(contactIds.filter(Boolean))).slice(0, UPDATE_CONFIG.MAX_CONTACTS_PER_BATCH);
    
    console.log(`Processing deal ${dealId}: ${uniqueCompanyIds.length} companies, ${uniqueContactIds.length} contacts`);
    
    // Check for potential infinite loops
    if (await checkForLoop(tenantId, dealId, uniqueCompanyIds, uniqueContactIds)) {
      return {
        success: false,
        message: 'Potential infinite loop detected, skipping update',
        loopDetected: true
      };
    }
    
    // Mark entities as updated to prevent loops
    await markEntitiesAsUpdated(dealId, uniqueCompanyIds, uniqueContactIds);
    
    // Update company active salespeople
    const companyResults = [];
    for (const companyId of uniqueCompanyIds) {
      try {
        await updateCompanyActiveSalespeople(tenantId, companyId);
        companyResults.push({ companyId, success: true });
      } catch (error) {
        console.error(`Failed to update company ${companyId}:`, error);
        companyResults.push({ companyId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
    
    // Update contact active salespeople
    const contactResults = [];
    for (const contactId of uniqueContactIds) {
      try {
        await updateContactActiveSalespeople(tenantId, contactId);
        contactResults.push({ contactId, success: true });
      } catch (error) {
        console.error(`Failed to update contact ${contactId}:`, error);
        contactResults.push({ contactId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
    
    // Update rate limiting counters
    await updateRateLimiting(dealId);
    
    const successCount = companyResults.filter(r => r.success).length + contactResults.filter(r => r.success).length;
    const failureCount = companyResults.filter(r => !r.success).length + contactResults.filter(r => !r.success).length;
    
    console.log('✅ Active salespeople update completed', {
      dealId,
      tenantId,
      companiesUpdated: companyResults.filter(r => r.success).length,
      contactsUpdated: contactResults.filter(r => r.success).length,
      totalSuccess: successCount,
      totalFailures: failureCount
    });
    
    return {
      success: true,
      message: 'Active salespeople update completed successfully',
      summary: {
        companies: { total: uniqueCompanyIds.length, successful: companyResults.filter(r => r.success).length, failed: companyResults.filter(r => !r.success).length },
        contacts: { total: uniqueContactIds.length, successful: contactResults.filter(r => r.success).length, failed: contactResults.filter(r => !r.success).length },
        totalSuccess: successCount,
        totalFailures: failureCount
      },
      results: {
        companies: companyResults,
        contacts: contactResults
      }
    };
    
  } catch (error) {
    console.error('Error in updateActiveSalespeopleOnDealCallable:', error);
    throw new Error(`Active salespeople update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
