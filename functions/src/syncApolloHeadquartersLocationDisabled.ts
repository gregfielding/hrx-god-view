import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

/**
 * DISABLED: syncApolloHeadquartersLocation (Firestore Trigger)
 * 
 * This function is permanently disabled to prevent excessive invocations
 * that were causing performance issues and unnecessary costs.
 * 
 * The function was running on EVERY company document update, not just
 * when Apollo data was added, causing:
 * - Excessive function invocations (100+ per hour)
 * - Unnecessary resource usage
 * - Performance degradation
 * 
 * Instead, we now use:
 * - syncApolloHeadquartersLocationCallable: Only runs when explicitly called
 * - Manual triggers from the frontend when "AI Enhance" is clicked
 * - No automatic Firestore triggers for location syncing
 */

export const syncApolloHeadquartersLocation = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}', async (event) => {
  // 🚨 PERMANENTLY DISABLED - This function was causing excessive invocations
  console.log('🚨 syncApolloHeadquartersLocation is PERMANENTLY DISABLED to prevent excessive invocations');
  console.log('🚨 Event data:', {
    tenantId: event.params.tenantId,
    companyId: event.params.companyId,
    reason: 'Function disabled to prevent excessive Firestore trigger invocations'
  });
  
  // Return success but do nothing
  return { 
    success: true, 
    disabled: true, 
    reason: 'Function permanently disabled to prevent excessive invocations',
    timestamp: new Date().toISOString()
  };
});
