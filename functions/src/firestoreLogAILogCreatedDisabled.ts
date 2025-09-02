import { onDocumentCreated } from 'firebase-functions/v2/firestore';

/**
 * COMPLETELY DISABLED: firestoreLogAILogCreated
 * 
 * This function is permanently disabled to prevent infinite feedback loops
 * that were causing runaway costs and excessive function invocations.
 * 
 * The function was creating meta-logs for every AI log creation, which then
 * triggered more AI log creation, creating an infinite loop.
 * 
 * Instead, we now use:
 * 1. Intelligent filtering in the logAIAction function
 * 2. Rate limiting and sampling
 * 3. Whitelist approach for event types
 * 4. No meta-logging of AI log operations
 */

export const firestoreLogAILogCreated = onDocumentCreated('ai_logs/{logId}', async (event) => {
  // 🚨 PERMANENTLY DISABLED - This function creates infinite loops
  console.log('🚨 firestoreLogAILogCreated is PERMANENTLY DISABLED to prevent infinite loops');
  console.log('🚨 Event data:', {
    logId: event.params.logId,
    eventType: 'ai_log.created',
    reason: 'Function disabled to prevent infinite feedback loops'
  });
  
  // Return success but do nothing
  return { 
    success: true, 
    disabled: true, 
    reason: 'Function permanently disabled to prevent infinite loops',
    timestamp: new Date().toISOString()
  };
});
