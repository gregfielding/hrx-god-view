import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Emergency circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
  // Global circuit breaker - set to 'on' to disable all triggers
  GLOBAL_CIRCUIT_BREAKER: process.env.GLOBAL_CIRCUIT_BREAKER === 'on',
  
  // Rate limiting per function
  MAX_CALLS_PER_MINUTE: 10,
  MAX_CALLS_PER_HOUR: 100,
  
  // Cooldown periods
  COOLDOWN_MINUTES: 5,
  
  // Function-specific settings
  FUNCTIONS: {
    'firestoreLogAILogCreated': {
      enabled: false, // DISABLED - causes infinite loops
      maxCallsPerMinute: 1,
      maxCallsPerHour: 10
    },
    'updateActiveSalespeopleOnActivityLog': {
      enabled: false, // DISABLED - causes cascading updates
      maxCallsPerMinute: 5,
      maxCallsPerHour: 50
    },
    'updateActiveSalespeopleOnEmailLog': {
      enabled: false, // DISABLED - causes cascading updates
      maxCallsPerMinute: 5,
      maxCallsPerHour: 50
    }
  }
};

// Rate limiting cache
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

/**
 * Check if function should be allowed to run
 */
function shouldAllowFunction(functionName: string): boolean {
  // Check global circuit breaker
  if (CIRCUIT_BREAKER_CONFIG.GLOBAL_CIRCUIT_BREAKER) {
    console.log(`🚨 Global circuit breaker active - blocking ${functionName}`);
    return false;
  }

  // Check function-specific settings
  const functionConfig = CIRCUIT_BREAKER_CONFIG.FUNCTIONS[functionName];
  if (functionConfig && !functionConfig.enabled) {
    console.log(`🚨 Function ${functionName} is disabled`);
    return false;
  }

  // Check rate limiting
  const now = Date.now();
  const cacheKey = `${functionName}_${Math.floor(now / 60000)}`; // Per minute
  const currentCount = rateLimitCache.get(cacheKey) || { count: 0, resetTime: now + 60000 };
  
  if (now > currentCount.resetTime) {
    rateLimitCache.set(cacheKey, { count: 1, resetTime: now + 60000 });
    return true;
  }
  
  if (currentCount.count >= (functionConfig?.maxCallsPerMinute || CIRCUIT_BREAKER_CONFIG.MAX_CALLS_PER_MINUTE)) {
    console.log(`🚨 Rate limit exceeded for ${functionName}: ${currentCount.count} calls this minute`);
    return false;
  }
  
  currentCount.count++;
  rateLimitCache.set(cacheKey, currentCount);
  return true;
}

/**
 * Check if document has already been processed to prevent loops
 */
