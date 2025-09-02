import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

/**
 * DISABLED: onCompanyLocationUpdated (Firestore Trigger)
 * 
 * This function is permanently disabled to prevent excessive invocations
 * that were causing performance issues and unnecessary costs.
 * 
 * The function was running on EVERY company location document update, causing:
 * - Excessive function invocations (20+ per hour during spikes)
 * - Cascading updates from pipeline total calculations
 * - Performance degradation during batch operations
 * - Unnecessary resource usage
 * 
 * Instead, we now use:
 * - updateCompanyLocationMirrorCallable: Only runs when explicitly called
 * - batchUpdateCompanyLocationMirrorsCallable: Efficient bulk processing
 * - No automatic Firestore triggers for location mirror updates
 * - Manual triggers only when location data actually changes
 */

export const onCompanyLocationUpdated = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  // 🚨 PERMANENTLY DISABLED - This function was causing excessive invocations
  console.log('🚨 onCompanyLocationUpdated is PERMANENTLY DISABLED to prevent excessive invocations');
  console.log('🚨 Event data:', {
    tenantId: event.params.tenantId,
    companyId: event.params.companyId,
    locationId: event.params.locationId,
    reason: 'Function disabled to prevent excessive Firestore trigger invocations and cascading updates'
  });
  
  // Return success but do nothing
  return { 
    success: true, 
    disabled: true, 
    reason: 'Function permanently disabled to prevent excessive invocations and cascading updates',
    timestamp: new Date().toISOString()
  };
});
