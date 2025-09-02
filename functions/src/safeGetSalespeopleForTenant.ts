import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe salespeople retrieval
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'getSalespeopleForTenant@v2',
  // Query limits to prevent runaway reads
  MAX_USERS_PER_QUERY: 1000, // Limit users per query
  MAX_SALESPEOPLE_RETURN: 500, // Limit salespeople returned
  // Cache settings
  CACHE_DURATION_MS: 5 * 60 * 1000, // 5 minutes
  // Rate limiting
  MAX_REQUESTS_PER_MINUTE: 60
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
 * Validate input parameters
 */
function validateInput(data: any): { tenantId: string } {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { tenantId } = data;
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  return { tenantId: tenantId.trim() };
}

/**
 * Check user authentication and tenant access
 */
async function validateUserAccess(auth: any, tenantId: string): Promise<void> {
  if (!auth || !auth.uid) {
    throw new Error('User must be authenticated');
  }

  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('validateUserAccess', 0.001);

  // Get user document directly
  const userDoc = await db.collection('users').doc(auth.uid).get();

  if (!userDoc.exists) {
    throw new Error('User not found');
  }

  const userData = userDoc.data();
  if (!userData) {
    throw new Error('User data not found');
  }

  // Check if user has access to this tenant
  const hasTenantAccess = userData.tenantIds && userData.tenantIds[tenantId];
  if (!hasTenantAccess) {
    throw new Error('User does not have access to this tenant');
  }
}

/**
 * Get salespeople for tenant with proper query limits
 */
async function getSalespeopleForTenantSafely(tenantId: string): Promise<any[]> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getSalespeopleForTenantSafely', 0.01);

  console.log(`🔍 Getting salespeople for tenant: ${tenantId}`);

  // Get all users and filter in memory since tenantIds can be array or object
  // This is more reliable than complex queries
  let allSalespeople: any[] = [];
  let lastDoc: any = null;
  let queryCount = 0;

  // Use pagination to handle large datasets safely
  while (queryCount < 10) { // Max 10 queries to prevent runaway
    SafeFunctionUtils.checkSafetyLimits();
    
    let query = db.collection('users').limit(SAFE_CONFIG.MAX_USERS_PER_QUERY);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const usersSnapshot = await query.get();
    queryCount++;

    if (usersSnapshot.empty) {
      break;
    }

    // Process this batch
    const batchUsers = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Filter for users in this tenant (in memory for this batch)
    const batchSalespeople = batchUsers.filter((user: any) => {
      // Check if user has crm_sales flag
      if (!user.crm_sales) return false;
      
      // Check if user has direct tenantId match
      if (user.tenantId === tenantId) return true;
      
      // Check if user has tenantId in tenantIds array
      if (user.tenantIds && Array.isArray(user.tenantIds) && user.tenantIds.includes(tenantId)) {
        return true;
      }
      
      // Check if user has tenantId in tenantIds object (new structure)
      if (user.tenantIds && typeof user.tenantIds === 'object' && !Array.isArray(user.tenantIds) && user.tenantIds[tenantId]) {
        return true;
      }
      
      return false;
    });

    allSalespeople.push(...batchSalespeople);

    // Check if we've reached our limit
    if (allSalespeople.length >= SAFE_CONFIG.MAX_SALESPEOPLE_RETURN) {
      allSalespeople = allSalespeople.slice(0, SAFE_CONFIG.MAX_SALESPEOPLE_RETURN);
      break;
    }

    // Prepare for next iteration
    lastDoc = usersSnapshot.docs[usersSnapshot.docs.length - 1];

    // Add delay between queries to prevent overwhelming Firestore
    if (queryCount > 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`✅ Found ${allSalespeople.length} salespeople for tenant ${tenantId} (${queryCount} queries)`);

  // Map to response format
  return allSalespeople.map((user: any) => ({
    id: user.id,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email || '',
    jobTitle: user.jobTitle || '',
    crm_sales: user.crm_sales || false
  }));
}

/**
 * Safe version of getSalespeopleForTenant with hardening playbook compliance
 */
export const getSalespeopleForTenant = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  },
  async (request) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate input
      const { tenantId } = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate user access
      await validateUserAccess(request.auth, tenantId);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get salespeople with query limits
      const salespeople = await getSalespeopleForTenantSafely(tenantId);

      const costSummary = CostTracker.getCostSummary();
      console.log(`Salespeople retrieval completed for tenant ${tenantId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        salespeople,
        _metadata: {
          count: salespeople.length,
          tenantId,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('❌ Error in getSalespeopleForTenant:', error);
      
      // Log detailed error information for debugging
      console.error('Error details:', {
        errorType: typeof error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        tenantId: request.data?.tenantId,
        userId: request.auth?.uid
      });
      
      if (error instanceof Error) {
        if (error.message.includes('permission')) {
          throw new Error('Permission denied: User does not have access to this tenant');
        } else if (error.message.includes('not found')) {
          throw new Error('Tenant not found or user not found');
        } else if (error.message.includes('timeout')) {
          throw new Error('Request timed out - please try again');
        } else if (error.message.includes('circuit breaker')) {
          throw new Error('Service temporarily unavailable - please try again');
        } else {
          throw new Error(`Failed to get salespeople: ${error.message}`);
        }
      } else {
        throw new Error('Failed to get salespeople: Unknown error occurred');
      }
    }
  }
);