function hasBeenProcessed(data: any, functionName: string): boolean {
  const processedBy = data._processedBy || data.processedBy;
  const processedAt = data._processedAt || data.processedAt;
  
  // Check if this function has already processed this document
  if (processedBy === functionName) {
    console.log(`🔄 Document already processed by ${functionName}, skipping`);
    return true;
  }
  
  // Check if document was processed recently (within cooldown period)
  if (processedAt) {
    const processedTime = processedAt.toMillis ? processedAt.toMillis() : new Date(processedAt).getTime();
    const cooldownMs = CIRCUIT_BREAKER_CONFIG.COOLDOWN_MINUTES * 60 * 1000;
    
    if (Date.now() - processedTime < cooldownMs) {
      console.log(`⏰ Document processed recently, cooldown active for ${functionName}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Emergency disabled version of firestoreLogAILogCreated
 */
export const firestoreLogAILogCreated = onDocumentCreated('ai_logs/{logId}', async (event) => {
  const functionName = 'firestoreLogAILogCreated';
  
  // Check circuit breaker and rate limiting
  if (!shouldAllowFunction(functionName)) {
    console.log(`🚨 ${functionName} blocked by circuit breaker or rate limiting`);
    return;
  }
  
  const data = event.data?.data();
  if (!data) return;
  
  // Check if already processed
  if (hasBeenProcessed(data, functionName)) {
    return;
  }
  
  console.log(`🚨 ${functionName} is DISABLED - preventing infinite loops`);
  return;
});

/**
 * Emergency disabled version of updateActiveSalespeopleOnActivityLog
 */
export const updateActiveSalespeopleOnActivityLog = onDocumentCreated('tenants/{tenantId}/activity_logs/{activityId}', async (event) => {
  const functionName = 'updateActiveSalespeopleOnActivityLog';
  
  // Check circuit breaker and rate limiting
  if (!shouldAllowFunction(functionName)) {
    console.log(`🚨 ${functionName} blocked by circuit breaker or rate limiting`);
    return;
  }
  
  const data = event.data?.data();
  if (!data) return;
  
  // Check if already processed
  if (hasBeenProcessed(data, functionName)) {
    return;
  }
  
  console.log(`🚨 ${functionName} is DISABLED - preventing cascading updates`);
  return;
});

/**
 * Emergency disabled version of updateActiveSalespeopleOnEmailLog
 */
export const updateActiveSalespeopleOnEmailLog = onDocumentCreated('tenants/{tenantId}/email_logs/{emailId}', async (event) => {
  const functionName = 'updateActiveSalespeopleOnEmailLog';
  
  // Check circuit breaker and rate limiting
  if (!shouldAllowFunction(functionName)) {
    console.log(`🚨 ${functionName} blocked by circuit breaker or rate limiting`);
    return;
  }
  
  const data = event.data?.data();
  if (!data) return;
  
  // Check if already processed
  if (hasBeenProcessed(data, functionName)) {
    return;
  }
  
  console.log(`🚨 ${functionName} is DISABLED - preventing cascading updates`);
  return;
});

/**
 * Emergency disabled version of updateActiveSalespeopleOnDeal
 */
export const updateActiveSalespeopleOnDeal = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  const functionName = 'updateActiveSalespeopleOnDeal';
  
  // Check circuit breaker and rate limiting
  if (!shouldAllowFunction(functionName)) {
    console.log(`🚨 ${functionName} blocked by circuit breaker or rate limiting`);
    return;
  }
  
  const beforeData = event.data?.before?.data();
  const afterData = event.data?.after?.data();
  
  if (!beforeData || !afterData) return;
  
  // Check if already processed
  if (hasBeenProcessed(afterData, functionName)) {
    return;
  }
  
  console.log(`🚨 ${functionName} is DISABLED - preventing cascading updates`);
  return;
});

/**
 * Emergency disabled version of updateActiveSalespeopleOnTask
 */
export const updateActiveSalespeopleOnTask = onDocumentUpdated('tenants/{tenantId}/tasks/{taskId}', async (event) => {
  const functionName = 'updateActiveSalespeopleOnTask';
  
  // Check circuit breaker and rate limiting
  if (!shouldAllowFunction(functionName)) {
    console.log(`🚨 ${functionName} blocked by circuit breaker or rate limiting`);
    return;
  }
  
  const beforeData = event.data?.before?.data();
  const afterData = event.data?.after?.data();
  
  if (!beforeData || !afterData) return;
  
  // Check if already processed
  if (hasBeenProcessed(afterData, functionName)) {
    return;
  }
  
  console.log(`🚨 ${functionName} is DISABLED - preventing cascading updates`);
  return;
});

/**
 * Callable function to enable/disable circuit breakers
 */
export const toggleCircuitBreaker = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  // Only allow admin users to toggle circuit breakers
  if (!request.auth?.uid) {
    throw new Error('Unauthorized');
  }
  
  const { functionName, enabled } = request.data;
  
  if (functionName === 'global') {
    // Toggle global circuit breaker
    process.env.GLOBAL_CIRCUIT_BREAKER = enabled ? 'on' : 'off';
    console.log(`🔧 Global circuit breaker ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return { success: true, message: `Global circuit breaker ${enabled ? 'enabled' : 'disabled'}` };
  }
  
  if (CIRCUIT_BREAKER_CONFIG.FUNCTIONS[functionName]) {
    // Toggle function-specific circuit breaker
    CIRCUIT_BREAKER_CONFIG.FUNCTIONS[functionName].enabled = enabled;
    console.log(`🔧 Function ${functionName} ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return { success: true, message: `Function ${functionName} ${enabled ? 'enabled' : 'disabled'}` };
  }
  
  throw new Error('Invalid function name');
});

/**
 * Callable function to get circuit breaker status
 */
export const getCircuitBreakerStatus = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  if (!request.auth?.uid) {
    throw new Error('Unauthorized');
  }
  
  return {
    global: CIRCUIT_BREAKER_CONFIG.GLOBAL_CIRCUIT_BREAKER,
    functions: CIRCUIT_BREAKER_CONFIG.FUNCTIONS,
    rateLimits: Object.fromEntries(rateLimitCache.entries())
  };
});
