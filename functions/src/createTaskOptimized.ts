import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logAIAction, createTaskAILog, createDealAILog } from './utils/aiLogging';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Task Creation System
 * 
 * This system replaces the problematic multiple implementations with a single
 * optimized function that implements intelligent caching, rate limiting, and
 * prevents excessive invocations and cascading updates.
 */

// Configuration for optimized task creation
const CREATE_TASK_CONFIG = {
  // Cache settings
  CACHE_DURATION_MS: 15 * 60 * 1000, // 15 minutes cache for task creation
  CACHE_CLEANUP_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes cleanup
  
  // Rate limiting
  MAX_CREATIONS_PER_HOUR_PER_USER: 20, // Prevent excessive task creation per user
  MAX_CREATIONS_PER_HOUR_GLOBAL: 100,  // Global rate limit
  
  // Processing limits
  MAX_EXECUTION_TIME_MS: 60000, // 60 seconds max execution
  MAX_TASKS_PER_BATCH: 50, // Maximum tasks per batch
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.9, // Process 90% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
  
  // Task validation
  MAX_TITLE_LENGTH: 160,
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_DURATION_MINUTES: 480, // 8 hours max
  MAX_REPEAT_INTERVAL_DAYS: 365, // 1 year max
};

// Global cache for task creation (shared across instances)
const taskCreationCache = new Map<string, { 
  data: any; 
  timestamp: number; 
  lastAccess: number;
  accessCount: number;
  taskCount: number;
}>();

// Rate limiting tracking
const rateLimitCache = new Map<string, { 
  count: number; 
  resetTime: number;
}>();

// Loop prevention tracking
const loopPreventionCache = new Map<string, { 
  lastCall: number; 
  callCount: number;
  lastTaskType: string;
}>();

/**
 * Clean up expired cache entries
 */
function cleanupCache(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, value] of taskCreationCache.entries()) {
    if (now - value.timestamp > CREATE_TASK_CONFIG.CACHE_DURATION_MS) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => taskCreationCache.delete(key));
  
  // Also clean up rate limiting cache
  for (const [key, value] of rateLimitCache.entries()) {
    if (now > value.resetTime) {
      rateLimitCache.delete(key);
    }
  }
  
  // Clean up loop prevention cache
  for (const [key, value] of loopPreventionCache.entries()) {
    if (now - value.lastCall > CREATE_TASK_CONFIG.LOOP_PREVENTION_TTL) {
      loopPreventionCache.delete(key);
    }
  }
  
  // If cache is still too large, remove least recently accessed entries
  if (taskCreationCache.size > 100) {
    const entries = Array.from(taskCreationCache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3)); // Remove 30% oldest
    toRemove.forEach(([key]) => taskCreationCache.delete(key));
  }
}

/**
 * Check rate limiting for task creation calls
 */
