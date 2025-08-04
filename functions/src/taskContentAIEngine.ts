import * as admin from 'firebase-admin';
import { logAIAction } from './utils/aiLogging';

const db = admin.firestore();

/**
 * Task Content AI Engine - Generates intelligent content for tasks
 * Creates emails, call scripts, meeting agendas, and follow-up content
 * Based on deal context, contact information, and task requirements
 */
export const processWithTaskContentAIEngine = async (logData: any, logId: string): Promise<any> => {
  console.log(`TaskContentAIEngine processing log ${logId}:`, logData.eventType);
  
  const start = Date.now();
  const results: any = {
    generatedContent: {},
    contentSuggestions: [],
    aiInsights: [],
    nextSteps: []
  };

  try {
    const tenantId = logData.tenantId;
    const taskId = logData.targetId;
    const userId = logData.userId;

    if (!tenantId || !taskId) {
      throw new Error('Missing required fields: tenantId, taskId');
    }

    // Get comprehensive task and deal context
    const taskContext = await getTaskContext(taskId, tenantId, userId);
    
    // Generate content based on task type
    const contentResults = await generateTaskContent(taskContext);
    
    // Generate follow-up suggestions
    const followUpSuggestions = await generateFollowUpSuggestions(taskContext);
    
    // Analyze optimal timing
    const timingAnalysis = await analyzeOptimalTiming(taskContext);
    
    // Generate personalized insights
    const personalizedInsights = await generatePersonalizedInsights(taskContext);

    // Combine all results
    results.generatedContent = contentResults;
    results.contentSuggestions = followUpSuggestions;
    results.aiInsights = personalizedInsights;
    results.nextSteps = timingAnalysis.nextSteps;

    // Log the AI processing
    await logAIAction({
      eventType: 'task_content_ai_engine.processed',
      targetType: 'task_content',
      targetId: taskId,
      reason: `Task Content AI Engine generated ${Object.keys(contentResults).length} content pieces`,
      contextType: 'task_content_generation',
      aiTags: ['content_generation', 'task_optimization', 'personalization'],
      urgencyScore: 7,
      inputPrompt: `Generate content for task: ${taskContext.task.title}`,
      composedPrompt: `Generate intelligent content for task with context: ${JSON.stringify(taskContext.summary)}`,
      aiResponse: JSON.stringify(results),
      success: true,
      latencyMs: Date.now() - start,
      tenantId,
      userId
    });

    const latencyMs = Date.now() - start;
    
    return {
      success: true,
      latencyMs,
      contentGenerated: Object.keys(contentResults).length,
      suggestionsGenerated: followUpSuggestions.length,
      insightsGenerated: personalizedInsights.length
    };

  } catch (error) {
    console.error('Error in TaskContentAIEngine:', error);
    
    await logAIAction({
      eventType: 'task_content_ai_engine.error',
      targetType: 'task_content',
      targetId: logData.targetId || 'unknown',
      reason: `Task Content AI Engine error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      contextType: 'error_handling',
      aiTags: ['error', 'content_generation'],
      urgencyScore: 3,
      inputPrompt: 'Error in content generation',
      composedPrompt: 'Error occurred during content generation',
      aiResponse: 'Error occurred',
      success: false,
      latencyMs: Date.now() - start,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      tenantId: logData.tenantId,
      userId: logData.userId
    });

    throw error;
  }
};

// Get comprehensive task context
async function getTaskContext(taskId: string, tenantId: string, userId: string): Promise<any> {
  try {
    // Get task details
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Task not found');
    }
    const task = { id: taskId, ...taskDoc.data() } as any;

    // Get associated deal
    let deal = null;
    if (task.associations?.deals?.length > 0) {
      const dealId = task.associations.deals[0];
      const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
      if (dealDoc.exists) {
        deal = { id: dealId, ...dealDoc.data() } as any;
      }
    }

    // Get associated company
    let company = null;
    if (task.associations?.companies?.length > 0) {
      const companyId = task.associations.companies[0];
      const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get();
      if (companyDoc.exists) {
        company = { id: companyId, ...companyDoc.data() } as any;
      }
    }

    // Get associated contacts
    const contacts = [];
    if (task.associations?.contacts?.length > 0) {
      for (const contactId of task.associations.contacts) {
        const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
        if (contactDoc.exists) {
          contacts.push({ id: contactId, ...contactDoc.data() } as any);
        }
      }
    }

    // Get recent activities
    const activitiesQuery = db.collection('tenants').doc(tenantId).collection('activities')
      .where('entityId', '==', deal?.id || taskId)
      .orderBy('timestamp', 'desc')
      .limit(10);
    const activitiesSnapshot = await activitiesQuery.get();
    const activities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

    // Get user preferences and history
    const userDoc = await db.collection('tenants').doc(tenantId).collection('users').doc(userId).get();
    const user = userDoc.exists ? { id: userId, ...userDoc.data() } as any : null;

    return {
      task,
      deal,
      company,
      contacts,
      activities,
      user,
      summary: {
        taskType: task.type,
        taskPriority: task.priority,
        dealStage: deal?.stage,
        companyName: company?.name,
        contactNames: contacts.map((c: any) => `${c.firstName} ${c.lastName}`).join(', '),
        recentActivities: activities.length
      }
    };
  } catch (error) {
    console.error('Error getting task context:', error);
    throw error;
  }
}

// Generate content based on task type
async function generateTaskContent(context: any): Promise<any> {
  const { task } = context;
  const content: any = {};

  switch (task.type) {
    case 'email':
      content.email = await generateEmailContent(context);
      break;
    case 'phone_call':
      content.callScript = await generateCallScript(context);
      break;
    case 'scheduled_meeting_virtual':
    case 'scheduled_meeting_in_person':
      content.meetingAgenda = await generateMeetingAgenda(context);
      break;
    case 'research':
      content.researchPlan = await generateResearchPlan(context);
      break;
    case 'follow_up':
      content.followUpContent = await generateFollowUpContent(context);
      break;
    default:
      content.generalContent = await generateGeneralContent(context);
  }

  return content;
}

// Generate email content
async function generateEmailContent(context: any): Promise<any> {
  const { task, deal, company, contacts } = context;
  
  const emailTemplates: any = {
    prospecting: {
      subject: `Introduction - ${company?.name || 'Your Company'} Staffing Solutions`,
      greeting: `Hi ${contacts[0]?.firstName || 'there'},`,
      body: `I hope this email finds you well. I came across ${company?.name || 'your company'} and was impressed by your work in ${company?.industry || 'your industry'}.

I wanted to reach out because we specialize in providing staffing solutions that help companies like yours scale efficiently while maintaining quality standards.

Would you be open to a brief 15-minute call to discuss how we might support your staffing needs? I'd love to learn more about your current challenges and see if there's a fit.

Best regards,
[Your Name]`,
      callToAction: 'Schedule a call'
    },
    follow_up: {
      subject: `Follow-up: ${deal?.title || 'Our Discussion'}`,
      greeting: `Hi ${contacts[0]?.firstName || 'there'},`,
      body: `I wanted to follow up on our recent conversation about ${deal?.title || 'your staffing needs'}.

I've been thinking about your situation and wanted to share some additional insights that might be relevant to your challenges.

Have you had a chance to review the information I sent? I'd love to schedule a follow-up call to discuss next steps.

Best regards,
[Your Name]`,
      callToAction: 'Schedule follow-up'
    },
    proposal: {
      subject: `Proposal: ${deal?.title || 'Staffing Solution'}`,
      greeting: `Hi ${contacts[0]?.firstName || 'there'},`,
      body: `Thank you for the opportunity to put together a proposal for ${company?.name || 'your company'}.

I've attached our detailed proposal that addresses the specific challenges we discussed. The solution includes:

• Customized staffing approach
• Quality assurance processes
• Scalable pricing model
• Dedicated account management

I'm available for a call to walk through the proposal and answer any questions you might have.

Best regards,
[Your Name]`,
      callToAction: 'Review proposal'
    }
  };

  // Determine email type based on deal stage and context
  let emailType = 'prospecting';
  if (deal?.stage === 'proposal' || deal?.stage === 'quoting') {
    emailType = 'proposal';
  } else if (task.category === 'follow_up') {
    emailType = 'follow_up';
  }

  const template = emailTemplates[emailType] || emailTemplates.prospecting;
  
  return {
    subject: template.subject,
    greeting: template.greeting,
    body: template.body,
    callToAction: template.callToAction,
    personalization: {
      contactName: contacts[0]?.firstName || 'there',
      companyName: company?.name || 'your company',
      dealTitle: deal?.title || 'our discussion'
    }
  };
}

// Generate call script
async function generateCallScript(context: any): Promise<any> {
  const { task, deal, contacts } = context;
  
  const scriptTemplates: any = {
    prospecting: {
      opening: `Hi ${contacts[0]?.firstName || 'there'}, this is [Your Name] from [Company]. I'm calling about the staffing solutions we discussed.`,
      agenda: [
        'Introduce yourself and company',
        'Mention how you found them',
        'Ask about current staffing challenges',
        'Share relevant case study',
        'Propose next steps'
      ],
      questions: [
        'What are your biggest staffing challenges right now?',
        'How do you currently handle hiring and onboarding?',
        'What would success look like for your staffing needs?',
        'Who else should be involved in this discussion?'
      ],
      closing: "Based on what you've shared, I'd like to schedule a more detailed discussion. When would work best for you?"
    },
    follow_up: {
      opening: `Hi ${contacts[0]?.firstName || 'there'}, this is [Your Name] following up on our recent discussion about ${deal?.title || 'your staffing needs'}.`,
      agenda: [
        'Reference previous conversation',
        'Ask about any questions or concerns',
        'Share additional insights',
        'Discuss next steps',
        'Schedule follow-up if needed'
      ],
      questions: [
        'Have you had a chance to review the information I sent?',
        'What questions do you have about our proposal?',
        "What's the timeline for making a decision?",
        'Who else needs to be involved in the decision process?'
      ],
      closing: "I appreciate your time. Let me know if you need anything else, and I'll follow up as discussed."
    }
  };

  let scriptType = 'prospecting';
  if (task.category === 'follow_up') {
    scriptType = 'follow_up';
  }

  const template = scriptTemplates[scriptType] || scriptTemplates.prospecting;
  
  return {
    opening: template.opening,
    agenda: template.agenda,
    questions: template.questions,
    closing: template.closing,
    notes: `Focus on understanding their needs and building rapport. Take notes on key challenges and decision makers.`
  };
}

// Generate meeting agenda
async function generateMeetingAgenda(context: any): Promise<any> {
  const { deal, company } = context;
  
  const agendaTemplates: any = {
    discovery: {
      title: `Discovery Meeting: ${company?.name || 'Staffing Needs Assessment'}`,
      duration: '30 minutes',
      agenda: [
        'Introduction and company overview (5 min)',
        'Current staffing challenges discussion (10 min)',
        'Requirements and expectations (10 min)',
        'Next steps and timeline (5 min)'
      ],
      objectives: [
        'Understand their staffing challenges',
        'Identify key decision makers',
        'Establish timeline and budget',
        'Schedule follow-up meeting'
      ]
    },
    proposal: {
      title: `Proposal Review: ${deal?.title || 'Staffing Solution'}`,
      duration: '45 minutes',
      agenda: [
        'Recap of requirements (5 min)',
        'Proposed solution overview (15 min)',
        'Pricing and terms discussion (15 min)',
        'Implementation timeline (5 min)',
        'Q&A and next steps (5 min)'
      ],
      objectives: [
        'Present comprehensive solution',
        'Address questions and concerns',
        'Discuss pricing and terms',
        'Get commitment to next steps'
      ]
    }
  };

  let agendaType = 'discovery';
  if (deal?.stage === 'proposal' || deal?.stage === 'quoting') {
    agendaType = 'proposal';
  }

  const template = agendaTemplates[agendaType] || agendaTemplates.discovery;
  
  return {
    title: template.title,
    duration: template.duration,
    agenda: template.agenda,
    objectives: template.objectives,
    preparation: [
      'Review company information',
      'Prepare relevant case studies',
      'Have pricing ready',
      'Prepare questions for discovery'
    ]
  };
}

// Generate research plan
async function generateResearchPlan(context: any): Promise<any> {
  return {
    objectives: [
      'Understand company structure and decision-making process',
      'Identify key stakeholders and influencers',
      'Research industry trends and challenges',
      'Find relevant case studies and success stories'
    ],
    researchAreas: [
      'Company background and recent news',
      'Industry trends and challenges',
      'Competitive landscape',
      'Decision-making process',
      'Budget and timeline constraints'
    ],
    sources: [
      'Company website and social media',
      'Industry reports and publications',
      'LinkedIn profiles of key contacts',
      'Recent news and press releases',
      'Competitor analysis'
    ],
    deliverables: [
      'Company profile summary',
      'Stakeholder mapping',
      'Industry insights report',
      'Competitive analysis',
      'Recommendations for approach'
    ]
  };
}

// Generate follow-up content
async function generateFollowUpContent(context: any): Promise<any> {
  const { deal, contacts } = context;
  
  return {
    emailTemplate: {
      subject: `Follow-up: ${deal?.title || 'Our Discussion'}`,
      body: `Hi ${contacts[0]?.firstName || 'there'},

I wanted to follow up on our recent discussion about ${deal?.title || 'your staffing needs'}.

I've been thinking about your situation and wanted to share some additional insights that might be relevant.

Have you had a chance to review the information I sent? I'd love to schedule a follow-up call to discuss next steps.

Best regards,
[Your Name]`
    },
    callScript: {
      opening: `Hi ${contacts[0]?.firstName || 'there'}, this is [Your Name] following up on our recent discussion.`,
      questions: [
        'Have you had a chance to review the materials I sent?',
        'What questions do you have about our proposal?',
        "What's the timeline for making a decision?",
        'Who else should be involved in this discussion?'
      ]
    },
    nextSteps: [
      'Send additional relevant materials',
      'Schedule follow-up meeting',
      'Connect with additional stakeholders',
      'Provide case studies or testimonials'
    ]
  };
}

// Generate general content
async function generateGeneralContent(context: any): Promise<any> {
  const { task, company } = context;
  
  return {
    taskDescription: `Complete ${task.title} for ${company?.name || 'the client'}`,
    keyPoints: [
      'Review all relevant information',
      'Prepare necessary materials',
      'Schedule appropriate time',
      'Follow up with results'
    ],
    successCriteria: [
      'Task completed on time',
      'Quality standards met',
      'Documentation updated',
      'Next steps identified'
    ]
  };
}

// Generate follow-up suggestions
async function generateFollowUpSuggestions(context: any): Promise<any[]> {
  const { task, deal } = context;
  const suggestions = [];

  // Email follow-up suggestions
  if (task.type === 'email') {
    suggestions.push({
      type: 'email_follow_up',
      title: 'Follow-up Email',
      description: 'Send a follow-up email if no response received',
      timing: '3-5 days after initial email',
      content: await generateEmailContent(context)
    });
  }

  // Call follow-up suggestions
  if (task.type === 'phone_call') {
    suggestions.push({
      type: 'call_follow_up',
      title: 'Follow-up Call',
      description: 'Schedule a follow-up call to discuss next steps',
      timing: '1-2 days after initial call',
      content: await generateCallScript(context)
    });
  }

  // Meeting follow-up suggestions
  if (task.type.includes('meeting')) {
    suggestions.push({
      type: 'meeting_follow_up',
      title: 'Meeting Summary',
      description: 'Send meeting summary and action items',
      timing: 'Same day as meeting',
      content: {
        subject: `Meeting Summary: ${deal?.title || 'Discussion'}`,
        body: `Thank you for the meeting today. Here's a summary of our discussion and next steps...`
      }
    });
  }

  return suggestions;
}

// Analyze optimal timing
async function analyzeOptimalTiming(context: any): Promise<any> {
  const { task, activities } = context;
  
  // Analyze recent activity patterns
  const recentActivity = activities.slice(0, 5);
  const responseTimes: number[] = [];
  const preferredTimes: number[] = [];

  // Extract patterns from recent activities
  recentActivity.forEach((activity: any) => {
    if (activity.type === 'email' && activity.responseTime) {
      responseTimes.push(activity.responseTime);
    }
    if (activity.timestamp) {
      const hour = new Date(activity.timestamp.toDate()).getHours();
      preferredTimes.push(hour);
    }
  });

  // Calculate optimal timing
  const avgResponseTime = responseTimes.length > 0 ? 
    responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 24;
  
  const mostActiveHour = preferredTimes.length > 0 ? 
    preferredTimes.sort((a, b) => preferredTimes.filter(v => v === a).length - preferredTimes.filter(v => v === b).length).pop() : 10;

  return {
    optimalTiming: {
      bestDay: 'Tuesday', // Based on general sales patterns
      bestTime: `${mostActiveHour}:00`,
      responseTime: `${avgResponseTime.toFixed(1)} hours`,
      urgency: task.priority === 'high' ? 'immediate' : 'within 24 hours'
    },
    nextSteps: [
      'Schedule task for optimal time',
      'Set reminders for follow-up',
      'Prepare content in advance',
      'Track response patterns'
    ]
  };
}

// Generate personalized insights
async function generatePersonalizedInsights(context: any): Promise<any[]> {
  const { deal, contacts, activities } = context;
  const insights = [];

  // Success rate analysis
  const completedTasks = activities.filter((a: any) => a.type === 'task' && a.status === 'completed');
  const successRate = completedTasks.length / Math.max(activities.length, 1) * 100;
  
  insights.push({
    type: 'success_rate',
    title: 'Task Success Rate',
    description: `Your success rate for similar tasks is ${successRate.toFixed(1)}%`,
    recommendation: successRate > 80 ? 'Keep up the great work!' : 'Consider adjusting your approach'
  });

  // Timing insights
  const timingInsights = await analyzeOptimalTiming(context);
  insights.push({
    type: 'timing',
    title: 'Optimal Timing',
    description: `Best time to reach ${contacts[0]?.firstName || 'contacts'}: ${timingInsights.optimalTiming.bestTime}`,
    recommendation: 'Schedule tasks during optimal hours for better response rates'
  });

  // Deal progression insights
  if (deal) {
    const dealAge = (Date.now() - new Date(deal.createdAt?.toDate()).getTime()) / (1000 * 60 * 60 * 24);
    insights.push({
      type: 'deal_progression',
      title: 'Deal Health',
      description: `Deal has been active for ${dealAge.toFixed(0)} days`,
      recommendation: dealAge > 30 ? 'Consider accelerating the deal' : 'Deal is progressing well'
    });
  }

  return insights;
} 