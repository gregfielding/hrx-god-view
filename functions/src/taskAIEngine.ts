import * as admin from 'firebase-admin';
import { logAIAction } from './utils/aiLogging';

const db = admin.firestore();

/**
 * Tasks AI Engine - Processes task-related AI logs and provides intelligent task management
 * Handles task suggestions, prioritization, scheduling, and content generation
 */
export const processWithTasksAIEngine = async (logData: any, logId: string): Promise<any> => {
  console.log(`TasksAIEngine processing log ${logId}:`, logData.eventType);
  
  const start = Date.now();
  const results: any = {
    taskSuggestions: [],
    priorityRecommendations: [],
    schedulingOptimizations: [],
    contentDrafts: [],
    followUpTasks: [],
    quotaOptimizations: [],
    associationInsights: [],
    aiGeneratedTasks: []
  };

  try {
    const tenantId = logData.tenantId;
    const taskId = logData.targetId;

    if (!tenantId) {
      throw new Error('Missing tenantId for Tasks AI processing');
    }

    // Get full context based on event type
    let contextData: any = {};
    
    switch (logData.eventType) {
      case 'task.created':
        contextData = await getTaskCreationContext(logData, tenantId);
        break;
      case 'task.completed':
        contextData = await getTaskCompletionContext(logData, tenantId);
        break;
      case 'task.updated':
        contextData = await getGeneralContext(logData, tenantId);
        break;
      case 'deal.stage_advanced':
        contextData = await getDealStageContext(logData, tenantId);
        break;
      case 'contact.interaction':
        contextData = await getContactInteractionContext(logData, tenantId);
        break;
      case 'company.updated':
        contextData = await getCompanyUpdateContext(logData, tenantId);
        break;
      default:
        contextData = await getGeneralContext(logData, tenantId);
    }

    // Generate AI insights and recommendations
    results.taskSuggestions = await generateTaskSuggestions(contextData, logData);
    results.priorityRecommendations = await generatePriorityRecommendations(contextData, logData);
    results.schedulingOptimizations = await generateSchedulingOptimizations(contextData, logData);
    results.contentDrafts = await generateContentDrafts(contextData, logData);
    results.followUpTasks = await generateFollowUpTasks(contextData, logData);
    results.quotaOptimizations = await generateQuotaOptimizations(contextData, logData);
    results.associationInsights = await generateAssociationInsights(contextData, logData);
    results.aiGeneratedTasks = await generateAITasks(contextData, logData);

    // Log the AI processing
    await logAIAction({
      eventType: 'tasks_ai_engine.processed',
      targetType: 'task_ai_analysis',
      targetId: taskId || 'general',
      reason: `Tasks AI Engine processed ${logData.eventType} with ${results.taskSuggestions.length} suggestions`,
      contextType: 'tasks_ai',
      aiTags: ['tasks_ai', 'processing', 'suggestions'],
      urgencyScore: 5,
      inputPrompt: `Process ${logData.eventType} for intelligent task management`,
      composedPrompt: `Analyze context for task optimization: ${JSON.stringify(contextData.summary)}`,
      aiResponse: JSON.stringify(results),
      success: true,
      latencyMs: Date.now() - start
    });

    const latencyMs = Date.now() - start;
    
    return {
      success: true,
      latencyMs,
      taskSuggestions: results.taskSuggestions.length,
      priorityRecommendations: results.priorityRecommendations.length,
      schedulingOptimizations: results.schedulingOptimizations.length,
      contentDrafts: results.contentDrafts.length,
      followUpTasks: results.followUpTasks.length,
      quotaOptimizations: results.quotaOptimizations.length,
      associationInsights: results.associationInsights.length,
      aiGeneratedTasks: results.aiGeneratedTasks.length,
      results
    };

  } catch (error) {
    console.error('Error in Tasks AI Engine:', error);
    
    // Log the error
    await logAIAction({
      eventType: 'tasks_ai_engine.error',
      targetType: 'task_ai_analysis',
      targetId: logData.targetId || 'error',
      reason: `Tasks AI Engine error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      contextType: 'tasks_ai',
      aiTags: ['tasks_ai', 'error'],
      urgencyScore: 8,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - start
    };
  }
};

// Context gathering functions
async function getTaskCreationContext(logData: any, tenantId: string): Promise<any> {
  const taskId = logData.targetId;
  const userId = logData.userId || logData.assignedTo;
  
  const context: any = {
    task: null,
    user: null,
    associations: {},
    pipeline: {},
    quota: {},
    summary: ''
  };

  try {
    // Get task data
    if (taskId) {
      const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
      if (taskDoc.exists) {
        context.task = { id: taskId, ...taskDoc.data() };
      }
    }

    // Get user data and quota
    if (userId) {
      const userDoc = await db.collection('tenants').doc(tenantId).collection('users').doc(userId).get();
      if (userDoc.exists) {
        context.user = { id: userId, ...userDoc.data() };
      }

      // Get user's quota and activity
      context.quota = await getUserQuota(userId, tenantId);
    }

    // Get associations if task exists
    if (context.task) {
      context.associations = await getTaskAssociations(taskId, tenantId);
    }

    // Get user's pipeline
    if (userId) {
      context.pipeline = await getUserPipeline(userId, tenantId);
    }

    context.summary = `Task creation context: ${context.task ? 'Task exists' : 'No task'}, User: ${context.user ? 'Found' : 'Not found'}, Associations: ${Object.keys(context.associations).length}`;
    
    return context;
  } catch (error) {
    console.error('Error getting task creation context:', error);
    return context;
  }
}

async function getTaskCompletionContext(logData: any, tenantId: string): Promise<any> {
  const taskId = logData.targetId;
  const userId = logData.userId || logData.assignedTo;
  
  const context: any = {
    task: null,
    user: null,
    associations: {},
    pipeline: {},
    quota: {},
    completionImpact: {},
    summary: ''
  };

  try {
    // Get completed task data
    if (taskId) {
      const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
      if (taskDoc.exists) {
        context.task = { id: taskId, ...taskDoc.data() };
      }
    }

    // Get user data and updated quota
    if (userId) {
      const userDoc = await db.collection('tenants').doc(tenantId).collection('users').doc(userId).get();
      if (userDoc.exists) {
        context.user = { id: userId, ...userDoc.data() };
      }

      // Get updated quota after completion
      context.quota = await getUserQuota(userId, tenantId);
    }

    // Get associations
    if (context.task) {
      context.associations = await getTaskAssociations(taskId, tenantId);
    }

    // Get pipeline impact
    if (userId) {
      context.pipeline = await getUserPipeline(userId, tenantId);
    }

    // Analyze completion impact
    if (context.task) {
      context.completionImpact = await analyzeCompletionImpact(context.task, context.associations);
    }

    context.summary = `Task completion context: Task completed, Impact: ${Object.keys(context.completionImpact).length} areas affected`;
    
    return context;
  } catch (error) {
    console.error('Error getting task completion context:', error);
    return context;
  }
}

async function getDealStageContext(logData: any, tenantId: string): Promise<any> {
  const dealId = logData.targetId;
  
  const context: any = {
    deal: null,
    stage: null,
    associations: {},
    requiredTasks: [],
    summary: ''
  };

  try {
    // Get deal data
    if (dealId) {
      const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
      if (dealDoc.exists) {
        context.deal = { id: dealId, ...dealDoc.data() };
        context.stage = context.deal.stage || 'discovery';
      }
    }

    // Get deal associations
    if (dealId) {
      context.associations = await getDealAssociations(dealId, tenantId);
    }

    // Get stage-required tasks
    if (context.stage) {
      context.requiredTasks = await getStageRequiredTasks(context.stage, context.deal);
    }

    context.summary = `Deal stage context: Deal ${dealId}, Stage: ${context.stage}, Required tasks: ${context.requiredTasks.length}`;
    
    return context;
  } catch (error) {
    console.error('Error getting deal stage context:', error);
    return context;
  }
}

async function getContactInteractionContext(logData: any, tenantId: string): Promise<any> {
  const contactId = logData.targetId;
  
  const context: any = {
    contact: null,
    interaction: null,
    associations: {},
    followUpTasks: [],
    summary: ''
  };

  try {
    // Get contact data
    if (contactId) {
      const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
      if (contactDoc.exists) {
        context.contact = { id: contactId, ...contactDoc.data() };
      }
    }

    // Get interaction details
    context.interaction = logData.interaction || logData.note || logData.email;

    // Get contact associations
    if (contactId) {
      context.associations = await getContactAssociations(contactId, tenantId);
    }

    // Generate follow-up tasks
    if (context.interaction) {
      context.followUpTasks = await generateContactFollowUpTasks(context.contact, context.interaction);
    }

    context.summary = `Contact interaction context: Contact ${contactId}, Interaction type: ${logData.eventType}, Follow-ups: ${context.followUpTasks.length}`;
    
    return context;
  } catch (error) {
    console.error('Error getting contact interaction context:', error);
    return context;
  }
}

async function getCompanyUpdateContext(logData: any, tenantId: string): Promise<any> {
  const companyId = logData.targetId;
  
  const context: any = {
    company: null,
    update: null,
    associations: {},
    impactTasks: [],
    summary: ''
  };

  try {
    // Get company data
    if (companyId) {
      const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get();
      if (companyDoc.exists) {
        context.company = { id: companyId, ...companyDoc.data() };
      }
    }

    // Get update details
    context.update = logData.changes || logData.update;

    // Get company associations
    if (companyId) {
      context.associations = await getCompanyAssociations(companyId, tenantId);
    }

    // Analyze impact on existing tasks
    if (companyId) {
      context.impactTasks = await analyzeCompanyUpdateImpact(companyId, context.update, tenantId);
    }

    context.summary = `Company update context: Company ${companyId}, Update type: ${logData.eventType}, Impact: ${context.impactTasks.length} tasks affected`;
    
    return context;
  } catch (error) {
    console.error('Error getting company update context:', error);
    return context;
  }
}

async function getGeneralContext(logData: any, tenantId: string): Promise<any> {
  const context: any = {
    event: logData,
    summary: `General context for ${logData.eventType}`
  };

  return context;
}

// Helper functions for data gathering
async function getUserQuota(userId: string, tenantId: string): Promise<any> {
  try {
    // Get user's daily quota and current progress
    const today = new Date().toISOString().split('T')[0];
    
    const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
      .where('assignedTo', '==', userId)
      .where('scheduledDate', '>=', today)
      .where('scheduledDate', '<=', today + 'T23:59:59.999Z');
    
    const tasksSnapshot = await tasksQuery.get();
    const todayTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
    
    const completedTasks = todayTasks.filter((task: any) => task.status === 'completed');
    const businessGeneratingTasks = todayTasks.filter((task: any) => 
      task.quotaCategory === 'business_generating' && task.status === 'completed'
    );
    
    return {
      dailyTarget: 30, // Default quota
      completedToday: completedTasks.length,
      businessGeneratingCompleted: businessGeneratingTasks.length,
      remainingToday: 30 - businessGeneratingTasks.length,
      completionRate: todayTasks.length > 0 ? (completedTasks.length / todayTasks.length) * 100 : 0
    };
  } catch (error) {
    console.error('Error getting user quota:', error);
    return {
      dailyTarget: 30,
      completedToday: 0,
      businessGeneratingCompleted: 0,
      remainingToday: 30,
      completionRate: 0
    };
  }
}

async function getUserPipeline(userId: string, tenantId: string): Promise<any> {
  try {
    // Get user's active deals and their stages
    const dealsQuery = db.collection('tenants').doc(tenantId).collection('crm_deals')
      .where('assignedTo', '==', userId)
      .where('status', '==', 'active');
    
    const dealsSnapshot = await dealsQuery.get();
    const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Group deals by stage
    const pipelineByStage = deals.reduce((acc: any, deal: any) => {
      const stage = deal.stage || 'discovery';
      if (!acc[stage]) acc[stage] = [];
      acc[stage].push(deal);
      return acc;
    }, {});
    
    return {
      totalDeals: deals.length,
      dealsByStage: pipelineByStage,
      stages: Object.keys(pipelineByStage),
      averageDealValue: deals.length > 0 ? 
        deals.reduce((sum: number, deal: any) => sum + (deal.value || 0), 0) / deals.length : 0
    };
  } catch (error) {
    console.error('Error getting user pipeline:', error);
    return {
      totalDeals: 0,
      dealsByStage: {},
      stages: [],
      averageDealValue: 0
    };
  }
}

async function getTaskAssociations(taskId: string, tenantId: string): Promise<any> {
  try {
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) return {};
    
    const taskData = taskDoc.data();
    return {
      deals: taskData?.associations?.deals || [],
      companies: taskData?.associations?.companies || [],
      contacts: taskData?.associations?.contacts || [],
      salespeople: taskData?.associations?.salespeople || []
    };
  } catch (error) {
    console.error('Error getting task associations:', error);
    return {};
  }
}

async function getDealAssociations(dealId: string, tenantId: string): Promise<any> {
  try {
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (!dealDoc.exists) return {};
    
    const dealData = dealDoc.data();
    return {
      companies: dealData?.associations?.companies || [],
      contacts: dealData?.associations?.contacts || [],
      salespeople: dealData?.associations?.salespeople || []
    };
  } catch (error) {
    console.error('Error getting deal associations:', error);
    return {};
  }
}

async function getContactAssociations(contactId: string, tenantId: string): Promise<any> {
  try {
    const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
    if (!contactDoc.exists) return {};
    
    const contactData = contactDoc.data();
    return {
      companies: contactData?.associations?.companies || [],
      deals: contactData?.associations?.deals || [],
      salespeople: contactData?.associations?.salespeople || []
    };
  } catch (error) {
    console.error('Error getting contact associations:', error);
    return {};
  }
}

async function getCompanyAssociations(companyId: string, tenantId: string): Promise<any> {
  try {
    const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get();
    if (!companyDoc.exists) return {};
    
    const companyData = companyDoc.data();
    return {
      contacts: companyData?.associations?.contacts || [],
      deals: companyData?.associations?.deals || [],
      salespeople: companyData?.associations?.salespeople || []
    };
  } catch (error) {
    console.error('Error getting company associations:', error);
    return {};
  }
}

// AI Generation functions
async function generateTaskSuggestions(contextData: any, logData: any): Promise<any[]> {
  const suggestions: any[] = [];
  
  try {
    // Generate suggestions based on context
    if (contextData.deal && contextData.stage) {
      suggestions.push({
        type: 'stage_advancement',
        title: `Advance ${contextData.deal.name} to next stage`,
        description: `Move deal from ${contextData.stage} to ${getNextStage(contextData.stage)}`,
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 30,
        associations: {
          deals: [contextData.deal.id]
        },
        aiGenerated: true,
        aiPrompt: `Deal ${contextData.deal.name} is ready for stage advancement`
      });
    }

    if (contextData.contact && contextData.interaction) {
      suggestions.push({
        type: 'follow_up',
        title: `Follow up with ${contextData.contact.name}`,
        description: `Follow up on recent interaction: ${contextData.interaction.type}`,
        priority: 'medium',
        category: 'business_generating',
        estimatedDuration: 15,
        associations: {
          contacts: [contextData.contact.id]
        },
        aiGenerated: true,
        aiPrompt: `Contact ${contextData.contact.name} needs follow-up`
      });
    }

    if (contextData.quota && contextData.quota.remainingToday > 0) {
      suggestions.push({
        type: 'quota_fill',
        title: `Fill remaining quota (${contextData.quota.remainingToday} activities needed)`,
        description: `Complete ${contextData.quota.remainingToday} more business-generating activities today`,
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 60,
        aiGenerated: true,
        aiPrompt: `User needs ${contextData.quota.remainingToday} more quota activities`
      });
    }

    return suggestions;
  } catch (error) {
    console.error('Error generating task suggestions:', error);
    return [];
  }
}

async function generatePriorityRecommendations(contextData: any, logData: any): Promise<any[]> {
  const recommendations: any[] = [];
  
  try {
    // Analyze current priorities and suggest optimizations
    if (contextData.task) {
      const task = contextData.task;
      
      // Suggest priority changes based on context
      if (task.priority === 'low' && task.quotaCategory === 'business_generating') {
        recommendations.push({
          taskId: task.id,
          currentPriority: task.priority,
          suggestedPriority: 'medium',
          reason: 'Business-generating tasks should have higher priority',
          impact: 'medium'
        });
      }
      
      if (task.priority === 'high' && task.status === 'scheduled' && task.dueDate) {
        const daysUntilDue = Math.ceil((new Date(task.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysUntilDue > 7) {
          recommendations.push({
            taskId: task.id,
            currentPriority: task.priority,
            suggestedPriority: 'medium',
            reason: `Task is due in ${daysUntilDue} days, can be deprioritized`,
            impact: 'low'
          });
        }
      }
    }

    return recommendations;
  } catch (error) {
    console.error('Error generating priority recommendations:', error);
    return [];
  }
}

async function generateSchedulingOptimizations(contextData: any, logData: any): Promise<any[]> {
  const optimizations: any[] = [];
  
  try {
    // Suggest scheduling optimizations
    if (contextData.quota && contextData.quota.completionRate < 50) {
      optimizations.push({
        type: 'morning_focus',
        description: 'Schedule high-priority tasks in the morning',
        reason: 'Low completion rate suggests better morning scheduling',
        impact: 'high'
      });
    }

    if (contextData.pipeline && contextData.pipeline.totalDeals > 10) {
      optimizations.push({
        type: 'deal_rotation',
        description: 'Rotate focus between deals to maintain momentum',
        reason: 'Large pipeline requires systematic deal management',
        impact: 'medium'
      });
    }

    return optimizations;
  } catch (error) {
    console.error('Error generating scheduling optimizations:', error);
    return [];
  }
}

async function generateContentDrafts(contextData: any, logData: any): Promise<any[]> {
  const drafts: any[] = [];
  
  try {
    // Generate email drafts and scripts based on context
    if (contextData.contact && contextData.interaction) {
      drafts.push({
        type: 'follow_up_email',
        title: `Follow-up email to ${contextData.contact.name}`,
        content: `Hi ${contextData.contact.name},\n\nThank you for our recent conversation about ${contextData.interaction.topic || 'your business needs'}. I wanted to follow up and see if you have any questions or if there's anything else I can help you with.\n\nBest regards,\n[Your Name]`,
        associations: {
          contacts: [contextData.contact.id]
        },
        aiGenerated: true
      });
    }

    if (contextData.deal && contextData.stage === 'proposal') {
      drafts.push({
        type: 'proposal_follow_up',
        title: `Proposal follow-up for ${contextData.deal.name}`,
        content: `Hi [Contact Name],\n\nI hope you've had a chance to review our proposal for ${contextData.deal.name}. I wanted to check in and see if you have any questions or feedback.\n\nI'm available for a call this week to discuss any aspects of the proposal in detail.\n\nBest regards,\n[Your Name]`,
        associations: {
          deals: [contextData.deal.id]
        },
        aiGenerated: true
      });
    }

    return drafts;
  } catch (error) {
    console.error('Error generating content drafts:', error);
    return [];
  }
}

