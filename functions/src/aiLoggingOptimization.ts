import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * AI Logging Optimization System
 * 
 * This system rethinks the purpose of AI logging and implements intelligent filtering
 * to prevent unnecessary logs, loops, and excessive costs.
 */

// Configuration for intelligent AI logging
const LOGGING_CONFIG = {
  // Only log events that meet these criteria
  MIN_URGENCY_SCORE: 7, // Only log events with urgency score >= 7 (high priority)
  
  // Skip these event types entirely (too noisy, not actionable)
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
    'tenant_contact.created',
    'location.updated',
    'location.created',
    'location.deleted',
    'setting.updated',
    'setting.created',
    'setting.deleted',
    'notification.updated',
    'notification.created',
    'notification.deleted'
  ],
  
  // Skip these context types (not AI-relevant)
  SKIP_CONTEXT_TYPES: [
    'meta_logging',
    'system',
    'debug',
    'user',
    'conversation',
    'customer',
    'agency',
    'tenant',
    'location',
    'setting',
    'notification'
  ],
  
  // Skip these source modules to prevent loops
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
    'firestoreLogTenantContactUpdated',
    'firestoreLogLocationUpdated',
    'firestoreLogSettingUpdated',
    'firestoreLogNotificationUpdated'
  ],
  
  // Only log these specific event types (whitelist approach)
  ALLOWED_EVENT_TYPES: [
    'dealCoach.analyze',
    'dealCoach.chat',
    'dealCoach.action',
    'ai_campaign.triggered',
    'ai_campaign.completed',
    'ai_enrichment.completed',
    'ai_analysis.completed',
    'ai_task.completed',
    'ai_insight.generated',
    'ai_recommendation.provided'
  ],
  
  // Sampling rate for high-volume events (only log 1% of non-critical events)
  SAMPLING_RATE: 0.01,
  
  // Maximum logs per hour per tenant to prevent abuse
  MAX_LOGS_PER_HOUR_PER_TENANT: 100,
  
  // Maximum logs per hour globally to prevent runaway costs
  MAX_LOGS_PER_HOUR_GLOBAL: 1000
};

/**
 * Check if an event should be logged based on intelligent filtering
 */
export function shouldLogEvent(logData: any): boolean {
  // Skip if no log data
  if (!logData) return false;
  
  // Skip if source module is in blacklist
  if (logData.sourceModule && LOGGING_CONFIG.SKIP_SOURCE_MODULES.includes(logData.sourceModule)) {
    return false;
  }
  
  // Skip if event type is in blacklist
  if (logData.eventType && LOGGING_CONFIG.SKIP_EVENT_TYPES.includes(logData.eventType)) {
    return false;
  }
  
  // Skip if context type is in blacklist
  if (logData.contextType && LOGGING_CONFIG.SKIP_CONTEXT_TYPES.includes(logData.contextType)) {
    return false;
  }
  
  // Skip if urgency score is too low
  if (logData.urgencyScore && logData.urgencyScore < LOGGING_CONFIG.MIN_URGENCY_SCORE) {
    return false;
  }
  
  // Only allow specific event types (whitelist approach)
  if (logData.eventType && !LOGGING_CONFIG.ALLOWED_EVENT_TYPES.includes(logData.eventType)) {
    return false;
  }
  
  // Apply sampling for high-volume events
  if (Math.random() > LOGGING_CONFIG.SAMPLING_RATE) {
    return false;
  }
  
  return true;
}

/**
 * Check rate limiting for logging
 */
