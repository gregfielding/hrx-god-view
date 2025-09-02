import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Global cache for salespeople data
const salespeopleCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_DURATION_MS = 60 * 60 * 1000; // 60 minutes cache (increased for better cost reduction)
const MAX_CACHE_SIZE = 50; // Maximum number of cached tenants

/**
 * Clean up old cache entries
 */
function cleanupCache() {
  const now = Date.now();
  const entries = Array.from(salespeopleCache.entries());
  
  // Remove expired entries
  for (const [key, value] of entries) {
    if (now - value.timestamp > CACHE_DURATION_MS) {
      salespeopleCache.delete(key);
    }
  }
  
  // If cache is still too large, remove oldest entries
  if (salespeopleCache.size > MAX_CACHE_SIZE) {
    const sortedEntries = entries
      .filter(([_, value]) => now - value.timestamp <= CACHE_DURATION_MS)
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = sortedEntries.slice(0, salespeopleCache.size - MAX_CACHE_SIZE);
    toRemove.forEach(([key]) => salespeopleCache.delete(key));
  }
}

/**
 * Simplified version of getSalespeopleForTenant to fix 500 errors
 */
export const getSalespeopleForTenant = onCall(
  {
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 3
  },
  async (request) => {
    try {
      console.log('🔍 Simple getSalespeopleForTenant called');
      
      const { tenantId } = request.data;
      const userId = request.auth?.uid;

      if (!tenantId) {
        throw new Error('Missing required field: tenantId');
      }

      if (!userId) {
        throw new Error('User not authenticated');
      }

      console.log(`🔍 Getting salespeople for tenant: ${tenantId}, user: ${userId}`);

      // Clean up cache first
      cleanupCache();

      // Check cache first
      const cacheKey = `salespeople_${tenantId}`;
      const cached = salespeopleCache.get(cacheKey);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
        console.log('📦 Salespeople served from server cache for tenant:', tenantId);
        return { 
          salespeople: cached.data,
          _metadata: {
            count: cached.data.length,
            tenantId,
            processedBy: 'simpleGetSalespeopleForTenant',
            cached: true,
            cacheAge: Math.floor((now - cached.timestamp) / 1000)
          }
        };
      }

      // Simple query without complex safety checks
      const usersSnapshot = await db.collection('users')
        .where('crm_sales', '==', true)
        .limit(100)
        .get();

      const allUsers = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Filter for users in this tenant
      const salespeople = allUsers.filter((user: any) => {
        // Check if user has direct tenantId match
        if (user.tenantId === tenantId) return true;
        
        // Check if user has tenantId in tenantIds array
        if (user.tenantIds && Array.isArray(user.tenantIds) && user.tenantIds.includes(tenantId)) {
          return true;
        }
        
        // Check if user has tenantId in tenantIds object
        if (user.tenantIds && typeof user.tenantIds === 'object' && !Array.isArray(user.tenantIds) && user.tenantIds[tenantId]) {
          return true;
        }
        
        return false;
      });

      console.log(`✅ Found ${salespeople.length} salespeople for tenant ${tenantId}`);

      // Map to response format
      const result = salespeople.map((user: any) => ({
        id: user.id,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        jobTitle: user.jobTitle || '',
        crm_sales: user.crm_sales || false
      }));

      // Cache the result
      salespeopleCache.set(cacheKey, { data: result, timestamp: now });
      console.log(`💾 Cached salespeople data for tenant ${tenantId}`);

      return { 
        salespeople: result,
        _metadata: {
          count: result.length,
          tenantId,
          processedBy: 'simpleGetSalespeopleForTenant',
          cached: false,
          cacheAge: 0
        }
      };

    } catch (error) {
      console.error('❌ Error in simple getSalespeopleForTenant:', error);
      
      // Log detailed error information for debugging
      console.error('Error details:', {
        errorType: typeof error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        tenantId: request.data?.tenantId,
        userId: request.auth?.uid
      });
      
      throw new Error(`Failed to get salespeople: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
