import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe Apollo headquarters sync
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  RELEVANT_FIELDS: ['firmographics.apollo', 'companyName', 'name'],
  TAG: 'syncApolloHeadquartersLocation@v2'
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
 * Check if Apollo data was actually added or updated
 */
function hasApolloDataChanged(beforeData: any, afterData: any): boolean {
  const beforeApollo = beforeData?.firmographics?.apollo;
  const afterApollo = afterData?.firmographics?.apollo;
  
  // Only proceed if Apollo data was actually added or changed
  if (!afterApollo) {
    console.log('No Apollo data in after state, skipping location sync');
    return false;
  }
  
  // Check if Apollo data actually changed (to prevent infinite loops)
  if (beforeApollo && JSON.stringify(beforeApollo) === JSON.stringify(afterApollo)) {
    console.log('Apollo data unchanged, skipping location sync');
    return false;
  }
  
  return true;
}

/**
 * Check if headquarters data exists and is valid
 */
function validateHeadquartersData(headquarters: any): { isValid: boolean; address?: string } {
  if (!headquarters) {
    console.log('No headquarters data in Apollo response, skipping location creation');
    return { isValid: false };
  }

  const { street_address, city, state, postal_code, country } = headquarters;
  
  console.log('Processing headquarters data', { 
    street_address, 
    city, 
    state, 
    postal_code, 
    country 
  });
  
  // Only proceed if we have complete address data
  if (!city || !state) {
    console.log('Incomplete Apollo address data, skipping headquarters location creation');
    return { isValid: false };
  }

  return { 
    isValid: true, 
    address: `${street_address}, ${city}, ${state}`.toLowerCase() 
  };
}

/**
 * Check if headquarters location already exists
 */
async function checkExistingHeadquarters(tenantId: string, companyId: string): Promise<boolean> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('checkExistingHeadquarters', 0.0001);

    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    
    // Check if headquarters already exists - PROTECT AGAINST DUPLICATES
    const headquartersQuery = locationsRef.where('type', '==', 'Headquarters');
    const headquartersSnap = await headquartersQuery.get();
    
    if (!headquartersSnap.empty) {
      const existingLocations = headquartersSnap.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        address: doc.data().address
      }));
      console.log('🚫 Headquarters location already exists - PROTECTING EXISTING DATA', { 
        existingCount: existingLocations.length,
        existingLocations: existingLocations
      });
      return true;
    }
    
    console.log('✅ No existing headquarters found - safe to create new one');
    return false;
  } catch (error) {
    console.error('Error checking existing headquarters:', error);
    return true; // Assume exists to prevent creation on error
  }
}

/**
 * Check for similar existing locations to prevent duplicates
 */
async function checkSimilarLocations(tenantId: string, companyId: string, newAddress: string): Promise<boolean> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('checkSimilarLocations', 0.0001);

    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    
    // Look for any existing locations with similar address to prevent duplicates
    const allLocationsQuery = locationsRef.get();
    const allLocationsSnap = await allLocationsQuery;
    const existingLocations = allLocationsSnap.docs.map(doc => doc.data());
    
    // Check if any existing location has a similar address
    const similarLocation = existingLocations.find(loc => {
      const existingAddress = `${loc.address || ''}, ${loc.city || ''}, ${loc.state || ''}`.toLowerCase();
      return existingAddress.includes(newAddress.split(',')[1]?.trim()) && 
             existingAddress.includes(newAddress.split(',')[2]?.trim());
    });
    
    if (similarLocation) {
      console.log('🚫 Found existing location with similar address - preventing duplicate', {
        newAddress: newAddress,
        existingLocation: {
          name: similarLocation.name,
          address: similarLocation.address,
          city: similarLocation.city,
          state: similarLocation.state
        }
      });
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking similar locations:', error);
    return true; // Assume similar exists to prevent creation on error
  }
}

/**
 * Create headquarters location safely
 */
async function createHeadquartersLocation(
  tenantId: string, 
  companyId: string, 
  headquarters: any, 
  companyName: string
): Promise<void> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('createHeadquartersLocation', 0.001);

    const { street_address, city, state, postal_code, country } = headquarters;
    
    // Create headquarters location data
    const locationData = {
      name: companyName || 'Headquarters',
      address: street_address,
      city: city,
      state: state,
      zipCode: postal_code || '',
      country: country || 'USA',
      type: 'Headquarters',
      coordinates: null, // Could be enhanced with geocoding later
      discoveredBy: 'Apollo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contactCount: 0,
      dealCount: 0,
      salespersonCount: 0,
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    console.log('Creating headquarters location', { 
      name: locationData.name,
      address: locationData.address,
      city: locationData.city,
      state: locationData.state
    });
    
    const cleanLocationData = Object.fromEntries(
      Object.entries(locationData).filter(([, v]) => v !== undefined && v !== null)
    );
    
    // Create new headquarters location
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    await locationsRef.add(cleanLocationData);
    
    console.log('✅ Created headquarters location from Apollo data', { companyId, tenantId });
  } catch (error) {
    console.error('Error creating headquarters location from Apollo data:', error);
    throw error;
  }
}

/**
 * Safe version of syncApolloHeadquartersLocation with hardening playbook compliance
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
      const beforeData = event.data?.before?.data();
      const afterData = event.data?.after?.data();
      
      if (!beforeData || !afterData) {
        console.log('Document created or deleted, skipping location sync');
        return;
      }

      const tenantId = event.params.tenantId as string;
      const companyId = event.params.companyId as string;

      // Self-write ignore per playbook §2.3
      if (afterData._processedBy === SAFE_CONFIG.TAG) {
        console.log('Ignoring self-write for Apollo headquarters sync');
        return;
      }

      // Check if relevant fields actually changed per playbook §2.2
      if (!hasRelevantChanges(beforeData, afterData)) {
        console.log('No relevant company fields changed, skipping Apollo headquarters sync');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Check if Apollo data was actually added or updated
      if (!hasApolloDataChanged(beforeData, afterData)) {
        return;
      }

      console.log('Apollo location sync triggered - new Apollo data detected', { 
        tenantId, 
        companyId, 
        hasBeforeApollo: !!beforeData.firmographics?.apollo, 
        hasAfterApollo: !!afterData.firmographics?.apollo,
        beforeApolloKeys: beforeData.firmographics?.apollo ? Object.keys(beforeData.firmographics.apollo) : [],
        afterApolloKeys: afterData.firmographics?.apollo ? Object.keys(afterData.firmographics.apollo) : []
      });

      // Check if headquarters data exists and we should create a location
      const headquarters = afterData.firmographics?.apollo?.headquarters;
      const validation = validateHeadquartersData(headquarters);
      
      if (!validation.isValid) {
        return;
      }

      // Check if headquarters location already exists
      const hasExistingHeadquarters = await checkExistingHeadquarters(tenantId, companyId);
      if (hasExistingHeadquarters) {
        return;
      }

      // Check for similar existing locations to prevent duplicates
      const hasSimilarLocation = await checkSimilarLocations(tenantId, companyId, validation.address!);
      if (hasSimilarLocation) {
        return;
      }

      // Create headquarters location
      const companyName = afterData.companyName || afterData.name || 'Headquarters';
      await createHeadquartersLocation(tenantId, companyId, headquarters, companyName);

      const costSummary = CostTracker.getCostSummary();
      console.log(`Apollo headquarters sync completed for company ${companyId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in syncApolloHeadquartersLocation:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
    maxInstances: 2
  }
);

export const syncApolloHeadquartersLocation = safeTrigger.onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}');