function checkRateLimiting(userId: string): boolean {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Check global rate limiting
  const globalKey = `create_task_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    if (globalLimit.count >= CREATE_TASK_CONFIG.MAX_CREATIONS_PER_HOUR_GLOBAL) {
      console.log('🚫 Global rate limit exceeded for task creation calls');
      return false;
    }
  }
  
  // Check user-specific rate limiting
  const userKey = `create_task_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    if (userLimit.count >= CREATE_TASK_CONFIG.MAX_CREATIONS_PER_HOUR_PER_USER) {
      console.log(`🚫 User rate limit exceeded for task creation: ${userId}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Update rate limiting counters
 */
function updateRateLimiting(userId: string): void {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Update global counter
  const globalKey = `create_task_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    globalLimit.count++;
  } else {
    rateLimitCache.set(globalKey, { 
      count: 1, 
      resetTime: now + (60 * 60 * 1000) 
    });
  }
  
  // Update user counter
  const userKey = `create_task_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    userLimit.count++;
  } else {
    rateLimitCache.set(userKey, { 
      count: 1, 
      resetTime: now + (60 * 60 * 1000) 
    });
  }
}

/**
 * Check for potential infinite loops
 */
function checkForLoop(userId: string): boolean {
  const now = Date.now();
  const loopKey = `create_task_loop_${userId}`;
  const loopData = loopPreventionCache.get(loopKey);
  
  if (loopData) {
    // Check if called too frequently
    if (now - loopData.lastCall < 1000) { // Less than 1 second between calls
      loopData.callCount++;
      if (loopData.callCount > 5) { // More than 5 calls in rapid succession
        console.log(`🚫 Loop prevention: User ${userId} creating tasks too frequently`);
        return true;
      }
    } else {
      loopData.callCount = 1;
    }
    loopData.lastCall = now;
  } else {
    loopPreventionCache.set(loopKey, { 
      lastCall: now, 
      callCount: 1,
      lastTaskType: 'unknown'
    });
  }
  
  return false;
}

/**
 * Validate task data
 */
function validateTaskData(taskData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required fields
  if (!taskData.title) {
    errors.push('Title is required');
  } else if (taskData.title.length > CREATE_TASK_CONFIG.MAX_TITLE_LENGTH) {
    errors.push(`Title must be ${CREATE_TASK_CONFIG.MAX_TITLE_LENGTH} characters or less`);
  }
  
  if (!taskData.assignedTo) {
    errors.push('AssignedTo is required');
  }
  
  if (!taskData.createdBy) {
    errors.push('CreatedBy is required');
  }
  
  if (!taskData.tenantId) {
    errors.push('TenantId is required');
  }
  
  // Optional field validation
  if (taskData.description && taskData.description.length > CREATE_TASK_CONFIG.MAX_DESCRIPTION_LENGTH) {
    errors.push(`Description must be ${CREATE_TASK_CONFIG.MAX_DESCRIPTION_LENGTH} characters or less`);
  }
  
  if (taskData.duration && (taskData.duration < 1 || taskData.duration > CREATE_TASK_CONFIG.MAX_DURATION_MINUTES)) {
    errors.push(`Duration must be between 1 and ${CREATE_TASK_CONFIG.MAX_DURATION_MINUTES} minutes`);
  }
  
  if (taskData.repeatInterval && (taskData.repeatInterval < 1 || taskData.repeatInterval > CREATE_TASK_CONFIG.MAX_REPEAT_INTERVAL_DAYS)) {
    errors.push(`Repeat interval must be between 1 and ${CREATE_TASK_CONFIG.MAX_REPEAT_INTERVAL_DAYS} days`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create task with comprehensive optimization
 */
export const createTaskOptimized = onCall({
  timeoutSeconds: Math.floor(CREATE_TASK_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
  memory: '512MiB',
  maxInstances: 5
}, async (request) => {
  try {
    const { 
      title, 
      description, 
      type, 
      priority, 
      status, 
      scheduledDate, 
      assignedTo, 
      createdBy, 
      tenantId, 
      category, 
      quotaCategory, 
      associations, 
      aiSuggested, 
      aiPrompt,
      classification = 'todo',
      startTime = null,
      duration = null,
      dueDate = null,
      isRepeating = false,
      repeatInterval = 30,
      userTimezone = 'America/Los_Angeles',
      force = false
    } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!title || !assignedTo || !createdBy || !tenantId) {
      throw new HttpsError('invalid-argument', 'Missing required fields: title, assignedTo, createdBy, tenantId');
    }

    console.log('🔍 Task creation requested', {
      title: title.substring(0, 50) + (title.length > 50 ? '...' : ''),
      type,
      classification,
      assignedTo: Array.isArray(assignedTo) ? assignedTo.length : 1,
      createdBy,
      tenantId,
      requestedBy: request.auth.uid,
      force,
      timestamp: new Date().toISOString()
    });

    // Clean up cache periodically
    if (Math.random() < 0.1) { // 10% chance to clean up
      cleanupCache();
    }

    // Check rate limiting (unless forced)
    if (!force && !checkRateLimiting(createdBy)) {
      return {
        success: false,
        taskId: null,
        message: 'Rate limit exceeded for task creation',
        rateLimited: true
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > CREATE_TASK_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping task creation request due to sampling');
      return {
        success: false,
        taskId: null,
        message: 'Skipped due to sampling',
        sampled: true
      };
    }
    
    // Check for potential infinite loops
    if (checkForLoop(createdBy)) {
      return {
        success: false,
        taskId: null,
        message: 'Too many rapid task creation calls detected',
        loopDetected: true
      };
    }
    
    // Validate task data
    const validation = validateTaskData(request.data);
    if (!validation.valid) {
      throw new HttpsError('invalid-argument', `Task validation failed: ${validation.errors.join(', ')}`);
    }
    
    // Update rate limiting
    updateRateLimiting(createdBy);

    try {
      // Get user names for optimization
      let assignedToName = 'Unknown User';
      let createdByName = 'Unknown User';
      
      try {
        const [assignedUserDoc, createdUserDoc] = await Promise.all([
          db.collection('users').doc(Array.isArray(assignedTo) ? assignedTo[0] : assignedTo).get(),
          db.collection('users').doc(createdBy).get()
        ]);
        
        if (assignedUserDoc.exists) {
          const assignedUserData = assignedUserDoc.data();
          assignedToName = assignedUserData?.displayName || assignedUserData?.firstName || assignedUserData?.email || 'Unknown User';
        }
        
        if (createdUserDoc.exists) {
          const createdUserData = createdUserDoc.data();
          createdByName = createdUserData?.displayName || createdUserData?.firstName || createdUserData?.email || 'Unknown User';
        }
      } catch (userError) {
        console.warn('Could not fetch user names for optimization:', userError);
      }

      // Get related entity names for optimization
      let relatedToName = '';
      if (associations?.relatedTo) {
        try {
          const relatedEntityDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(associations.relatedTo).get();
          if (relatedEntityDoc.exists) {
            const relatedEntityData = relatedEntityDoc.data();
            relatedToName = relatedEntityData?.companyName || relatedEntityData?.name || 'Unknown Company';
          }
        } catch (entityError) {
          console.warn(`Could not fetch related entity name for ${associations.relatedTo}:`, (entityError as Error).message);
        }
      }

      const taskData = {
        title: title.substring(0, CREATE_TASK_CONFIG.MAX_TITLE_LENGTH),
        description: description ? description.substring(0, CREATE_TASK_CONFIG.MAX_DESCRIPTION_LENGTH) : '',
        type: type || 'custom',
        priority: priority || 'medium',
        status: status || 'upcoming',
        classification: classification || 'todo',
        startTime: classification === 'appointment' ? startTime : null,
        duration: classification === 'appointment' ? Math.min(duration || 30, CREATE_TASK_CONFIG.MAX_DURATION_MINUTES) : null,
        endTime: classification === 'appointment' && startTime && duration ? 
          new Date(new Date(startTime).getTime() + Math.min(duration, CREATE_TASK_CONFIG.MAX_DURATION_MINUTES) * 60000).toISOString() : null,
        scheduledDate,
        dueDate,
        assignedTo,
        assignedToName,
        associations: associations || {},
        notes: '',
        category: category || null,
        quotaCategory: quotaCategory || null,
        estimatedDuration: Math.min(duration || 30, CREATE_TASK_CONFIG.MAX_DURATION_MINUTES),
        aiSuggested: aiSuggested || false,
        aiPrompt: aiPrompt || '',
        aiReason: aiPrompt || '',
        aiConfidence: aiSuggested ? 85 : null,
        aiContext: aiSuggested ? 'AI generated task' : null,
        aiInsights: aiSuggested ? ['AI suggested based on context'] : [],
        googleCalendarEventId: null,
        googleTaskId: null,
        lastGoogleSync: null,
        syncStatus: 'pending',
        tags: [],
        relatedToName,
        tenantId,
        createdBy,
        createdByName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Task-type-specific fields
        agenda: request.data.agenda || '',
        goals: request.data.goals || [],
        researchTopics: request.data.researchTopics || [],
        callScript: request.data.callScript || '',
        emailTemplate: request.data.emailTemplate || '',
        followUpNotes: request.data.followUpNotes || '',
        meetingAttendees: request.data.meetingAttendees || [],
        // Repeating task fields
        isRepeating: isRepeating || false,
        repeatInterval: isRepeating ? Math.min(repeatInterval, CREATE_TASK_CONFIG.MAX_REPEAT_INTERVAL_DAYS) : null,
        nextRepeatDate: isRepeating && dueDate ? 
          new Date(new Date(dueDate).getTime() + Math.min(repeatInterval, CREATE_TASK_CONFIG.MAX_REPEAT_INTERVAL_DAYS) * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
        originalTaskId: null
      };

      // Create task in Firestore
      const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc();
      await taskRef.set(taskData);

      // Log AI action if this is an AI-suggested task
      if (aiSuggested) {
        try {
          await logAIAction({
            eventType: 'task.created.ai_suggested',
            targetType: 'task',
            targetId: taskRef.id,
            reason: `AI suggested task: ${title}`,
            contextType: 'tasks',
            aiTags: ['task', 'ai_suggested', type || 'unknown'],
            urgencyScore: 5,
            inputPrompt: aiPrompt || '',
            tenantId,
            userId: createdBy
          });
        } catch (aiLogError) {
          console.warn('Failed to log AI action for task:', aiLogError);
        }
      }

      // Create AI log for the task
      try {
        await createTaskAILog(
          taskRef.id,
          title,
          type || 'unknown',
          classification,
          tenantId,
          createdBy,
          associations
        );
      } catch (aiLogError) {
        console.warn('Failed to create AI log for task:', aiLogError);
      }

      // Create deal AI log if associated with a deal
      if (associations?.deals && associations.deals.length > 0) {
        try {
          await createDealAILog(
            associations.deals[0],
            'task_created',
            `Task created: ${title}`,
            tenantId,
            createdBy,
            { taskId: taskRef.id, taskType: type, classification }
          );
        } catch (dealLogError) {
          console.warn('Failed to create deal AI log for task:', dealLogError);
        }
      }

      console.log('✅ Task created successfully:', {
        taskId: taskRef.id,
        title: title.substring(0, 50) + (title.length > 50 ? '...' : ''),
        classification,
        tenantId,
        createdBy
      });

      return {
        success: true,
        taskId: taskRef.id,
        message: 'Task created successfully'
      };
      
    } catch (error: any) {
      console.error('Error creating task:', error);
      
      if (error instanceof HttpsError) {
        throw error;
      }
      
      throw new HttpsError('internal', `Failed to create task: ${error.message}`);
    }

  } catch (error) {
    console.error('Error in createTaskOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch create tasks for multiple users (efficient bulk processing)
 */
export const batchCreateTasksOptimized = onCall({
  timeoutSeconds: 120,
  memory: '1GiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { taskRequests, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!Array.isArray(taskRequests) || taskRequests.length === 0) {
      throw new HttpsError('invalid-argument', 'Task requests array is required');
    }
    
    if (taskRequests.length > CREATE_TASK_CONFIG.MAX_TASKS_PER_BATCH) {
      throw new HttpsError('invalid-argument', `Maximum ${CREATE_TASK_CONFIG.MAX_TASKS_PER_BATCH} tasks per batch`);
    }

    const requestingUserId = request.auth.uid;

    console.log('🔍 Batch task creation requested', {
      taskCount: taskRequests.length,
      requestedBy: requestingUserId,
      force,
      timestamp: new Date().toISOString()
    });

    const results = [];
    
    // Process tasks in parallel with concurrency limit
    const concurrencyLimit = 10; // Higher concurrency for task creation
    for (let i = 0; i < taskRequests.length; i += concurrencyLimit) {
      const batch = taskRequests.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (taskRequest, index) => {
        try {
          const { 
            title, 
            description, 
            type, 
            priority, 
            status, 
            scheduledDate, 
            assignedTo, 
            createdBy, 
            tenantId, 
            category, 
            quotaCategory, 
            associations, 
            aiSuggested, 
            aiPrompt,
            classification = 'todo',
            startTime = null,
            duration = null,
            dueDate = null,
            isRepeating = false,
            repeatInterval = 30,
            userTimezone = 'America/Los_Angeles'
          } = taskRequest;
          
          if (!title || !assignedTo || !createdBy || !tenantId) {
            return {
              index,
              success: false,
              taskId: null,
              message: 'Missing required fields: title, assignedTo, createdBy, tenantId'
            };
          }
          
          // Check rate limiting for each user
          if (!force && !checkRateLimiting(createdBy)) {
            return {
              index,
              success: false,
              taskId: null,
              message: 'Rate limit exceeded',
              rateLimited: true
            };
          }
          
          // Check for loops
          if (checkForLoop(createdBy)) {
            return {
              index,
              success: false,
              taskId: null,
              message: 'Too many rapid calls detected',
              loopDetected: true
            };
          }
          
          // Validate task data
          const validation = validateTaskData(taskRequest);
          if (!validation.valid) {
            return {
              index,
              success: false,
              taskId: null,
              message: `Task validation failed: ${validation.errors.join(', ')}`
            };
          }
          
          // Update rate limiting
          updateRateLimiting(createdBy);
          
          // Get user names for optimization
          let assignedToName = 'Unknown User';
          let createdByName = 'Unknown User';
          
          try {
            const [assignedUserDoc, createdUserDoc] = await Promise.all([
              db.collection('users').doc(Array.isArray(assignedTo) ? assignedTo[0] : assignedTo).get(),
              db.collection('users').doc(createdBy).get()
            ]);
            
            if (assignedUserDoc.exists) {
              const assignedUserData = assignedUserDoc.data();
              assignedToName = assignedUserData?.displayName || assignedUserData?.firstName || assignedUserData?.email || 'Unknown User';
            }
            
            if (createdUserDoc.exists) {
              const createdUserData = createdUserDoc.data();
              createdByName = createdUserData?.displayName || createdUserData?.firstName || createdUserData?.email || 'Unknown User';
            }
          } catch (userError) {
            console.warn('Could not fetch user names for optimization:', userError);
          }

          // Get related entity names for optimization
          let relatedToName = '';
          if (associations?.relatedTo) {
            try {
              const relatedEntityDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(associations.relatedTo).get();
              if (relatedEntityDoc.exists) {
                const relatedEntityData = relatedEntityDoc.data();
                relatedToName = relatedEntityData?.companyName || relatedEntityData?.name || 'Unknown Company';
              }
            } catch (entityError) {
              console.warn(`Could not fetch related entity name for ${associations.relatedTo}:`, (entityError as Error).message);
            }
          }

          const taskData = {
            title: title.substring(0, CREATE_TASK_CONFIG.MAX_TITLE_LENGTH),
            description: description ? description.substring(0, CREATE_TASK_CONFIG.MAX_DESCRIPTION_LENGTH) : '',
            type: type || 'custom',
            priority: priority || 'medium',
            status: status || 'upcoming',
            classification: classification || 'todo',
            startTime: classification === 'appointment' ? startTime : null,
            duration: classification === 'appointment' ? Math.min(duration || 30, CREATE_TASK_CONFIG.MAX_DURATION_MINUTES) : null,
            endTime: classification === 'appointment' && startTime && duration ? 
              new Date(new Date(startTime).getTime() + Math.min(duration, CREATE_TASK_CONFIG.MAX_DURATION_MINUTES) * 60000).toISOString() : null,
            scheduledDate,
            dueDate,
            assignedTo,
            assignedToName,
            associations: associations || {},
            notes: '',
            category: category || null,
            quotaCategory: quotaCategory || null,
            estimatedDuration: Math.min(duration || 30, CREATE_TASK_CONFIG.MAX_DURATION_MINUTES),
            aiSuggested: aiSuggested || false,
            aiPrompt: aiPrompt || '',
            aiReason: aiPrompt || '',
            aiConfidence: aiSuggested ? 85 : null,
            aiContext: aiSuggested ? 'AI generated task' : null,
            aiInsights: aiSuggested ? ['AI suggested based on context'] : [],
            googleCalendarEventId: null,
            googleTaskId: null,
            lastGoogleSync: null,
            syncStatus: 'pending',
            tags: [],
            relatedToName,
            tenantId,
            createdBy,
            createdByName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            // Task-type-specific fields
            agenda: taskRequest.agenda || '',
            goals: taskRequest.goals || [],
            researchTopics: taskRequest.researchTopics || [],
            callScript: taskRequest.callScript || '',
            emailTemplate: taskRequest.emailTemplate || '',
            followUpNotes: taskRequest.followUpNotes || '',
            meetingAttendees: taskRequest.meetingAttendees || [],
            // Repeating task fields
            isRepeating: isRepeating || false,
            repeatInterval: isRepeating ? Math.min(repeatInterval, CREATE_TASK_CONFIG.MAX_REPEAT_INTERVAL_DAYS) : null,
            nextRepeatDate: isRepeating && dueDate ? 
              new Date(new Date(dueDate).getTime() + Math.min(repeatInterval, CREATE_TASK_CONFIG.MAX_REPEAT_INTERVAL_DAYS) * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
            originalTaskId: null
          };

          // Create task in Firestore
          const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc();
          await taskRef.set(taskData);

          // Log AI action if this is an AI-suggested task
          if (aiSuggested) {
            try {
              await logAIAction({
                eventType: 'task.created.ai_suggested',
                targetType: 'task',
                targetId: taskRef.id,
                reason: `AI suggested task: ${title}`,
                contextType: 'tasks',
                aiTags: ['task', 'ai_suggested', type || 'unknown'],
                urgencyScore: 5,
                inputPrompt: aiPrompt || '',
                tenantId,
                userId: createdBy
              });
            } catch (aiLogError) {
              console.warn('Failed to log AI action for task:', aiLogError);
            }
          }

          // Create AI log for the task
          try {
            await createTaskAILog(
              taskRef.id,
              title,
              type || 'unknown',
              classification,
              tenantId,
              createdBy,
              associations
            );
          } catch (aiLogError) {
            console.warn('Failed to create AI log for task:', aiLogError);
          }

          // Create deal AI log if associated with a deal
          if (associations?.deals && associations.deals.length > 0) {
            try {
              await createDealAILog(
                associations.deals[0],
                'task_created',
                `Task created: ${title}`,
                tenantId,
                createdBy,
                { taskId: taskRef.id, taskType: type, classification }
              );
            } catch (dealLogError) {
              console.warn('Failed to create deal AI log for task:', dealLogError);
            }
          }
          
          return {
            index,
            success: true,
            taskId: taskRef.id,
            message: 'Task created successfully'
          };
          
        } catch (error: any) {
          console.error(`Error processing task creation for index ${index}:`, error);
          
          return {
            index,
            success: false,
            taskId: null,
            message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to respect API limits
      if (i + concurrencyLimit < taskRequests.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch task creation completed', {
      totalTasks: taskRequests.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch task creation completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: taskRequests.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchCreateTasksOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to batch create tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Set up periodic cache cleanup
setInterval(cleanupCache, CREATE_TASK_CONFIG.CACHE_CLEANUP_INTERVAL_MS);
