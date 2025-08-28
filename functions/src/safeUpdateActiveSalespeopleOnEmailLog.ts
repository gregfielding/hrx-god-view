import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe email log processing
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'updateActiveSalespeopleOnEmailLog@v2',
  // Rate limiting
  MAX_EMAILS_PER_MINUTE: 10,
  MAX_COMPANIES_PER_BATCH: 5,
  MAX_CONTACTS_PER_BATCH: 10,
  BATCH_DELAY_MS: 1000, // 1 second between batches
  // Skip certain email types
  SKIP_EMAIL_TYPES: [
    'system',
    'notification',
    'automated'
  ]
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
 * Check if we should process this email log
 */
function shouldProcessEmailLog(data: any): boolean {
  // Skip system emails
  if (data.type && SAFE_CONFIG.SKIP_EMAIL_TYPES.includes(data.type)) {
    return false;
  }

  // Skip if no relevant data
  if (!data.matchingContacts && !data.contactId && !data.companyId && !data.associations) {
    return false;
  }

  return true;
}

/**
 * Extract contact and company IDs safely
 */
function extractIds(data: any): { contactIds: string[], companyIds: string[] } {
  const contactIds: string[] = [];
  const companyIds: string[] = [];

  // Collect contact IDs from various shapes
  try {
    if (Array.isArray(data.matchingContacts)) {
      data.matchingContacts.forEach((id: any) => {
        if (typeof id === 'string') contactIds.push(id);
      });
    }
    if (Array.isArray(data.associations?.contacts)) {
      data.associations.contacts.forEach((c: any) => {
        const id = typeof c === 'string' ? c : c?.id;
        if (typeof id === 'string') contactIds.push(id);
      });
    }
    if (typeof data.contactId === 'string') {
      contactIds.push(data.contactId);
    }
  } catch (error) {
    console.warn('Error extracting contact IDs:', error);
  }

  // Collect company IDs directly from the email log
  try {
    if (typeof data.companyId === 'string') {
      companyIds.push(data.companyId);
    }
    if (Array.isArray(data.associations?.companies)) {
      data.associations.companies.forEach((c: any) => {
        const id = typeof c === 'string' ? c : c?.id;
        if (typeof id === 'string') companyIds.push(id);
      });
    }
  } catch (error) {
    console.warn('Error extracting company IDs:', error);
  }

  return {
    contactIds: Array.from(new Set(contactIds.filter(Boolean))),
    companyIds: Array.from(new Set(companyIds.filter(Boolean)))
  };
}

/**
 * Resolve company IDs from contacts if needed
 */
async function resolveCompanyIdsFromContacts(tenantId: string, contactIds: string[]): Promise<string[]> {
  if (contactIds.length === 0) return [];

  const companyIds: string[] = [];
  const chunks: string[][] = [];
  
  // Split into batches
  for (let i = 0; i < contactIds.length; i += 10) {
    chunks.push(contactIds.slice(i, i + 10));
  }

  // Process each batch with delay
  for (const batch of chunks) {
    try {
      SafeFunctionUtils.checkSafetyLimits();
      
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

      // Add delay between batches
      if (chunks.indexOf(batch) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.BATCH_DELAY_MS));
      }
    } catch (error) {
      console.warn('Error resolving company IDs from contacts:', error);
    }
  }

  return Array.from(new Set(companyIds.filter(Boolean)));
}

/**
 * Update company active salespeople safely
 */
