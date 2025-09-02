import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Task Update System
 * 
 * This system replaces the problematic multiple implementations with a single
 * optimized function that implements intelligent caching, rate limiting, and
 * prevents excessive invocations and cascading updates.
 */

// Configuration for optimized task updates
const TASK_UPDATE_CONFIG = {
  // Cache settings
  CACHE_DURATION_MS: 15 * 60 * 1000, // 15 minutes cache for task updates
  CACHE_CLEANUP_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes cleanup
  
  // Rate limiting
  MAX_UPDATES_PER_HOUR_PER_TASK: 5, // Prevent excessive updates per task
  MAX_UPDATES_PER_HOUR_PER_USER: 20, // Prevent excessive updates per user
  MAX_UPDATES_PER_HOUR_GLOBAL: 100,  // Global rate limit
  
  // Processing limits
  MAX_EXECUTION_TIME_MS: 30000, // 30 seconds max execution
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.7, // Process 70% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
  
  // Field filtering
  RELEVANT_FIELDS: ['title', 'description', 'status', 'priority', 'assignedTo', 'dueDate', 'scheduledDate', 'associations'],
  IGNORED_FIELDS: ['updatedAt', 'lastModified', 'processingStartedAt', 'processingCompletedAt', 'lastGoogleSync'],
};

// Global cache for task updates (shared across instances)
const taskUpdateCache = new Map<string, { 
  data: any; 
  timestamp: number; 
  lastAccess: number;
  accessCount: number;
  updateCount: number;
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
  lastUpdateTime: number;
}>();

/**
 * Clean up expired cache entries
 */
function cleanupCache(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, value] of taskUpdateCache.entries()) {
    if (now - value.timestamp > TASK_UPDATE_CONFIG.CACHE_DURATION_MS) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => taskUpdateCache.delete(key));
  
  // Also clean up rate limiting cache
  for (const [key, value] of rateLimitCache.entries()) {
    if (now > value.resetTime) {
      rateLimitCache.delete(key);
    }
  }
  
  // Clean up loop prevention cache
  for (const [key, value] of loopPreventionCache.entries()) {
    if (now - value.lastCall > TASK_UPDATE_CONFIG.LOOP_PREVENTION_TTL) {
      loopPreventionCache.delete(key);
    }
  }
}

/**
 * Check rate limiting for task updates
 */
