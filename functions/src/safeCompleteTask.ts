import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe task completion
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'completeTask@v2',
  // Input validation limits
  MAX_ACTION_RESULT_LENGTH: 2000,
  MAX_FOLLOW_UP_TITLE_LENGTH: 200,
  MAX_FOLLOW_UP_DESCRIPTION_LENGTH: 2000,
  // Query limits
  MAX_USER_LOOKUPS: 2,
  MAX_TASK_OPERATIONS: 5,
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
  taskId: string;
  tenantId: string;
  actionResult?: string;
  followUpTask?: {
    title: string;
    description?: string;
    type?: string;
    priority?: string;
    dueDate?: string;
  };
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { taskId, tenantId, actionResult, followUpTask } = data;

  // Required field validation
  if (!taskId || typeof taskId !== 'string' || taskId.trim() === '') {
    throw new Error('taskId is required and must be a non-empty string');
  }

  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  // Optional field validation
  if (actionResult && (typeof actionResult !== 'string' || actionResult.length > SAFE_CONFIG.MAX_ACTION_RESULT_LENGTH)) {
    throw new Error(`actionResult must be a string and ${SAFE_CONFIG.MAX_ACTION_RESULT_LENGTH} characters or less`);
  }

  // Follow-up task validation
  if (followUpTask) {
    if (typeof followUpTask !== 'object') {
      throw new Error('followUpTask must be an object');
    }

    if (!followUpTask.title || typeof followUpTask.title !== 'string' || followUpTask.title.trim() === '') {
      throw new Error('followUpTask.title is required and must be a non-empty string');
    }

    if (followUpTask.title.length > SAFE_CONFIG.MAX_FOLLOW_UP_TITLE_LENGTH) {
      throw new Error(`followUpTask.title must be ${SAFE_CONFIG.MAX_FOLLOW_UP_TITLE_LENGTH} characters or less`);
    }

    if (followUpTask.description && (typeof followUpTask.description !== 'string' || followUpTask.description.length > SAFE_CONFIG.MAX_FOLLOW_UP_DESCRIPTION_LENGTH)) {
      throw new Error(`followUpTask.description must be a string and ${SAFE_CONFIG.MAX_FOLLOW_UP_DESCRIPTION_LENGTH} characters or less`);
    }

    if (followUpTask.type && typeof followUpTask.type !== 'string') {
      throw new Error('followUpTask.type must be a string');
    }

    if (followUpTask.priority && typeof followUpTask.priority !== 'string') {
      throw new Error('followUpTask.priority must be a string');
    }

    if (followUpTask.dueDate && typeof followUpTask.dueDate !== 'string') {
      throw new Error('followUpTask.dueDate must be a string');
    }
  }

  return {
    taskId: taskId.trim(),
    tenantId: tenantId.trim(),
    actionResult: actionResult?.trim(),
    followUpTask: followUpTask ? {
      title: followUpTask.title.trim(),
      description: followUpTask.description?.trim(),
      type: followUpTask.type,
      priority: followUpTask.priority,
      dueDate: followUpTask.dueDate
    } : undefined
  };
}

/**
 * Get task data safely
 */
async function getTaskDataSafely(taskId: string, tenantId: string): Promise<{ taskData: any; taskRef: any }> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getTaskDataSafely', 0.001);

  const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
  const taskDoc = await taskRef.get();

  if (!taskDoc.exists) {
    throw new Error(`Task ${taskId} not found`);
  }

  const taskData = taskDoc.data();
  if (!taskData) {
    throw new Error(`Task ${taskId} has no data`);
  }

  return { taskData, taskRef };
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
 * Create AI log safely
 */
async function createTaskAILogSafely(
  eventType: string,
  taskId: string,
  reason: string,
  tenantId: string,
  userId: string,
  associations: any,
  aiResponse: string
): Promise<void> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('createTaskAILogSafely', 0.001);

  try {
    const { createTaskAILog } = await import('./utils/aiLogging');
    await createTaskAILog(eventType, taskId, reason, tenantId, userId, associations, aiResponse);
  } catch (error) {
    console.warn('⚠️ Failed to create AI log:', error);
  }
}

