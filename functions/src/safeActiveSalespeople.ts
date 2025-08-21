import * as admin from 'firebase-admin';
import { createSafeCallableFunction, createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Safe configuration
const SAFE_CONFIG = {
  MAX_COMPANIES_PER_TENANT: 1000,
  MAX_TOTAL_COMPANIES: 5000,
  BATCH_SIZE: 200,
  MAX_RECURSIVE_UPDATES: 2,
  UPDATE_COOLDOWN_MS: 5000, // 5 seconds between updates
};

// Track recent updates to prevent loops
const recentUpdates = new Map<string, number>();

/**
 * Safe version of computeActiveSalespeople with limits and checks
 */
async function computeActiveSalespeopleSafely(tenantId: string, companyId: string): Promise<any> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('computeActiveSalespeople', 0.001);

  try {
    // Check if we've updated this company recently
    const updateKey = `${tenantId}-${companyId}`;
    const lastUpdate = recentUpdates.get(updateKey) || 0;
    const timeSinceUpdate = Date.now() - lastUpdate;

    if (timeSinceUpdate < SAFE_CONFIG.UPDATE_COOLDOWN_MS) {
      console.log(`Skipping update for ${updateKey} - too recent`);
      return {};
    }

    // Check for infinite loop
    const wouldLoop = await SafeFunctionUtils.checkForInfiniteLoop(
      `tenants/${tenantId}/crm_companies`,
      companyId,
      { activeSalespeople: {} }
    );

    if (wouldLoop) {
      console.warn(`Potential infinite loop detected for company ${companyId}`);
      return {};
    }

    // Get company data directly
    const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get();

    if (!companyDoc.exists) {
      return {};
    }

    const companyData = companyDoc.data();
    if (!companyData) return {};

    // Get deals for this company with limits
    const dealsQuery = db.collection('tenants').doc(tenantId).collection('crm_deals')
      .where('companyId', '==', companyId)
      .where('status', 'in', ['active', 'negotiation', 'proposal']);

    const deals = await SafeFunctionUtils.safeQuery(dealsQuery, 100);

    // Get salespeople with limits
    const salespeopleQuery = db.collection('tenants').doc(tenantId).collection('crm_salespeople')
      .where('status', '==', 'active');

    const salespeople = await SafeFunctionUtils.safeQuery(salespeopleQuery, 50);

    // Compute active salespeople mapping
    const activeSalespeople: any = {};

    for (const deal of deals) {
      const dealData = deal.data();
      if (dealData.salespersonId && salespeople.some(sp => sp.id === dealData.salespersonId)) {
        activeSalespeople[dealData.salespersonId] = {
          dealId: deal.id,
          dealValue: dealData.value || 0,
          dealStage: dealData.stage || 'unknown',
          lastActivity: dealData.lastActivity || null
        };
      }
    }

    // Mark this update as recent
    recentUpdates.set(updateKey, Date.now());

    // Clean up old entries (keep only last 1000)
    if (recentUpdates.size > 1000) {
      const entries = Array.from(recentUpdates.entries());
      entries.sort((a, b) => b[1] - a[1]);
      const newMap = new Map(entries.slice(0, 1000));
      recentUpdates.clear();
      newMap.forEach((value, key) => recentUpdates.set(key, value));
    }

    return activeSalespeople;

  } catch (error) {
    console.error('Error in computeActiveSalespeopleSafely:', error);
    return {};
  }
}

/**
 * Safe version of rebuildAllCompanyActiveSalespeople
 */
