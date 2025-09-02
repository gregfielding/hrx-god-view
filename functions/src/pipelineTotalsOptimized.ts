import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Pipeline Totals System
 * 
 * This system replaces the problematic automatic pipeline totals updates
 * that were causing cascading location document updates and triggering
 * excessive function invocations.
 */

// Configuration for optimized pipeline totals
const PIPELINE_CONFIG = {
  // Rate limiting
  MAX_UPDATES_PER_HOUR_PER_COMPANY: 3, // Prevent excessive updates for the same company
  MAX_UPDATES_PER_HOUR_GLOBAL: 20,     // Global rate limit
  
  // Processing limits
  MAX_DEALS_PER_COMPANY: 1000,         // Limit deals processed per company
  MAX_LOCATIONS_PER_COMPANY: 100,      // Limit locations processed per company
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.5,                  // Only process 50% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 10 * 60 * 1000, // 10 minutes loop prevention
};

// Interfaces for type safety
interface PipelineTotals {
  low: number;
  high: number;
  dealCount: number;
}

interface ClosedTotals {
  total: number;
  dealCount: number;
}

interface LocationTotals {
  pipelineValue: PipelineTotals;
  closedValue: ClosedTotals;
}

interface DivisionTotals {
  [divisionName: string]: {
    pipelineValue: PipelineTotals;
    closedValue: ClosedTotals;
    locations: string[];
  };
}

interface CompanyTotals {
  pipelineValue: PipelineTotals;
  closedValue: ClosedTotals;
  divisions: DivisionTotals;
  locations: LocationTotals[];
}

/**
 * Calculate expected revenue range from deal stage data
 */
function calculateExpectedRevenueRange(stageData: any): { min: number; max: number; hasData: boolean } {
  if (!stageData || typeof stageData !== 'object') {
    return { min: 0, max: 0, hasData: false };
  }

  let startingCount = 0;
  let after180DaysCount = 0;

  // Count deals in different stages
  Object.values(stageData).forEach((stage: any) => {
    if (stage && typeof stage === 'object' && stage.count) {
      if (stage.stage === 'starting' || stage.stage === 'qualification') {
        startingCount += stage.count;
      } else if (stage.stage === 'after180Days') {
        after180DaysCount += stage.count;
      }
    }
  });

  // Calculate revenue ranges based on stage counts
  const startingRevenue = startingCount * 50000; // $50k average for starting deals
  const after180DaysRevenue = after180DaysCount * 150000; // $150k average for later stage deals

  return {
    min: startingRevenue + after180DaysRevenue,
    max: startingRevenue * 1.5 + after180DaysRevenue * 2,
    hasData: startingCount > 0 || after180DaysCount > 0
  };
}

/**
 * Check rate limiting for pipeline updates
 */
async function checkRateLimiting(companyId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Check global rate limiting
    const globalKey = `pipeline_update_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    const globalSnap = await globalRef.get();
    
    if (globalSnap.exists) {
      const globalData = globalSnap.data() as any;
      if (globalData.count >= PIPELINE_CONFIG.MAX_UPDATES_PER_HOUR_GLOBAL) {
        console.log('🚫 Global rate limit exceeded for pipeline updates');
        return false;
      }
    }
    
    // Check company-specific rate limiting
    const companyKey = `pipeline_update_rate_limit:company:${companyId}:${hourKey}`;
    const companyRef = db.collection('ai_cache').doc(companyKey);
    const companySnap = await companyRef.get();
    
    if (companySnap.exists) {
      const companyData = companySnap.data() as any;
      if (companyData.count >= PIPELINE_CONFIG.MAX_UPDATES_PER_HOUR_PER_COMPANY) {
        console.log(`🚫 Company rate limit exceeded for pipeline updates: ${companyId}`);
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
async function updateRateLimiting(companyId: string): Promise<void> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Update global counter
    const globalKey = `pipeline_update_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    await globalRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Update company counter
    const companyKey = `pipeline_update_rate_limit:company:${companyId}:${hourKey}`;
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
 * Check for potential infinite loops
 */
async function checkForLoop(tenantId: string, companyId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const loopKey = `loop_prevention:pipeline:${companyId}:${now}`;
    const loopRef = db.collection('ai_cache').doc(loopKey);
    
    // Check if we've processed this company recently
    const loopSnap = await loopRef.get();
    if (loopSnap.exists) {
      const loopData = loopSnap.data() as any;
      if (loopData.updatedAt && (now - loopData.updatedAt.toMillis()) < PIPELINE_CONFIG.LOOP_PREVENTION_TTL) {
        console.log(`🚫 Loop prevention: Company ${companyId} processed too recently`);
        return true; // Potential loop detected
      }
    }
    
    return false; // No loop detected
  } catch (error) {
    console.error('Error checking for loops:', error);
    return true; // Fail safe - assume loop if we can't check
  }
}

