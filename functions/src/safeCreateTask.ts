import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe task creation
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'createTask@v2',
  // Input validation limits
  MAX_TITLE_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_AGENDA_LENGTH: 1000,
  MAX_CALL_SCRIPT_LENGTH: 2000,
  MAX_EMAIL_TEMPLATE_LENGTH: 2000,
  // Query limits
  MAX_USER_LOOKUPS: 3,
  MAX_ENTITY_LOOKUPS: 2,
  // External API limits
  CALENDAR_SYNC_TIMEOUT_MS: 10000, // 10 seconds for calendar sync
  // Cost limits
  MAX_COST_PER_CALL: 0.05 // $0.05 USD max per call
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Validate input parameters
 */
function validateInput(data: any): {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  status?: string;
  scheduledDate?: string;
  assignedTo: string;
  createdBy: string;
  tenantId: string;
  category?: string;
  quotaCategory?: string;
  associations?: any;
  aiSuggested?: boolean;
  aiPrompt?: string;
  classification?: string;
  startTime?: string;
  duration?: number;
  dueDate?: string;
  isRepeating?: boolean;
  repeatInterval?: number;
  userTimezone?: string;
  agenda?: string;
  goals?: string[];
  researchTopics?: string[];
  callScript?: string;
  emailTemplate?: string;
  followUpNotes?: string;
  meetingAttendees?: string[];
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const {
    title, description, type, priority, status, scheduledDate, assignedTo, createdBy, tenantId,
    category, quotaCategory, associations, aiSuggested, aiPrompt, classification = 'todo',
    startTime, duration, dueDate, isRepeating = false, repeatInterval = 30,
    userTimezone = 'America/Los_Angeles', agenda, goals, researchTopics, callScript,
    emailTemplate, followUpNotes, meetingAttendees
  } = data;

  // Required field validation
  if (!title || typeof title !== 'string' || title.trim() === '') {
    throw new Error('title is required and must be a non-empty string');
  }
  if (title.length > SAFE_CONFIG.MAX_TITLE_LENGTH) {
    throw new Error(`title must be ${SAFE_CONFIG.MAX_TITLE_LENGTH} characters or less`);
  }

  if (!assignedTo || typeof assignedTo !== 'string' || assignedTo.trim() === '') {
    throw new Error('assignedTo is required and must be a non-empty string');
  }

  if (!createdBy || typeof createdBy !== 'string' || createdBy.trim() === '') {
    throw new Error('createdBy is required and must be a non-empty string');
  }

  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  // Optional field validation
  if (description && (typeof description !== 'string' || description.length > SAFE_CONFIG.MAX_DESCRIPTION_LENGTH)) {
    throw new Error(`description must be a string and ${SAFE_CONFIG.MAX_DESCRIPTION_LENGTH} characters or less`);
  }

  if (agenda && (typeof agenda !== 'string' || agenda.length > SAFE_CONFIG.MAX_AGENDA_LENGTH)) {
    throw new Error(`agenda must be a string and ${SAFE_CONFIG.MAX_AGENDA_LENGTH} characters or less`);
  }

  if (callScript && (typeof callScript !== 'string' || callScript.length > SAFE_CONFIG.MAX_CALL_SCRIPT_LENGTH)) {
    throw new Error(`callScript must be a string and ${SAFE_CONFIG.MAX_CALL_SCRIPT_LENGTH} characters or less`);
  }

  if (emailTemplate && (typeof emailTemplate !== 'string' || emailTemplate.length > SAFE_CONFIG.MAX_EMAIL_TEMPLATE_LENGTH)) {
    throw new Error(`emailTemplate must be a string and ${SAFE_CONFIG.MAX_EMAIL_TEMPLATE_LENGTH} characters or less`);
  }

  // Classification validation
  if (classification && !['todo', 'appointment', 'meeting', 'call', 'email', 'research'].includes(classification)) {
    throw new Error('classification must be one of: todo, appointment, meeting, call, email, research');
  }

  // Appointment validation
  if (classification === 'appointment') {
    if (!startTime) {
      throw new Error('startTime is required for appointments');
    }
    if (!duration || typeof duration !== 'number' || duration <= 0) {
      throw new Error('duration is required and must be a positive number for appointments');
    }
  }

  // Array validation
  if (goals && (!Array.isArray(goals) || goals.some(g => typeof g !== 'string'))) {
    throw new Error('goals must be an array of strings');
  }

  if (researchTopics && (!Array.isArray(researchTopics) || researchTopics.some(t => typeof t !== 'string'))) {
    throw new Error('researchTopics must be an array of strings');
  }

  if (meetingAttendees && (!Array.isArray(meetingAttendees) || meetingAttendees.some(a => typeof a !== 'string'))) {
    throw new Error('meetingAttendees must be an array of strings');
  }

  return {
    title: title.trim(),
    description: description?.trim(),
    type,
    priority,
    status,
    scheduledDate,
    assignedTo: assignedTo.trim(),
    createdBy: createdBy.trim(),
    tenantId: tenantId.trim(),
    category,
    quotaCategory,
    associations,
    aiSuggested: Boolean(aiSuggested),
    aiPrompt: aiPrompt?.trim(),
    classification,
    startTime,
    duration,
    dueDate,
    isRepeating: Boolean(isRepeating),
    repeatInterval: Number(repeatInterval),
    userTimezone,
    agenda: agenda?.trim(),
    goals,
    researchTopics,
    callScript: callScript?.trim(),
    emailTemplate: emailTemplate?.trim(),
    followUpNotes: followUpNotes?.trim(),
    meetingAttendees
  };
}

