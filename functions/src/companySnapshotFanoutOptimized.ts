import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Company Snapshot Fanout System
 * 
 * This system replaces the Firestore trigger with a callable function
 * that only runs when explicitly needed, preventing excessive invocations
 * and implementing intelligent batching.
 */

// Configuration for optimized company snapshot fanout
const FANOUT_CONFIG = {
  // Only update these specific fields (reduced from 10 to 3 most important)
  RELEVANT_FIELDS: ['companyName', 'name', 'industry'],
  
  // Batch processing limits
  MAX_DEALS_PER_BATCH: 100, // Reduced from 500 for better performance
  BATCH_DELAY_MS: 100, // Reduced delay between batches
  
  // Rate limiting
  MAX_UPDATES_PER_HOUR_PER_COMPANY: 5, // Prevent excessive updates
  MAX_UPDATES_PER_HOUR_GLOBAL: 50, // Global rate limit
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.5, // Only process 50% of requests during high volume
};

/**
 * Check if fields actually changed and are relevant
 */
function hasRelevantChanges(before: any, after: any): boolean {
  if (!before) return true; // New document
  
  return FANOUT_CONFIG.RELEVANT_FIELDS.some(field => {
    const beforeValue = before[field];
    const afterValue = after[field];
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  });
}

/**
 * Check rate limiting for fanout operations
 */
async function checkRateLimiting(companyId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Check global rate limiting
    const globalKey = `fanout_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    const globalSnap = await globalRef.get();
    
    if (globalSnap.exists) {
      const globalData = globalSnap.data() as any;
      if (globalData.count >= FANOUT_CONFIG.MAX_UPDATES_PER_HOUR_GLOBAL) {
        console.log('🚫 Global rate limit exceeded for company fanout');
        return false;
      }
    }
    
    // Check company-specific rate limiting
    const companyKey = `fanout_rate_limit:company:${companyId}:${hourKey}`;
    const companyRef = db.collection('ai_cache').doc(companyKey);
    const companySnap = await companyRef.get();
    
    if (companySnap.exists) {
      const companyData = companySnap.data() as any;
      if (companyData.count >= FANOUT_CONFIG.MAX_UPDATES_PER_HOUR_PER_COMPANY) {
        console.log(`🚫 Company rate limit exceeded for fanout: ${companyId}`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error checking rate limiting:', error);
    return false; // Fail safe - don't process if we can't check limits
  }
}

/**
 * Update rate limiting counters
 */
async function updateRateLimiting(companyId: string): Promise<void> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Update global counter
    const globalKey = `fanout_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    await globalRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Update company counter
    const companyKey = `fanout_rate_limit:company:${companyId}:${hourKey}`;
    const companyRef = db.collection('ai_cache').doc(companyKey);
    await companyRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error updating rate limiting:', error);
  }
}

/**
 * Safe batch operation with limits
 */
async function safeBatchOperation<T>(
  items: T[],
  operation: (batch: admin.firestore.WriteBatch, item: T) => void,
  batchSize: number = FANOUT_CONFIG.MAX_DEALS_PER_BATCH
): Promise<void> {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  for (let i = 0; i < batches.length; i++) {
    const batch = db.batch();
    batches[i].forEach(item => operation(batch, item));
    
    await batch.commit();
    console.log(`✅ Processed batch ${i + 1}/${batches.length} (${batches[i].length} items)`);
    
    // Small delay between batches to prevent overwhelming the system
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, FANOUT_CONFIG.BATCH_DELAY_MS));
    }
  }
}

/**
 * Update deals for company with safety measures
 */