export const rebuildAllCompanyActiveSalespeople = createSafeCallableFunction(async (request) => {
  const { tenantIds } = request;
  
  if (!tenantIds || !Array.isArray(tenantIds)) {
    throw new Error('tenantIds array required');
  }

  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  try {
    let companiesProcessed = 0;
    let totalUpdated = 0;

    for (const tenantId of tenantIds) {
      SafeFunctionUtils.checkSafetyLimits();
      
      let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;
      let companiesInTenant = 0;
      
      // Page through companies with safety limits
      while (true) {
        SafeFunctionUtils.checkSafetyLimits();
        
        // Check limits
        if (companiesInTenant >= SAFE_CONFIG.MAX_COMPANIES_PER_TENANT) {
          console.log(`⚠️ Safety limit reached for tenant ${tenantId}: ${companiesInTenant} companies`);
          break;
        }
        
        if (companiesProcessed >= SAFE_CONFIG.MAX_TOTAL_COMPANIES) {
          console.log(`⚠️ Global safety limit reached: ${companiesProcessed} total companies`);
          break;
        }

        // Query with limits
        let q = db.collection('tenants').doc(tenantId).collection('crm_companies')
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(SAFE_CONFIG.BATCH_SIZE);
          
        if (lastDoc) q = q.startAfter(lastDoc);
        
        const snap = await SafeFunctionUtils.safeQuery(q, SAFE_CONFIG.BATCH_SIZE);
        
        if (snap.length === 0) {
          console.log(`✅ Completed processing tenant ${tenantId}: ${companiesInTenant} companies`);
          break;
        }
        
        // Process companies in batches
        const companies = snap.map(doc => ({ id: doc.id, data: doc.data() }));
        
        await SafeFunctionUtils.safeBatchOperation(companies, async (batch, company) => {
          const map = await computeActiveSalespeopleSafely(tenantId, company.id);
          
          // Add safety metadata
          const updateData = SafeFunctionUtils.addSafetyMetadata({
            activeSalespeople: map,
            activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          batch.set(
            db.doc(`tenants/${tenantId}/crm_companies/${company.id}`),
            updateData,
            { merge: true }
          );
          
          companiesProcessed += 1;
          companiesInTenant += 1;
          totalUpdated += Object.keys(map).length;
          
          CostTracker.trackOperation('companyUpdate', 0.0005);
        });
        
        lastDoc = snap[snap.length - 1];
      }
    }

    const costSummary = CostTracker.getCostSummary();
    console.log(`Rebuild completed: ${companiesProcessed} companies, ${totalUpdated} updates, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return { 
      ok: true, 
      tenants: tenantIds.length, 
      companiesProcessed, 
      totalUpdated,
      costSummary
    };

  } catch (error) {
    console.error('rebuildAllCompanyActiveSalespeople error:', error);
    return { ok: false, error: (error as Error).message || 'unknown_error' };
  }
});

/**
 * Safe version of updateActiveSalespeopleOnDeal - with loop prevention
 */
export const updateActiveSalespeopleOnDeal = createSafeFirestoreTrigger(
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;

    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    try {
      const tenantId = event.params.tenantId as string;
      const dealId = event.params.dealId as string;

      // Check if this is a recursive update
      SafeFunctionUtils.incrementRecursiveCallCount();
      
      if (SafeFunctionUtils.incrementRecursiveCallCount() > SAFE_CONFIG.MAX_RECURSIVE_UPDATES) {
        console.warn(`Too many recursive updates for deal ${dealId}, skipping`);
        return;
      }

      // Check for infinite loop
      const wouldLoop = await SafeFunctionUtils.checkForInfiniteLoop(
        `tenants/${tenantId}/crm_deals`,
        dealId,
        { activeSalespeople: {} }
      );

      if (wouldLoop) {
        console.warn(`Potential infinite loop detected for deal ${dealId}, skipping update`);
        return;
      }

      const companyIds: string[] = [];
      if (after.companyId) companyIds.push(after.companyId);
      if (Array.isArray(after.companyIds)) after.companyIds.forEach((id: string) => companyIds.push(id));
      if (Array.isArray(after.associations?.companies)) after.associations.companies.forEach((c: any) => companyIds.push(typeof c === 'string' ? c : c?.id));
      
      const uniqueCompanyIds = Array.from(new Set(companyIds.filter(Boolean)));

      // Process companies with limits
      for (const companyId of uniqueCompanyIds.slice(0, 10)) { // Limit to 10 companies
        SafeFunctionUtils.checkSafetyLimits();
        
        const map = await computeActiveSalespeopleSafely(tenantId, companyId);
        
        // Add safety metadata
        const updateData = SafeFunctionUtils.addSafetyMetadata({
          activeSalespeople: map,
          activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set(updateData, { merge: true });
        CostTracker.trackOperation('companyUpdate', 0.0005);
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Deal update completed for ${uniqueCompanyIds.length} companies, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('updateActiveSalespeopleOnDeal error:', error);
      // Don't throw - Firestore triggers should fail gracefully
    }
  },
  {
    timeoutSeconds: 300, // 5 minutes
    memory: '256MiB',
    maxInstances: 5
  }
).onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}');

/**
 * Safe version of updateActiveSalespeopleOnTask - with loop prevention
 */
export const updateActiveSalespeopleOnTask = createSafeFirestoreTrigger(
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;

    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    try {
      const tenantId = event.params.tenantId as string;
      const taskId = event.params.taskId as string;

      // Check if this is a recursive update
      SafeFunctionUtils.incrementRecursiveCallCount();
      
      if (SafeFunctionUtils.incrementRecursiveCallCount() > SAFE_CONFIG.MAX_RECURSIVE_UPDATES) {
        console.warn(`Too many recursive updates for task ${taskId}, skipping`);
        return;
      }

      // Check for infinite loop
      const wouldLoop = await SafeFunctionUtils.checkForInfiniteLoop(
        `tenants/${tenantId}/tasks`,
        taskId,
        { activeSalespeople: {} }
      );

      if (wouldLoop) {
        console.warn(`Potential infinite loop detected for task ${taskId}, skipping update`);
        return;
      }

      const companyIds: any[] = Array.isArray(after.associations?.companies) ? after.associations.companies : [];
      const contactIds: any[] = Array.isArray(after.associations?.contacts) ? after.associations.contacts : [];
      
      const companySet = new Set<string>();
      companyIds.forEach((entry: any) => companySet.add(typeof entry === 'string' ? entry : entry?.id));

      // If only contacts are present, resolve their companies with limits
      if (companySet.size === 0 && contactIds.length > 0) {
        const contactChunks = [];
        for (let i = 0; i < Math.min(contactIds.length, 10); i += 10) {
          contactChunks.push(contactIds.slice(i, i + 10));
        }
        
        for (const batchIds of contactChunks) {
          SafeFunctionUtils.checkSafetyLimits();
          
          const snap = await SafeFunctionUtils.safeQuery(
            db.collection('tenants').doc(tenantId).collection('crm_contacts')
              .where(admin.firestore.FieldPath.documentId(), 'in' as any, batchIds as any),
            10
          );
          
          snap.forEach((d) => {
            const data: any = d.data() || {};
            if (Array.isArray(data.associations?.companies)) {
              data.associations.companies.forEach((c: any) => companySet.add(typeof c === 'string' ? c : c?.id));
            } else if (data.companyId) {
              companySet.add(data.companyId);
            }
          });
        }
      }

      const uniqueCompanyIds = Array.from(companySet).filter(Boolean).slice(0, 10); // Limit to 10 companies

      // Process companies with limits
      for (const companyId of uniqueCompanyIds) {
        SafeFunctionUtils.checkSafetyLimits();
        
        const map = await computeActiveSalespeopleSafely(tenantId, companyId);
        
        // Add safety metadata
        const updateData = SafeFunctionUtils.addSafetyMetadata({
          activeSalespeople: map,
          activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set(updateData, { merge: true });
        CostTracker.trackOperation('companyUpdate', 0.0005);
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Task update completed for ${uniqueCompanyIds.length} companies, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('updateActiveSalespeopleOnTask error:', error);
      // Don't throw - Firestore triggers should fail gracefully
    }
  },
  {
    timeoutSeconds: 300, // 5 minutes
    memory: '256MiB',
    maxInstances: 5
  }
).onDocumentUpdated('tenants/{tenantId}/tasks/{taskId}');

// Export individual rebuild functions
export const rebuildCompanyActiveSalespeople = createSafeCallableFunction(async (request) => {
  const { tenantId, companyId } = request;
  
  if (!tenantId || !companyId) {
    throw new Error('tenantId and companyId are required');
  }

  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  try {
    const map = await computeActiveSalespeopleSafely(tenantId, companyId);
    
    // Add safety metadata
    const updateData = SafeFunctionUtils.addSafetyMetadata({
      activeSalespeople: map,
      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set(updateData, { merge: true });
    
    const costSummary = CostTracker.getCostSummary();
    console.log(`Company rebuild completed, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return { 
      ok: true, 
      companyId, 
      activeSalespeopleCount: Object.keys(map).length,
      costSummary
    };

  } catch (error) {
    console.error('rebuildCompanyActiveSalespeople error:', error);
    return { ok: false, error: (error as Error).message || 'unknown_error' };
  }
});

export const rebuildContactActiveSalespeople = createSafeCallableFunction(async (request) => {
  const { tenantId, contactId } = request;
  
  if (!tenantId || !contactId) {
    throw new Error('tenantId and contactId are required');
  }

  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  try {
    // Get contact's companies
    const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
    if (!contactDoc.exists) {
      return { ok: false, error: 'Contact not found' };
    }

    const contactData = contactDoc.data();
    const companyIds: string[] = [];
    
    if (contactData?.companyId) companyIds.push(contactData.companyId);
    if (Array.isArray(contactData?.associations?.companies)) {
      contactData.associations.companies.forEach((c: any) => companyIds.push(typeof c === 'string' ? c : c?.id));
    }

    const uniqueCompanyIds = Array.from(new Set(companyIds.filter(Boolean)));

    // Update each company's active salespeople
    for (const companyId of uniqueCompanyIds.slice(0, 5)) { // Limit to 5 companies
      SafeFunctionUtils.checkSafetyLimits();
      
      const map = await computeActiveSalespeopleSafely(tenantId, companyId);
      
      // Add safety metadata
      const updateData = SafeFunctionUtils.addSafetyMetadata({
        activeSalespeople: map,
        activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).set(updateData, { merge: true });
      CostTracker.trackOperation('companyUpdate', 0.0005);
    }

    const costSummary = CostTracker.getCostSummary();
    console.log(`Contact rebuild completed for ${uniqueCompanyIds.length} companies, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return { 
      ok: true, 
      contactId, 
      companiesUpdated: uniqueCompanyIds.length,
      costSummary
    };

  } catch (error) {
    console.error('rebuildContactActiveSalespeople error:', error);
    return { ok: false, error: (error as Error).message || 'unknown_error' };
  }
});