async function generateFollowUpTasks(contextData: any, logData: any): Promise<any[]> {
  const followUps: any[] = [];
  
  try {
    // Generate follow-up tasks based on completed tasks
    if (contextData.task && contextData.task.status === 'completed') {
      const task = contextData.task;
      
      // Suggest follow-up based on task type
      switch (task.type) {
        case 'email':
          followUps.push({
            type: 'follow_up_call',
            title: `Follow-up call after email to ${task.associations?.contacts?.[0] || 'contact'}`,
            description: 'Schedule a call to discuss the email content',
            priority: 'medium',
            category: 'business_generating',
            estimatedDuration: 30,
            associations: task.associations,
            aiGenerated: true,
            aiPrompt: `Follow-up call after email task completion`
          });
          break;
          
        case 'phone_call':
          followUps.push({
            type: 'follow_up_email',
            title: `Send follow-up email after call`,
            description: 'Send a summary email of the call discussion',
            priority: 'medium',
            category: 'business_generating',
            estimatedDuration: 15,
            associations: task.associations,
            aiGenerated: true,
            aiPrompt: `Follow-up email after call task completion`
          });
          break;
      }
    }

    return followUps;
  } catch (error) {
    console.error('Error generating follow-up tasks:', error);
    return [];
  }
}

async function generateQuotaOptimizations(contextData: any, logData: any): Promise<any[]> {
  const optimizations: any[] = [];
  
  try {
    // Suggest quota optimization strategies
    if (contextData.quota && contextData.quota.remainingToday > 0) {
      optimizations.push({
        type: 'quick_wins',
        description: `Focus on ${contextData.quota.remainingToday} quick business-generating activities`,
        suggestions: [
          'Send 3 follow-up emails',
          'Make 2 quick check-in calls',
          'Update 1 deal status',
          'Research 1 new prospect'
        ],
        impact: 'high'
      });
    }

    if (contextData.quota && contextData.quota.completionRate < 30) {
      optimizations.push({
        type: 'time_management',
        description: 'Improve time management for better quota completion',
        suggestions: [
          'Block 2-hour focus periods',
          'Use task batching',
          'Set specific time slots for different activity types'
        ],
        impact: 'medium'
      });
    }

    return optimizations;
  } catch (error) {
    console.error('Error generating quota optimizations:', error);
    return [];
  }
}

