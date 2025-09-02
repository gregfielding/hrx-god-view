import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// Cache for salespeople queries
const salespeopleCache = new Map<string, { data: any; timestamp: number }>();
const SALESPEOPLE_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache

export const getSalespeople = onCall(async (request) => {
  try {
    const { tenantId, activeTenantId } = request.data;

    if (!tenantId) {
      throw new Error('Missing required parameter: tenantId');
    }

    // Create cache key
    const cacheKey = `salespeople_${tenantId}_${activeTenantId || 'all'}`;
    
    // Check cache first
    const cached = salespeopleCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < SALESPEOPLE_CACHE_DURATION) {
      console.log('Salespeople served from cache for tenant:', tenantId);
      return cached.data;
    }

    console.log(`🔍 getSalespeople called with tenantId: ${tenantId}, activeTenantId: ${activeTenantId}`);

    const db = admin.firestore();
    
    // Query the top-level users collection instead of workforce subcollection
    const usersRef = db.collection('users');
    
    // First, let's see all users to understand the data structure
    const allUsersSnap = await usersRef.get();
    const allUsersData = allUsersSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    console.log(`🔍 Total users in database: ${allUsersData.length}`);
    console.log(`🔍 Sample users:`, allUsersData.slice(0, 3).map(u => ({ 
      id: u.id, 
      firstName: u.firstName, 
      lastName: u.lastName, 
      email: u.email,
      tenantId: u.tenantId,
      tenantIds: u.tenantIds,
      crm_sales: u.crm_sales
    })));
    
    // Filter users who belong to this tenant
    const usersInTenant = allUsersData.filter((user: any) => {
      // Check if user has direct tenantId match
      if (user.tenantId === tenantId) {
        return true;
      }
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
    
    console.log(`🔍 Users in tenant ${tenantId}: ${usersInTenant.length}`);
    console.log(`🔍 Users in tenant:`, usersInTenant.map(u => ({ 
      id: u.id, 
      firstName: u.firstName, 
      lastName: u.lastName, 
      email: u.email,
      crm_sales: u.crm_sales
    })));
    
    // Filter for users with crm_sales: true
    const salespeople = usersInTenant.filter((user: any) => user.crm_sales === true);
    
    console.log(`🔍 Found ${salespeople.length} salespeople with crm_sales: true:`, 
      salespeople.map((s: any) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email })));

    const result = { salespeople };
    
    // Cache the result
    salespeopleCache.set(cacheKey, { data: result, timestamp: now });
    
    return result;

  } catch (error) {
    console.error('❌ Error in getSalespeople:', error);
    throw new Error('Failed to get salespeople');
  }
}); 