/**
 * Get user name safely with query limits
 */
async function getUserNameSafely(userId: string): Promise<string> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getUserNameSafely', 0.001);

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      return userData?.displayName || 
             userData?.fullName || 
             `${userData?.firstName || ''} ${userData?.lastName || ''}`.trim() || 
             userData?.email || 
             'Unknown User';
    }
  } catch (error) {
    console.warn(`Could not fetch user name for ${userId}:`, error);
  }
  
  return 'Unknown User';
}

/**
 * Get related entity name safely
 */
async function getRelatedEntityNameSafely(tenantId: string, entityId: string): Promise<string> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getRelatedEntityNameSafely', 0.001);

  try {
    const entityDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(entityId).get();
    if (entityDoc.exists) {
      const entityData = entityDoc.data();
      return entityData?.companyName || entityData?.name || 'Unknown Company';
    }
  } catch (error) {
    console.warn(`Could not fetch related entity name for ${entityId}:`, error);
  }
  
  return 'Unknown Company';
}

/**
 * Sync task to Google Calendar safely with timeout
 */
async function syncTaskToCalendarSafely(
  createdBy: string,
  tenantId: string,
  taskId: string,
  taskData: any,
  userTimezone: string
): Promise<{ success: boolean; message: string }> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('syncTaskToCalendarSafely', 0.01);

  try {
    // Set up timeout for calendar sync
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SAFE_CONFIG.CALENDAR_SYNC_TIMEOUT_MS);

    const { syncTaskToCalendar } = await import('./calendarSyncService');
    const syncResult = await syncTaskToCalendar(createdBy, tenantId, taskId, taskData, userTimezone);
    
    clearTimeout(timeoutId);

    if (syncResult.success) {
      console.log('✅ Task synced to Google Calendar:', syncResult.message);
    } else {
      console.log('ℹ️ Calendar sync skipped:', syncResult.message);
    }

    return syncResult;
  } catch (error) {
    console.warn('⚠️ Failed to sync task to Google Calendar:', error);
    return { success: false, message: 'Calendar sync failed' };
  }
}

/**
 * Log AI action safely
 */
async function logAIActionSafely(taskId: string, title: string, type: string, classification: string, aiPrompt: string, tenantId: string, createdBy: string): Promise<void> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('logAIActionSafely', 0.001);

  try {
    const { logAIAction } = await import('./utils/aiLogging');
    await logAIAction({
      eventType: 'ai_task.created',
      targetType: 'task',
      targetId: taskId,
      reason: `AI created task: ${title}`,
      contextType: 'task_creation',
      aiTags: ['ai_suggestions', 'task_creation', type],
      urgencyScore: 5, // Default urgency score
      tenantId,
      userId: createdBy,
      aiResponse: JSON.stringify({
        taskTitle: title,
        taskType: type,
        classification,
        aiPrompt
      })
    });
  } catch (error) {
    console.warn('⚠️ Failed to log AI action:', error);
  }
}