async function generateAssociationInsights(contextData: any, logData: any): Promise<any[]> {
  const insights: any[] = [];
  
  try {
    // Generate insights based on associations
    if (contextData.associations) {
      const associations = contextData.associations;
      
      if (associations.deals && associations.deals.length > 0) {
        insights.push({
          type: 'deal_opportunity',
          description: `${associations.deals.length} associated deals - focus on high-value opportunities`,
          action: 'Prioritize tasks related to highest-value deals',
          impact: 'high'
        });
      }
      
      if (associations.contacts && associations.contacts.length > 0) {
        insights.push({
          type: 'contact_network',
          description: `${associations.contacts.length} associated contacts - leverage network effect`,
          action: 'Use contact relationships to expand opportunities',
          impact: 'medium'
        });
      }
      
      if (associations.companies && associations.companies.length > 0) {
        insights.push({
          type: 'company_expansion',
          description: `${associations.companies.length} associated companies - explore expansion opportunities`,
          action: 'Look for cross-selling and expansion opportunities',
          impact: 'medium'
        });
      }
    }

    return insights;
  } catch (error) {
    console.error('Error generating association insights:', error);
    return [];
  }
}

async function generateAITasks(contextData: any, logData: any): Promise<any[]> {
  const aiTasks: any[] = [];
  
  try {
    // Generate AI-created tasks based on context analysis
    if (contextData.pipeline && contextData.pipeline.totalDeals > 0) {
      // Suggest tasks for each deal stage
      Object.entries(contextData.pipeline.dealsByStage).forEach(([stage, deals]: [string, any]) => {
        if (deals.length > 0) {
          aiTasks.push({
            type: 'pipeline_management',
            title: `Review ${stage} stage deals (${deals.length} deals)`,
            description: `Systematic review of all deals in ${stage} stage`,
            priority: 'medium',
            category: 'business_generating',
            estimatedDuration: 45,
            associations: {
              deals: deals.map((deal: any) => deal.id)
            },
            aiGenerated: true,
            aiPrompt: `Pipeline management for ${stage} stage deals`
          });
        }
      });
    }

    if (contextData.quota && contextData.quota.remainingToday > 5) {
      aiTasks.push({
        type: 'quota_fill',
        title: `Complete ${contextData.quota.remainingToday} quota activities`,
        description: `Focus on business-generating activities to meet daily quota`,
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 90,
        aiGenerated: true,
        aiPrompt: `Fill remaining quota of ${contextData.quota.remainingToday} activities`
      });
    }

    return aiTasks;
  } catch (error) {
    console.error('Error generating AI tasks:', error);
    return [];
  }
}

