import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * CRM Engine - Processes deal-related AI logs and provides intelligent insights
 * Handles deal stage progression, activity tracking, and predictive analytics
 */
export const processWithCRMEngine = async (logData: any, logId: string): Promise<any> => {
  console.log(`CRMEngine processing log ${logId}:`, logData.eventType);
  
  const start = Date.now();
  const results: any = {
    insights: [],
    suggestions: [],
    riskFactors: [],
    nextActions: [],
    dealSummary: null,
    stageRecommendations: [],
    emailDrafts: [],
    taskSuggestions: []
  };

  try {
    // Extract deal context
    const dealId = logData.targetId || logData.dealId;
    const tenantId = logData.tenantId;
    // const userId = logData.userId || logData.workerId; // Available for future use

    if (!dealId || !tenantId) {
      throw new Error('Missing dealId or tenantId for CRM processing');
    }

    // Get deal data
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (!dealDoc.exists) {
      throw new Error(`Deal ${dealId} not found`);
    }

    const dealData = dealDoc.data();
    const currentStage = dealData?.stage || 'discovery';

    // Get all AI logs for this deal
    const dealLogs = await getDealLogs(dealId, tenantId);
    
    // Analyze deal activity patterns
    const activityAnalysis = await analyzeDealActivity(dealLogs, dealData);
    
    // Generate insights based on event type
    switch (logData.eventType) {
      case 'deal.stage_advanced':
        results.insights = await generateStageInsights(dealData, currentStage, activityAnalysis);
        results.suggestions = await generateStageSuggestions(dealData, currentStage, activityAnalysis);
        results.nextActions = await generateNextActions(dealData, currentStage);
        break;
        
      case 'deal.note_created':
        results.insights = await analyzeNoteInsights(logData, dealData);
        results.suggestions = await generateNoteSuggestions(logData, dealData);
        break;
        
      case 'deal.task_completed':
        results.insights = await analyzeTaskCompletion(logData, dealData);
        results.suggestions = await generateFollowUpTasks(logData, dealData);
        break;
        
      case 'deal.email_sent':
        results.insights = await analyzeEmailInsights(logData, dealData);
        results.suggestions = await generateEmailFollowUps(logData, dealData);
        break;
        
      case 'deal.contact_interaction':
        results.insights = await analyzeContactInteraction(logData, dealData);
        results.suggestions = await generateContactSuggestions(logData, dealData);
        break;
        
      default:
        // General deal analysis
        results.insights = await generateGeneralInsights(dealData, activityAnalysis);
        results.suggestions = await generateGeneralSuggestions(dealData, activityAnalysis);
        results.riskFactors = await identifyRiskFactors(dealData, activityAnalysis);
        results.dealSummary = await generateDealSummary(dealData, activityAnalysis);
    }

    // Generate AI-powered recommendations
    results.stageRecommendations = await generateStageRecommendations(dealData, activityAnalysis);
    results.emailDrafts = await generateEmailDrafts(dealData, activityAnalysis);
    results.taskSuggestions = await generateTaskSuggestions(dealData, activityAnalysis);

    // Store insights in deal document
    await updateDealInsights(dealId, tenantId, results);

    const latencyMs = Date.now() - start;
    
    return {
      success: true,
      latencyMs,
      insights: results.insights.length,
      suggestions: results.suggestions.length,
      riskFactors: results.riskFactors.length,
      nextActions: results.nextActions.length,
      hasSummary: !!results.dealSummary,
      stageRecommendations: results.stageRecommendations.length,
      emailDrafts: results.emailDrafts.length,
      taskSuggestions: results.taskSuggestions.length
    };

  } catch (error: any) {
    console.error('CRMEngine processing error:', error);
    return {
      success: false,
      error: error.message,
      latencyMs: Date.now() - start
    };
  }
};

/**
 * Get all AI logs related to a specific deal
 */
