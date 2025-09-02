import * as admin from 'firebase-admin';

const db = admin.firestore();

// Recursively remove undefined values from objects/arrays to satisfy Firestore rules
function sanitizeForFirestore(input: any): any {
  if (input === undefined) return undefined; // caller should delete keys with undefined
  if (input === null) return null;
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForFirestore(item)).filter((v) => v !== undefined);
  }
  if (typeof input === 'object') {
    // Do not attempt to sanitize Firestore FieldValue sentinels
    const isFieldValue = typeof (input as any)._methodName === 'string' && (input as any)._methodName.length > 0;
    if (isFieldValue) return input;
    const out: any = {};
    Object.keys(input).forEach((key) => {
      const val = sanitizeForFirestore((input as any)[key]);
      if (val !== undefined) out[key] = val;
    });
    return out;
  }
  return input;
}

/**
 * AI Logging Utility - Creates AI logs for processing by the AI engine
 * This function is used by various AI engines to log their activities
 */
export const logAIAction = async (logData: {
  eventType: string;
  targetType: string;
  targetId: string;
  reason: string;
  contextType: string;
  aiTags: string[];
  urgencyScore: number;
  inputPrompt?: string;
  composedPrompt?: string;
  aiResponse?: string;
  success?: boolean;
  latencyMs?: number;
  errorMessage?: string;
  tenantId?: string;
  userId?: string;
  associations?: any;
  metadata?: any;
  promptHash?: string;
  promptVersion?: string;
  schemaVersion?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheHit?: boolean;
  requestId?: string;
  sourceModule?: string; // Added for cost containment
}): Promise<string> => {
  // 🚨 EMERGENCY COST CONTAINMENT: Aggressive sampling to reduce logs by 99%
  
  // 1. Skip low-urgency events entirely (urgencyScore < 7)
  if (logData.urgencyScore < 7) {
    console.log(`🚨 AI Logging blocked: Low urgency score ${logData.urgencyScore} for ${logData.eventType}`);
    return 'blocked_low_urgency';
  }
  
  // 2. Skip non-critical event types
  const criticalEvents = [
    'dealCoach.analyze',
    'dealCoach.chat',
    'ai_log.created',
    'ai_log.updated',
    'ai_log.deleted'
  ];
  
  if (!criticalEvents.some(event => logData.eventType?.includes(event))) {
    console.log(`🚨 AI Logging blocked: Non-critical event type ${logData.eventType}`);
    return 'blocked_non_critical';
  }
  
  // 3. Aggressive sampling: only log 1% of events (99% blocked)
  if (Math.random() > 0.01) {
    console.log(`🚨 AI Logging sampled out: ${logData.eventType} (1% sampling)`);
    return 'sampled_out';
  }
  
  // 4. Skip if sourceModule is FirestoreTrigger to prevent loops
  if (logData.sourceModule === 'FirestoreTrigger') {
    console.log(`🚨 AI Logging blocked: FirestoreTrigger source to prevent loops`);
    return 'blocked_firestore_trigger';
  }
  
  try {
    const logId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const aiLogDataRaw = {
      eventType: logData.eventType,
      targetType: logData.targetType,
      targetId: logData.targetId,
      reason: logData.reason,
      contextType: logData.contextType,
      aiTags: logData.aiTags,
      urgencyScore: logData.urgencyScore,
      inputPrompt: logData.inputPrompt || '',
      composedPrompt: logData.composedPrompt || '',
      aiResponse: logData.aiResponse || '',
      success: logData.success !== undefined ? logData.success : true,
      latencyMs: logData.latencyMs || 0,
      errorMessage: logData.errorMessage || '',
      tenantId: logData.tenantId || '',
      userId: logData.userId || '',
      associations: logData.associations || {},
      metadata: logData.metadata || {},
      aiRelevant: true,
      processed: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processingStartedAt: null,
      processingCompletedAt: null,
      engineTouched: [],
      processingResults: [],
      errors: [],
      promptHash: logData.promptHash || '',
      promptVersion: logData.promptVersion || '',
      schemaVersion: logData.schemaVersion || '',
      model: logData.model || '',
      tokensIn: logData.tokensIn || 0,
      tokensOut: logData.tokensOut || 0,
      cacheHit: logData.cacheHit ?? false,
      requestId: logData.requestId || '',
      _costContainment: {
        sampled: true,
        originalUrgencyScore: logData.urgencyScore,
        timestamp: new Date().toISOString()
      }
    };

    // Sanitize to remove undefined values while preserving serverTimestamp sentinel
    const aiLogData = sanitizeForFirestore(aiLogDataRaw);

    await db.collection('ai_logs').doc(logId).set(aiLogData);
    
    console.log(`✅ AI log created (EMERGENCY MODE): ${logId} - ${logData.eventType}`);
    return logId;
    
  } catch (error) {
    console.error('❌ Error creating AI log:', error);
    throw error;
  }
};

/**
 * Create a simple AI log for basic operations
 */
export const createSimpleAILog = async (
  eventType: string,
  targetType: string,
  targetId: string,
  reason: string,
  tenantId?: string,
  userId?: string
): Promise<string> => {
  return await logAIAction({
    eventType,
    targetType,
    targetId,
    reason,
    contextType: 'general',
    aiTags: [eventType.split('.')[0]],
    urgencyScore: 3,
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {})
  });
};

/**
 * Create an AI log for task-related events
 */
export const createTaskAILog = async (
  eventType: string,
  taskId: string,
  reason: string,
  tenantId: string,
  userId: string,
  associations?: any,
  aiResponse?: string
): Promise<string> => {
  return await logAIAction({
    eventType,
    targetType: 'task',
    targetId: taskId,
    reason,
    contextType: 'tasks',
    aiTags: ['task', eventType.split('.')[1] || 'general'],
    urgencyScore: 5,
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {}),
    associations,
    ...(aiResponse ? { aiResponse } : {})
  });
};

/**
 * Create an AI log for deal-related events
 */
export const createDealAILog = async (
  eventType: string,
  dealId: string,
  reason: string,
  tenantId: string,
  userId: string,
  associations?: any,
  aiResponse?: string
): Promise<string> => {
  return await logAIAction({
    eventType,
    targetType: 'deal',
    targetId: dealId,
    reason,
    contextType: 'deals',
    aiTags: ['deal', eventType.split('.')[1] || 'general'],
    urgencyScore: 6,
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {}),
    associations,
    ...(aiResponse ? { aiResponse } : {})
  });
};

/**
 * Create an AI log for contact-related events
 */
export const createContactAILog = async (
  eventType: string,
  contactId: string,
  reason: string,
  tenantId: string,
  userId: string,
  associations?: any,
  aiResponse?: string
): Promise<string> => {
  return await logAIAction({
    eventType,
    targetType: 'contact',
    targetId: contactId,
    reason,
    contextType: 'contacts',
    aiTags: ['contact', eventType.split('.')[1] || 'general'],
    urgencyScore: 4,
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {}),
    associations,
    ...(aiResponse ? { aiResponse } : {})
  });
};

/**
 * Create an AI log for company-related events
 */
export const createCompanyAILog = async (
  eventType: string,
  companyId: string,
  reason: string,
  tenantId: string,
  userId: string,
  associations?: any,
  aiResponse?: string
): Promise<string> => {
  return await logAIAction({
    eventType,
    targetType: 'company',
    targetId: companyId,
    reason,
    contextType: 'companies',
    aiTags: ['company', eventType.split('.')[1] || 'general'],
    urgencyScore: 4,
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {}),
    associations,
    ...(aiResponse ? { aiResponse } : {})
  });
}; 