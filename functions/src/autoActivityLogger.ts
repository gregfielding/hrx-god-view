import { logAIAction } from './utils/aiLogging';

/**
 * Auto Activity Logger - Automatically logs activities for AI-worthy events
 * This function is called whenever important actions occur in the system
 */

export interface AutoActivityLogData {
  eventType: string;
  targetType: string;
  targetId: string;
  reason: string;
  tenantId: string;
  userId: string;
  urgencyScore?: number;
  aiTags?: string[];
  metadata?: any;
  associations?: any;
}

/**
 * Log an activity automatically when an AI-worthy event occurs
 */
export const autoLogActivity = async (logData: AutoActivityLogData): Promise<string> => {
  try {
    console.log(`🔄 Auto-logging activity: ${logData.eventType} for ${logData.targetType}:${logData.targetId}`);
    
    // Create AI log entry
    const aiLogId = await logAIAction({
      eventType: logData.eventType,
      targetType: logData.targetType,
      targetId: logData.targetId,
      reason: logData.reason,
      contextType: 'activity',
      aiTags: logData.aiTags || [logData.eventType.split('.')[0]],
      urgencyScore: logData.urgencyScore || 3,
      tenantId: logData.tenantId,
      userId: logData.userId,
      associations: logData.associations || {},
      metadata: logData.metadata || {},
      success: true,
      latencyMs: 0, // Auto-logged activities don't have latency
    });

    console.log(`✅ Auto-activity logged: ${aiLogId}`);
    return aiLogId;
    
  } catch (error) {
    console.error('❌ Error auto-logging activity:', error);
    throw error;
  }
};

/**
 * Log contact-related activities
 */
export const logContactActivity = async (
  eventType: string,
  contactId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `contact.${eventType}`,
    targetType: 'contact',
    targetId: contactId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['contact', eventType],
    metadata,
  });
};

/**
 * Log deal-related activities
 */
export const logDealActivity = async (
  eventType: string,
  dealId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `deal.${eventType}`,
    targetType: 'deal',
    targetId: dealId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['deal', eventType],
    metadata,
  });
};

/**
 * Log company-related activities
 */
export const logCompanyActivity = async (
  eventType: string,
  companyId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `company.${eventType}`,
    targetType: 'company',
    targetId: companyId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['company', eventType],
    metadata,
  });
};

/**
 * Log location-related activities
 */
export const logLocationActivity = async (
  eventType: string,
  locationId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `location.${eventType}`,
    targetType: 'location',
    targetId: locationId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['location', eventType],
    metadata,
  });
};

/**
 * Log salesperson-related activities
 */
export const logSalespersonActivity = async (
  eventType: string,
  salespersonId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `salesperson.${eventType}`,
    targetType: 'salesperson',
    targetId: salespersonId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['salesperson', eventType],
    metadata,
  });
};

/**
 * Log task-related activities
 */
export const logTaskActivity = async (
  eventType: string,
  taskId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `task.${eventType}`,
    targetType: 'task',
    targetId: taskId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['task', eventType],
    metadata,
  });
};

/**
 * Log email-related activities
 */
export const logEmailActivity = async (
  eventType: string,
  emailId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `email.${eventType}`,
    targetType: 'email',
    targetId: emailId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['email', eventType],
    metadata,
  });
};

/**
 * Log note-related activities
 */
export const logNoteActivity = async (
  eventType: string,
  noteId: string,
  reason: string,
  tenantId: string,
  userId: string,
  metadata?: any
): Promise<string> => {
  return await autoLogActivity({
    eventType: `note.${eventType}`,
    targetType: 'note',
    targetId: noteId,
    reason,
    tenantId,
    userId,
    urgencyScore: getUrgencyScore(eventType),
    aiTags: ['note', eventType],
    metadata,
  });
};

/**
 * Determine urgency score based on event type
 */
function getUrgencyScore(eventType: string): number {
  const urgencyMap: { [key: string]: number } = {
    // High urgency events (8-10)
    'created': 8,
    'updated': 7,
    'deleted': 9,
    'status_changed': 8,
    'assigned': 8,
    'completed': 7,
    'cancelled': 9,
    
    // Medium urgency events (5-7)
    'viewed': 5,
    'searched': 5,
    'filtered': 5,
    'exported': 6,
    'imported': 7,
    'enhanced': 6,
    'enriched': 6,
    
    // Low urgency events (1-4)
    'logged': 3,
    'tracked': 3,
    'monitored': 2,
    'analyzed': 4,
    'reported': 4,
  };

  return urgencyMap[eventType] || 3; // Default to medium-low urgency
}

