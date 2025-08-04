import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logAIAction, createTaskAILog, createDealAILog } from './utils/aiLogging';

const db = admin.firestore();

// 🎯 COMPREHENSIVE TASKS ENGINE
// Integrates with CRM, AI logging, and activity tracking

// 🏗️ CORE TASK OPERATIONS

export const createTask = onCall({
  cors: true
}, async (request) => {
  const { 
    title, 
    description, 
    type, 
    priority, 
    status, 
    scheduledDate, 
    dueDate, 
    estimatedDuration, 
    assignedTo, 
    createdBy, 
    tenantId, 
    category, 
    quotaCategory, 
    associations, 
    tags, 
    notes, 
    reason,
    aiSuggested,
    aiPrompt
  } = request.data;

  try {
    if (!title || !assignedTo || !tenantId) {
      throw new Error('Missing required fields: title, assignedTo, tenantId');
    }

    const taskData = {
      title,
      description: description || '',
      type: type || 'custom',
      priority: priority || 'medium',
      status: status || 'scheduled',
      scheduledDate: scheduledDate || new Date().toISOString(),
      dueDate: dueDate || null,
      estimatedDuration: estimatedDuration || 30,
      assignedTo,
      createdBy: createdBy || assignedTo,
      tenantId,
      category: category || 'general',
      quotaCategory: quotaCategory || 'business_generating',
      associations: associations || {},
      tags: tags || [],
      notes: notes || '',
      reason: reason || '',
      aiSuggested: aiSuggested || false,
      aiPrompt: aiPrompt || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
      actionResult: null
    };

    const taskRef = await db.collection('tenants').doc(tenantId).collection('tasks').add(taskData);
    const taskId = taskRef.id;

    // Create AI log for task creation
    await createTaskAILog(
      'task.created',
      taskId,
      `Task "${title}" created by ${createdBy || assignedTo}`,
      tenantId,
      assignedTo,
      associations,
      JSON.stringify({
        type,
        priority,
        category,
        quotaCategory,
        aiSuggested
      })
    );

    console.log(`✅ Task created: ${taskId} - ${title}`);

    return { 
      taskId, 
      success: true,
      message: 'Task created successfully'
    };

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
        const followUpData = {
          ...followUpTask,
          assignedTo: taskData?.assignedTo,
          createdBy: taskData?.assignedTo,
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

    // Get today's tasks
    const todayStart = new Date(date);
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(date);
    todayEnd.setHours(23, 59, 59, 999);

    try {
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
    } catch (indexError: any) {
      console.warn('Index not ready for today tasks query, returning empty results:', indexError.message);
      todayTasks = [];
    }
    
    // Get this week's tasks
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    
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

    // Calculate analytics
    const allTasks = [...todayTasks, ...weekTasks];
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

    const completedTasks = allTasks.filter((t: any) => t.status === 'completed').length;
    const totalTasks = allTasks.length;
    const quotaProgress = {
      percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      completed: completedTasks,
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

export const acceptAITaskSuggestion = onCall({
  cors: true
}, async (request) => {
  const { suggestionId, tenantId, userId } = request.data;

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

    // Create the task
    const taskData = {
      title: suggestion.title,
      description: suggestion.description,
      type: suggestion.type,
      category: suggestion.category,
      priority: suggestion.priority,
      scheduledDate: suggestion.suggestedDate,
      status: 'upcoming',
      assignedTo: suggestion.suggestedFor,
      associations: suggestion.associations,
      notes: suggestion.aiReason,
      aiGenerated: true,
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const taskResult = await db.collection('tenants').doc(tenantId).collection('tasks').add(taskData);

    // Mark suggestion as accepted
    await suggestionRef.update({
      status: 'accepted',
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      acceptedBy: userId,
      createdTaskId: taskResult.id
    });

    // Log AI action
    await logAIAction({
      eventType: 'ai_suggestion.accepted',
      targetType: 'ai_suggestion',
      targetId: taskResult.id,
      reason: `Accepted AI task suggestion: ${suggestion.title}`,
      contextType: 'ai_suggestions',
      aiTags: ['ai_suggestions', 'acceptance', suggestion.type],
      urgencyScore: getUrgencyScore(suggestion.priority),
      tenantId,
      userId,
      aiResponse: JSON.stringify({
        suggestionId,
        taskTitle: suggestion.title,
        taskType: suggestion.type
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

    // Create AI log to trigger the Task Content AI Engine
    await createTaskAILog(
      'task.content_generation_requested',
      taskId,
      `AI content generation requested for task`,
      tenantId,
      userId,
      {},
      JSON.stringify({
        requestType: 'content_generation',
        contentTypes: ['email', 'call_script', 'meeting_agenda', 'follow_up']
      })
    );

    // Wait a moment for the AI engine to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the latest content analysis for this task
    const contentQuery = db.collection('task_content_ai_analysis')
      .where('analysis.targetId', '==', taskId)
      .orderBy('timestamp', 'desc')
      .limit(1);

    const contentSnapshot = await contentQuery.get();
    
    if (contentSnapshot.empty) {
      // Return default content if no AI analysis is available yet
      return {
        success: true,
        content: {
          email: {
            subject: 'Sample Email Subject',
            greeting: 'Hi there,',
            body: 'This is a sample email body. AI content generation is being processed.',
            callToAction: 'Schedule a call'
          },
          callScript: {
            opening: 'Sample call opening',
            agenda: ['Introduction', 'Discussion', 'Next steps'],
            questions: ['What are your challenges?', 'What is your timeline?'],
            closing: 'Thank you for your time.'
          },
          meetingAgenda: {
            title: 'Sample Meeting Agenda',
            duration: '30 minutes',
            agenda: ['Introduction (5 min)', 'Discussion (20 min)', 'Next steps (5 min)'],
            objectives: ['Understand needs', 'Present solution', 'Get commitment']
          }
        },
        insights: [
          'AI content generation is being processed. Please refresh in a moment to see generated content.',
          'Content will be personalized based on deal context and contact information.'
        ]
      };
    }

    const latestContent = contentSnapshot.docs[0].data();
    const results = latestContent.analysis;

    return {
      success: true,
      content: results.generatedContent,
      suggestions: results.contentSuggestions,
      insights: results.aiInsights,
      nextSteps: results.nextSteps
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