import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

interface AISummary {
  summary: string;
  roadblocks: string[];
  customerResponsiveness: 'high' | 'medium' | 'low';
  likelihoodToClose: 'high' | 'medium' | 'low';
  salespersonPerformance: 'excellent' | 'good' | 'needs_improvement';
  lastUpdated: admin.firestore.Timestamp;
  emailAnalysis: {
    totalEmails: number;
    responseTime: string;
    engagementLevel: string;
  };
  aiLogsAnalysis: {
    totalLogs: number;
    recentActivity: string;
    keyInsights: string[];
  };
  dealProgress: {
    stage: string;
    timeInStage: string;
    stageAdvancement: string;
  };
}

export const generateDealAISummary = onCall(async (request) => {
  try {
    const { tenantId, dealId } = request.data;

    if (!tenantId || !dealId) {
      throw new Error('Missing required parameters: tenantId, dealId');
    }

    console.log(`🔍 Generating AI summary for deal: ${dealId} in tenant: ${tenantId}`);

    const db = admin.firestore();
    
    // Get deal data
    const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
    const dealDoc = await dealRef.get();
    
    if (!dealDoc.exists) {
      throw new Error('Deal not found');
    }

    const dealData = dealDoc.data();
    console.log(`📄 Deal data:`, dealData);

    // Get AI logs for this deal
    let aiLogs: any[] = [];
    try {
      const aiLogsRef = db.collection('tenants').doc(tenantId).collection('ai_logs');
      const aiLogsQuery = aiLogsRef.where('dealId', '==', dealId).limit(50);
      const aiLogsSnap = await aiLogsQuery.get();
      
      aiLogs = aiLogsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort by timestamp in memory to avoid composite index requirement
      aiLogs.sort((a, b) => {
        const aTime = a.timestamp?.toMillis?.() || a.timestamp?._seconds || 0;
        const bTime = b.timestamp?.toMillis?.() || b.timestamp?._seconds || 0;
        return bTime - aTime; // Descending order
      });
      
      console.log(`📊 Found ${aiLogs.length} AI logs for deal`);
    } catch (error) {
      console.log(`⚠️ No AI logs found or error accessing logs:`, error);
      aiLogs = [];
    }

    // Get emails for this deal (if Gmail integration is available)
    let emails: any[] = [];
    try {
      const emailsRef = db.collection('tenants').doc(tenantId).collection('emails');
      const emailsQuery = emailsRef.where('dealId', '==', dealId).limit(100);
      const emailsSnap = await emailsQuery.get();
      
      emails = emailsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort by timestamp in memory to avoid composite index requirement
      emails.sort((a, b) => {
        const aTime = a.timestamp?.toMillis?.() || a.timestamp?._seconds || 0;
        const bTime = b.timestamp?.toMillis?.() || b.timestamp?._seconds || 0;
        return bTime - aTime; // Descending order
      });
      
      console.log(`📧 Found ${emails.length} emails for deal`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`⚠️ No email integration found:`, errorMessage);
    }

    // Get deal stage history
    let stageHistory: any[] = [];
    try {
      const stageHistoryRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).collection('stage_history');
      const stageHistorySnap = await stageHistoryRef.orderBy('timestamp', 'desc').limit(10).get();
      
      stageHistory = stageHistorySnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`📈 Found ${stageHistory.length} stage history entries`);
    } catch (error) {
      console.log(`⚠️ No stage history found or error accessing history:`, error);
      stageHistory = [];
    }

    // Analyze customer responsiveness from emails
    const emailAnalysis = analyzeEmailResponsiveness(emails);
    
    // Analyze AI logs for insights
    const aiLogsAnalysis = analyzeAILogs(aiLogs);
    
    // Analyze deal progress
    const dealProgress = analyzeDealProgress(dealData, stageHistory);
    
    // Determine roadblocks
    const roadblocks = identifyRoadblocks(dealData, aiLogs, emails);
    
    // Assess customer responsiveness
    const customerResponsiveness = assessCustomerResponsiveness(emailAnalysis, aiLogs);
    
    // Calculate likelihood to close
    const likelihoodToClose = calculateLikelihoodToClose(dealData, aiLogs, emailAnalysis);
    
    // Assess salesperson performance
    const salespersonPerformance = assessSalespersonPerformance(dealData, aiLogs, emailAnalysis);
    
    // Generate summary text
    const summary = generateSummaryText(dealData, emailAnalysis, aiLogsAnalysis, dealProgress, roadblocks);

    const aiSummary: AISummary = {
      summary,
      roadblocks,
      customerResponsiveness,
      likelihoodToClose,
      salespersonPerformance,
      lastUpdated: admin.firestore.Timestamp.now(),
      emailAnalysis,
      aiLogsAnalysis,
      dealProgress
    };

    // Save to Firestore
    await dealRef.update({
      aiSummary,
      aiSummaryLastUpdated: admin.firestore.Timestamp.now()
    });

    console.log(`✅ AI summary generated and saved for deal: ${dealId}`);

    return { aiSummary };

  } catch (error) {
    console.error('❌ Error generating AI summary:', error);
    throw new Error('Failed to generate AI summary');
  }
});