function checkRateLimiting(taskId: string, userId: string): boolean {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Check global rate limiting
  const globalKey = `task_update_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    if (globalLimit.count >= TASK_UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_GLOBAL) {
      console.log('🚫 Global rate limit exceeded for task updates');
      return false;
    }
  }
  
  // Check user-specific rate limiting
  const userKey = `task_update_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    if (userLimit.count >= TASK_UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_PER_USER) {
      console.log(`🚫 User rate limit exceeded for task updates: ${userId}`);
      return false;
    }
  }
  
  // Check task-specific rate limiting
  const taskKey = `task_update_task_${taskId}_${hourKey}`;
  const taskLimit = rateLimitCache.get(taskKey);
  
  if (taskLimit) {
    if (taskLimit.count >= TASK_UPDATE_CONFIG.MAX_UPDATES_PER_HOUR_PER_TASK) {
      console.log(`🚫 Task rate limit exceeded for task updates: ${taskId}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Update rate limiting counters
 */
function updateRateLimiting(taskId: string, userId: string): void {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Update global counter
  const globalKey = `task_update_global_${hourKey}`;
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
  const userKey = `task_update_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    userLimit.count++;
  } else {
    rateLimitCache.set(userKey, { 
      count: 1, 
      resetTime: now + (60 * 60 * 1000) 
    });
  }
  
  // Update task counter
  const taskKey = `task_update_task_${taskId}_${hourKey}`;
  const taskLimit = rateLimitCache.get(taskKey);
  
  if (taskLimit) {
    taskLimit.count++;
  } else {
    rateLimitCache.set(taskKey, { 
      count: 1, 
      resetTime: now + (60 * 60 * 1000) 
    });
  }
}

/**
 * Check for potential infinite loops
 */
function checkForLoop(taskId: string, userId: string): boolean {
  const now = Date.now();
  const loopKey = `task_update_loop_${taskId}_${userId}`;
  const loopData = loopPreventionCache.get(loopKey);
  
  if (loopData) {
    // Check if called too frequently
    if (now - loopData.lastCall < 1000) { // Less than 1 second between calls
      loopData.callCount++;
      if (loopData.callCount > 3) { // More than 3 calls in rapid succession
        console.log(`🚫 Loop prevention: Task ${taskId} being updated too frequently by user ${userId}`);
        return true;
      }
    } else {
      loopData.callCount = 1;
    }
    
    // Check if task is being updated too frequently overall
    if (now - loopData.lastUpdateTime < 5000) { // Less than 5 seconds between updates
      console.log(`🚫 Loop prevention: Task ${taskId} updated too recently`);
      return true;
    }
    
    loopData.lastCall = now;
    loopData.lastUpdateTime = now;
  } else {
    loopPreventionCache.set(loopKey, { 
      lastCall: now, 
      callCount: 1,
      lastUpdateTime: now
    });
  }
  
  return false;
}

/**
 * Check if update contains relevant changes
 */
function hasRelevantChanges(beforeData: any, afterData: any): boolean {
  if (!beforeData || !afterData) return true;
  
  // Check if any relevant fields changed
  for (const field of TASK_UPDATE_CONFIG.RELEVANT_FIELDS) {
    if (JSON.stringify(beforeData[field]) !== JSON.stringify(afterData[field])) {
      return true;
    }
  }
  
  // Check if ignored fields are the only changes
  const beforeIgnored = { ...beforeData };
  const afterIgnored = { ...afterData };
  
  TASK_UPDATE_CONFIG.IGNORED_FIELDS.forEach(field => {
    delete beforeIgnored[field];
    delete afterIgnored[field];
  });
  
  return JSON.stringify(beforeIgnored) !== JSON.stringify(afterIgnored);
}

/**
 * Optimized task update with comprehensive safety features
 */
export const updateTaskOptimized = onCall({
  timeoutSeconds: Math.floor(TASK_UPDATE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
  memory: '512MiB',
  maxInstances: 5
}, async (request) => {
  try {
    const { taskId, updates, tenantId, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!taskId || !tenantId || !updates) {
      throw new HttpsError('invalid-argument', 'Missing required fields: taskId, tenantId, updates');
    }

    const userId = request.auth.uid;

    console.log('🔍 Task update requested', {
      taskId,
      tenantId,
      userId,
      requestedBy: request.auth.uid,
      force,
      updateFields: Object.keys(updates),
      timestamp: new Date().toISOString()
    });

    // Clean up cache periodically
    if (Math.random() < 0.1) { // 10% chance to clean up
      cleanupCache();
    }

    // Check rate limiting (unless forced)
    if (!force && !checkRateLimiting(taskId, userId)) {
      return {
        success: false,
        message: 'Rate limit exceeded for task updates',
        rateLimited: true,
        cached: false
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > TASK_UPDATE_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping task update due to sampling');
      return {
        success: true,
        message: 'Skipped due to sampling',
        sampled: true,
        cached: false
      };
    }
    
    // Check for potential infinite loops
    if (checkForLoop(taskId, userId)) {
      return {
        success: false,
        message: 'Too many rapid updates detected',
        loopDetected: true,
        cached: false
      };
    }
    
    // Check cache first for recent updates
    const cacheKey = `task_update_${taskId}_${userId}`;
    const cached = taskUpdateCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < TASK_UPDATE_CONFIG.CACHE_DURATION_MS) {
      // Update access tracking
      cached.lastAccess = now;
      cached.accessCount++;
      
      console.log('✅ Task update served from cache for task:', taskId);
      return {
        ...cached.data,
        success: true,
        cached: true,
        cacheAge: now - cached.timestamp
      };
    }

    // Update rate limiting
    updateRateLimiting(taskId, userId);

    try {
      // Get task reference
      const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
      const taskDoc = await taskRef.get();

      if (!taskDoc.exists) {
        const result = { 
          success: false,
          message: `Task ${taskId} not found`,
          cached: false
        };
        
        // Cache negative results too
        taskUpdateCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1,
          updateCount: 0
        });
        
        return result;
      }

      const taskData = taskDoc.data();
      
      // Check if update contains relevant changes
      const updateData = {
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      if (!hasRelevantChanges(taskData, updateData)) {
        console.log('📝 No relevant changes detected, skipping update');
        const result = { 
          success: true,
          message: 'No relevant changes detected',
          noChanges: true,
          cached: false
        };
        
        // Cache the result
        taskUpdateCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1,
          updateCount: 0
        });
        
        return result;
      }

      // If assignedTo is being updated, fetch the user name for optimization
      if (updates.assignedTo && typeof updates.assignedTo === 'string') {
        try {
          const assignedUserDoc = await db.collection('users').doc(updates.assignedTo).get();
          if (assignedUserDoc.exists) {
            const assignedUserData = assignedUserDoc.data();
            const assignedToName = assignedUserData?.displayName || 
                                  assignedUserData?.fullName || 
                                  `${assignedUserData?.firstName || ''} ${assignedUserData?.lastName || ''}`.trim() || 
                                  assignedUserData?.email || 
                                  'Unknown User';
            
            updateData.assignedToName = assignedToName;
            console.log(`✅ Updated assignedToName to: ${assignedToName}`);
          }
        } catch (userError) {
          console.warn(`Could not fetch assigned user name for ${updates.assignedTo}:`, (userError as Error).message);
          updateData.assignedToName = 'Unknown User';
        }
      }

      // If createdBy is being updated, fetch the user name for optimization
      if (updates.createdBy && typeof updates.createdBy === 'string') {
        try {
          const createdUserDoc = await db.collection('users').doc(updates.createdBy).get();
          if (createdUserDoc.exists) {
            const createdUserData = createdUserDoc.data();
            const createdByName = createdUserData?.displayName || 
                                 createdUserData?.fullName || 
                                 `${createdUserData?.firstName || ''} ${createdUserData?.lastName || ''}`.trim() || 
                                 createdUserData?.email || 
                                 'Unknown User';
            
            updateData.createdByName = createdByName;
            console.log(`✅ Updated createdByName to: ${createdByName}`);
          }
        } catch (userError) {
          console.warn(`Could not fetch created user name for ${updates.createdBy}:`, (userError as Error).message);
          updateData.createdByName = 'Unknown User';
        }
      }

      // If relatedTo is being updated, fetch the entity name for optimization
      if (updates.associations?.relatedTo?.type && updates.associations?.relatedTo?.id) {
        try {
          const entityType = updates.associations.relatedTo.type;
          const entityId = updates.associations.relatedTo.id;
          
          let entityDoc;
          if (entityType === 'deal') {
            entityDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(entityId).get();
          } else if (entityType === 'company') {
            entityDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(entityId).get();
          } else if (entityType === 'contact') {
            entityDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(entityId).get();
          }
          
          if (entityDoc?.exists) {
            const entityData = entityDoc.data();
            let relatedToName = 'Unknown';
            
            if (entityType === 'deal') {
              relatedToName = entityData?.name || entityData?.title || 'Untitled Deal';
            } else if (entityType === 'company') {
              relatedToName = entityData?.name || 'Untitled Company';
            } else if (entityType === 'contact') {
              relatedToName = entityData?.fullName || 
                             entityData?.name || 
                             `${entityData?.firstName || ''} ${entityData?.lastName || ''}`.trim() || 
                             'Untitled Contact';
            }
            
            updateData.relatedToName = relatedToName;
            console.log(`✅ Updated relatedToName to: ${relatedToName}`);
          }
        } catch (entityError) {
          console.warn(`Could not fetch related entity name:`, (entityError as Error).message);
          updateData.relatedToName = 'Unknown';
        }
      }

      // Perform the update
      await taskRef.update(updateData);

      // Create AI log for task update (with rate limiting)
      try {
        const { logAIAction } = require('./aiLoggingOptimization');
        await logAIAction({
          userId: userId,
          actionType: 'task_updated',
          sourceModule: 'updateTaskOptimized',
          success: true,
          eventType: 'task.updated',
          targetType: 'task',
          targetId: taskId,
          aiRelevant: true,
          contextType: 'crm',
          traitsAffected: null,
          aiTags: ['task', 'update', ...Object.keys(updates)],
          urgencyScore: updates.priority === 'urgent' ? 8 : updates.priority === 'high' ? 6 : 4,
          reason: `Task updated: ${Object.keys(updates).join(', ')}`,
          versionTag: 'v1',
          latencyMs: 0
        });
      } catch (logError) {
        console.warn('Could not create AI log for task update:', logError);
        // Don't fail the update if logging fails
      }

      const result = { 
        success: true,
        message: 'Task updated successfully',
        taskId,
        updatedFields: Object.keys(updates),
        cached: false
      };
      
      // Cache the successful result
      taskUpdateCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1,
        updateCount: (cached?.updateCount || 0) + 1
      });
      
      console.log('✅ Task updated successfully:', taskId);
      return result;
      
    } catch (error: any) {
      console.error('Error updating task:', error);
      
      const result = { 
        success: false,
        message: `Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error.message : 'Unknown error',
        cached: false
      };
      
      // Cache error results too (but with shorter TTL)
      taskUpdateCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1,
        updateCount: (cached?.updateCount || 0)
      });
      
      return result;
    }

  } catch (error) {
    console.error('Error in updateTaskOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch update multiple tasks (efficient bulk processing)
 */
export const batchUpdateTasksOptimized = onCall({
  timeoutSeconds: 120,
  memory: '1GiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { taskUpdates, tenantId, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!Array.isArray(taskUpdates) || taskUpdates.length === 0) {
      throw new HttpsError('invalid-argument', 'Task updates array is required');
    }
    
    if (taskUpdates.length > 50) {
      throw new HttpsError('invalid-argument', 'Maximum 50 tasks per batch');
    }

    const userId = request.auth.uid;

    console.log('🔍 Batch task update requested', {
      taskCount: taskUpdates.length,
      tenantId,
      userId,
      requestedBy: request.auth.uid,
      force,
      timestamp: new Date().toISOString()
    });

    const results = [];
    
    // Process tasks in parallel with concurrency limit
    const concurrencyLimit = 10;
    for (let i = 0; i < taskUpdates.length; i += concurrencyLimit) {
      const batch = taskUpdates.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (taskUpdate) => {
        try {
          const { taskId, updates } = taskUpdate;
          
          if (!taskId || !updates) {
            return {
              taskId,
              success: false,
              message: 'Missing taskId or updates'
            };
          }
          
          // Check rate limiting for each task
          if (!force && !checkRateLimiting(taskId, userId)) {
            return {
              taskId,
              success: false,
              message: 'Rate limit exceeded',
              rateLimited: true
            };
          }
          
          // Check for loops
          if (checkForLoop(taskId, userId)) {
            return {
              taskId,
              success: false,
              message: 'Too many rapid updates detected',
              loopDetected: true
            };
          }
          
          // Check cache first
          const cacheKey = `task_update_${taskId}_${userId}`;
          const cached = taskUpdateCache.get(cacheKey);
          const now = Date.now();
          
          if (cached && (now - cached.timestamp) < TASK_UPDATE_CONFIG.CACHE_DURATION_MS) {
            cached.lastAccess = now;
            cached.accessCount++;
            
            return {
              taskId,
              ...cached.data,
              cached: true,
              cacheAge: now - cached.timestamp
            };
          }
          
          // Update rate limiting
          updateRateLimiting(taskId, userId);
          
          // Get task data
          const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
          const taskDoc = await taskRef.get();
          
          if (!taskDoc.exists) {
            const result = { 
              taskId,
              success: false,
              message: 'Task not found'
            };
            
            taskUpdateCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1,
              updateCount: 0
            });
            
            return result;
          }
          
          const taskData = taskDoc.data();
          
          // Check if update contains relevant changes
          const updateData = {
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
          
          if (!hasRelevantChanges(taskData, updateData)) {
            const result = { 
              taskId,
              success: true,
              message: 'No relevant changes detected',
              noChanges: true
            };
            
            taskUpdateCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1,
              updateCount: 0
            });
            
            return result;
          }
          
          // Perform the update
          await taskRef.update(updateData);
          
          const result = { 
            taskId,
            success: true,
            message: 'Task updated successfully',
            updatedFields: Object.keys(updates)
          };
          
          taskUpdateCache.set(cacheKey, { 
            data: result, 
            timestamp: now,
            lastAccess: now,
            accessCount: 1,
            updateCount: (cached?.updateCount || 0) + 1
          });
          
          return result;
          
        } catch (error: any) {
          console.error(`Error processing task update:`, error);
          
          return {
            taskId: taskUpdate.taskId || 'unknown',
            success: false,
            message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + concurrencyLimit < taskUpdates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch task update completed', {
      totalTasks: taskUpdates.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch update completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: taskUpdates.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchUpdateTasksOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to batch update tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Set up periodic cache cleanup
setInterval(cleanupCache, TASK_UPDATE_CONFIG.CACHE_CLEANUP_INTERVAL_MS);
