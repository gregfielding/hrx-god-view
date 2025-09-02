import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// Cache for users by tenant
const usersByTenantCache = new Map<string, { data: any; timestamp: number }>();
const USERS_BY_TENANT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache

export const getUsersByTenant = onCall({
  maxInstances: 5,
  timeoutSeconds: 60
}, async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId } = request.data;
  
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    // Check cache first
    const cacheKey = `users_by_tenant_${tenantId}`;
    const cached = usersByTenantCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < USERS_BY_TENANT_CACHE_DURATION) {
      console.log('Users by tenant served from cache for tenant:', tenantId);
      return cached.data;
    }

    const db = admin.firestore();
    
    // First, get users with direct tenantId field (old structure)
    const directTenantQuery = db.collection('users')
      .where('tenantId', '==', tenantId);
    
    const directTenantSnapshot = await directTenantQuery.get();
    const directTenantUsers = directTenantSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Then, get all users and filter for those with tenantId in tenantIds map (new structure)
    // Note: This requires admin privileges to read all users
    const allUsersQuery = db.collection('users');
    const allUsersSnapshot = await allUsersQuery.get();
    
    const usersWithTenantInMap = allUsersSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((user: any) => 
        user.tenantIds && 
        user.tenantIds[tenantId] && 
        !directTenantUsers.find(directUser => directUser.id === user.id) // Avoid duplicates
      );

    // Combine both results
    const allUsersForTenant = [...directTenantUsers, ...usersWithTenantInMap];

    console.log(`Found ${allUsersForTenant.length} users for tenant ${tenantId}:`, {
      directTenantUsers: directTenantUsers.length,
      usersWithTenantInMap: usersWithTenantInMap.length
    });

    const result = {
      users: allUsersForTenant,
      count: allUsersForTenant.length
    };

    // Cache the result
    usersByTenantCache.set(cacheKey, { data: result, timestamp: now });

    return result;

  } catch (error) {
    console.error('Error fetching users by tenant:', error);
    throw new Error('Failed to fetch users');
  }
}); 