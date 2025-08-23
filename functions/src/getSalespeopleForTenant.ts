import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// Add caching for salespeople to reduce database calls
const salespeopleCache = new Map<string, { data: any; timestamp: number }>();
const SALESPEOPLE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache (longer since salespeople don't change frequently)

export const getSalespeopleForTenant = onCall(async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('User must be authenticated');
    }

    const { tenantId } = request.data;
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    // Check cache first
    const cached = salespeopleCache.get(tenantId);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < SALESPEOPLE_CACHE_DURATION) {
      console.log('Salespeople served from cache for tenant:', tenantId);
      return cached.data;
    }

    // Get the user's document to check permissions
    const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
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

    // OPTIMIZED: Use a more efficient query approach
    // Instead of fetching ALL users, we'll use a collection group query with a filter
    // This is much more efficient than fetching all users and filtering client-side
    
    console.log(`🔍 Fetching salespeople for tenant: ${tenantId}`);
    
    // Use collection group query to find users with the specific tenant access
    const usersSnapshot = await admin.firestore()
      .collectionGroup('users')
      .where(`tenantIds.${tenantId}`, '==', true)
      .get();

    console.log(`🏢 Users with tenant access: ${usersSnapshot.docs.length}`);

    // Filter for users with crm_sales: true
    const salespeople = usersSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((user: any) => user.crm_sales === true)
      .map((user: any) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        jobTitle: user.jobTitle,
        crm_sales: user.crm_sales
      }));

    const result = { salespeople };

    // Cache the result
    salespeopleCache.set(tenantId, { data: result, timestamp: now });

    console.log(`✅ Salespeople with crm_sales: true: ${salespeople.length}`);
    console.log('📋 Salespeople:', salespeople.map(sp => ({ id: sp.id, name: `${sp.firstName} ${sp.lastName}`, email: sp.email })));

    return result;
  } catch (error) {
    console.error('Error in getSalespeopleForTenant:', error);
    throw new Error('Failed to get salespeople');
  }
});

// Clear cache when user data changes (called from other functions)
export const clearSalespeopleCache = (tenantId: string) => {
  salespeopleCache.delete(tenantId);
}; 