async function getDealLogs(dealId: string, tenantId: string): Promise<any[]> {
  const logsRef = db.collection('ai_logs');
  const snapshot = await logsRef
    .where('targetId', '==', dealId)
    .where('tenantId', '==', tenantId)
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

/**
 * Analyze deal activity patterns
 */
async function analyzeDealActivity(logs: any[], dealData: any): Promise<any> {
  const analysis: any = {
    totalActivities: logs.length,
    stageProgression: [] as any[],
    contactInteractions: [] as any[],
    emailActivity: [] as any[],
    taskCompletion: [] as any[],
    noteActivity: [] as any[],
    timeInStages: {} as any,
    activityFrequency: {} as any,
    riskIndicators: [] as string[]
  };

  // Analyze stage progression
  const stageLogs = logs.filter(log => log.eventType?.includes('stage'));
  analysis.stageProgression = stageLogs.map(log => ({
    stage: log.newValue || log.stage,
    timestamp: log.timestamp,
    reason: log.reason
  }));

  // Analyze contact interactions
  analysis.contactInteractions = logs.filter(log => 
    log.eventType?.includes('contact') || log.contextType === 'contact'
  );

  // Analyze email activity
  analysis.emailActivity = logs.filter(log => 
    log.eventType?.includes('email') || log.contextType === 'email'
  );

  // Analyze task completion
  analysis.taskCompletion = logs.filter(log => 
    log.eventType?.includes('task') || log.contextType === 'task'
  );

  // Calculate time in stages
  const currentStage = dealData.stage;
  const stageStartTime = stageLogs.find(log => log.stage === currentStage)?.timestamp;
  if (stageStartTime) {
    const timeInStage = Date.now() - stageStartTime.toDate().getTime();
    analysis.timeInStages[currentStage] = timeInStage;
  }

  // Identify risk indicators
  analysis.riskIndicators = identifyRiskIndicators(logs, dealData);

  return analysis;
}

/**
 * Generate insights for stage advancement
 */
async function generateStageInsights(dealData: any, currentStage: string, activityAnalysis: any): Promise<string[]> {
  const insights = [];
  
  // Analyze stage progression speed
  const timeInStage = activityAnalysis.timeInStages[currentStage];
  if (timeInStage) {
    const daysInStage = timeInStage / (1000 * 60 * 60 * 24);
    if (daysInStage > 30) {
      insights.push(`Deal has been in ${currentStage} stage for ${Math.round(daysInStage)} days - consider advancing or identifying blockers`);
    }
  }

  // Analyze activity frequency
  const recentActivity = activityAnalysis.totalActivities;
  if (recentActivity < 5) {
    insights.push('Low activity detected - consider increasing engagement with stakeholders');
  }

  // Analyze contact interactions
  if (activityAnalysis.contactInteractions.length === 0) {
    insights.push('No recent contact interactions - prioritize stakeholder engagement');
  }

  return insights;
}

/**
 * Generate suggestions for current stage
 */
async function generateStageSuggestions(dealData: any, currentStage: string, activityAnalysis: any): Promise<string[]> {
  const suggestions = [];
  
  switch (currentStage) {
    case 'discovery':
      suggestions.push('Schedule discovery call with key stakeholders');
      suggestions.push('Research company structure and decision makers');
      suggestions.push('Identify pain points and business needs');
      break;
      
    case 'qualification':
      suggestions.push('Validate budget and authority');
      suggestions.push('Confirm timeline and urgency');
      suggestions.push('Identify all decision makers');
      break;
      
    case 'scoping':
      suggestions.push('Define detailed requirements');
      suggestions.push('Create project timeline');
      suggestions.push('Identify success metrics');
      break;
      
    case 'proposalDrafted':
      suggestions.push('Review proposal with internal team');
      suggestions.push('Prepare for client presentation');
      suggestions.push('Anticipate questions and objections');
      break;
      
    case 'negotiation':
      suggestions.push('Prepare negotiation strategy');
      suggestions.push('Identify concessions and trade-offs');
      suggestions.push('Plan for different scenarios');
      break;
      
    case 'verbalAgreement':
      suggestions.push('Document all agreed terms');
      suggestions.push('Prepare contract for signature');
      suggestions.push('Plan implementation timeline');
      break;
  }

  return suggestions;
}

/**
 * Generate next actions based on current stage
 */
async function generateNextActions(dealData: any, currentStage: string): Promise<string[]> {
  const actions = [];
  
  // Add stage-specific actions
  switch (currentStage) {
    case 'discovery':
      actions.push('Schedule stakeholder interviews');
      actions.push('Research company background');
      actions.push('Identify key pain points');
      break;
      
    case 'qualification':
      actions.push('Validate budget authority');
      actions.push('Confirm decision timeline');
      actions.push('Map decision makers');
      break;
      
    case 'scoping':
      actions.push('Define project requirements');
      actions.push('Create implementation plan');
      actions.push('Set success metrics');
      break;
      
    case 'proposalDrafted':
      actions.push('Internal proposal review');
      actions.push('Prepare client presentation');
      actions.push('Anticipate objections');
      break;
      
    case 'negotiation':
      actions.push('Prepare negotiation strategy');
      actions.push('Identify concessions');
      actions.push('Plan for different outcomes');
      break;
      
    case 'verbalAgreement':
      actions.push('Document agreed terms');
      actions.push('Prepare final contract');
      actions.push('Plan implementation');
      break;
  }

  return actions;
}

/**
 * Analyze note insights
 */
async function analyzeNoteInsights(logData: any, dealData: any): Promise<string[]> {
  const insights = [];
  const noteContent = logData.noteContent || logData.content || '';
  
  // Analyze note sentiment and content
  if (noteContent.toLowerCase().includes('concern') || noteContent.toLowerCase().includes('issue')) {
    insights.push('Note indicates potential concerns - follow up required');
  }
  
  if (noteContent.toLowerCase().includes('positive') || noteContent.toLowerCase().includes('good')) {
    insights.push('Positive sentiment detected - leverage for momentum');
  }
  
  if (noteContent.toLowerCase().includes('budget') || noteContent.toLowerCase().includes('cost')) {
    insights.push('Budget discussion noted - ensure value proposition is clear');
  }
  
  return insights;
}

/**
 * Generate note suggestions
 */
async function generateNoteSuggestions(logData: any, dealData: any): Promise<string[]> {
  const suggestions = [];
  
  suggestions.push('Schedule follow-up based on note content');
  suggestions.push('Share relevant information with team');
  suggestions.push('Update deal strategy if needed');
  
  return suggestions;
}

/**
 * Analyze task completion
 */
async function analyzeTaskCompletion(logData: any, dealData: any): Promise<string[]> {
  const insights = [];
  
  insights.push('Task completed successfully');
  insights.push('Consider next steps in sequence');
  
  return insights;
}

/**
 * Generate follow-up tasks
 */
async function generateFollowUpTasks(logData: any, dealData: any): Promise<string[]> {
  const suggestions = [];
  
  suggestions.push('Schedule next milestone task');
  suggestions.push('Update deal timeline');
  suggestions.push('Communicate progress to stakeholders');
  
  return suggestions;
}

/**
 * Analyze email insights
 */
async function analyzeEmailInsights(logData: any, dealData: any): Promise<string[]> {
  const insights = [];
  
  insights.push('Email sent successfully');
  insights.push('Monitor for response and engagement');
  
  return insights;
}

/**
 * Generate email follow-ups
 */
async function generateEmailFollowUps(logData: any, dealData: any): Promise<string[]> {
  const suggestions = [];
  
  suggestions.push('Schedule follow-up email in 3-5 days');
  suggestions.push('Prepare alternative communication if no response');
  suggestions.push('Update contact preferences if needed');
  
  return suggestions;
}

/**
 * Analyze contact interaction
 */
async function analyzeContactInteraction(logData: any, dealData: any): Promise<string[]> {
  const insights = [];
  
  insights.push('Contact interaction logged');
  insights.push('Update contact preferences and notes');
  
  return insights;
}

/**
 * Generate contact suggestions
 */
async function generateContactSuggestions(logData: any, dealData: any): Promise<string[]> {
  const suggestions = [];
  
  suggestions.push('Schedule next contact touchpoint');
  suggestions.push('Update contact information if needed');
  suggestions.push('Share relevant updates with team');
  
  return suggestions;
}

/**
 * Generate general insights
 */
async function generateGeneralInsights(dealData: any, activityAnalysis: any): Promise<string[]> {
  const insights = [];
  
  // Analyze deal health
  if (activityAnalysis.totalActivities < 10) {
    insights.push('Deal activity is low - consider increasing engagement');
  }
  
  if (activityAnalysis.riskIndicators.length > 0) {
    insights.push('Risk indicators detected - review and address');
  }
  
  // Analyze stage progression
  if (activityAnalysis.stageProgression.length > 0) {
    insights.push('Deal is progressing through stages');
  }
  
  return insights;
}

/**
 * Generate general suggestions
 */
async function generateGeneralSuggestions(dealData: any, activityAnalysis: any): Promise<string[]> {
  const suggestions = [];
  
  suggestions.push('Schedule regular deal reviews');
  suggestions.push('Update deal strategy based on activity');
  suggestions.push('Engage with key stakeholders');
  
  return suggestions;
}

/**
 * Identify risk factors
 */
async function identifyRiskFactors(dealData: any, activityAnalysis: any): Promise<string[]> {
  const riskFactors = [];
  
  // Check for long periods without activity
  if (activityAnalysis.totalActivities < 5) {
    riskFactors.push('Low engagement - deal may be at risk');
  }
  
  // Check for stage stagnation
  const timeInStage = activityAnalysis.timeInStages[dealData.stage];
  if (timeInStage && timeInStage > 30 * 24 * 60 * 60 * 1000) { // 30 days
    riskFactors.push('Extended time in current stage - potential blocker');
  }
  
  // Check for negative sentiment in notes
  const negativeNotes = activityAnalysis.noteActivity.filter((note: any) => 
    note.content?.toLowerCase().includes('concern') || 
    note.content?.toLowerCase().includes('issue')
  );
  
  if (negativeNotes.length > 0) {
    riskFactors.push('Negative sentiment detected in recent notes');
  }
  
  return riskFactors;
}

/**
 * Generate deal summary
 */
async function generateDealSummary(dealData: any, activityAnalysis: any): Promise<any> {
  return {
    currentStage: dealData.stage,
    totalActivities: activityAnalysis.totalActivities,
    lastActivity: activityAnalysis.totalActivities > 0 ? 'Recent' : 'None',
    riskLevel: activityAnalysis.riskIndicators.length > 2 ? 'High' : 'Low',
    nextMilestone: getNextMilestone(dealData.stage),
    keyInsights: activityAnalysis.insights || [],
    recommendations: activityAnalysis.suggestions || []
  };
}

/**
 * Generate stage recommendations
 */
async function generateStageRecommendations(dealData: any, activityAnalysis: any): Promise<string[]> {
  const recommendations = [];
  const currentStage = dealData.stage;
  
  // Recommend next stage based on current progress
  switch (currentStage) {
    case 'discovery':
      if (activityAnalysis.totalActivities > 10) {
        recommendations.push('Ready to advance to qualification stage');
      }
      break;
      
    case 'qualification':
      if (activityAnalysis.contactInteractions.length > 3) {
        recommendations.push('Ready to advance to scoping stage');
      }
      break;
      
    case 'scoping':
      if (activityAnalysis.totalActivities > 15) {
        recommendations.push('Ready to advance to proposal stage');
      }
      break;
  }
  
  return recommendations;
}

/**
 * Generate email drafts
 */
async function generateEmailDrafts(dealData: any, activityAnalysis: any): Promise<any[]> {
  const drafts = [];
  
  // Generate stage-appropriate email drafts
  switch (dealData.stage) {
    case 'discovery':
      drafts.push({
        subject: 'Discovery Call Follow-up',
        content: 'Thank you for the discovery call. Here are the key points we discussed...',
        type: 'follow-up'
      });
      break;
      
    case 'qualification':
      drafts.push({
        subject: 'Qualification Meeting Request',
        content: 'I\'d like to schedule a qualification meeting to discuss your needs in detail...',
        type: 'meeting_request'
      });
      break;
  }
  
  return drafts;
}

/**
 * Generate task suggestions
 */
async function generateTaskSuggestions(dealData: any, activityAnalysis: any): Promise<any[]> {
  const suggestions = [];
  
  // Generate stage-appropriate tasks
  switch (dealData.stage) {
    case 'discovery':
      suggestions.push({
        title: 'Research company structure',
        description: 'Identify key decision makers and organizational structure',
        priority: 'high',
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // 2 days
      });
      break;
      
    case 'qualification':
      suggestions.push({
        title: 'Validate budget authority',
        description: 'Confirm budget availability and decision authority',
        priority: 'high',
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
      });
      break;
  }
  
  return suggestions;
}

/**
 * Update deal insights in Firestore
 */
async function updateDealInsights(dealId: string, tenantId: string, insights: any): Promise<void> {
  await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).update({
    aiInsights: insights,
    lastAIAnalysis: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Get next milestone for current stage
 */
function getNextMilestone(stage: string): string {
  const milestones = {
    discovery: 'Qualification Meeting',
    qualification: 'Scoping Session',
    scoping: 'Proposal Draft',
    proposalDrafted: 'Client Presentation',
    proposalReview: 'Negotiation',
    negotiation: 'Verbal Agreement',
    verbalAgreement: 'Contract Signing',
    closedWon: 'Implementation',
    closedLost: 'Post-Mortem'
  };
  
  return milestones[stage as keyof typeof milestones] || 'Next Stage';
}

/**
 * Identify risk indicators
 */
function identifyRiskIndicators(logs: any[], dealData: any): string[] {
  const indicators = [];
  
  // Check for long periods without activity
  const recentLogs = logs.filter(log => {
    const logTime = log.timestamp?.toDate?.() || new Date(log.timestamp);
    return Date.now() - logTime.getTime() < 7 * 24 * 60 * 60 * 1000; // 7 days
  });
  
  if (recentLogs.length === 0) {
    indicators.push('No recent activity');
  }
  
  // Check for negative sentiment
  const negativeLogs = logs.filter(log => 
    log.reason?.toLowerCase().includes('concern') ||
    log.reason?.toLowerCase().includes('issue') ||
    log.reason?.toLowerCase().includes('problem')
  );
  
  if (negativeLogs.length > 0) {
    indicators.push('Negative sentiment detected');
  }
  
  return indicators;
}

// Export for use in AI engine processor
export { processWithCRMEngine as default }; 