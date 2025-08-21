import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe deal updates
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  MAX_LOCATIONS_PER_BATCH: 50,
  BATCH_DELAY_MS: 200, // Small backoff between batches
  RELEVANT_FIELDS: ['status', 'stageData', 'locationId', 'companyId', 'value', 'amount'],
  TAG: 'onDealUpdated@v2'
};

// Type definitions
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
 * Calculate expected revenue range from qualification data
 */
function calculateExpectedRevenueRange(stageData: any): { min: number; max: number; hasData: boolean } {
  if (!stageData?.qualification) {
    return { min: 0, max: 0, hasData: false };
  }

  const qualData = stageData.qualification;
  const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
  const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
  const timeline = qualData.staffPlacementTimeline;

  if (!timeline) {
    return { min: 0, max: 0, hasData: false };
  }

  // Calculate bill rate: pay rate + markup
  const billRate = payRate * (1 + markup / 100);
  
  // Annual hours per employee (2080 full-time hours)
  const annualHoursPerEmployee = 2080;
  
  // Calculate annual revenue per employee
  const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
  
  // Get starting and 180-day numbers
  const startingCount = timeline.starting || 0;
  const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
  
  // Calculate revenue range
  const minRevenue = annualRevenuePerEmployee * startingCount;
  const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
  
  return {
    min: minRevenue,
    max: maxRevenue,
    hasData: startingCount > 0 || after180DaysCount > 0
  };
}

/**
 * Safe batch operation with limits per playbook §2.6
 */
async function safeBatchOperation<T>(
  items: T[],
  operation: (batch: admin.firestore.WriteBatch, item: T) => void,
  batchSize: number = SAFE_CONFIG.MAX_LOCATIONS_PER_BATCH
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
 * Calculate location totals safely
 */
async function calculateLocationTotals(
  tenantId: string, 
  companyId: string, 
  location: any, 
  deals: any[]
): Promise<LocationTotals> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('calculateLocationTotals', 0.001);

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
  } catch (error) {
    console.error(`Error calculating location totals for ${location.id}:`, error);
    return {
      pipelineValue: { low: 0, high: 0, dealCount: 0 },
      closedValue: { total: 0, dealCount: 0 }
    };
  }
}

/**
 * Update pipeline totals safely
 */
async function updatePipelineTotals(tenantId: string, companyId: string, dealId: string): Promise<void> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('updatePipelineTotals', 0.01);

    console.log(`🔄 Deal ${dealId} updated, triggering pipeline totals update for company ${companyId}`);

    // Get company data
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      console.log(`⚠️ Company ${companyId} not found, skipping pipeline update`);
      return;
    }
    
    // Get all deals for this company (limited to prevent runaway queries)
    const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
    const dealsQuery = dealsRef.where('companyId', '==', companyId).limit(1000);
    const dealsSnapshot = await dealsQuery.get();
    
    const deals = dealsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Get company locations (limited to prevent runaway queries)
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`).limit(100);
    const locationsSnapshot = await locationsRef.get();
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

    // Calculate totals for each location
    const locationTotals: { [locationId: string]: LocationTotals } = {};
    
    for (const location of locations) {
      const locationTotal = await calculateLocationTotals(tenantId, companyId, location, deals);
      locationTotals[location.id] = locationTotal;
      companyTotals.locations.push(locationTotal);

      // Update location document with its totals
      const locationRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${location.id}`);
      await locationRef.update({
        pipelineValue: locationTotal.pipelineValue,
        closedValue: locationTotal.closedValue,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        _processedBy: SAFE_CONFIG.TAG,
        _processedAt: admin.firestore.FieldValue.serverTimestamp()
      });

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

    // Handle deals without specific locations (aggregate to company level)
    const dealsWithoutLocation = deals.filter(deal => !deal.locationId);
    
    if (dealsWithoutLocation.length > 0) {
      const pipelineDeals = dealsWithoutLocation.filter(deal => 
        deal.status !== 'closed' && deal.status !== 'lost'
      );
      
      let companyPipelineLow = 0;
      let companyPipelineHigh = 0;
      
      pipelineDeals.forEach(deal => {
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        if (revenueRange.hasData) {
          companyPipelineLow += revenueRange.min;
          companyPipelineHigh += revenueRange.max;
        }
      });

      const closedDeals = dealsWithoutLocation.filter(deal => 
        deal.status === 'closed'
      );
      
      let companyClosedValue = 0;
      
      closedDeals.forEach(deal => {
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        if (revenueRange.hasData) {
          companyClosedValue += (revenueRange.min + revenueRange.max) / 2;
        }
      });

      // Add to company totals
      companyTotals.pipelineValue.low += companyPipelineLow;
      companyTotals.pipelineValue.high += companyPipelineHigh;
      companyTotals.pipelineValue.dealCount += pipelineDeals.length;
      companyTotals.closedValue.total += companyClosedValue;
      companyTotals.closedValue.dealCount += closedDeals.length;
    }

    // Update company document with hierarchical totals
    await companyRef.update({
      pipelineValue: companyTotals.pipelineValue,
      closedValue: companyTotals.closedValue,
      divisionTotals: companyTotals.divisions,
      locationTotals: locationTotals,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Successfully updated pipeline totals for company ${companyId} after deal ${dealId} update`);

  } catch (error) {
    console.error(`❌ Error in pipeline update for deal ${dealId}:`, error);
    // Don't throw - Firestore triggers should fail gracefully per playbook
  }
}

/**
 * Safe version of onDealUpdated with hardening playbook compliance
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
        console.log('No after data, skipping pipeline update');
        return;
      }

      const tenantId = event.params.tenantId as string;
      const dealId = event.params.dealId as string;

      // Self-write ignore per playbook §2.3
      if (after._processedBy === SAFE_CONFIG.TAG) {
        console.log('Ignoring self-write for pipeline update');
        return;
      }

      // Check if relevant fields actually changed per playbook §2.2
      const before = event.data?.before?.data();
      if (!hasRelevantChanges(before, after)) {
        console.log('No relevant deal fields changed, skipping pipeline update');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate required fields
      if (!after.companyId) {
        console.log(`⚠️ Deal ${dealId} has no companyId, skipping pipeline update`);
        return;
      }

      // Update pipeline totals
      await updatePipelineTotals(tenantId, after.companyId, dealId);

      const costSummary = CostTracker.getCostSummary();
      console.log(`Pipeline update completed for deal ${dealId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in onDealUpdated:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  }
);

export const onDealUpdated = safeTrigger.onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}');