/**
 * Mark company as recently updated to prevent loops
 */
async function markCompanyAsUpdated(companyId: string): Promise<void> {
  try {
    const now = Date.now();
    const loopKey = `loop_prevention:pipeline:${companyId}:${now}`;
    const loopRef = db.collection('ai_cache').doc(loopKey);
    
    await loopRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: 'pipelineTotalsOptimized'
    });
  } catch (error) {
    console.error('Error marking company as updated:', error);
  }
}

/**
 * Calculate location totals without updating location documents
 */
function calculateLocationTotals(location: any, deals: any[]): LocationTotals {
  const locationDeals = deals.filter(deal => deal.locationId === location.id);
  
  // Calculate pipeline deals for this location
  const pipelineDeals = locationDeals.filter(deal => 
    deal.status !== 'closed' && deal.status !== 'lost'
  );
  
  let locationPipelineLow = 0;
  let locationPipelineHigh = 0;
  
  pipelineDeals.forEach(deal => {
    const revenueRange = calculateExpectedRevenueRange(deal.stageData);
    if (revenueRange.hasData) {
      locationPipelineLow += revenueRange.min;
      locationPipelineHigh += revenueRange.max;
    }
  });

  // Calculate closed deals for this location
  const closedDeals = locationDeals.filter(deal => 
    deal.status === 'closed'
  );
  
  let locationClosedValue = 0;
  
  closedDeals.forEach(deal => {
    const revenueRange = calculateExpectedRevenueRange(deal.stageData);
    if (revenueRange.hasData) {
      locationClosedValue += (revenueRange.min + revenueRange.max) / 2;
    }
  });

  return {
    pipelineValue: {
      low: locationPipelineLow,
      high: locationPipelineHigh,
      dealCount: pipelineDeals.length
    },
    closedValue: {
      total: locationClosedValue,
      dealCount: closedDeals.length
    }
  };
}

/**
 * Optimized callable function for updating company pipeline totals
 * This function does NOT update location documents, preventing the cascade
 * that was causing onCompanyLocationUpdated spikes
 */
