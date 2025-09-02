import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

/**
 * DISABLED: onDealUpdated (Firestore Trigger)
 * 
 * This function is permanently disabled to prevent excessive invocations
 * that were causing performance issues and unnecessary costs.
 * 
 * The function was running on EVERY deal document update, causing:
 * - Excessive function invocations (20+ per hour during spikes)
 * - Cascading updates to location documents (triggering onCompanyLocationUpdated)
 * - Performance degradation during batch operations
 * - Unnecessary resource usage and costs
 * 
 * Instead, we now use:
 * - updateCompanyPipelineTotalsCallable: Only runs when explicitly called
 * - batchUpdateCompanyPipelineTotalsCallable: Efficient bulk processing
 * - No automatic Firestore triggers for pipeline updates
 * - Manual triggers only when deal data actually changes
 */

export const onDealUpdated = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  // 🚨 PERMANENTLY DISABLED - This function was causing excessive invocations and cascading updates
  console.log('🚨 onDealUpdated is PERMANENTLY DISABLED to prevent excessive invocations and cascading updates');
  console.log('🚨 Event data:', {
    tenantId: event.params.tenantId,
    dealId: event.params.dealId,
    reason: 'Function disabled to prevent excessive Firestore trigger invocations and location document updates'
  });
  
  // Return success but do nothing
  return { 
    success: true, 
    disabled: true, 
    reason: 'Function permanently disabled to prevent excessive invocations and cascading updates',
    timestamp: new Date().toISOString()
  };
});
