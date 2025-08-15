import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logAIAction, createTaskAILog, createDealAILog } from './utils/aiLogging';

const db = admin.firestore();

// 🎯 COMPREHENSIVE TASKS ENGINE
// Integrates with CRM, AI logging, and activity tracking

// 🏗️ CORE TASK OPERATIONS

export const createTask = onCall({ cors: true, region: 'us-central1', timeoutSeconds: 60, memory: '512MiB', minInstances: 0 }, async (request) => {
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
    classification = 'todo', // Default to todo if not specified
    startTime = null,
    duration = null,
    dueDate = null
  } = request.data;

  try {
    if (!title || !assignedTo || !createdBy || !tenantId) {
      throw new Error('Missing required fields: title, assignedTo, createdBy, tenantId');
    }

    // Validate appointment fields
    if (classification === 'appointment') {
      if (!startTime) {
        throw new Error('Start time is required for appointments');
      }
      if (!duration) {
        throw new Error('Duration is required for appointments');
      }
    }

    // Get user names for optimization
    let assignedToName = 'Unknown User';
    let createdByName = 'Unknown User';
    
    try {
      // Get assigned user name
      const assignedUserDoc = await db.collection('users').doc(assignedTo).get();
      if (assignedUserDoc.exists) {
        const assignedUserData = assignedUserDoc.data();
        assignedToName = assignedUserData?.displayName || 
                        assignedUserData?.fullName || 
                        `${assignedUserData?.firstName || ''} ${assignedUserData?.lastName || ''}`.trim() || 
                        assignedUserData?.email || 
                        'Unknown User';
      }
    } catch (userError) {
      console.warn(`Could not fetch assigned user name for ${assignedTo}:`, (userError as Error).message);
    }
    
    try {
      // Get creator name
      const creatorUserDoc = await db.collection('users').doc(createdBy).get();
      if (creatorUserDoc.exists) {
        const creatorUserData = creatorUserDoc.data();
        createdByName = creatorUserData?.displayName || 
                       creatorUserData?.fullName || 
                       `${creatorUserData?.firstName || ''} ${creatorUserData?.lastName || ''}`.trim() || 
                       creatorUserData?.email || 
                       'Unknown User';
      }
    } catch (userError) {
      console.warn(`Could not fetch creator name for ${createdBy}:`, (userError as Error).message);
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
      title,
      description: description || '',
      type,
      priority,
      status,
      classification, // Add classification field
      startTime: classification === 'appointment' ? startTime : null,
      duration: classification === 'appointment' ? duration : null,
      endTime: classification === 'appointment' && startTime && duration ? 
        new Date(new Date(startTime).getTime() + duration * 60000).toISOString() : null,
      scheduledDate,
      dueDate,
      assignedTo,
      assignedToName, // Add user name for optimization
      associations: associations || {},
      notes: '',
      category, // Add category field
      quotaCategory,
      estimatedDuration: duration || 30,
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
      relatedToName, // Add related entity name for optimization
      tenantId,
      createdBy,
      createdByName, // Add creator name for optimization
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Task-type-specific fields
      agenda: request.data.agenda || '',
      goals: request.data.goals || [],
      researchTopics: request.data.researchTopics || [],
      callScript: request.data.callScript || '',
      emailTemplate: request.data.emailTemplate || '',
      followUpNotes: request.data.followUpNotes || '',
      meetingAttendees: request.data.meetingAttendees || []
    };

    // batch single write for symmetry if we expand later
    const batch = db.batch();
    const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc();
    batch.set(taskRef, taskData);
    await batch.commit();

    // Sync to Google Calendar if it's an appointment
    if (classification === 'appointment' && startTime) {
      try {
        const { syncTaskToCalendar } = await import('./calendarSyncService');
        const syncResult = await syncTaskToCalendar(createdBy, tenantId, taskRef.id, taskData);
        
        if (syncResult.success) {
          console.log('✅ Task synced to Google Calendar:', syncResult.message);
        } else {
          console.log('ℹ️ Calendar sync skipped:', syncResult.message);
        }
      } catch (calendarError) {
        console.warn('⚠️ Failed to sync task to Google Calendar:', calendarError);
        // Don't fail the task creation if calendar sync fails
      }
    }

    // Log AI action if this is an AI-suggested task
    if (aiSuggested) {
      await logAIAction({
        eventType: 'ai_task.created',
        targetType: 'task',
        targetId: taskRef.id,
        reason: `AI created task: ${title}`,
        contextType: 'task_creation',
        aiTags: ['ai_suggestions', 'task_creation', type],
        urgencyScore: getUrgencyScore(priority),
        tenantId,
        userId: createdBy,
        aiResponse: JSON.stringify({
          taskTitle: title,
          taskType: type,
          classification,
          aiPrompt
        })
      });
    }

    return { taskId: taskRef.id, success: true };

  } catch (error) {
    console.error('❌ Error creating task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to create task: ${errorMessage}`);
  }
});

export const updateTask = onCall({
  cors: true
}, async (request) => {
  const { 
    taskId, 
    updates, 
    tenantId 
  } = request.data;

  try {
    if (!taskId || !tenantId || !updates) {
      throw new Error('Missing required fields: taskId, tenantId, updates');
    }

    const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      throw new Error(`Task ${taskId} not found`);
    }

    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

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
        console.warn(`Could not fetch creator name for ${updates.createdBy}:`, (userError as Error).message);
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

    await taskRef.update(updateData);

    // Create AI log for task update
    await createTaskAILog(
      'task.updated',
      taskId,
      `Task "${taskDoc.data()?.title}" updated with ${Object.keys(updates).length} changes`,
      tenantId,
      updates.assignedTo || taskDoc.data()?.assignedTo,
      taskDoc.data()?.associations,
      JSON.stringify(updates)
    );

    console.log(`✅ Task updated: ${taskId}`);

    return { 
      success: true,
      message: 'Task updated successfully'
    };

  } catch (error) {
    console.error('❌ Error updating task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to update task: ${errorMessage}`);
  }
});