async function updateDealsForCompany(
  tenantId: string,
  companyId: string,
  snapshotData: Record<string, any>
): Promise<{ updatedCount: number; totalDeals: number }> {
  const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
  
  // Query for deals associated with this company
  const dealsQuery = dealsRef.where('companyIds', 'array-contains', companyId);
  const dealsSnap = await dealsQuery.get();
  
  if (dealsSnap.empty) {
    console.log(`No deals found for company ${companyId} in tenant ${tenantId}`);
    return { updatedCount: 0, totalDeals: 0 };
  }
  
  const totalDeals = dealsSnap.size;
  console.log(`Found ${totalDeals} deals for company ${companyId}`);
  
  const dealsToUpdate: Array<{ doc: admin.firestore.QueryDocumentSnapshot; updatedAssociations: any }> = [];
  
  // Process deals and prepare updates
  dealsSnap.docs.forEach((dealDoc) => {
    const dealData: any = dealDoc.data() || {};
    const assocArr: any[] = (dealData.associations?.companies || []).slice();
    
    if (!Array.isArray(assocArr) || assocArr.length === 0) return;
    
    let changed = false;
    const updatedArr = assocArr.map((entry) => {
      if (typeof entry === 'string') {
        return entry; // Keep string form as-is
      }
      if (entry && entry.id === companyId) {
        const existingSnapshot = entry.snapshot || {};
        const nextSnapshot = { ...existingSnapshot, ...snapshotData };
        changed = true;
        return { ...entry, snapshot: nextSnapshot };
      }
      return entry;
    });
    
    if (changed) {
      const nextAssociations = {
        ...(dealData.associations || {}),
        companies: updatedArr,
      };
      
      dealsToUpdate.push({
        doc: dealDoc,
        updatedAssociations: nextAssociations
      });
    }
  });
  
  if (dealsToUpdate.length === 0) {
    console.log(`No deals need updating for company ${companyId}`);
    return { updatedCount: 0, totalDeals };
  }
  
  console.log(`Updating ${dealsToUpdate.length} deals for company ${companyId}`);
  
  // Use safe batch operation
  await safeBatchOperation(dealsToUpdate, (batch, item) => {
    batch.update(item.doc.ref, {
      associations: item.updatedAssociations,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: 'companySnapshotFanoutOptimized',
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  return { updatedCount: dealsToUpdate.length, totalDeals };
}

/**
 * Optimized callable function for company snapshot fanout
 * Only runs when explicitly called, preventing excessive invocations
 */
export const companySnapshotFanoutCallable = onCall({
  timeoutSeconds: 120, // 2 minutes for batch operations
  memory: '512MiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { tenantId, companyId, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !companyId) {
      throw new Error('tenantId and companyId are required');
    }

    console.log('🔍 Company snapshot fanout requested', {
      tenantId,
      companyId,
      requestedBy: request.auth.uid,
      force
    });

    // Get company data to check what changed
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companySnap = await companyRef.get();
    
    if (!companySnap.exists) {
      throw new Error('Company not found');
    }
    
    const companyData = companySnap.data();
    
    // Check rate limiting (unless forced)
    if (!force && !(await checkRateLimiting(companyId))) {
      return {
        success: false,
        message: 'Rate limit exceeded for this company',
        rateLimited: true
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > FANOUT_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping company fanout due to sampling');
      return {
        success: true,
        message: 'Skipped due to sampling',
        sampled: true
      };
    }
    
    // Prepare snapshot data (only relevant fields)
    const snapshotData = {
      name: companyData.companyName || companyData.name,
      industry: companyData.industry,
      // Only include fields that are actually present
      ...(companyData.city && { city: companyData.city }),
      ...(companyData.state && { state: companyData.state }),
      ...(companyData.phone && { phone: companyData.phone }),
      ...(companyData.website && { companyUrl: companyData.website }),
      ...(companyData.logo && { logo: companyData.logo })
    };
    
    // Remove undefined values
    const cleanSnapshotData = Object.fromEntries(
      Object.entries(snapshotData).filter(([, v]) => v !== undefined && v !== null)
    );
    
    console.log('Processing company snapshot data:', cleanSnapshotData);
    
    // Update deals with safety measures
    const result = await updateDealsForCompany(tenantId, companyId, cleanSnapshotData);
    
    // Update rate limiting counters
    await updateRateLimiting(companyId);
    
    console.log('✅ Company snapshot fanout completed', {
      companyId,
      tenantId,
      updatedDeals: result.updatedCount,
      totalDeals: result.totalDeals
    });
    
    return {
      success: true,
      message: 'Company snapshot fanout completed successfully',
      updatedDeals: result.updatedCount,
      totalDeals: result.totalDeals,
      snapshotData: cleanSnapshotData
    };
    
  } catch (error) {
    console.error('Error in company snapshot fanout:', error);
    throw new Error(`Company snapshot fanout failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch fanout for multiple companies (efficient bulk processing)
 */
export const batchCompanySnapshotFanoutCallable = onCall({
  timeoutSeconds: 300, // 5 minutes for bulk operations
  memory: '1GiB',
  maxInstances: 2
}, async (request) => {
  try {
    const { tenantId, companyIds, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !Array.isArray(companyIds) || companyIds.length === 0) {
      throw new Error('tenantId and companyIds array are required');
    }
    
    if (companyIds.length > 50) {
      throw new Error('Maximum 50 companies per batch');
    }

    console.log('🔍 Batch company snapshot fanout requested', {
      tenantId,
      companyCount: companyIds.length,
      requestedBy: request.auth.uid,
      force
    });

    const results = [];
    
    // Process companies in parallel with concurrency limit
    const concurrencyLimit = 5;
    for (let i = 0; i < companyIds.length; i += concurrencyLimit) {
      const batch = companyIds.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (companyId) => {
        try {
          // Check rate limiting for each company
          if (!force && !(await checkRateLimiting(companyId))) {
            return {
              companyId,
              success: false,
              message: 'Rate limit exceeded',
              rateLimited: true
            };
          }
          
          // Get company data
          const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
          const companySnap = await companyRef.get();
          
          if (!companySnap.exists) {
            return {
              companyId,
              success: false,
              message: 'Company not found'
            };
          }
          
          const companyData = companySnap.data();
          
          // Prepare snapshot data
          const snapshotData = {
            name: companyData.companyName || companyData.name,
            industry: companyData.industry,
            ...(companyData.city && { city: companyData.city }),
            ...(companyData.state && { state: companyData.state }),
            ...(companyData.phone && { phone: companyData.phone }),
            ...(companyData.website && { companyUrl: companyData.website }),
            ...(companyData.logo && { logo: companyData.logo })
          };
          
          const cleanSnapshotData = Object.fromEntries(
            Object.entries(snapshotData).filter(([, v]) => v !== undefined && v !== null)
          );
          
          // Update deals
          const result = await updateDealsForCompany(tenantId, companyId, cleanSnapshotData);
          
          // Update rate limiting
          await updateRateLimiting(companyId);
          
          return {
            companyId,
            success: true,
            updatedDeals: result.updatedCount,
            totalDeals: result.totalDeals,
            snapshotData: cleanSnapshotData
          };
          
        } catch (error) {
          console.error(`Error processing company ${companyId}:`, error);
          return {
            companyId,
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + concurrencyLimit < companyIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch company snapshot fanout completed', {
      totalCompanies: companyIds.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch fanout completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: companyIds.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batch company snapshot fanout:', error);
    throw new Error(`Batch company snapshot fanout failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