function analyzeEmailResponsiveness(emails: any[]) {
  if (emails.length === 0) {
    return {
      totalEmails: 0,
      responseTime: 'No email data available',
      engagementLevel: 'Unknown'
    };
  }

  const inboundEmails = emails.filter(email => email.direction === 'inbound');
  const outboundEmails = emails.filter(email => email.direction === 'outbound');
  
  // Calculate average response time
  let totalResponseTime = 0;
  let responseCount = 0;
  
  outboundEmails.forEach(outbound => {
    const responses = inboundEmails.filter(inbound => 
      inbound.timestamp > outbound.timestamp && 
      inbound.subject?.includes(outbound.subject?.split('Re:')[1] || '')
    );
    
    if (responses.length > 0) {
      const responseTime = responses[0].timestamp - outbound.timestamp;
      totalResponseTime += responseTime;
      responseCount++;
    }
  });

  const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;
  const avgResponseHours = avgResponseTime / (1000 * 60 * 60);

  let engagementLevel = 'low';
  if (inboundEmails.length > outboundEmails.length * 0.8) {
    engagementLevel = 'high';
  } else if (inboundEmails.length > outboundEmails.length * 0.4) {
    engagementLevel = 'medium';
  }

  return {
    totalEmails: emails.length,
    responseTime: avgResponseHours < 24 ? `${avgResponseHours.toFixed(1)} hours` : `${(avgResponseHours / 24).toFixed(1)} days`,
    engagementLevel
  };
}

function analyzeAILogs(aiLogs: any[]) {
  if (aiLogs.length === 0) {
    return {
      totalLogs: 0,
      recentActivity: 'No recent AI activity',
      keyInsights: []
    };
  }

  const recentLogs = aiLogs.slice(0, 10);
  const keyInsights: string[] = [];
  
  // Extract insights from AI logs
  recentLogs.forEach(log => {
    if (log.action?.includes('stage_advance')) {
      keyInsights.push(`Stage advanced to ${log.newStage || 'next stage'}`);
    }
    if (log.action?.includes('email_sent')) {
      keyInsights.push('Follow-up email sent');
    }
    if (log.action?.includes('meeting_scheduled')) {
      keyInsights.push('Meeting scheduled');
    }
    if (log.action?.includes('proposal_sent')) {
      keyInsights.push('Proposal sent to customer');
    }
  });

  const lastActivity = aiLogs[0]?.timestamp;
  const hoursSinceLastActivity = lastActivity ? (Date.now() - lastActivity.toMillis()) / (1000 * 60 * 60) : 0;

  let recentActivity = 'Unknown';
  if (hoursSinceLastActivity < 24) {
    recentActivity = 'Very recent (within 24 hours)';
  } else if (hoursSinceLastActivity < 72) {
    recentActivity = 'Recent (within 3 days)';
  } else if (hoursSinceLastActivity < 168) {
    recentActivity = 'Moderate (within 1 week)';
  } else {
    recentActivity = 'Stale (over 1 week)';
  }

  return {
    totalLogs: aiLogs.length,
    recentActivity,
    keyInsights: keyInsights.slice(0, 5) // Limit to top 5 insights
  };
}

function analyzeDealProgress(dealData: any, stageHistory: any[]) {
  const currentStage = dealData.stage;
  const stageStartTime = stageHistory.find(h => h.stage === currentStage)?.timestamp;
  
  let timeInStage = 'Unknown';
  if (stageStartTime) {
    const hoursInStage = (Date.now() - stageStartTime.toMillis()) / (1000 * 60 * 60);
    if (hoursInStage < 24) {
      timeInStage = `${hoursInStage.toFixed(1)} hours`;
    } else {
      timeInStage = `${(hoursInStage / 24).toFixed(1)} days`;
    }
  }

  const stageAdvancement = stageHistory.length > 1 ? 'Progressive' : 'Initial stage';

  return {
    stage: currentStage,
    timeInStage,
    stageAdvancement
  };
}