async function updateCompanyActiveSalespeople(tenantId: string, companyId: string): Promise<void> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('updateCompanyActiveSalespeople', 0.001);

    // Check for infinite loop
    const wouldLoop = await SafeFunctionUtils.checkForInfiniteLoop(
      `tenants/${tenantId}/crm_companies`,
      companyId,
      { activeSalespeople: {} }
    );

    if (wouldLoop) {
      console.warn(`Potential infinite loop detected for company ${companyId}, skipping update`);
      return;
    }

    // Simplified active salespeople computation
    const activeIds = new Set<string>();
    const lastActiveMap: Record<string, number> = {};

    // Get deals for this company (limited query)
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const dealSnap = await dealsRef.where('companyId', '==', companyId).limit(50).get();
    
    dealSnap.docs.forEach((d) => {
      const data: any = d.data() || {};
      const idSet = new Set<string>();
      
      if (Array.isArray(data.salespersonIds)) {
        data.salespersonIds.forEach((sid: string) => idSet.add(sid));
      }
      if (Array.isArray(data.associations?.salespeople)) {
        data.associations.salespeople.forEach((s: any) => idSet.add(typeof s === 'string' ? s : s?.id));
      }
      if (data.salesOwnerId) idSet.add(data.salesOwnerId);

      Array.from(idSet).filter(Boolean).forEach((sid) => {
        activeIds.add(sid);
        const ts = data.updatedAt?.toMillis?.() || Date.now();
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      });
    });

    // Build simplified snapshot
    const snapshots: Record<string, any> = {};
    const activeIdsArray = Array.from(activeIds).slice(0, 20); // Limit to 20 salespeople
    
    for (const sid of activeIdsArray) {
      try {
        const userSnap = await db.collection('tenants').doc(tenantId).collection('users').doc(sid).get();
        if (userSnap.exists) {
          const userData = userSnap.data();
          snapshots[sid] = {
            id: sid,
            displayName: userData?.displayName || userData?.name || 'Unknown',
            email: userData?.email || '',
            lastActiveAt: lastActiveMap[sid] || Date.now(),
            _processedBy: SAFE_CONFIG.TAG,
            _processedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        }
      } catch (error) {
        console.warn(`Error getting user data for ${sid}:`, error);
      }
    }

    // Update company document
    await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set({
      activeSalespeople: snapshots,
      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Updated active salespeople for company ${companyId}`);
  } catch (error) {
    console.error(`Error updating company active salespeople for ${companyId}:`, error);
  }
}

/**
 * Update contact active salespeople safely
 */
async function updateContactActiveSalespeople(tenantId: string, contactId: string): Promise<void> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('updateContactActiveSalespeople', 0.001);

    // Check for infinite loop
    const wouldLoop = await SafeFunctionUtils.checkForInfiniteLoop(
      `tenants/${tenantId}/crm_contacts`,
      contactId,
      { activeSalespeople: {} }
    );

    if (wouldLoop) {
      console.warn(`Potential infinite loop detected for contact ${contactId}, skipping update`);
      return;
    }

    // Simplified active salespeople computation for contacts
    const activeIds = new Set<string>();
    const lastActiveMap: Record<string, number> = {};

    // Get deals for this contact (limited query)
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const dealSnap = await dealsRef.where('contactIds', 'array-contains', contactId).limit(50).get();
    
    dealSnap.docs.forEach((d) => {
      const data: any = d.data() || {};
      const idSet = new Set<string>();
      
      if (Array.isArray(data.salespersonIds)) {
        data.salespersonIds.forEach((sid: string) => idSet.add(sid));
      }
      if (Array.isArray(data.associations?.salespeople)) {
        data.associations.salespeople.forEach((s: any) => idSet.add(typeof s === 'string' ? s : s?.id));
      }
      if (data.salesOwnerId) idSet.add(data.salesOwnerId);

      Array.from(idSet).filter(Boolean).forEach((sid) => {
        activeIds.add(sid);
        const ts = data.updatedAt?.toMillis?.() || Date.now();
        lastActiveMap[sid] = Math.max(lastActiveMap[sid] || 0, ts);
      });
    });

    // Build simplified snapshot
    const snapshots: Record<string, any> = {};
    const activeIdsArray = Array.from(activeIds).slice(0, 20); // Limit to 20 salespeople
    
    for (const sid of activeIdsArray) {
      try {
        const userSnap = await db.collection('tenants').doc(tenantId).collection('users').doc(sid).get();
        if (userSnap.exists) {
          const userData = userSnap.data();
          snapshots[sid] = {
            id: sid,
            displayName: userData?.displayName || userData?.name || 'Unknown',
            email: userData?.email || '',
            lastActiveAt: lastActiveMap[sid] || Date.now(),
            _processedBy: SAFE_CONFIG.TAG,
            _processedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        }
      } catch (error) {
        console.warn(`Error getting user data for ${sid}:`, error);
      }
    }

    // Update contact document
    await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set({
      activeSalespeople: snapshots,
      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Updated active salespeople for contact ${contactId}`);
  } catch (error) {
    console.error(`Error updating contact active salespeople for ${contactId}:`, error);
  }
}

/**
 * Safe version of updateActiveSalespeopleOnEmailLog with rate limiting and batching
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
      const data = event.data?.data();
      const tenantId = event.params.tenantId as string;
      const emailId = event.params.emailId as string;
      
      if (!data) {
        console.log('No email log data, skipping processing');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Check if we should process this email
      if (!shouldProcessEmailLog(data)) {
        console.log(`Skipping email log ${emailId} (filtered out)`);
        return;
      }

      // Extract IDs
      const { contactIds, companyIds } = extractIds(data);

      // Resolve company IDs from contacts if needed
      let resolvedCompanyIds = [...companyIds];
      if (companyIds.length === 0 && contactIds.length > 0) {
        const resolved = await resolveCompanyIdsFromContacts(tenantId, contactIds);
        resolvedCompanyIds = resolved;
      }

      const uniqueCompanyIds = Array.from(new Set(resolvedCompanyIds)).slice(0, SAFE_CONFIG.MAX_COMPANIES_PER_BATCH);
      const uniqueContactIds = Array.from(new Set(contactIds)).slice(0, SAFE_CONFIG.MAX_CONTACTS_PER_BATCH);

      console.log(`Processing email ${emailId}: ${uniqueCompanyIds.length} companies, ${uniqueContactIds.length} contacts`);

      // Update companies with batching and delays
      for (let i = 0; i < uniqueCompanyIds.length; i++) {
        if (abort.aborted) break;
        
        await updateCompanyActiveSalespeople(tenantId, uniqueCompanyIds[i]);
        
        // Add delay between updates
        if (i < uniqueCompanyIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.BATCH_DELAY_MS));
        }
      }

      // Update contacts with batching and delays
      for (let i = 0; i < uniqueContactIds.length; i++) {
        if (abort.aborted) break;
        
        await updateContactActiveSalespeople(tenantId, uniqueContactIds[i]);
        
        // Add delay between updates
        if (i < uniqueContactIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.BATCH_DELAY_MS));
        }
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Email log processing completed for ${emailId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in updateActiveSalespeopleOnEmailLog:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
    maxInstances: 3
  }
);

export const updateActiveSalespeopleOnEmailLog = safeTrigger.onDocumentCreated('tenants/{tenantId}/email_logs/{emailId}');