/**
 * Create follow-up task safely
 */
async function createFollowUpTaskSafely(
  followUpTask: any,
  originalTaskData: any,
  tenantId: string
): Promise<string | null> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('createFollowUpTaskSafely', 0.01);

  try {
    // Get user name for follow-up task
    const assignedToName = await getUserNameSafely(originalTaskData.assignedTo);

    const followUpData = {
      ...followUpTask,
      assignedTo: originalTaskData.assignedTo,
      assignedToName,
      createdBy: originalTaskData.assignedTo,
      createdByName: assignedToName,
      tenantId,
      associations: originalTaskData.associations || {},
      aiSuggested: true,
      aiPrompt: `Follow-up task after completing "${originalTaskData.title}"`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const followUpRef = await db.collection('tenants').doc(tenantId).collection('tasks').add(followUpData);
    
    console.log(`✅ Follow-up task created: ${followUpRef.id}`);
    return followUpRef.id;
  } catch (error) {
    console.error('❌ Error creating follow-up task:', error);
    return null;
  }
}

/**
 * Create next repeating task safely
 */
async function createNextRepeatingTaskSafely(taskId: string, tenantId: string, assignedTo: string): Promise<{ success: boolean; taskId?: string; message: string }> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('createNextRepeatingTaskSafely', 0.01);

  try {
    // For now, we'll implement a simplified version
    // In a real implementation, this would create the next occurrence of the repeating task
    console.log(`ℹ️ Repeating task handling not implemented for ${taskId}`);
    return { success: false, message: 'Repeating task handling not implemented' };
  } catch (error) {
    console.warn('⚠️ Failed to create next repeating task:', error);
    return { success: false, message: 'Failed to create repeating task' };
  }
}

/**
 * Safe version of completeTask with hardening playbook compliance
 */
export const completeTask = onCall(
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
      const { taskId, tenantId, actionResult, followUpTask } = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get task data safely
      const { taskData, taskRef } = await getTaskDataSafely(taskId, tenantId);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Update task status
      const updateData: any = {
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (actionResult) {
        updateData.actionResult = actionResult;
      }

      await taskRef.update(updateData);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Create AI log for task completion
      await createTaskAILogSafely(
        'task.completed',
        taskId,
        `Task "${taskData.title}" completed by ${taskData.assignedTo}`,
        tenantId,
        taskData.assignedTo,
        taskData.associations,
        JSON.stringify({
          actionResult,
          followUpTask,
          originalType: taskData.type,
          originalPriority: taskData.priority,
          quotaCategory: taskData.quotaCategory
        })
      );

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Create follow-up task if specified
      let followUpTaskId: string | null = null;
      if (followUpTask) {
        followUpTaskId = await createFollowUpTaskSafely(followUpTask, taskData, tenantId);

        // Check abort signal
        if (abort.aborted) {
          throw new Error('Function execution timeout');
        }

        // Create AI log for follow-up task
        if (followUpTaskId) {
          await createTaskAILogSafely(
            'task.follow_up_created',
            followUpTaskId,
            `Follow-up task "${followUpTask.title}" created after completing "${taskData.title}"`,
            tenantId,
            taskData.assignedTo,
            taskData.associations,
            JSON.stringify(followUpTask)
          );
        }
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Handle repeating tasks
      let repeatingTaskResult = null;
      if (taskData.isRepeating && taskData.repeatInterval) {
        repeatingTaskResult = await createNextRepeatingTaskSafely(taskId, tenantId, taskData.assignedTo);
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Task completion completed for ${taskId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        success: true,
        message: 'Task completed successfully',
        followUpTaskId: followUpTaskId ? 'created' : null,
        repeatingTaskCreated: repeatingTaskResult?.success || false,
        _metadata: {
          taskId,
          tenantId,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('Error in completeTask:', error);
      throw new Error(`Failed to complete task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
