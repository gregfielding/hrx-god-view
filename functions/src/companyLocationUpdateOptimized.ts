import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Company Location Update System
 * 
 * This system replaces the problematic Firestore trigger with a callable function
 * that only runs when explicitly needed, preventing excessive invocations and loops.
 */

// Configuration for optimized company location updates
const UPDATE_CONFIG = {
  // Only update these specific fields (reduced scope to prevent loops)
  RELEVANT_FIELDS: ['state', 'stateCode', 'address', 'addressText', 'streetAddress', 'city', 'zipCode'],
  
  // Rate limiting
  MAX_UPDATES_PER_HOUR_PER_LOCATION: 5, // Prevent excessive updates for the same location
  MAX_UPDATES_PER_HOUR_GLOBAL: 50,      // Global rate limit
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.3, // Only process 30% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
};

// State mapping for normalization
const STATE_MAP: Record<string, string> = {
  'ALABAMA': 'AL','ALASKA': 'AK','ARIZONA': 'AZ','ARKANSAS': 'AR','CALIFORNIA': 'CA','COLORADO': 'CO','CONNECTICUT': 'CT','DELAWARE': 'DE','FLORIDA': 'FL','GEORGIA': 'GA','HAWAII': 'HI','IDAHO': 'ID','ILLINOIS': 'IL','INDIANA': 'IN','IOWA': 'IA','KANSAS': 'KS','KENTUCKY': 'KY','LOUISIANA': 'LA','MAINE': 'ME','MARYLAND': 'MD','MASSACHUSETTS': 'MA','MICHIGAN': 'MI','MINNESOTA': 'MN','MISSISSIPPI': 'MS','MISSOURI': 'MO','MONTANA': 'MT','NEBRASKA': 'NE','NEVADA': 'NV','NEW HAMPSHIRE': 'NH','NEW JERSEY': 'NJ','NEW MEXICO': 'NM','NEW YORK': 'NY','NORTH CAROLINA': 'NC','NORTH DAKOTA': 'ND','OHIO': 'OH','OKLAHOMA': 'OK','OREGON': 'OR','PENNSYLVANIA': 'PA','RHODE ISLAND': 'RI','SOUTH CAROLINA': 'SC','SOUTH DAKOTA': 'SD','TENNESSEE': 'TN','TEXAS': 'TX','UTAH': 'UT','VERMONT': 'VT','VIRGINIA': 'VA','WASHINGTON': 'WA','WEST VIRGINIA': 'WV','WISCONSIN': 'WI','WYOMING': 'WY'
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
async function checkRateLimiting(locationId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Check global rate limiting
    const globalKey = `location_update_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    const globalSnap = await globalRef.get();
    
    if (globalSnap.exists) {
      const globalData = globalSnap.data() as any;
      if (globalData.count >= UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_GLOBAL) {
        console.log('🚫 Global rate limit exceeded for location updates');
        return false;
      }
    }
    
    // Check location-specific rate limiting
    const locationKey = `location_update_rate_limit:location:${locationId}:${hourKey}`;
    const locationRef = db.collection('ai_cache').doc(locationKey);
    const locationSnap = await locationRef.get();
    
    if (locationSnap.exists) {
      const locationData = locationSnap.data() as any;
      if (locationData.count >= UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_PER_LOCATION) {
        console.log(`🚫 Location rate limit exceeded for updates: ${locationId}`);
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
async function updateRateLimiting(locationId: string): Promise<void> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Update global counter
    const globalKey = `location_update_rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    await globalRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Update location counter
    const locationKey = `location_update_rate_limit:location:${locationId}:${hourKey}`;
    const locationRef = db.collection('ai_cache').doc(locationKey);
    await locationRef.set({
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
async function checkForLoop(tenantId: string, locationId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const loopKey = `loop_prevention:location:${locationId}:${now}`;
    const loopRef = db.collection('ai_cache').doc(loopKey);
    
    // Check if we've processed this location recently
    const loopSnap = await loopRef.get();
    if (loopSnap.exists) {
      const loopData = loopSnap.data() as any;
      if (loopData.updatedAt && (now - loopData.updatedAt.toMillis()) < UPDATE_CONFIG.LOOP_PREVENTION_TTL) {
        console.log(`🚫 Loop prevention: Location ${locationId} processed too recently`);
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
 * Mark location as recently updated to prevent loops
 */
async function markLocationAsUpdated(locationId: string): Promise<void> {
  try {
    const now = Date.now();
    const loopKey = `loop_prevention:location:${locationId}:${now}`;
    const loopRef = db.collection('ai_cache').doc(loopKey);
    
    await loopRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: 'companyLocationUpdateOptimized'
    });
  } catch (error) {
    console.error('Error marking location as updated:', error);
  }
}

/**
 * Normalize state to state code
 */
function normalizeState(state: any): { stateCode: string | null; stateName: string | null } {
  if (!state) return { stateCode: null, stateName: null };
  
  const stateStr = String(state).trim().toUpperCase();
  
  // Direct match
  if (STATE_MAP[stateStr]) {
    return { stateCode: STATE_MAP[stateStr], stateName: stateStr };
  }
  
  // Partial match
  for (const [fullName, code] of Object.entries(STATE_MAP)) {
    if (fullName.includes(stateStr) || stateStr.includes(fullName)) {
      return { stateCode: code, stateName: fullName };
    }
  }
  
  return { stateCode: null, stateName: null };
}

/**
 * Derive state from address text
 */
function deriveStateFromAddressText(text?: string | null): { stateCode: string | null; stateName: string | null } {
  if (!text) return { stateCode: null, stateName: null };
  
  const textUpper = text.toUpperCase();
  
  // Look for state patterns in address text
  for (const [fullName, code] of Object.entries(STATE_MAP)) {
    if (textUpper.includes(fullName) || textUpper.includes(code)) {
      return { stateCode: code, stateName: fullName };
    }
  }
  
  return { stateCode: null, stateName: null };
}

/**
 * Compute state fields from location data
 */
function computeStateFields(locData: any): { stateCode: string | null; stateName: string | null; raw: string | null } {
  const raw = locData?.state ?? locData?.stateCode ?? locData?.address?.state ?? locData?.address?.stateCode ?? null;
  let norm = normalizeState(raw);
  
  if (!norm.stateCode) {
    // Try address text variants
    const addrText = locData?.addressText || locData?.address || locData?.streetAddress || null;
    norm = deriveStateFromAddressText(addrText);
  }
  
  return { stateCode: norm.stateCode, stateName: norm.stateName, raw: raw || null };
}

/**
 * Get mirror document path
 */
function mirrorDocPath(tenantId: string, companyId: string, locationId: string): string {
  return `tenants/${tenantId}/company_locations/${locationId}`;
}

/**
 * Update mirror document safely
 */
async function updateMirrorDocument(tenantId: string, companyId: string, locationId: string, locationData: any): Promise<void> {
  try {
    const { stateCode, stateName, raw } = computeStateFields(locationData);
    const path = mirrorDocPath(tenantId, companyId, locationId);
    
    if (!stateCode) {
      // Delete mirror document if no valid state
      await db.doc(path).delete().catch((error) => {
        console.warn(`Failed to delete mirror document for ${path}:`, error);
      });
      console.log(`Deleted mirror document for location ${locationId} (no valid state)`);
      return;
    }
    
    // Update mirror document with state information
    await db.doc(path).set({
      companyId,
      state: raw,
      stateCode,
      stateName,
      _processedBy: 'companyLocationUpdateOptimized',
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`Updated mirror document for location ${locationId} with state ${stateCode}`);
  } catch (error) {
    console.error(`Error updating mirror document for location ${locationId}:`, error);
    throw error;
  }
}

/**
 * Optimized callable function for updating company location mirror documents
 * Only runs when explicitly called, preventing excessive invocations and loops
 */
export const updateCompanyLocationMirrorCallable = onCall({
  timeoutSeconds: 60, // 1 minute for location updates
  memory: '256MiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { tenantId, companyId, locationId, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !companyId || !locationId) {
      throw new Error('tenantId, companyId, and locationId are required');
    }

    console.log('🔍 Company location mirror update requested', {
      tenantId,
      companyId,
      locationId,
      requestedBy: request.auth.uid,
      force
    });

    // Get location data to check what changed
    const locationRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${locationId}`);
    const locationSnap = await locationRef.get();
    
    if (!locationSnap.exists) {
      throw new Error('Location not found');
    }
    
    const locationData = locationSnap.data();
    
    // Check rate limiting (unless forced)
    if (!force && !(await checkRateLimiting(locationId))) {
      return {
        success: false,
        message: 'Rate limit exceeded for this location',
        rateLimited: true
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > UPDATE_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping location mirror update due to sampling');
      return {
        success: true,
        message: 'Skipped due to sampling',
        sampled: true
      };
    }
    
    // Check for potential infinite loops
    if (await checkForLoop(tenantId, locationId)) {
      return {
        success: false,
        message: 'Potential infinite loop detected, skipping update',
        loopDetected: true
      };
    }
    
    // Mark location as updated to prevent loops
    await markLocationAsUpdated(locationId);
    
    // Update mirror document
    await updateMirrorDocument(tenantId, companyId, locationId, locationData);
    
    // Update rate limiting counters
    await updateRateLimiting(locationId);
    
    console.log('✅ Company location mirror update completed', {
      locationId,
      tenantId,
      companyId
    });
    
    return {
      success: true,
      message: 'Company location mirror update completed successfully',
      locationId,
      tenantId,
      companyId
    };
    
  } catch (error) {
    console.error('Error in updateCompanyLocationMirrorCallable:', error);
    throw new Error(`Company location mirror update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch update multiple company location mirrors (efficient bulk processing)
 */
export const batchUpdateCompanyLocationMirrorsCallable = onCall({
  timeoutSeconds: 120, // 2 minutes for bulk operations
  memory: '512MiB',
  maxInstances: 2
}, async (request) => {
  try {
    const { tenantId, companyId, locationIds, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !companyId || !Array.isArray(locationIds) || locationIds.length === 0) {
      throw new Error('tenantId, companyId, and locationIds array are required');
    }
    
    if (locationIds.length > 50) {
      throw new Error('Maximum 50 locations per batch');
    }

    console.log('🔍 Batch company location mirror update requested', {
      tenantId,
      companyId,
      locationCount: locationIds.length,
      requestedBy: request.auth.uid,
      force
    });

    const results = [];
    
    // Process locations in parallel with concurrency limit
    const concurrencyLimit = 10;
    for (let i = 0; i < locationIds.length; i += concurrencyLimit) {
      const batch = locationIds.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (locationId) => {
        try {
          // Check rate limiting for each location
          if (!force && !(await checkRateLimiting(locationId))) {
            return {
              locationId,
              success: false,
              message: 'Rate limit exceeded',
              rateLimited: true
            };
          }
          
          // Check for loops
          if (await checkForLoop(tenantId, locationId)) {
            return {
              locationId,
              success: false,
              message: 'Potential infinite loop detected',
              loopDetected: true
            };
          }
          
          // Get location data
          const locationRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${locationId}`);
          const locationSnap = await locationRef.get();
          
          if (!locationSnap.exists) {
            return {
              locationId,
              success: false,
              message: 'Location not found'
            };
          }
          
          const locationData = locationSnap.data();
          
          // Mark location as updated to prevent loops
          await markLocationAsUpdated(locationId);
          
          // Update mirror document
          await updateMirrorDocument(tenantId, companyId, locationId, locationData);
          
          // Update rate limiting
          await updateRateLimiting(locationId);
          
          return {
            locationId,
            success: true
          };
          
        } catch (error) {
          console.error(`Error processing location ${locationId}:`, error);
          return {
            locationId,
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + concurrencyLimit < locationIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch company location mirror update completed', {
      totalLocations: locationIds.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch update completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: locationIds.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchUpdateCompanyLocationMirrorsCallable:', error);
    throw new Error(`Batch company location mirror update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