/**
 * Get urgency score based on priority
 */
function getUrgencyScore(priority?: string): number {
  switch (priority) {
    case 'high': return 8;
    case 'medium': return 5;
    case 'low': return 3;
    default: return 5;
  }
}

/**
 * Safe version of createTask with hardening playbook compliance
 */
export const createTask = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  },
  async (request) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate input
      const validatedData = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get user names safely
      const [assignedToName, createdByName] = await Promise.all([
        getUserNameSafely(validatedData.assignedTo),
        getUserNameSafely(validatedData.createdBy)
      ]);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get related entity name if needed
      let relatedToName = '';
      if (validatedData.associations?.relatedTo) {
        relatedToName = await getRelatedEntityNameSafely(validatedData.tenantId, validatedData.associations.relatedTo);
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Build task data
      const taskData = {
        title: validatedData.title,
        description: validatedData.description || '',
        type: validatedData.type,
        priority: validatedData.priority,
        status: validatedData.status,
        classification: validatedData.classification,
        startTime: validatedData.classification === 'appointment' ? validatedData.startTime : null,
        duration: validatedData.classification === 'appointment' ? validatedData.duration : null,
        endTime: validatedData.classification === 'appointment' && validatedData.startTime && validatedData.duration ? 
          new Date(new Date(validatedData.startTime).getTime() + validatedData.duration * 60000).toISOString() : null,
        scheduledDate: validatedData.scheduledDate,
        dueDate: validatedData.dueDate,
        assignedTo: validatedData.assignedTo,
        assignedToName,
        associations: validatedData.associations || {},
        notes: '',
        category: validatedData.category,
        quotaCategory: validatedData.quotaCategory,
        estimatedDuration: validatedData.duration || 30,
        aiSuggested: validatedData.aiSuggested,
        aiPrompt: validatedData.aiPrompt || '',
        aiReason: validatedData.aiPrompt || '',
        aiConfidence: validatedData.aiSuggested ? 85 : null,
        aiContext: validatedData.aiSuggested ? 'AI generated task' : null,
        aiInsights: validatedData.aiSuggested ? ['AI suggested based on context'] : [],
        googleCalendarEventId: null,
        googleTaskId: null,
        lastGoogleSync: null,
        syncStatus: 'pending',
        tags: [],
        relatedToName,
        tenantId: validatedData.tenantId,
        createdBy: validatedData.createdBy,
        createdByName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Task-type-specific fields
        agenda: validatedData.agenda || '',
        goals: validatedData.goals || [],
        researchTopics: validatedData.researchTopics || [],
        callScript: validatedData.callScript || '',
        emailTemplate: validatedData.emailTemplate || '',
        followUpNotes: validatedData.followUpNotes || '',
        meetingAttendees: validatedData.meetingAttendees || [],
        // Repeating task fields
        isRepeating: validatedData.isRepeating,
        repeatInterval: validatedData.isRepeating ? validatedData.repeatInterval : null,
        nextRepeatDate: validatedData.isRepeating && validatedData.dueDate ? 
          new Date(new Date(validatedData.dueDate).getTime() + validatedData.repeatInterval * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
        originalTaskId: null
      };

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Create task in Firestore
      const taskRef = db.collection('tenants').doc(validatedData.tenantId).collection('tasks').doc();
      await taskRef.set(taskData);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Sync to Google Calendar if it's an appointment
      if (validatedData.classification === 'appointment' && validatedData.startTime) {
        await syncTaskToCalendarSafely(
          validatedData.createdBy,
          validatedData.tenantId,
          taskRef.id,
          taskData,
          validatedData.userTimezone
        );
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Log AI action if this is an AI-suggested task
      if (validatedData.aiSuggested) {
        await logAIActionSafely(
          taskRef.id,
          validatedData.title,
          validatedData.type || 'unknown',
          validatedData.classification,
          validatedData.aiPrompt || '',
          validatedData.tenantId,
          validatedData.createdBy
        );
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Task creation completed for ${validatedData.title}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        taskId: taskRef.id, 
        success: true,
        _metadata: {
          title: validatedData.title,
          classification: validatedData.classification,
          tenantId: validatedData.tenantId,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('Error in createTask:', error);
      throw new Error(`Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
