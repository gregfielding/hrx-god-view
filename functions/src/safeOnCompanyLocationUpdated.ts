import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe company location updates
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  RELEVANT_FIELDS: ['state', 'stateCode', 'address', 'addressText', 'streetAddress'],
  TAG: 'onCompanyLocationUpdated@v2'
};

// State mapping for normalization
const STATE_MAP: Record<string, string> = {
  'ALABAMA': 'AL','ALASKA': 'AK','ARIZONA': 'AZ','ARKANSAS': 'AR','CALIFORNIA': 'CA','COLORADO': 'CO','CONNECTICUT': 'CT','DELAWARE': 'DE','FLORIDA': 'FL','GEORGIA': 'GA','HAWAII': 'HI','IDAHO': 'ID','ILLINOIS': 'IL','INDIANA': 'IN','IOWA': 'IA','KANSAS': 'KS','KENTUCKY': 'KY','LOUISIANA': 'LA','MAINE': 'ME','MARYLAND': 'MD','MASSACHUSETTS': 'MA','MICHIGAN': 'MI','MINNESOTA': 'MN','MISSISSIPPI': 'MS','MISSOURI': 'MO','MONTANA': 'MT','NEBRASKA': 'NE','NEVADA': 'NV','NEW HAMPSHIRE': 'NH','NEW JERSEY': 'NJ','NEW MEXICO': 'NM','NEW YORK': 'NY','NORTH CAROLINA': 'NC','NORTH DAKOTA': 'ND','OHIO': 'OH','OKLAHOMA': 'OK','OREGON': 'OR','PENNSYLVANIA': 'PA','RHODE ISLAND': 'RI','SOUTH CAROLINA': 'SC','SOUTH DAKOTA': 'SD','TENNESSEE': 'TN','TEXAS': 'TX','UTAH': 'UT','VERMONT': 'VT','VIRGINIA': 'VA','WASHINGTON': 'WA','WEST VIRGINIA': 'WV','WISCONSIN': 'WI','WYOMING': 'WY'
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
 * Generate mirror document path
 */
function mirrorDocPath(tenantId: string, companyId: string, locationId: string): string {
  const id = `${companyId}_${locationId}`;
  return `tenants/${tenantId}/company_locations/${id}`;
}

/**
 * Normalize state input to state code and name
 */
function normalizeState(input?: string | null): { stateCode: string | null; stateName: string | null } {
  if (!input) return { stateCode: null, stateName: null };
  const s = String(input).trim();
  if (!s) return { stateCode: null, stateName: null };
  const upper = s.toUpperCase();
  
  // If already a 2-letter code
  if (upper.length === 2 && Object.values(STATE_MAP).includes(upper)) {
    const name = Object.keys(STATE_MAP).find((k) => STATE_MAP[k] === upper) || null;
    return { stateCode: upper, stateName: name ? toTitle(name) : null };
  }
  
  // Try full name
  const code = STATE_MAP[upper];
  if (code) return { stateCode: code, stateName: toTitle(upper) };
  return { stateCode: null, stateName: null };
}

/**
 * Convert string to title case
 */
function toTitle(s: string): string { 
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); 
}

/**
 * Derive state from address text
 */
function deriveStateFromAddressText(text?: string | null): { stateCode: string | null; stateName: string | null } {
  if (!text) return { stateCode: null, stateName: null };
  const t = String(text);
  
  // Try ", Illinois 60639" or ", IL 60639"
  const nameMatch = t.match(/,\s*([A-Za-z]{3,})\s+\d{5}(-\d{4})?/);
  if (nameMatch) return normalizeState(nameMatch[1]);
  
  const codeMatch = t.match(/,\s*([A-Za-z]{2})\b/);
  if (codeMatch) return normalizeState(codeMatch[1]);
  
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
 * Update mirror document safely
 */
async function updateMirrorDocument(tenantId: string, companyId: string, locationId: string, after: any): Promise<void> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('updateMirrorDocument', 0.0001);

    const { stateCode, stateName, raw } = computeStateFields(after);
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
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`Updated mirror document for location ${locationId} with state ${stateCode}`);
  } catch (error) {
    console.error(`Error updating mirror document for location ${locationId}:`, error);
    // Don't throw - Firestore triggers should fail gracefully per playbook
  }
}

/**
 * Safe version of onCompanyLocationUpdated with hardening playbook compliance
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
        console.log('No after data, skipping location mirror update');
        return;
      }

      const tenantId = event.params.tenantId as string;
      const companyId = event.params.companyId as string;
      const locationId = event.params.locationId as string;

      // Self-write ignore per playbook §2.3
      if (after._processedBy === SAFE_CONFIG.TAG) {
        console.log('Ignoring self-write for location mirror update');
        return;
      }

      // Check if relevant fields actually changed per playbook §2.2
      const before = event.data?.before?.data();
      if (!hasRelevantChanges(before, after)) {
        console.log('No relevant location fields changed, skipping mirror update');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Update mirror document
      await updateMirrorDocument(tenantId, companyId, locationId, after);

      const costSummary = CostTracker.getCostSummary();
      console.log(`Location mirror update completed for ${locationId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in onCompanyLocationUpdated:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
    maxInstances: 2
  }
);

export const onCompanyLocationUpdated = safeTrigger.onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}');