export async function checkRateLimiting(tenantId?: string): Promise<boolean> {
  try {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    // Check global rate limiting
    const globalKey = `rate_limit:global:${Math.floor(now / (60 * 60 * 1000))}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    const globalSnap = await globalRef.get();
    
    if (globalSnap.exists) {
      const globalData = globalSnap.data() as any;
      if (globalData.count >= LOGGING_CONFIG.MAX_LOGS_PER_HOUR_GLOBAL) {
        console.log('🚫 Global rate limit exceeded for AI logging');
        return false;
      }
    }
    
    // Check tenant-specific rate limiting
    if (tenantId) {
      const tenantKey = `rate_limit:tenant:${tenantId}:${Math.floor(now / (60 * 60 * 1000))}`;
      const tenantRef = db.collection('ai_cache').doc(tenantKey);
      const tenantSnap = await tenantRef.get();
      
      if (tenantSnap.exists) {
        const tenantData = tenantSnap.data() as any;
        if (tenantData.count >= LOGGING_CONFIG.MAX_LOGS_PER_HOUR_PER_TENANT) {
          console.log(`🚫 Tenant rate limit exceeded for AI logging: ${tenantId}`);
          return false;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error checking rate limiting:', error);
    return false; // Fail safe - don't log if we can't check rate limits
  }
}

/**
 * Update rate limiting counters
 */
export async function updateRateLimiting(tenantId?: string): Promise<void> {
  try {
    const now = Date.now();
    const hourKey = Math.floor(now / (60 * 60 * 1000));
    
    // Update global counter
    const globalKey = `rate_limit:global:${hourKey}`;
    const globalRef = db.collection('ai_cache').doc(globalKey);
    await globalRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Update tenant counter
    if (tenantId) {
      const tenantKey = `rate_limit:tenant:${tenantId}:${hourKey}`;
      const tenantRef = db.collection('ai_cache').doc(tenantKey);
      await tenantRef.set({
        count: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  } catch (error) {
    console.error('Error updating rate limiting:', error);
  }
}

/**
 * Optimized AI logging function that only logs what's truly important
 */
export async function logAIActionOptimized(logData: {
  eventType: string;
  targetType: string;
  targetId: string;
  reason: string;
  contextType: string;
  aiTags: string[];
  urgencyScore: number;
  tenantId?: string;
  userId?: string;
  [key: string]: any;
}): Promise<string | null> {
  try {
    // Check if this event should be logged
    if (!shouldLogEvent(logData)) {
      console.log(`🚫 Skipping AI log for ${logData.eventType} (filtered out)`);
      return null;
    }
    
    // Check rate limiting
    if (!(await checkRateLimiting(logData.tenantId))) {
      console.log(`🚫 Rate limit exceeded for AI log: ${logData.eventType}`);
      return null;
    }
    
    // Create the log entry
    const logId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const aiLogData: any = {
      eventType: logData.eventType,
      targetType: logData.targetType,
      targetId: logData.targetId,
      reason: logData.reason,
      contextType: logData.contextType,
      aiTags: logData.aiTags,
      urgencyScore: logData.urgencyScore,
      tenantId: logData.tenantId || '',
      userId: logData.userId || '',
      aiRelevant: true,
      processed: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      _optimized: true,
      _filtered: false,
      _rateLimited: false
    };
    
    // Add additional fields if provided
    if (logData.inputPrompt) aiLogData.inputPrompt = logData.inputPrompt;
    if (logData.aiResponse) aiLogData.aiResponse = logData.aiResponse;
    if (logData.success !== undefined) aiLogData.success = logData.success;
    if (logData.latencyMs) aiLogData.latencyMs = logData.latencyMs;
    if (logData.errorMessage) aiLogData.errorMessage = logData.errorMessage;
    
    // Save to Firestore
    await db.collection('ai_logs').doc(logId).set(aiLogData);
    
    // Update rate limiting counters
    await updateRateLimiting(logData.tenantId);
    
    console.log(`✅ AI log created (optimized): ${logId} - ${logData.eventType}`);
    return logId;
    
  } catch (error) {
    console.error('❌ Error creating optimized AI log:', error);
    return null;
  }
}

/**
 * Get logging statistics for monitoring
 */
export async function getLoggingStats(): Promise<{
  totalLogs: number;
  filteredLogs: number;
  rateLimitedLogs: number;
  costSavings: number;
}> {
  try {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    // Get recent logs count
    const recentLogsQuery = db.collection('ai_logs')
      .where('createdAt', '>', new Date(hourAgo))
      .where('_optimized', '==', true);
    
    const recentLogsSnap = await recentLogsQuery.get();
    const totalLogs = recentLogsSnap.size;
    
    // Get filtered logs count
    const filteredLogsQuery = db.collection('ai_logs')
      .where('createdAt', '>', new Date(hourAgo))
      .where('_filtered', '==', true);
    
    const filteredLogsSnap = await filteredLogsQuery.get();
    const filteredLogs = filteredLogsSnap.size;
    
    // Get rate limited logs count
    const rateLimitedLogsQuery = db.collection('ai_logs')
      .where('createdAt', '>', new Date(hourAgo))
      .where('_rateLimited', '==', true);
    
    const rateLimitedLogsSnap = await rateLimitedLogsQuery.get();
    const rateLimitedLogs = rateLimitedLogsSnap.size;
    
    // Estimate cost savings (assuming each log costs $0.001)
    const costSavings = (filteredLogs + rateLimitedLogs) * 0.001;
    
    return {
      totalLogs,
      filteredLogs,
      rateLimitedLogs,
      costSavings
    };
  } catch (error) {
    console.error('Error getting logging stats:', error);
    return {
      totalLogs: 0,
      filteredLogs: 0,
      rateLimitedLogs: 0,
      costSavings: 0
    };
  }
}