// Helper functions
function getNextStage(currentStage: string): string {
  const stages = ['discovery', 'qualification', 'proposal', 'negotiation', 'closing'];
  const currentIndex = stages.indexOf(currentStage);
  return currentIndex < stages.length - 1 ? stages[currentIndex + 1] : currentStage;
}

async function analyzeCompletionImpact(task: any, associations: any): Promise<any> {
  const impact: any = {
    quota: false,
    pipeline: false,
    relationships: false,
    revenue: false
  };
  
  try {
    if (task.quotaCategory === 'business_generating') {
      impact.quota = true;
    }
    
    if (associations.deals && associations.deals.length > 0) {
      impact.pipeline = true;
    }
    
    if (associations.contacts && associations.contacts.length > 0) {
      impact.relationships = true;
    }
    
    if (task.type === 'closing' || task.type === 'negotiation') {
      impact.revenue = true;
    }
    
    return impact;
  } catch (error) {
    console.error('Error analyzing completion impact:', error);
    return impact;
  }
}

async function getStageRequiredTasks(stage: string, deal: any): Promise<any[]> {
  const stageTasks: any[] = [];
  
  try {
    switch (stage) {
      case 'discovery':
        stageTasks.push({
          type: 'research',
          title: `Research ${deal.name}`,
          description: 'Gather information about company, decision makers, and needs',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'qualification':
        stageTasks.push({
          type: 'meeting',
          title: `Qualification meeting with ${deal.name}`,
          description: 'Assess fit and budget alignment',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'proposal':
        stageTasks.push({
          type: 'proposal_preparation',
          title: `Prepare proposal for ${deal.name}`,
          description: 'Create detailed proposal based on requirements',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'negotiation':
        stageTasks.push({
          type: 'negotiation',
          title: `Negotiate terms with ${deal.name}`,
          description: 'Finalize pricing and terms',
          priority: 'high',
          category: 'business_generating'
        });
        break;
        
      case 'closing':
        stageTasks.push({
          type: 'closing',
          title: `Close deal with ${deal.name}`,
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

async function generateContactFollowUpTasks(contact: any, interaction: any): Promise<any[]> {
  const followUps: any[] = [];
  
  try {
    if (contact && interaction) {
      followUps.push({
        type: 'follow_up',
        title: `Follow up with ${contact.name}`,
        description: `Follow up on ${interaction.type} interaction`,
        priority: 'medium',
        category: 'business_generating',
        estimatedDuration: 15,
        associations: {
          contacts: [contact.id]
        },
        aiGenerated: true
      });
    }
    
    return followUps;
  } catch (error) {
    console.error('Error generating contact follow-up tasks:', error);
    return [];
  }
}

async function analyzeCompanyUpdateImpact(companyId: string, update: any, tenantId: string): Promise<any[]> {
  const impactTasks: any[] = [];
  
  try {
    // Find tasks associated with this company
    const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
      .where('associations.companies', 'array-contains', companyId);
    
    const tasksSnapshot = await tasksQuery.get();
    const tasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Analyze which tasks might be affected by the company update
    tasks.forEach(task => {
      if (update && update.type === 'expansion') {
        impactTasks.push({
          taskId: task.id,
          impact: 'positive',
          reason: 'Company expansion may create new opportunities',
          action: 'Review task for potential scope expansion'
        });
      }
    });
    
    return impactTasks;
  } catch (error) {
    console.error('Error analyzing company update impact:', error);
    return [];
  }
} 