/**
 * Common activity logging functions for specific scenarios
 */

// Contact activities
export const logContactCreated = (contactId: string, reason: string, tenantId: string, userId: string) =>
  logContactActivity('created', contactId, reason, tenantId, userId);

export const logContactUpdated = (contactId: string, reason: string, tenantId: string, userId: string, metadata?: any) =>
  logContactActivity('updated', contactId, reason, tenantId, userId, metadata);

export const logContactEnhanced = (contactId: string, reason: string, tenantId: string, userId: string, metadata?: any) =>
  logContactActivity('enhanced', contactId, reason, tenantId, userId, metadata);

export const logContactEmailFound = (contactId: string, email: string, tenantId: string, userId: string) =>
  logContactActivity('email_found', contactId, `Found email: ${email}`, tenantId, userId, { email });

export const logContactPhoneFound = (contactId: string, phone: string, tenantId: string, userId: string) =>
  logContactActivity('phone_found', contactId, `Found phone: ${phone}`, tenantId, userId, { phone });

// Deal activities
export const logDealCreated = (dealId: string, reason: string, tenantId: string, userId: string) =>
  logDealActivity('created', dealId, reason, tenantId, userId);

export const logDealUpdated = (dealId: string, reason: string, tenantId: string, userId: string, metadata?: any) =>
  logDealActivity('updated', dealId, reason, tenantId, userId, metadata);

export const logDealStageChanged = (dealId: string, oldStage: string, newStage: string, tenantId: string, userId: string) =>
  logDealActivity('stage_changed', dealId, `Stage changed from ${oldStage} to ${newStage}`, tenantId, userId, { oldStage, newStage });

// Company activities
export const logCompanyCreated = (companyId: string, reason: string, tenantId: string, userId: string) =>
  logCompanyActivity('created', companyId, reason, tenantId, userId);

export const logCompanyUpdated = (companyId: string, reason: string, tenantId: string, userId: string, metadata?: any) =>
  logCompanyActivity('updated', companyId, reason, tenantId, userId, metadata);

export const logCompanyEnhanced = (companyId: string, reason: string, tenantId: string, userId: string, metadata?: any) =>
  logCompanyActivity('enhanced', companyId, reason, tenantId, userId, metadata);

// Task activities
export const logTaskCreated = (taskId: string, reason: string, tenantId: string, userId: string) =>
  logTaskActivity('created', taskId, reason, tenantId, userId);

export const logTaskCompleted = (taskId: string, reason: string, tenantId: string, userId: string) =>
  logTaskActivity('completed', taskId, reason, tenantId, userId);

export const logTaskCancelled = (taskId: string, reason: string, tenantId: string, userId: string) =>
  logTaskActivity('cancelled', taskId, reason, tenantId, userId);

// Note activities
export const logNoteAdded = (noteId: string, reason: string, tenantId: string, userId: string) =>
  logNoteActivity('added', noteId, reason, tenantId, userId);

export const logNoteUpdated = (noteId: string, reason: string, tenantId: string, userId: string) =>
  logNoteActivity('updated', noteId, reason, tenantId, userId);

// Association activities
export const logAssociationAdded = (entityType: string, entityId: string, targetType: string, targetId: string, tenantId: string, userId: string) =>
  autoLogActivity({
    eventType: `association.added`,
    targetType: entityType,
    targetId: entityId,
    reason: `Added association to ${targetType}`,
    tenantId,
    userId,
    urgencyScore: 6,
    aiTags: ['association', 'added'],
    metadata: { targetType, targetId },
  });

export const logAssociationRemoved = (entityType: string, entityId: string, targetType: string, targetId: string, tenantId: string, userId: string) =>
  autoLogActivity({
    eventType: `association.removed`,
    targetType: entityType,
    targetId: entityId,
    reason: `Removed association to ${targetType}`,
    tenantId,
    userId,
    urgencyScore: 6,
    aiTags: ['association', 'removed'],
    metadata: { targetType, targetId },
  }); 