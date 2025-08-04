import * as admin from 'firebase-admin';

const db = admin.firestore();

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
}): Promise<string> => {
  try {
    const logId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const aiLogData = {
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
      errors: []
    };

    await db.collection('ai_logs').doc(logId).set(aiLogData);
    
    console.log(`✅ AI log created: ${logId} - ${logData.eventType}`);
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
    tenantId,
    userId
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
    tenantId,
    userId,
    associations,
    aiResponse
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
    tenantId,
    userId,
    associations,
    aiResponse
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
    tenantId,
    userId,
    associations,
    aiResponse
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
    tenantId,
    userId,
    associations,
    aiResponse
  });
}; 