export const completeTask = onCall({
  cors: true
}, async (request) => {
  const { 
    taskId, 
    tenantId, 
    actionResult, 
    followUpTask 
  } = request.data;

  try {
    if (!taskId || !tenantId) {
      throw new Error('Missing required fields: taskId, tenantId');
    }

    const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      throw new Error(`Task ${taskId} not found`);
    }

    const taskData = taskDoc.data();
    const updateData: any = {
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (actionResult) {
      updateData.actionResult = actionResult;
    }

    await taskRef.update(updateData);

    // Create AI log for task completion
    await createTaskAILog(
      'task.completed',
      taskId,
      `Task "${taskData?.title}" completed by ${taskData?.assignedTo}`,
      tenantId,
      taskData?.assignedTo,
      taskData?.associations,
      JSON.stringify({
        actionResult,
        followUpTask,
        originalType: taskData?.type,
        originalPriority: taskData?.priority,
        quotaCategory: taskData?.quotaCategory
      })
    );

    // Create follow-up task if specified
    if (followUpTask) {
      try {
        // Get user names for optimization
        let assignedToName = 'Unknown User';
        let createdByName = 'Unknown User';
        
        try {
          // Get assigned user name
          const assignedUserDoc = await db.collection('users').doc(taskData?.assignedTo).get();
          if (assignedUserDoc.exists) {
            const assignedUserData = assignedUserDoc.data();
            assignedToName = assignedUserData?.displayName || 
                            assignedUserData?.fullName || 
                            `${assignedUserData?.firstName || ''} ${assignedUserData?.lastName || ''}`.trim() || 
                            assignedUserData?.email || 
                            'Unknown User';
          }
        } catch (userError) {
          console.warn(`Could not fetch assigned user name for follow-up task:`, (userError as Error).message);
        }
        
        // For follow-up tasks, creator is usually the same as assigned user
        createdByName = assignedToName;

        const followUpData = {
          ...followUpTask,
          assignedTo: taskData?.assignedTo,
          assignedToName, // Add user name for optimization
          createdBy: taskData?.assignedTo,
          createdByName, // Add creator name for optimization
          tenantId,
          associations: taskData?.associations || {},
          aiSuggested: true,
          aiPrompt: `Follow-up task after completing "${taskData?.title}"`
        };

        const followUpRef = await db.collection('tenants').doc(tenantId).collection('tasks').add(followUpData);
        
        // Create AI log for follow-up task
        await createTaskAILog(
          'task.follow_up_created',
          followUpRef.id,
          `Follow-up task "${followUpTask.title}" created after completing "${taskData?.title}"`,
          tenantId,
          taskData?.assignedTo,
          taskData?.associations,
          JSON.stringify(followUpTask)
        );

        console.log(`✅ Follow-up task created: ${followUpRef.id}`);
      } catch (followUpError) {
        console.error('❌ Error creating follow-up task:', followUpError);
      }
    }

    console.log(`✅ Task completed: ${taskId}`);

    return { 
      success: true,
      message: 'Task completed successfully',
      followUpTaskId: followUpTask ? 'created' : null
    };

  } catch (error) {
    console.error('❌ Error completing task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to complete task: ${errorMessage}`);
  }
});

export const quickCompleteTask = onCall({
  cors: true
}, async (request) => {
  const { taskId } = request.data;

  try {
    if (!taskId) {
      throw new Error('Missing required field: taskId');
    }

    // Get the task to find tenantId and other details
    const taskQuery = await db.collectionGroup('tasks').where('__name__', '==', taskId).get();
    
    if (taskQuery.empty) {
      throw new Error(`Task ${taskId} not found`);
    }

    const taskDoc = taskQuery.docs[0];
    const taskData = taskDoc.data();
    const tenantId = taskData.tenantId;

    if (!tenantId) {
      throw new Error('Task has no tenantId');
    }

    const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
    
    const updateData: any = {
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await taskRef.update(updateData);

    // Create AI log for quick task completion
    await createTaskAILog(
      'task.quick_completed',
      taskId,
      `Task "${taskData?.title}" quickly completed`,
      tenantId,
      taskData?.assignedTo,
      taskData?.associations,
      JSON.stringify({
        quickComplete: true,
        originalType: taskData?.type,
        originalPriority: taskData?.priority,
        quotaCategory: taskData?.quotaCategory
      })
    );

    console.log(`✅ Task quickly completed: ${taskId}`);

    return { 
      success: true,
      message: 'Task quickly completed successfully'
    };

  } catch (error) {
    console.error('❌ Error quick completing task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to quick complete task: ${errorMessage}`);
  }
});

export const deleteTask = onCall({
  cors: true
}, async (request) => {
  const { 
    taskId, 
    tenantId 
  } = request.data;

  try {
    if (!taskId || !tenantId) {
      throw new Error('Missing required fields: taskId, tenantId');
    }

    const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      throw new Error(`Task ${taskId} not found`);
    }

    const taskData = taskDoc.data();

    // Create AI log for task deletion
    await createTaskAILog(
      'task.deleted',
      taskId,
      `Task "${taskData?.title}" deleted`,
      tenantId,
      taskData?.assignedTo,
      taskData?.associations,
      JSON.stringify({
        originalStatus: taskData?.status,
        originalType: taskData?.type,
        originalPriority: taskData?.priority
      })
    );

    await taskRef.delete();

    console.log(`✅ Task deleted: ${taskId}`);

    return { 
      success: true,
      message: 'Task deleted successfully'
    };

  } catch (error) {
    console.error('❌ Error deleting task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to delete task: ${errorMessage}`);
  }
});

export const getTasks = onCall({
  cors: true
}, async (request) => {
  const { 
    tenantId, 
    userId, 
    status, 
    type, 
    category, 
    priority, 
    startDate, 
    endDate, 
    dueDate, 
    aiGenerated, 
    quotaCategory, 
    orderBy = 'scheduledDate', 
    orderDirection = 'asc', 
    limit = 50,
    dealId,
    companyId,
    contactId,
    salespersonId,
    tags
  } = request.data;

  try {
    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }

    let tasks: any[] = [];

    try {
      let q: admin.firestore.Query = db.collection('tenants').doc(tenantId).collection('tasks');

      // Apply filters
      if (userId) {
        q = q.where('assignedTo', '==', userId);
      }

      if (status && status.length > 0) {
        q = q.where('status', 'in', status);
      }

      if (type && type.length > 0) {
        q = q.where('type', 'in', type);
      }

      if (category && category.length > 0) {
        q = q.where('category', 'in', category);
      }

      if (priority && priority.length > 0) {
        q = q.where('priority', 'in', priority);
      }

      if (startDate) {
        q = q.where('scheduledDate', '>=', startDate);
      }

      if (endDate) {
        q = q.where('scheduledDate', '<=', endDate);
      }

      if (dueDate) {
        q = q.where('dueDate', '==', dueDate);
      }

      if (aiGenerated !== undefined) {
        q = q.where('aiGenerated', '==', aiGenerated);
      }

      if (quotaCategory && quotaCategory.length > 0) {
        q = q.where('quotaCategory', 'in', quotaCategory);
      }

      // Apply ordering
      const orderDirectionValue = orderDirection === 'desc' ? 'desc' : 'asc';
      q = q.orderBy(orderBy, orderDirectionValue);

      // Apply limit
      if (limit) {
        q = q.limit(limit);
      }

      const snapshot = await q.get();
      tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (indexError: any) {
      console.warn('Index not ready for tasks query, returning empty results:', indexError.message);
      tasks = [];
    }

    // Apply association filters (client-side filtering)
    if (dealId) {
      tasks = tasks.filter(task => task.associations?.deals?.includes(dealId));
    }

    if (companyId) {
      tasks = tasks.filter(task => task.associations?.companies?.includes(companyId));
    }

    if (contactId) {
      tasks = tasks.filter(task => task.associations?.contacts?.includes(contactId));
    }

    if (salespersonId) {
      tasks = tasks.filter(task => task.associations?.salespeople?.includes(salespersonId));
    }

    if (tags && tags.length > 0) {
      tasks = tasks.filter(task => 
        task.tags && tags.some((tag: string) => task.tags.includes(tag))
      );
    }

    return { tasks, success: true };

  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch tasks: ${errorMessage}`);
  }
});

export const getTasksForDate = onCall({
  cors: true
}, async (request) => {
  const { date, tenantId } = request.data;

  try {
    if (!date || !tenantId) {
      throw new Error('Missing required fields: date, tenantId');
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const q = db.collection('tenants').doc(tenantId).collection('tasks')
      .where('scheduledDate', '>=', startOfDay.toISOString())
      .where('scheduledDate', '<=', endOfDay.toISOString())
      .orderBy('scheduledDate', 'asc');

    const snapshot = await q.get();
    const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return { tasks, success: true };

  } catch (error) {
    console.error('❌ Error fetching tasks for date:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch tasks for date: ${errorMessage}`);
  }
});

export const getTaskDashboard = onCall({
  cors: true
}, async (request) => {
  const { userId, date, tenantId, filters } = request.data;

  try {
    if (!userId || !date || !tenantId) {
      throw new Error('Missing required fields: userId, date, tenantId');
    }

    let todayTasks: any[] = [];
    let weekTasks: any[] = [];

    // Get today's tasks (including overdue tasks that are not completed)
    // Convert the date parameter to local timezone for proper day boundaries
    const inputDate = new Date(date);
    const todayStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate(), 0, 0, 0, 0);
    
    const todayEnd = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate(), 23, 59, 59, 999);

    try {
      // First, get tasks scheduled for today
      let todayQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('scheduledDate', '>=', todayStart.toISOString())
        .where('scheduledDate', '<=', todayEnd.toISOString())
        .where('assignedTo', '==', userId);

      // Apply filters if provided
      if (filters?.dealId) {
        todayQuery = todayQuery.where('associations.deals', 'array-contains', filters.dealId);
      }

      const todaySnapshot = await todayQuery.get();
      todayTasks = todaySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Then, get overdue tasks that are not completed
      let overdueQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('scheduledDate', '<', todayStart.toISOString())
        .where('assignedTo', '==', userId)
        .where('status', '!=', 'completed');

      // Apply filters if provided
      if (filters?.dealId) {
        overdueQuery = overdueQuery.where('associations.deals', 'array-contains', filters.dealId);
      }

      const overdueSnapshot = await overdueQuery.get();
      const overdueTasks = overdueSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Combine today's tasks and overdue tasks
      todayTasks = [...todayTasks, ...overdueTasks];
    } catch (indexError: any) {
      console.warn('Index not ready for today tasks query, returning empty results:', indexError.message);
      todayTasks = [];
    }
    
    // Get this week's tasks
    const weekStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate() - inputDate.getDay(), 0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    try {
      let weekQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('scheduledDate', '>=', weekStart.toISOString())
        .where('scheduledDate', '<=', weekEnd.toISOString())
        .where('assignedTo', '==', userId);

      // Apply filters if provided
      if (filters?.dealId) {
        weekQuery = weekQuery.where('associations.deals', 'array-contains', filters.dealId);
      }

      const weekSnapshot = await weekQuery.get();
      weekTasks = weekSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (indexError: any) {
      console.warn('Index not ready for week tasks query, returning empty results:', indexError.message);
      weekTasks = [];
    }

    // Get completed tasks
    let completedTasks: any[] = [];
    try {
      let completedQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('assignedTo', '==', userId)
        .where('status', '==', 'completed');

      // Apply filters if provided
      if (filters?.dealId) {
        completedQuery = completedQuery.where('associations.deals', 'array-contains', filters.dealId);
      }

      const completedSnapshot = await completedQuery.get();
      completedTasks = completedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (indexError: any) {
      console.warn('Index not ready for completed tasks query, returning empty results:', indexError.message);
      completedTasks = [];
    }

    // Calculate analytics
    const allTasks = [...todayTasks, ...weekTasks, ...completedTasks];
    const priorities = {
      high: allTasks.filter((t: any) => t.priority === 'high').length,
      medium: allTasks.filter((t: any) => t.priority === 'medium').length,
      low: allTasks.filter((t: any) => t.priority === 'low').length
    };

    const types = {
      email: allTasks.filter((t: any) => t.type === 'email').length,
      phone_call: allTasks.filter((t: any) => t.type === 'phone_call').length,
      scheduled_meeting_virtual: allTasks.filter((t: any) => t.type === 'scheduled_meeting_virtual').length,
      research: allTasks.filter((t: any) => t.type === 'research').length,
      custom: allTasks.filter((t: any) => t.type === 'custom').length
    };

    const completedTasksCount = allTasks.filter((t: any) => t.status === 'completed').length;
    const totalTasks = allTasks.length;
    const quotaProgress = {
      percentage: totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0,
      completed: completedTasksCount,
      target: 30 // Default daily quota
    };

    return {
      today: {
        totalTasks: todayTasks.length,
        completedTasks: todayTasks.filter((t: any) => t.status === 'completed').length,
        pendingTasks: todayTasks.filter((t: any) => t.status !== 'completed').length,
        tasks: todayTasks
      },
      thisWeek: {
        totalTasks: weekTasks.length,
        completedTasks: weekTasks.filter((t: any) => t.status === 'completed').length,
        pendingTasks: weekTasks.filter((t: any) => t.status !== 'completed').length,
        quotaProgress,
        tasks: weekTasks
      },
      completed: {
        totalTasks: completedTasks.length,
        tasks: completedTasks
      },
      priorities,
      types
    };

  } catch (error) {
    console.error('❌ Error fetching task dashboard:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch task dashboard: ${errorMessage}`);
  }
});

export const getAITaskSuggestions = onCall({
  cors: true
}, async (request) => {
  const { userId, tenantId, filters } = request.data;

  try {
    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    // Get user's pipeline data with optional filtering
    const pipelineData = await getUserPipelineData(userId, tenantId);
    
    // Apply filters to pipeline data
    if (filters?.dealId) {
      pipelineData.deals = pipelineData.deals.filter((deal: any) => deal.id === filters.dealId);
    }
    if (filters?.companyId) {
      pipelineData.companies = pipelineData.companies.filter((company: any) => company.id === filters.companyId);
    }
    if (filters?.contactId) {
      pipelineData.contacts = pipelineData.contacts.filter((contact: any) => contact.id === filters.contactId);
    }

    // Generate AI suggestions based on filtered data
    const suggestions = await generateAITaskSuggestions(pipelineData, 10);

    // If deal-specific filtering is requested, add deal context
    if (filters?.dealId && filters?.dealStage) {
      // Add stage-specific suggestions
      const stageSuggestions = generateBasicStageSuggestions(filters.dealStage, { id: filters.dealId });
      suggestions.push(...stageSuggestions.stageTasks);
    }

    return suggestions;

  } catch (error) {
    console.error('❌ Error fetching AI task suggestions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch AI task suggestions: ${errorMessage}`);
  }
});

export const getUnifiedAISuggestions = onCall({
  cors: true
}, async (request) => {
  const { userId, tenantId, filters } = request.data;

  try {
    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    // Get comprehensive context
    const pipelineData = await getUserPipelineData(userId, tenantId);
    const userContext = await getUserContext(userId, tenantId);
    
    // Apply filters
    let dealContext = null;
    if (filters?.dealId) {
      dealContext = await getDealContext(filters.dealId, tenantId, userId);
      pipelineData.deals = pipelineData.deals.filter((deal: any) => deal.id === filters.dealId);
    }

    // Generate unified suggestions
    const suggestions = await generateUnifiedSuggestions(pipelineData, userContext, dealContext, filters);

    return {
      success: true,
      suggestions: suggestions
    };

  } catch (error) {
    console.error('❌ Error fetching unified AI suggestions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch unified AI suggestions: ${errorMessage}`);
  }
});

async function generateUnifiedSuggestions(pipelineData: any, userContext: any, dealContext: any, filters: any) {
  const suggestions: any[] = [];
  
  try {
    // 1. Deal Stage Requirements (if deal-specific)
    if (dealContext && dealContext.deal) {
      const stageAnalysis = await analyzeCurrentStage(dealContext);
      const stageSuggestions = await generateStageBasedSuggestions(dealContext, stageAnalysis);
      suggestions.push(...stageSuggestions);
    }

    // 2. General Productivity Suggestions
    const productivitySuggestions = await generateProductivitySuggestions(pipelineData, userContext);
    suggestions.push(...productivitySuggestions);

    // 3. Deal-Specific Context Suggestions
    if (dealContext) {
      const dealSpecificSuggestions = await generateDealSpecificSuggestions(dealContext, pipelineData);
      suggestions.push(...dealSpecificSuggestions);
    }

    // 4. Quota and KPI Suggestions
    const quotaSuggestions = await generateQuotaSuggestions(userContext, pipelineData);
    suggestions.push(...quotaSuggestions);

    // 5. Remove duplicates and prioritize
    const uniqueSuggestions = removeDuplicateSuggestions(suggestions);
    const prioritizedSuggestions = prioritizeSuggestions(uniqueSuggestions, dealContext, userContext);

    return prioritizedSuggestions;

  } catch (error) {
    console.error('Error generating unified suggestions:', error);
    return [];
  }
}

async function generateStageBasedSuggestions(dealContext: any, stageAnalysis: any) {
  const suggestions: any[] = [];
  
  try {
    const missingFields = stageAnalysis.missingFields;
    const currentStage = stageAnalysis.currentStage;

    // Generate tasks for missing stage fields
    Object.entries(missingFields).forEach(([field, description]: [string, any]) => {
      suggestions.push({
        id: `stage_${field}_${Date.now()}`,
        title: `Complete ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
        description: `Required for ${currentStage} stage: ${description}`,
        type: 'field_completion',
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 30,
        associations: {
          deals: [dealContext.deal.id],
          companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
            ? (typeof dealContext.deal.associations.companies[0] === 'string'
                ? [dealContext.deal.associations.companies[0]]
                : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
            : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
        },
        aiGenerated: true,
        aiReason: `Missing required field for ${currentStage} stage`,
        aiConfidence: 95,
        source: 'stage_requirements',
        fieldName: field,
        stage: currentStage
      });
    });

    // Generate stage-specific tasks
    const stageTasks = await getStageRequiredTasks(currentStage, dealContext.deal);
    stageTasks.forEach((task: any) => {
      suggestions.push({
        ...task,
        id: `stage_task_${Date.now()}_${Math.random()}`,
        aiGenerated: true,
        aiReason: `Required for ${currentStage} stage progression`,
        aiConfidence: 90,
        source: 'stage_requirements',
        stage: currentStage
      });
    });

    return suggestions;
  } catch (error) {
    console.error('Error generating stage-based suggestions:', error);
    return [];
  }
}

// Import the missing functions from dealStageAIEngine
async function analyzeCurrentStage(dealContext: any): Promise<any> {
  // Simplified version for task engine
  const analysis: any = {
    currentStage: dealContext.deal?.stage || 'discovery',
    missingFields: {},
    stageProgress: 0
  };

  try {
    const currentStage = analysis.currentStage;
    
    // Define basic stage requirements
    const stageRequirements = getStageRequirements(currentStage);
    
    // Analyze completed fields (simplified)
    const stageForms = dealContext.stageForms?.[currentStage] || {};
    
    // Identify missing fields
    const missingFields: any = {};
    Object.keys(stageRequirements).forEach(field => {
      if (!stageForms[field] || stageForms[field] === '') {
        missingFields[field] = stageRequirements[field];
      }
    });
    analysis.missingFields = missingFields;

    return analysis;
  } catch (error) {
    console.error('Error analyzing current stage:', error);
    return analysis;
  }
}

function getStageRequirements(stage: string): any {
  const requirements: any = {
    discovery: {
      'currentStaffCount': 'Current staff count at the company',
      'currentAgencyCount': 'Number of staffing agencies currently used',
      'jobTitlesNeeded': 'Specific job titles they need to fill',
      'satisfactionLevel': 'Satisfaction level with current staffing',
      'shiftsNeeded': 'Shifts they need to cover',
      'currentStruggles': 'Current challenges with staffing',
      'budgetRange': 'Budget range for staffing services',
      'timeline': 'Timeline for implementation',
      'decisionMakers': 'Key decision makers involved'
    },
    qualification: {
      'painPoints': 'Specific pain points identified',
      'budgetConfirmed': 'Budget has been confirmed',
      'decisionProcess': 'Decision-making process',
      'timelineConfirmed': 'Implementation timeline confirmed',
      'stakeholders': 'All stakeholders identified',
      'currentSolutions': 'Current solutions being used',
      'evaluationCriteria': 'Evaluation criteria for vendors',
      'successMetrics': 'Success metrics defined'
    },
    proposal: {
      'requirements': 'Detailed requirements gathered',
      'solutionDesign': 'Solution design completed',
      'pricingStructure': 'Pricing structure defined',
      'implementationPlan': 'Implementation plan created',
      'timeline': 'Detailed timeline established',
      'teamAssigned': 'Implementation team assigned',
      'riskAssessment': 'Risk assessment completed',
      'valueProposition': 'Value proposition refined'
    },
    negotiation: {
      'pricingNegotiated': 'Pricing has been negotiated',
      'termsAgreed': 'Terms and conditions agreed',
      'contractDrafted': 'Contract has been drafted',
      'legalReview': 'Legal review completed',
      'finalApproval': 'Final approval obtained',
      'implementationSchedule': 'Implementation schedule set',
      'successMetrics': 'Success metrics finalized',
      'goLiveDate': 'Go-live date confirmed'
    },
    closing: {
      'contractSigned': 'Contract has been signed',
      'paymentTerms': 'Payment terms finalized',
      'implementationStarted': 'Implementation has started',
      'teamOnboarded': 'Team has been onboarded',
      'successMetrics': 'Success metrics tracking in place',
      'relationshipEstablished': 'Relationship manager assigned',
      'expansionOpportunities': 'Expansion opportunities identified',
      'referralPotential': 'Referral potential assessed'
    }
  };

  return requirements[stage] || {};
}

async function getStageRequiredTasks(stage: string, deal: any): Promise<any[]> {
  const stageTasks: any[] = [];
  
  try {
    switch (stage) {
      case 'discovery':
        stageTasks.push({
          type: 'research',
          title: `Research ${deal?.name || 'company'}`,
          description: 'Gather information about company, decision makers, and needs',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'qualification':
        stageTasks.push({
          type: 'meeting',
          title: `Qualification meeting with ${deal?.name || 'company'}`,
          description: 'Assess fit and budget alignment',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'proposal':
        stageTasks.push({
          type: 'proposal_preparation',
          title: `Prepare proposal for ${deal?.name || 'company'}`,
          description: 'Create detailed proposal based on requirements',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'negotiation':
        stageTasks.push({
          type: 'negotiation',
          title: `Negotiate terms with ${deal?.name || 'company'}`,
          description: 'Finalize pricing and terms',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'closing':
        stageTasks.push({
          type: 'closing',
          title: `Close deal with ${deal?.name || 'company'}`,
          description: 'Finalize contract and close the deal',
          priority: 'high',
          category: 'business_generating'
        });
        break;
    }
    
    return stageTasks;
  } catch (error) {
    console.error('Error getting stage required tasks:', error);
    return [];
  }
}

async function generateProductivitySuggestions(pipelineData: any, userContext: any) {
  const suggestions: any[] = [];
  
  try {
    // Follow-up suggestions for high-value deals
    const highValueDeals = pipelineData.deals.filter((deal: any) => 
      deal.estimatedRevenue && deal.estimatedRevenue > 50000
    );

    highValueDeals.forEach((deal: any) => {
      suggestions.push({
        id: `followup_${deal.id}_${Date.now()}`,
        title: `Follow up with ${deal.name}`,
        description: `High-value deal ($${deal.estimatedRevenue}) needs attention`,
        type: 'phone_call',
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 15,
        associations: { deals: [deal.id] },
        aiGenerated: true,
        aiReason: `High-value deal requires follow-up`,
        aiConfidence: 85,
        source: 'productivity'
      });
    });

    // Relationship building for contacts
    const contactsNeedingFollowUp = pipelineData.contacts.filter((contact: any) => {
      const lastContact = contact.lastContactDate;
      if (!lastContact) return true;
      const daysSinceContact = (Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceContact > 7;
    });

    contactsNeedingFollowUp.forEach((contact: any) => {
      suggestions.push({
        id: `relationship_${contact.id}_${Date.now()}`,
        title: `Check in with ${contact.fullName}`,
        description: `Maintain relationship with key contact`,
        type: 'email',
        priority: 'medium',
        category: 'relationship_building',
        estimatedDuration: 10,
        associations: { contacts: [contact.id] },
        aiGenerated: true,
        aiReason: `Contact needs relationship maintenance`,
        aiConfidence: 75,
        source: 'productivity'
      });
    });

    return suggestions;
  } catch (error) {
    console.error('Error generating productivity suggestions:', error);
    return [];
  }
}

async function generateDealSpecificSuggestions(dealContext: any, pipelineData: any) {
  const suggestions: any[] = [];
  
  try {
    const deal = dealContext.deal;
    if (!deal) return suggestions;
    
    // Research tasks for deal company
    const primaryCompanyId = (deal.associations?.primaryCompanyId) 
      || (Array.isArray(deal.associations?.companies) && deal.associations.companies.length > 0 
            ? (typeof deal.associations.companies[0] === 'string' ? deal.associations.companies[0] : deal.associations.companies[0]?.id) 
            : deal.companyId);
    if (primaryCompanyId && !dealContext.company?.researched) {
      suggestions.push({
        id: `research_${primaryCompanyId}_${Date.now()}`,
        title: `Research ${dealContext.company?.name || 'company'}`,
        description: `Gather information about company background and needs`,
        type: 'research',
        priority: 'medium',
        category: 'business_generating',
        estimatedDuration: 30,
        associations: { 
          deals: [deal.id],
          companies: [primaryCompanyId]
        },
        aiGenerated: true,
        aiReason: `Company research needed for deal`,
        aiConfidence: 80,
        source: 'deal_specific'
      });
    }

    // Contact engagement tasks
    if (dealContext.contacts.length > 0) {
      dealContext.contacts.forEach((contact: any) => {
        suggestions.push({
          id: `engagement_${contact.id}_${Date.now()}`,
          title: `Engage with ${contact.fullName}`,
          description: `Build relationship with key decision maker`,
          type: 'meeting',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 45,
          associations: { 
            deals: [deal?.id || ''],
            contacts: [contact.id]
          },
          aiGenerated: true,
          aiReason: `Key contact needs engagement`,
          aiConfidence: 85,
          source: 'deal_specific'
        });
      });
    }

    return suggestions;
  } catch (error) {
    console.error('Error generating deal-specific suggestions:', error);
    return [];
  }
}

async function generateQuotaSuggestions(userContext: any, pipelineData: any) {
  const suggestions: any[] = [];
  
  try {
    const quota = userContext.quota;
    
    if (quota && quota.remainingToday > 0) {
      suggestions.push({
        id: `quota_${Date.now()}`,
        title: `Complete ${quota.remainingToday} quota activities`,
        description: `Focus on business-generating activities to meet daily quota`,
        type: 'quota_fill',
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 60,
        associations: {},
        aiGenerated: true,
        aiReason: `Daily quota needs completion`,
        aiConfidence: 90,
        source: 'quota'
      });
    }

    return suggestions;
  } catch (error) {
    console.error('Error generating quota suggestions:', error);
    return [];
  }
}

function removeDuplicateSuggestions(suggestions: any[]) {
  const seen = new Set();
  return suggestions.filter(suggestion => {
    const key = `${suggestion.title}_${suggestion.type}_${suggestion.associations?.deals?.[0] || ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function prioritizeSuggestions(suggestions: any[], dealContext: any, userContext: any) {
  return suggestions.sort((a, b) => {
    // Stage requirements get highest priority
    if (a.source === 'stage_requirements' && b.source !== 'stage_requirements') return -1;
    if (b.source === 'stage_requirements' && a.source !== 'stage_requirements') return 1;
    
    // High priority over medium/low
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (b.priority === 'high' && a.priority !== 'high') return 1;
    
    // Higher AI confidence
    if (a.aiConfidence > b.aiConfidence) return -1;
    if (b.aiConfidence > a.aiConfidence) return 1;
    
    return 0;
  });
}

async function getDealContext(dealId: string, tenantId: string, userId: string) {
  try {
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (!dealDoc.exists) return null;

    const deal = dealDoc.data();
    if (!deal) return null;
    
    // Get associated company
    let company = null;
    const ctxPrimaryCompanyId = (deal.associations?.primaryCompanyId) 
      || (Array.isArray(deal.associations?.companies) && deal.associations.companies.length > 0 
            ? (typeof deal.associations.companies[0] === 'string' ? deal.associations.companies[0] : deal.associations.companies[0]?.id)
            : deal.companyId);
    if (ctxPrimaryCompanyId) {
      const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(ctxPrimaryCompanyId).get();
      if (companyDoc.exists) {
        company = companyDoc.data();
      }
    }

    // Get associated contacts (associations-first)
    const contacts: any[] = [];
    const assocContactIds = Array.isArray(deal.associations?.contacts)
      ? deal.associations.contacts.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
      : [];
    const legacyContactIds = Array.isArray(deal.contactIds) ? deal.contactIds : [];
    const contactIds = assocContactIds.length > 0 ? assocContactIds : legacyContactIds;
    for (const contactId of contactIds) {
      const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
      if (contactDoc.exists) {
        contacts.push(contactDoc.data());
      }
    }

    return {
      deal,
      company,
      contacts
    };
  } catch (error) {
    console.error('Error getting deal context:', error);
    return null;
  }
}

async function getUserContext(userId: string, tenantId: string) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return {};

    const user = userDoc.data();
    if (!user) return {};
    
    // Get user's quota and KPI data
    const quota = {
      daily: user.dailyQuota || 10,
      completed: 0, // Would need to calculate from today's activities
      remainingToday: 10 // Would need to calculate
    };

    return {
      user,
      quota
    };
  } catch (error) {
    console.error('Error getting user context:', error);
    return {};
  }
}

export const acceptAITaskSuggestion = onCall({
  cors: true
}, async (request) => {
  const { suggestionId, tenantId, userId, classification = 'todo' } = request.data;

  try {
    if (!suggestionId || !tenantId || !userId) {
      throw new Error('Missing required fields: suggestionId, tenantId, userId');
    }

    // Get the suggestion
    const suggestionRef = db.collection('tenants').doc(tenantId).collection('ai_task_suggestions').doc(suggestionId);
    const suggestionDoc = await suggestionRef.get();

    if (!suggestionDoc.exists) {
      throw new Error('AI suggestion not found');
    }

    const suggestion = suggestionDoc.data();
    if (!suggestion) {
      throw new Error('Suggestion data not found');
    }

    // Determine classification based on task type and context
    let suggestedClassification = classification;
    if (classification === 'todo') {
      // AI logic to determine if this should be an appointment
      const appointmentTypes = ['scheduled_meeting_virtual', 'scheduled_meeting_in_person', 'demo', 'presentation'];
      if (appointmentTypes.includes(suggestion.type)) {
        suggestedClassification = 'appointment';
      }
    }

    // Get user names for optimization
    let assignedToName = 'Unknown User';
    let createdByName = 'Unknown User';
    
    try {
      // Get assigned user name
      const assignedUserDoc = await db.collection('users').doc(suggestion.suggestedFor).get();
      if (assignedUserDoc.exists) {
        const assignedUserData = assignedUserDoc.data();
        assignedToName = assignedUserData?.displayName || 
                        assignedUserData?.fullName || 
                        `${assignedUserData?.firstName || ''} ${assignedUserData?.lastName || ''}`.trim() || 
                        assignedUserData?.email || 
                        'Unknown User';
      }
    } catch (userError) {
      console.warn(`Could not fetch assigned user name for ${suggestion.suggestedFor}:`, (userError as Error).message);
    }
    
    try {
      // Get creator name
      const creatorUserDoc = await db.collection('users').doc(userId).get();
      if (creatorUserDoc.exists) {
        const creatorUserData = creatorUserDoc.data();
        createdByName = creatorUserData?.displayName || 
                       creatorUserData?.fullName || 
                       `${creatorUserData?.firstName || ''} ${creatorUserData?.lastName || ''}`.trim() || 
                       creatorUserData?.email || 
                       'Unknown User';
      }
    } catch (userError) {
      console.warn(`Could not fetch creator name for ${userId}:`, (userError as Error).message);
    }

    const taskData = {
      title: suggestion.title,
      description: suggestion.description || '',
      type: suggestion.type,
      priority: suggestion.priority,
      scheduledDate: suggestion.suggestedDate,
      status: 'upcoming',
      classification: suggestedClassification, // Add classification
      startTime: suggestedClassification === 'appointment' ? suggestion.suggestedTime || null : null,
      duration: suggestedClassification === 'appointment' ? 60 : null, // Default 1 hour for appointments
      endTime: suggestedClassification === 'appointment' && suggestion.suggestedTime ? 
        new Date(new Date(suggestion.suggestedDate + 'T' + suggestion.suggestedTime).getTime() + 60 * 60000).toISOString() : null,
      assignedTo: suggestion.suggestedFor,
      assignedToName, // Add user name for optimization
      associations: suggestion.associations,
      notes: suggestion.aiReason,
      aiSuggested: true,
      aiReason: suggestion.aiReason,
      aiConfidence: suggestion.aiConfidence,
      aiContext: suggestion.aiContext,
      estimatedValue: suggestion.estimatedValue,
      kpiContribution: suggestion.kpiImpact,
      communicationDetails: suggestion.draftContent ? {
        method: suggestion.type === 'email' ? 'email' : 'phone',
        subject: suggestion.draftContent.emailSubject,
        draftContent: suggestion.draftContent.emailBody || suggestion.draftContent.phoneScript
      } : undefined,
      tenantId,
      createdBy: userId,
      createdByName, // Add creator name for optimization
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const taskResult = await db.collection('tenants').doc(tenantId).collection('tasks').add(taskData);

    // Mark suggestion as accepted
    await suggestionRef.update({
      status: 'accepted',
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      acceptedBy: userId,
      createdTaskId: taskResult.id,
      classification: suggestedClassification // Store the classification used
    });

    // Log AI action
    await logAIAction({
      eventType: 'ai_suggestion.accepted',
      targetType: 'ai_suggestion',
      targetId: taskResult.id,
      reason: `Accepted AI task suggestion: ${suggestion.title}`,
      contextType: 'ai_suggestions',
      aiTags: ['ai_suggestions', 'acceptance', suggestion.type, suggestedClassification],
      urgencyScore: getUrgencyScore(suggestion.priority),
      tenantId,
      userId,
      aiResponse: JSON.stringify({
        suggestionId,
        taskTitle: suggestion.title,
        taskType: suggestion.type,
        classification: suggestedClassification
      })
    });

    return { taskId: taskResult.id, success: true };

  } catch (error) {
    console.error('❌ Error accepting AI task suggestion:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to accept AI task suggestion: ${errorMessage}`);
  }
});

export const rejectAITaskSuggestion = onCall({
  cors: true
}, async (request) => {
  const { suggestionId, reason, tenantId, userId } = request.data;

  try {
    if (!suggestionId || !tenantId) {
      throw new Error('Missing required fields: suggestionId, tenantId');
    }

    const suggestionRef = db.collection('tenants').doc(tenantId).collection('ai_task_suggestions').doc(suggestionId);
    const suggestionDoc = await suggestionRef.get();

    if (!suggestionDoc.exists) {
      throw new Error('AI suggestion not found');
    }

    const suggestion = suggestionDoc.data();
    if (!suggestion) {
      throw new Error('Suggestion data not found');
    }

    // Mark suggestion as rejected
    await suggestionRef.update({
      status: 'rejected',
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectedBy: userId,
      rejectionReason: reason
    });

    // Log AI action
    if (userId) {
      await logAIAction({
        eventType: 'ai_suggestion.rejected',
        targetType: 'ai_suggestion',
        targetId: suggestionId,
        reason: `Rejected AI task suggestion: ${suggestion.title}`,
        contextType: 'ai_suggestions',
        aiTags: ['ai_suggestions', 'rejection', suggestion.type],
        urgencyScore: getUrgencyScore(suggestion.priority),
        tenantId,
        userId,
        aiResponse: JSON.stringify({
          suggestionId,
          taskTitle: suggestion.title,
          rejectionReason: reason
        })
      });
    }

    return { success: true };

  } catch (error) {
    console.error('❌ Error rejecting AI task suggestion:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to reject AI task suggestion: ${errorMessage}`);
  }
});

export const getDealStageAISuggestions = onCall({
  cors: true
}, async (request) => {
  const { 
    dealId, 
    tenantId, 
    currentStage, 
    userId 
  } = request.data;

  try {
    if (!dealId || !tenantId || !currentStage || !userId) {
      throw new Error('Missing required fields: dealId, tenantId, currentStage, userId');
    }

    // Get basic deal information
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (!dealDoc.exists) {
      throw new Error('Deal not found');
    }

    const deal = dealDoc.data();
    
    // Generate basic stage-specific suggestions based on current stage
    const suggestions = generateBasicStageSuggestions(currentStage, deal);

    // Create AI log for tracking (but don't wait for processing)
    try {
      await createDealAILog(
        'deal.stage_analysis_requested',
        dealId,
        `AI suggestions requested for ${currentStage} stage`,
        tenantId,
        userId,
        {},
        JSON.stringify({
          currentStage,
          requestType: 'ai_suggestions'
        })
      );
    } catch (logError) {
      console.warn('Failed to create AI log for deal stage suggestions:', logError);
      // Continue without logging - this is not critical
    }

    return {
      success: true,
      results: suggestions
    };

  } catch (error) {
    console.error('❌ Error getting deal stage AI suggestions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get deal stage AI suggestions: ${errorMessage}`);
  }
});

export const generateTaskContent = onCall({
  cors: true
}, async (request) => {
  const { 
    taskId, 
    tenantId, 
    userId 
  } = request.data;

  try {
    if (!taskId || !tenantId || !userId) {
      throw new Error('Missing required fields: taskId, tenantId, userId');
    }

    // Get task information
    let taskData = null;
    if (taskId === 'new') {
      // For new tasks, use the task data passed in the request
      taskData = request.data.task || {};
    } else {
      // For existing tasks, fetch from database
      const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
      if (!taskDoc.exists) {
        throw new Error('Task not found');
      }
      taskData = taskDoc.data();
    }

    // Get associated data for context
    const associations = taskData.associations || {};
    let companyData = null;
    let contactData = null;
    let dealData = null;

    if (associations.companies && associations.companies.length > 0) {
      const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(associations.companies[0]).get();
      if (companyDoc.exists) {
        companyData = companyDoc.data();
      }
    }

    if (associations.contacts && associations.contacts.length > 0) {
      const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(associations.contacts[0]).get();
      if (contactDoc.exists) {
        contactData = contactDoc.data();
      }
    }

    if (associations.deals && associations.deals.length > 0) {
      const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(associations.deals[0]).get();
      if (dealDoc.exists) {
        dealData = dealDoc.data();
      }
    }

    // Generate content based on task type
    const generatedContent = await generateContentByType(taskData, companyData, contactData, dealData);

    // Create AI log for tracking
    await createTaskAILog(
      'task.content_generated',
      taskId,
      `AI content generated for ${taskData.type} task`,
      tenantId,
      userId,
      associations,
      JSON.stringify({
        taskType: taskData.type,
        contentGenerated: Object.keys(generatedContent),
        companyContext: !!companyData,
        contactContext: !!contactData,
        dealContext: !!dealData
      })
    );

    return {
      success: true,
      content: generatedContent,
      suggestions: generateContentSuggestions(taskData, generatedContent),
      insights: generateContentInsights(taskData, companyData, contactData, dealData)
    };

  } catch (error) {
    console.error('❌ Error generating task content:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to generate task content: ${errorMessage}`);
  }
});

// Helper function to generate basic stage suggestions
function generateBasicStageSuggestions(currentStage: string, deal: any): any {
  const stageName = currentStage.toLowerCase();
  
  const suggestions: any = {
    stageTasks: [],
    stageStrategies: [],
    fieldCompletionTasks: [],
    nextStagePreparation: [],
    emailActivityTasks: [],
    contactEngagementTasks: [],
    companyResearchTasks: [],
    competitiveAdvantageTasks: [],
    stageInsights: []
  };

  // Generate stage-specific suggestions
  switch (stageName) {
    case 'discovery':
    case 'scoping':
      suggestions.stageTasks = [
        {
          title: 'Schedule initial discovery call',
          description: 'Set up a meeting to understand their staffing needs',
          type: 'scheduled_meeting_virtual',
          priority: 'high',
          estimatedDuration: 60
        },
        {
          title: 'Research company background',
          description: 'Gather information about their industry and current staffing situation',
          type: 'research',
          priority: 'medium',
          estimatedDuration: 30
        }
      ];
      suggestions.stageStrategies = [
        'Focus on understanding their pain points and staffing challenges',
        'Identify key decision makers and influencers',
        'Document current staffing processes and gaps'
      ];
      suggestions.stageInsights = [
        'Discovery stage is crucial for understanding client needs',
        'Focus on building rapport and establishing trust',
        'Document everything for the next stage'
      ];
      break;

    case 'proposal':
    case 'quoting':
      suggestions.stageTasks = [
        {
          title: 'Prepare detailed proposal',
          description: 'Create comprehensive staffing solution proposal',
          type: 'proposal_preparation',
          priority: 'high',
          estimatedDuration: 120
        },
        {
          title: 'Schedule proposal presentation',
          description: 'Set up meeting to present the proposal',
          type: 'scheduled_meeting_virtual',
          priority: 'high',
          estimatedDuration: 90
        }
      ];
      suggestions.stageStrategies = [
        'Highlight value proposition and ROI',
        'Address specific pain points identified in discovery',
        'Include case studies and testimonials'
      ];
      suggestions.stageInsights = [
        'Proposal should be tailored to their specific needs',
        'Include clear pricing and terms',
        'Prepare for questions and objections'
      ];
      break;

    case 'negotiation':
      suggestions.stageTasks = [
        {
          title: 'Address contract concerns',
          description: 'Work through any contract issues or concerns',
          type: 'negotiation',
          priority: 'high',
          estimatedDuration: 60
        },
        {
          title: 'Follow up on proposal feedback',
          description: 'Check in on proposal review and address questions',
          type: 'follow_up',
          priority: 'medium',
          estimatedDuration: 30
        }
      ];
      suggestions.stageStrategies = [
        'Be flexible but maintain value',
        'Address concerns promptly and professionally',
        'Document all agreements and changes'
      ];
      suggestions.stageInsights = [
        'Negotiation is about finding win-win solutions',
        'Stay focused on value and benefits',
        'Keep momentum going'
      ];
      break;

    case 'closing':
      suggestions.stageTasks = [
        {
          title: 'Finalize contract terms',
          description: 'Complete contract finalization and signing',
          type: 'closing',
          priority: 'high',
          estimatedDuration: 60
        },
        {
          title: 'Schedule kickoff meeting',
          description: 'Plan initial meeting with operations team',
          type: 'scheduled_meeting_virtual',
          priority: 'high',
          estimatedDuration: 60
        }
      ];
      suggestions.stageStrategies = [
        'Ensure all terms are clearly documented',
        'Plan for smooth transition to operations',
        'Set up success metrics and reporting'
      ];
      suggestions.stageInsights = [
        'Closing requires attention to detail',
        'Plan for post-sale success',
        'Maintain relationship momentum'
      ];
      break;

    default:
      suggestions.stageTasks = [
        {
          title: 'Review stage requirements',
          description: 'Check what needs to be completed for this stage',
          type: 'research',
          priority: 'medium',
          estimatedDuration: 30
        }
      ];
      suggestions.stageStrategies = [
        'Focus on stage-specific goals and objectives',
        'Document progress and next steps',
        'Maintain regular communication with client'
      ];
      suggestions.stageInsights = [
        `Focus on completing ${currentStage} stage requirements`,
        'Keep the deal moving forward',
        'Document all activities and outcomes'
      ];
  }

  // Add some general field completion tasks
  suggestions.fieldCompletionTasks = [
    {
      title: 'Update deal notes',
      description: 'Document latest interactions and progress',
      type: 'administrative',
      priority: 'medium',
      estimatedDuration: 15
    },
    {
      title: 'Update contact information',
      description: 'Ensure all contact details are current',
      type: 'administrative',
      priority: 'low',
      estimatedDuration: 10
    }
  ];

  // Add email activity suggestions
  suggestions.emailActivityTasks = [
    {
      title: 'Send follow-up email',
      description: 'Follow up on recent interactions',
      type: 'email',
      priority: 'medium',
      estimatedDuration: 20
    }
  ];

  return suggestions;
}

// 🛠️ HELPER FUNCTIONS

async function getUserPipelineData(userId: string, tenantId: string): Promise<any> {
  try {
    // Get user's deals, contacts, companies, and recent activities
    const [deals, contacts, companies] = await Promise.all([
      db.collection('tenants').doc(tenantId).collection('crm_deals')
        .where('assignedTo', '==', userId)
        .where('status', 'in', ['scheduled', 'in_progress'])
        .get(),
      db.collection('tenants').doc(tenantId).collection('crm_contacts')
        .where('assignedTo', '==', userId)
        .get(),
      db.collection('tenants').doc(tenantId).collection('crm_companies')
        .where('assignedTo', '==', userId)
        .get()
    ]);

    return {
      deals: deals.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      contacts: contacts.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      companies: companies.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    };
  } catch (error) {
    console.error('Error getting user pipeline data:', error);
    return { deals: [], contacts: [], companies: [] };
  }
}

async function generateAITaskSuggestions(pipelineData: any, limit: number): Promise<any[]> {
  try {
    // This is a simplified version - in production, this would use AI to generate suggestions
    const suggestions = [];
    
    // Generate suggestions based on pipeline data
    if (pipelineData.deals.length > 0) {
      suggestions.push({
        id: `suggestion_${Date.now()}_1`,
        title: 'Follow up on recent deals',
        description: 'Check in on deals that haven\'t been updated recently',
        type: 'phone_call',
        category: 'follow_up',
        priority: 'high',
        suggestedDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        suggestedFor: pipelineData.deals[0].assignedTo,
        associations: { deals: pipelineData.deals.slice(0, 3).map((d: any) => d.id) },
        aiReason: 'High-value deals need regular follow-up',
        aiConfidence: 0.85,
        aiContext: 'Based on deal pipeline analysis',
        estimatedValue: 5000,
        kpiImpact: 'deal_progression'
      });
    }

    if (pipelineData.contacts.length > 0) {
      suggestions.push({
        id: `suggestion_${Date.now()}_2`,
        title: 'Reach out to new contacts',
        description: 'Connect with recently added contacts',
        type: 'email',
        category: 'outreach',
        priority: 'medium',
        suggestedDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        suggestedFor: pipelineData.contacts[0].assignedTo,
        associations: { contacts: pipelineData.contacts.slice(0, 5).map((c: any) => c.id) },
        aiReason: 'New contacts need initial outreach',
        aiConfidence: 0.75,
        aiContext: 'Based on contact acquisition analysis',
        estimatedValue: 1000,
        kpiImpact: 'contact_engagement'
      });
    }

    return suggestions.slice(0, limit);
  } catch (error) {
    console.error('Error generating AI task suggestions:', error);
    return [];
  }
}

function getUrgencyScore(priority: string): number {
  const scores = {
    urgent: 5,
    high: 4,
    medium: 3,
    low: 2
  };
  return scores[priority as keyof typeof scores] || 3;
}

// 🎯 CONTENT GENERATION FUNCTIONS

async function generateContentByType(taskData: any, companyData: any, contactData: any, dealData: any) {
  const taskType = taskData.type || 'custom';
  const content: any = {};

  switch (taskType) {
    case 'email':
      content.email = generateEmailContent(taskData, companyData, contactData, dealData);
      break;
    case 'phone_call':
      content.callScript = generateCallScript(taskData, companyData, contactData, dealData);
      break;
    case 'scheduled_meeting_virtual':
    case 'scheduled_meeting_in_person':
      content.meetingAgenda = generateMeetingAgenda(taskData, companyData, contactData, dealData);
      break;
    case 'research':
      content.researchPlan = generateResearchPlan(taskData, companyData, contactData, dealData);
      break;
    default:
      content.generalContent = generateGeneralContent(taskData, companyData, contactData, dealData);
  }

  return content;
}

function generateEmailContent(taskData: any, companyData: any, contactData: any, dealData: any) {
  const contactName = contactData?.fullName || contactData?.firstName || 'there';
  const companyName = companyData?.companyName || companyData?.name || 'your company';
  const dealName = dealData?.name || 'our discussion';

  return {
    subject: `Follow up: ${taskData.title || 'our conversation'}`,
    greeting: `Hi ${contactName},`,
    body: `I hope this email finds you well. I wanted to follow up on ${dealName} and see if you had any questions or if there's anything else I can help you with.

${taskData.description || 'I appreciate your time and look forward to continuing our conversation.'}`,
    callToAction: `Please let me know if you'd like to schedule a call or if you have any questions. I'm here to help!`,
    personalization: {
      contactName,
      companyName,
      dealName,
      taskContext: taskData.description
    }
  };
}

function generateCallScript(taskData: any, companyData: any, contactData: any, dealData: any) {
  const contactName = contactData?.fullName || contactData?.firstName || 'there';

  return {
    opening: `Hi ${contactName}, this is [Your Name] from [Your Company]. I hope I'm catching you at a good time.`,
    agenda: [
      'Brief introduction and purpose of call',
      'Discuss current situation and needs',
      'Explore potential solutions',
      'Next steps and follow-up'
    ],
    questions: [
      'What are your current challenges with staffing?',
      "What's your timeline for making a decision?",
      'Who else should be involved in this conversation?',
      'What would success look like for you?'
    ],
    closing: `Thank you for your time today. I'll follow up with the information we discussed and look forward to our next conversation.`,
    notes: `Focus on understanding their needs and building rapport. Be prepared to address common objections.`
  };
}

function generateMeetingAgenda(taskData: any, companyData: any, contactData: any, dealData: any) {
  const companyName = companyData?.companyName || companyData?.name || 'the company';

  return {
    title: `${taskData.title || 'Meeting'} - ${companyName}`,
    duration: '30 minutes',
    agenda: [
      'Introduction and meeting objectives',
      'Current situation and challenges',
      'Potential solutions and approach',
      'Next steps and timeline',
      'Questions and discussion'
    ],
    objectives: [
      'Understand their specific needs and challenges',
      'Present relevant solutions and approach',
      'Establish next steps and timeline',
      'Build relationship and trust'
    ],
    preparation: [
      'Research company and contact background',
      'Review previous interactions and notes',
      'Prepare relevant case studies or examples',
      'Set up meeting materials and agenda'
    ]
  };
}

function generateResearchPlan(taskData: any, companyData: any, contactData: any, dealData: any) {
  return {
    objectives: [
      'Understand company structure and decision-making process',
      'Identify key stakeholders and influencers',
      'Research current challenges and pain points',
      'Explore competitive landscape and opportunities'
    ],
    researchAreas: [
      'Company website and recent news',
      'LinkedIn profiles of key contacts',
      'Industry reports and market analysis',
      'Competitor analysis and positioning'
    ],
    sources: [
      'Company website and social media',
      'LinkedIn and professional networks',
      'Industry publications and reports',
      'News articles and press releases'
    ],
    deliverables: [
      'Company profile and key insights',
      'Stakeholder map and decision-making process',
      'Pain points and opportunity analysis',
      'Competitive positioning and recommendations'
    ]
  };
}

function generateGeneralContent(taskData: any, companyData: any, contactData: any, dealData: any) {
  return {
    title: taskData.title || 'Task',
    description: taskData.description || 'General task content',
    keyPoints: [
      'Understand the specific requirements',
      'Gather necessary information and context',
      'Prepare relevant materials and resources',
      'Follow up with appropriate stakeholders'
    ],
    nextSteps: [
      'Complete the task as outlined',
      'Document progress and outcomes',
      'Update relevant systems and records',
      'Schedule follow-up if needed'
    ]
  };
}

function generateContentSuggestions(taskData: any, generatedContent: any) {
  const suggestions = [];
  
  if (generatedContent.email) {
    suggestions.push({
      type: 'email',
      title: 'Use email template',
      description: 'Copy the generated email content to your email client',
      action: 'copy_email'
    });
  }
  
  if (generatedContent.callScript) {
    suggestions.push({
      type: 'call_script',
      title: 'Use call script',
      description: 'Use the generated script for your phone call',
      action: 'copy_script'
    });
  }
  
  if (generatedContent.meetingAgenda) {
    suggestions.push({
      type: 'meeting',
      title: 'Use meeting agenda',
      description: 'Use the generated agenda for your meeting',
      action: 'copy_agenda'
    });
  }
  
  return suggestions;
}

function generateContentInsights(taskData: any, companyData: any, contactData: any, dealData: any) {
  const insights = [];
  
  if (contactData) {
    insights.push({
      type: 'contact',
      title: 'Contact Context',
      description: `Based on ${contactData.fullName || contactData.firstName}'s role and background`,
      value: contactData.jobTitle || contactData.title || 'Unknown role'
    });
  }
  
  if (companyData) {
    insights.push({
      type: 'company',
      title: 'Company Context',
      description: `Tailored for ${companyData.companyName || companyData.name}`,
      value: companyData.industry || 'Unknown industry'
    });
  }
  
  if (dealData) {
    insights.push({
      type: 'deal',
      title: 'Deal Context',
      description: `Connected to deal: ${dealData.name}`,
      value: dealData.stage || 'Unknown stage'
    });
  }
  
  return insights;
} 