function identifyRoadblocks(dealData: any, aiLogs: any[], emails: any[]) {
  const roadblocks: string[] = [];
  
  // Check for long time in current stage
  const stageHistory = aiLogs.filter(log => log.action?.includes('stage'));
  if (stageHistory.length > 0) {
    const lastStageChange = stageHistory[0].timestamp;
    const hoursSinceStageChange = (Date.now() - lastStageChange.toMillis()) / (1000 * 60 * 60);
    
    if (hoursSinceStageChange > 168) { // More than 1 week
      roadblocks.push('Deal stalled in current stage for over 1 week');
    }
  }

  // Check for lack of customer engagement
  const recentEmails = emails.filter(email => 
    email.timestamp > Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
  );
  
  if (recentEmails.length === 0) {
    roadblocks.push('No recent email communication with customer');
  }

  // Check for missing critical information
  if (!dealData.stageData?.qualification?.expectedCloseDate) {
    roadblocks.push('Missing expected close date');
  }
  
  if (!dealData.stageData?.qualification?.timeline) {
    roadblocks.push('Missing timeline information');
  }

  return roadblocks;
}

function assessCustomerResponsiveness(emailAnalysis: any, aiLogs: any[]) {
  if (emailAnalysis.engagementLevel === 'high') {
    return 'high';
  } else if (emailAnalysis.engagementLevel === 'medium') {
    return 'medium';
  } else {
    return 'low';
  }
}

function calculateLikelihoodToClose(dealData: any, aiLogs: any[], emailAnalysis: any) {
  let score = 0;
  
  // Base score from stage
  const stageScores: { [key: string]: number } = {
    'discovery': 0.1,
    'qualification': 0.2,
    'proposal': 0.4,
    'negotiation': 0.7,
    'closed_won': 1.0,
    'closed_lost': 0.0
  };
  
  score += stageScores[dealData.stage] || 0.1;
  
  // Adjust based on customer responsiveness
  if (emailAnalysis.engagementLevel === 'high') score += 0.2;
  else if (emailAnalysis.engagementLevel === 'medium') score += 0.1;
  
  // Adjust based on recent activity
  const recentActivity = aiLogs.filter(log => 
    log.timestamp > Date.now() - (7 * 24 * 60 * 60 * 1000)
  );
  
  if (recentActivity.length > 5) score += 0.1;
  else if (recentActivity.length === 0) score -= 0.2;
  
  // Determine likelihood
  if (score >= 0.7) return 'high';
  else if (score >= 0.4) return 'medium';
  else return 'low';
}

function assessSalespersonPerformance(dealData: any, aiLogs: any[], emailAnalysis: any) {
  let score = 0;
  
  // Check for regular follow-ups
  const followUpLogs = aiLogs.filter(log => 
    log.action?.includes('email_sent') || log.action?.includes('follow_up')
  );
  
  if (followUpLogs.length > 5) score += 0.3;
  else if (followUpLogs.length > 2) score += 0.2;
  
  // Check for stage advancement
  const stageAdvancements = aiLogs.filter(log => 
    log.action?.includes('stage_advance')
  );
  
  if (stageAdvancements.length > 0) score += 0.3;
  
  // Check for customer engagement
  if (emailAnalysis.engagementLevel === 'high') score += 0.2;
  else if (emailAnalysis.engagementLevel === 'medium') score += 0.1;
  
  // Check for recent activity
  const recentActivity = aiLogs.filter(log => 
    log.timestamp > Date.now() - (3 * 24 * 60 * 60 * 1000) // Last 3 days
  );
  
  if (recentActivity.length > 3) score += 0.2;
  
  // Determine performance
  if (score >= 0.7) return 'excellent';
  else if (score >= 0.4) return 'good';
  else return 'needs_improvement';
}

function generateSummaryText(dealData: any, emailAnalysis: any, aiLogsAnalysis: any, dealProgress: any, roadblocks: string[]) {
  let summary = `Deal "${dealData.name}" is currently in the ${dealData.stage} stage. `;
  
  if (emailAnalysis.totalEmails > 0) {
    summary += `Customer engagement is ${emailAnalysis.engagementLevel} with an average response time of ${emailAnalysis.responseTime}. `;
  } else {
    summary += `Limited email communication data available. `;
  }
  
  summary += `The deal has been in the current stage for ${dealProgress.timeInStage}. `;
  
  if (aiLogsAnalysis.totalLogs > 0) {
    summary += `Recent AI activity shows ${aiLogsAnalysis.recentActivity} with ${aiLogsAnalysis.keyInsights.length} key actions. `;
  }
  
  if (roadblocks.length > 0) {
    summary += `Key roadblocks identified: ${roadblocks.join(', ')}. `;
  }
  
  return summary;
}

// Export analysis functions for use by trigger functions
export {
  analyzeEmailResponsiveness,
  analyzeAILogs,
  analyzeDealProgress,
  identifyRoadblocks,
  assessCustomerResponsiveness,
  calculateLikelihoodToClose,
  assessSalespersonPerformance,
  generateSummaryText
};
