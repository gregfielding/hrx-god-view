import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

/**
 * DISABLED: firestoreCompanySnapshotFanout (Firestore Trigger)
 * 
 * This function is permanently disabled to prevent excessive invocations
 * that were causing performance issues and unnecessary costs.
 * 
 * The function was running on EVERY company document update, causing:
 * - Excessive function invocations (20+ per hour at peak times)
 * - Unnecessary deal association updates
 * - Performance degradation from batch operations
 * - Cascading updates across the system
 * 
 * Instead, we now use:
 * - companySnapshotFanoutCallable: Only runs when explicitly called
 * - batchCompanySnapshotFanoutCallable: Efficient bulk processing
 * - Manual triggers from the frontend when needed
 * - No automatic Firestore triggers for snapshot fanout
 */

export const firestoreCompanySnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}', async (event) => {
  // 🚨 PERMANENTLY DISABLED - This function was causing excessive invocations
  console.log('🚨 firestoreCompanySnapshotFanout is PERMANENTLY DISABLED to prevent excessive invocations');
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
