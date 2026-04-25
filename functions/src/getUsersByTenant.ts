import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// Cache for users by tenant
const usersByTenantCache = new Map<string, { data: any; timestamp: number }>();
const USERS_BY_TENANT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache

export const getUsersByTenant = onCall({
  maxInstances: 5,
  timeoutSeconds: 60,
  memory: '512MiB',
  // CORS allowlist — the page lives at hrxone.com in prod and localhost
  // during dev. Without an explicit list a 500 from the handler strips
  // the CORS header on the error response, which the browser then
  // surfaces as "blocked by CORS policy" — masking the underlying
  // memory exhaustion that triggered the 500 in the first place.
  cors: true,
}, async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, _cacheBust } = request.data;
  
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    // Check cache first (skip if cache busting is requested)
    const cacheKey = `users_by_tenant_${tenantId}`;
    const cached = usersByTenantCache.get(cacheKey);
    const now = Date.now();
    if (!_cacheBust && cached && (now - cached.timestamp) < USERS_BY_TENANT_CACHE_DURATION) {
      console.log('Users by tenant served from cache for tenant:', tenantId);
      return cached.data;
    }
    
    if (_cacheBust) {
      console.log('Cache busting requested, fetching fresh data for tenant:', tenantId);
    }

    const db = admin.firestore();

    // Two parallel indexed queries — much cheaper than the previous
    // full-collection scan, which OOM'd as the users collection grew
    // and caused the function to 500 (which strips CORS headers and
    // surfaces in the browser as a misleading "CORS policy" error).
    //
    // 1) Legacy structure: top-level `tenantId` field.
    // 2) New structure: a key on the `tenantIds` map. Firestore lets us
    //    query nested maps with dotted paths — `tenantIds.{tid}.role`
    //    is a stable scalar that all in-tenant users have set
    //    (Admin / Tenant / Worker / etc.). `where('!=', null)` is
    //    supported and uses the auto-built single-field index, so no
    //    composite index is required.
    const [directTenantSnapshot, mapTenantSnapshot] = await Promise.all([
      db.collection('users').where('tenantId', '==', tenantId).get(),
      db.collection('users').where(`tenantIds.${tenantId}.role`, '!=', null).get(),
    ]);

    const directTenantUsers = directTenantSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const directIds = new Set(directTenantUsers.map(u => u.id));
    const usersWithTenantInMap = mapTenantSnapshot.docs
      .filter(doc => !directIds.has(doc.id)) // dedupe across both queries
      .map(doc => ({ id: doc.id, ...doc.data() }));

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