export const updateCompanyPipelineTotalsCallable = onCall({
  timeoutSeconds: 120, // 2 minutes for pipeline calculations
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

    console.log('🔍 Company pipeline totals update requested', {
      tenantId,
      companyId,
      requestedBy: request.auth.uid,
      force
    });

    // Check rate limiting (unless forced)
    if (!force && !(await checkRateLimiting(companyId))) {
      return {
        success: false,
        message: 'Rate limit exceeded for this company',
        rateLimited: true
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > PIPELINE_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping pipeline totals update due to sampling');
      return {
        success: true,
        message: 'Skipped due to sampling',
        sampled: true
      };
    }
    
    // Check for potential infinite loops
    if (await checkForLoop(tenantId, companyId)) {
      return {
        success: false,
        message: 'Potential infinite loop detected, skipping update',
        loopDetected: true
      };
    }
    
    // Mark company as updated to prevent loops
    await markCompanyAsUpdated(companyId);
    
    // Get company data
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companyDoc = await companyRef.get();
    
    if (!companyDoc.exists) {
      throw new Error(`Company ${companyId} not found`);
    }
    
    // Get all deals for this company (with limit)
    const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
    const dealsQuery = dealsRef.where('companyId', '==', companyId).limit(PIPELINE_CONFIG.MAX_DEALS_PER_COMPANY);
    const dealsSnapshot = await dealsQuery.get();
    
    const deals = dealsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Get company locations (with limit)
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    const locationsQuery = locationsRef.limit(PIPELINE_CONFIG.MAX_LOCATIONS_PER_COMPANY);
    const locationsSnapshot = await locationsQuery.get();
    
    const locations = locationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Initialize totals structure
    const companyTotals: CompanyTotals = {
      pipelineValue: { low: 0, high: 0, dealCount: 0 },
      closedValue: { total: 0, dealCount: 0 },
      divisions: {},
      locations: []
    };

    // Calculate totals for each location (WITHOUT updating location documents)
    const locationTotals: { [locationId: string]: LocationTotals } = {};
    
    for (const location of locations) {
      const locationTotal = calculateLocationTotals(location, deals);
      locationTotals[location.id] = locationTotal;
      companyTotals.locations.push(locationTotal);

      // Aggregate to divisions if location has a division
      if (location.division) {
        if (!companyTotals.divisions[location.division]) {
          companyTotals.divisions[location.division] = {
            pipelineValue: { low: 0, high: 0, dealCount: 0 },
            closedValue: { total: 0, dealCount: 0 },
            locations: []
          };
        }
        
        const division = companyTotals.divisions[location.division];
        division.pipelineValue.low += locationTotal.pipelineValue.low;
        division.pipelineValue.high += locationTotal.pipelineValue.high;
        division.pipelineValue.dealCount += locationTotal.pipelineValue.dealCount;
        division.closedValue.total += locationTotal.closedValue.total;
        division.closedValue.dealCount += locationTotal.closedValue.dealCount;
        division.locations.push(location.id);
      }

      // Aggregate to company totals
      companyTotals.pipelineValue.low += locationTotal.pipelineValue.low;
      companyTotals.pipelineValue.high += locationTotal.pipelineValue.high;
      companyTotals.pipelineValue.dealCount += locationTotal.pipelineValue.dealCount;
      companyTotals.closedValue.total += locationTotal.closedValue.total;
      companyTotals.closedValue.dealCount += locationTotal.closedValue.dealCount;
    }

    // Update company document with totals (this is safe - won't trigger location updates)
    await companyRef.update({
      pipelineValue: companyTotals.pipelineValue,
      closedValue: companyTotals.closedValue,
      divisions: companyTotals.divisions,
      locations: companyTotals.locations,
      pipelineUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: 'pipelineTotalsOptimized',
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update rate limiting counters
    await updateRateLimiting(companyId);
    
    console.log('✅ Company pipeline totals updated successfully', {
      companyId,
      tenantId,
      summary: {
        total: companyTotals.pipelineValue.dealCount,
        pipeline: companyTotals.pipelineValue,
        closed: companyTotals.closedValue,
        divisions: Object.keys(companyTotals.divisions).length,
        locations: companyTotals.locations.length
      }
    });

    return {
      success: true,
      message: 'Company pipeline totals updated successfully',
      companyTotals,
      summary: {
        total: companyTotals.pipelineValue.dealCount,
        pipeline: companyTotals.pipelineValue,
        closed: companyTotals.closedValue,
        divisions: Object.keys(companyTotals.divisions).length,
        locations: companyTotals.locations.length
      }
    };

  } catch (error) {
    console.error('Error in updateCompanyPipelineTotalsCallable:', error);
    throw new Error(`Company pipeline totals update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch update multiple companies' pipeline totals
 */
export const batchUpdateCompanyPipelineTotalsCallable = onCall({
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
    
    if (companyIds.length > 20) {
      throw new Error('Maximum 20 companies per batch');
    }

    console.log('🔍 Batch company pipeline totals update requested', {
      tenantId,
      companyCount: companyIds.length,
      requestedBy: request.auth.uid,
      force
    });

    const results = [];
    
    // Process companies sequentially to avoid overwhelming the system
    for (const companyId of companyIds) {
      try {
        // Check rate limiting for each company
        if (!force && !(await checkRateLimiting(companyId))) {
          results.push({
            companyId,
            success: false,
            message: 'Rate limit exceeded',
            rateLimited: true
          });
          continue;
        }
        
        // Check for loops
        if (await checkForLoop(tenantId, companyId)) {
          results.push({
            companyId,
            success: false,
            message: 'Potential infinite loop detected',
            loopDetected: true
          });
          continue;
        }
        
        // Mark company as updated to prevent loops
        await markCompanyAsUpdated(companyId);
        
        // Get company data
        const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
        const companyDoc = await companyRef.get();
        
        if (!companyDoc.exists) {
          results.push({
            companyId,
            success: false,
            message: 'Company not found'
          });
          continue;
        }
        
        // Get deals and locations (with limits)
        const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
        const dealsQuery = dealsRef.where('companyId', '==', companyId).limit(PIPELINE_CONFIG.MAX_DEALS_PER_COMPANY);
        const dealsSnapshot = await dealsQuery.get();
        
        const deals = dealsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as any[];

        const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
        const locationsQuery = locationsRef.limit(PIPELINE_CONFIG.MAX_LOCATIONS_PER_COMPANY);
        const locationsSnapshot = await locationsQuery.get();
        
        const locations = locationsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as any[];

        // Calculate totals (same logic as single company update)
        const companyTotals: CompanyTotals = {
          pipelineValue: { low: 0, high: 0, dealCount: 0 },
          closedValue: { total: 0, dealCount: 0 },
          divisions: {},
          locations: []
        };

        for (const location of locations) {
          const locationTotal = calculateLocationTotals(location, deals);
          companyTotals.locations.push(locationTotal);

          if (location.division) {
            if (!companyTotals.divisions[location.division]) {
              companyTotals.divisions[location.division] = {
                pipelineValue: { low: 0, high: 0, dealCount: 0 },
                closedValue: { total: 0, dealCount: 0 },
                locations: []
              };
            }
            
            const division = companyTotals.divisions[location.division];
            division.pipelineValue.low += locationTotal.pipelineValue.low;
            division.pipelineValue.high += locationTotal.pipelineValue.high;
            division.pipelineValue.dealCount += locationTotal.pipelineValue.dealCount;
            division.closedValue.total += locationTotal.closedValue.total;
            division.closedValue.dealCount += locationTotal.closedValue.dealCount;
            division.locations.push(location.id);
          }

          companyTotals.pipelineValue.low += locationTotal.pipelineValue.low;
          companyTotals.pipelineValue.high += locationTotal.pipelineValue.high;
          companyTotals.pipelineValue.dealCount += locationTotal.pipelineValue.dealCount;
          companyTotals.closedValue.total += locationTotal.closedValue.total;
          companyTotals.closedValue.dealCount += locationTotal.closedValue.dealCount;
        }

        // Update company document
        await companyRef.update({
          pipelineValue: companyTotals.pipelineValue,
          closedValue: companyTotals.closedValue,
          divisions: companyTotals.divisions,
          locations: companyTotals.locations,
          pipelineUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          _processedBy: 'pipelineTotalsOptimized',
          _processedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update rate limiting
        await updateRateLimiting(companyId);
        
        results.push({
          companyId,
          success: true,
          summary: {
            total: companyTotals.pipelineValue.dealCount,
            pipeline: companyTotals.pipelineValue,
            closed: companyTotals.closedValue,
            divisions: Object.keys(companyTotals.divisions).length,
            locations: companyTotals.locations.length
          }
        });
        
      } catch (error) {
        console.error(`Error processing company ${companyId}:`, error);
        results.push({
          companyId,
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Small delay between companies
      if (companyIds.indexOf(companyId) < companyIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch company pipeline totals update completed', {
      totalCompanies: companyIds.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch update completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: companyIds.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchUpdateCompanyPipelineTotalsCallable:', error);
    throw new Error(`Batch company pipeline totals update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
