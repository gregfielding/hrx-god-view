import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe AI log creation
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'firestoreLogAILogCreated@v3',
  // EMERGENCY: Aggressive filtering to stop runaway costs
  ENABLED: false, // TEMPORARILY DISABLED - enable only for critical events
  // Selective logging - only log critical events
  MIN_URGENCY_SCORE: 9, // Only log events with urgency score >= 9 (critical only)
  // Skip most event types entirely
  SKIP_EVENT_TYPES: [
    'ai_log.created',
    'ai_log.updated', 
    'ai_log.deleted',
    'meta_logging',
    'cache_hit',
    'system.heartbeat',
    'user.updated',
    'user.created',
    'user.deleted',
    'conversation.updated',
    'conversation.created',
    'message.updated',
    'message.created',
    'task.updated',
    'task.created',
    'customer.updated',
    'customer.created',
    'agency_contact.updated',
    'agency_contact.created',
    'tenant_contact.updated',
    'tenant_contact.created'
  ],
  // Skip most context types
  SKIP_CONTEXT_TYPES: [
    'meta_logging',
    'system',
    'debug',
    'user',
    'conversation',
    'customer',
    'agency',
    'tenant'
  ],
  // Skip most source modules to prevent loops
  SKIP_SOURCE_MODULES: [
    'FirestoreTrigger',
    'firestoreLogAILogCreated',
    'safeFirestoreLogAILogCreated',
    'firestoreLogUserUpdated',
    'firestoreLogConversationUpdated',
    'firestoreLogMessageUpdated',
    'firestoreLogTaskUpdated',
    'firestoreLogCustomerUpdated',
    'firestoreLogAgencyContactUpdated',
    'firestoreLogTenantContactUpdated'
  ],
  // Sampling: only process 0.1% of events (extremely aggressive)
  SAMPLING_RATE: 0.001 // 0.1% sampling (1 in 1000 events)
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
  
  // 🚨 EMERGENCY: Always block this function during cost containment
  throw new Error('🚨 firestoreLogAILogCreated is EMERGENCY DISABLED for cost containment');
}

/**
 * Check if we should log this event based on selective logging rules
 */
function shouldLogEvent(logData: any): boolean {
  // EMERGENCY: Function is temporarily disabled
  if (!SAFE_CONFIG.ENABLED) {
    return false;
  }

  // Apply sampling: only process 1% of events
  if (Math.random() > SAFE_CONFIG.SAMPLING_RATE) {
    return false;
  }

  // Prevent feedback loop: skip any log where sourceModule is 'FirestoreTrigger'
  if (logData.sourceModule === 'FirestoreTrigger') {
    return false;
  }

  // Skip if sourceModule is in the skip list
  if (SAFE_CONFIG.SKIP_SOURCE_MODULES.includes(logData.sourceModule)) {
    return false;
  }

  // Skip if eventType is in the skip list
  if (SAFE_CONFIG.SKIP_EVENT_TYPES.includes(logData.eventType)) {
    return false;
  }

  // Skip if contextType is in the skip list
  if (SAFE_CONFIG.SKIP_CONTEXT_TYPES.includes(logData.contextType)) {
    return false;
  }

  // Skip meta-logging events
  if (logData.contextType === 'meta_logging') {
    return false;
  }

  // Skip if urgency score is too low
  if (logData.urgencyScore && logData.urgencyScore < SAFE_CONFIG.MIN_URGENCY_SCORE) {
    return false;
  }

  // Skip if this is a meta-log entry (prevents infinite loops)
  if (logData.actionType === 'ai_log_created' || logData.targetType === 'ai_log') {
    return false;
  }

  return true;
}

/**
 * Create AI log entry safely
 */
async function createAILogEntry(logData: any, logId: string): Promise<void> {
  try {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('createAILogEntry', 0.001);

    const aiLogData = {
      userId: logData.userId || 'system',
      actionType: 'ai_log_created',
      sourceModule: SAFE_CONFIG.TAG,
      success: true,
      eventType: 'ai_log.created',
      targetType: 'ai_log',
      targetId: logId,
      aiRelevant: true,
      contextType: 'meta_logging',
      traitsAffected: null,
      aiTags: ['ai_log', 'meta_logging', 'creation', logData.actionType || 'unknown'],
      urgencyScore: 3,
      reason: `AI log created: ${logData.actionType || 'Unknown'} for ${logData.targetType || 'Unknown'}`,
      versionTag: 'v2',
      latencyMs: 0,
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('ai_logs').add(aiLogData);
    console.log(`✅ Meta-log created for AI log: ${logId}`);
  } catch (error) {
    console.error(`Error creating meta-log for ${logId}:`, error);
    // Don't throw - meta-logging should not break the main flow
  }
}

/**
 * Safe version of firestoreLogAILogCreated with selective logging
 */
const safeTrigger = createSafeFirestoreTrigger(
  async (event) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      const logData = event.data?.data();
      const logId = event.params.logId;
      
      if (!logData) {
        console.log('No log data, skipping meta-logging');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Apply selective logging rules
      if (!shouldLogEvent(logData)) {
        console.log(`Skipping meta-log for ${logId} (selective logging rules)`);
        return;
      }

      // Create meta-log entry
      await createAILogEntry(logData, logId);

      const costSummary = CostTracker.getCostSummary();
      console.log(`AI log meta-logging completed for ${logId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in firestoreLogAILogCreated:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
    maxInstances: 1 // Reduced from 2 for cost containment
  }
);

export const firestoreLogAILogCreated = safeTrigger.onDocumentCreated('ai_logs/{logId}');
