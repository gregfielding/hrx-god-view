import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// Cache for users by tenant
const usersByTenantCache = new Map<string, { data: any; timestamp: number }>();
const USERS_BY_TENANT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache

/**
 * Directory-relevant projection of `users/*`. We do NOT need gmailTokens,
 * calendarTokens, gmailMailboxCounts, recruiterScoreSnapshot, applications,
 * etc. — those are large blobs that previously OOM'd the function (521 MiB
 * used against a 512 MiB ceiling) when read in bulk. The Workforce
 * directory + downstream usages of getUsersByTenant only consume the
 * fields below, so projecting at the query level cuts per-doc payload by
 * ~95% and lets us read thousands of users without paging.
 *
 * Keep this list narrow. If a downstream caller needs a new field, add
 * it here AND verify it's actually rendered (not just available) — easy
 * to balloon back to the original problem.
 */
const DIRECTORY_FIELDS = [
  // Identity
  'firstName',
  'lastName',
  'displayName',
  'preferredName',
  'email',
  'phone',
  'avatar',
  'avatarUrl',
  // Tenant assignment (legacy + new)
  'tenantId',
  'tenantIds',
  'role',
  'orgType',
  // Security / module flags (legacy fallbacks; new structure is under tenantIds)
  'securityLevel',
  'recruiter',
  'crm_sales',
  'jobsBoard',
  'isActive',
  'workStatus',
  // Org placement (rendered as columns in WorkersTable)
  'jobTitle',
  'regionId',
  'divisionId',
  'departmentId',
  'locationId',
  'managerId',
  'regionName', // some legacy rows store the resolved name directly
  // Audit / sort
  'createdAt',
  'updatedAt',
  'lastLoginAt',
];

export const getUsersByTenant = onCall({
  maxInstances: 5,
  timeoutSeconds: 60,
  memory: '1GiB',
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

    // Two parallel indexed queries with field projection — much cheaper
    // than the previous full-collection scan AND much cheaper than the
    // un-projected indexed read that followed it (the latter still
    // OOM'd at 521 MiB / 512 MiB ceiling because each user doc carries
    // gmailTokens / calendarTokens / gmailMailboxCounts blobs that are
    // hundreds of KB apiece).
    //
    // 1) Legacy structure: top-level `tenantId` field.
    // 2) New structure: a key on the `tenantIds` map. Firestore lets us
    //    query nested maps with dotted paths — `tenantIds.{tid}.role`
    //    is a stable scalar that all in-tenant users have set
    //    (Admin / Tenant / Worker / etc.). `where('!=', null)` is
    //    supported and uses the auto-built single-field index, so no
    //    composite index is required.
    //
    // `.select(...)` server-side-projects each result down to the
    // directory-relevant fields only — see DIRECTORY_FIELDS above.
    const [directTenantSnapshot, mapTenantSnapshot] = await Promise.all([
      db
        .collection('users')
        .where('tenantId', '==', tenantId)
        .select(...DIRECTORY_FIELDS)
        .get(),
      db
        .collection('users')
        .where(`tenantIds.${tenantId}.role`, '!=', null)
        .select(...DIRECTORY_FIELDS)
        .get(),
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