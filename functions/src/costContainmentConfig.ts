/**
 * 🚨 EMERGENCY COST CONTAINMENT CONFIGURATION
 * 
 * This file contains all emergency measures to prevent runaway Firebase Functions costs
 * due to excessive AI logging and feedback loops.
 * 
 * Status: ACTIVE - All measures are currently enforced
 * Target: 99%+ reduction in AI logging function calls
 */

export const COST_CONTAINMENT_CONFIG = {
  // Overall status
  STATUS: 'EMERGENCY_ACTIVE',
  ACTIVATED_AT: new Date().toISOString(),
  TARGET_REDUCTION: '99%',
  
  // AI Logging Functions - COMPLETELY DISABLED
  DISABLED_FUNCTIONS: {
    firestoreLogAILogCreated: {
      status: 'DISABLED',
      reason: 'Infinite feedback loop - creates meta-logs for every AI log',
      impact: '99%+ reduction in function calls',
      replacement: 'Manual logging only for critical events'
    },
    processAILog: {
      status: 'DISABLED', 
      reason: 'Processes every AI log entry - expensive and unnecessary',
      impact: '100% reduction in AI log processing',
      replacement: 'None - not needed during cost crisis'
    }
  },
  
  // Core Logging Function - AGGRESSIVE SAMPLING
  logAIAction: {
    status: 'EMERGENCY_SAMPLING',
    sampling_rate: 0.01, // 1% of events logged (99% blocked)
    urgency_threshold: 7, // Only log events with urgency >= 7
    critical_events_only: true,
    impact: '99% reduction in AI log creation'
  },
  
  // Event Type Filtering
  BLOCKED_EVENT_TYPES: [
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
  
  // Context Type Filtering
  BLOCKED_CONTEXT_TYPES: [
    'meta_logging',
    'system',
    'debug',
    'user',
    'conversation',
    'customer',
    'agency',
    'tenant'
  ],
  
  // Source Module Filtering
  BLOCKED_SOURCE_MODULES: [
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
  
  // Monitoring and Alerts
  MONITORING: {
    target_calls_per_minute: 5, // Should be under 5 calls/minute
    alert_threshold: 10, // Alert if over 10 calls/minute
    check_interval_minutes: 5, // Check every 5 minutes
    metrics_to_track: [
      'firestoreLogAILogCreated_calls_per_minute',
      'processAILog_calls_per_minute',
      'logAIAction_calls_per_minute',
      'total_ai_logs_created_per_minute'
    ]
  },
  
  // Re-enablement Criteria
  RE_ENABLEMENT_CRITERIA: {
    cost_stabilized: '24 hours of stable costs',
    function_calls_controlled: 'Under 5 calls/minute for 24 hours',
    feedback_loops_resolved: 'All infinite loops eliminated',
    monitoring_implemented: 'Real-time cost monitoring active'
  }
};

/**
 * Check if cost containment is active
 */
export function isCostContainmentActive(): boolean {
  return COST_CONTAINMENT_CONFIG.STATUS === 'EMERGENCY_ACTIVE';
}

/**
 * Check if a function should be blocked
 */
export function shouldBlockFunction(functionName: string): boolean {
  return functionName in COST_CONTAINMENT_CONFIG.DISABLED_FUNCTIONS;
}

/**
 * Check if an event should be logged
 */
export function shouldLogEvent(eventType: string, urgencyScore: number, sourceModule: string): boolean {
  // Check if cost containment is active
  if (!isCostContainmentActive()) {
    return true; // Normal operation
  }
  
  // Block low urgency events
  if (urgencyScore < COST_CONTAINMENT_CONFIG.logAIAction.urgency_threshold) {
    return false;
  }
  
  // Block non-critical event types
  if (COST_CONTAINMENT_CONFIG.BLOCKED_EVENT_TYPES.includes(eventType)) {
    return false;
  }
  
  // Block blocked source modules
  if (COST_CONTAINMENT_CONFIG.BLOCKED_SOURCE_MODULES.includes(sourceModule)) {
    return false;
  }
  
  // Apply sampling
  if (Math.random() > COST_CONTAINMENT_CONFIG.logAIAction.sampling_rate) {
    return false;
  }
  
  return true;
}

/**
 * Get cost containment status
 */
export function getCostContainmentStatus() {
  return {
    status: COST_CONTAINMENT_CONFIG.STATUS,
    activatedAt: COST_CONTAINMENT_CONFIG.ACTIVATED_AT,
    targetReduction: COST_CONTAINMENT_CONFIG.TARGET_REDUCTION,
    disabledFunctions: Object.keys(COST_CONTAINMENT_CONFIG.DISABLED_FUNCTIONS),
    samplingRate: COST_CONTAINMENT_CONFIG.logAIAction.sampling_rate,
    urgencyThreshold: COST_CONTAINMENT_CONFIG.logAIAction.urgency_threshold
  };
}
