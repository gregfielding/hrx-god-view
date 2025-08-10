import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

// Trigger AI summary update when significant AI logs are added
export const triggerAISummaryUpdate = onDocumentCreated(
  'tenants/{tenantId}/ai_logs/{logId}',
  async (event) => {
    try {
      const logData = event.data?.data();
      const logId = event.params.logId;
      const tenantId = event.params.tenantId;

      if (!logData) {
        console.log('No log data found, skipping AI summary update');
        return;
      }

      console.log(`🔍 AI log created: ${logId} for tenant: ${tenantId}`);

      // Check if this log is related to a deal
      const dealId = logData.dealId;
      if (!dealId) {
        console.log('Log not related to a deal, skipping AI summary update');
        return;
      }

      // Check if this is a significant action that warrants summary update
      const significantActions = [
        'stage_advance',
        'email_sent',
        'meeting_scheduled',
        'proposal_sent',
        'follow_up',
        'contact_created',
        'deal_updated',
        'task_created',
        'task_completed'
      ];

      const action = logData.action;
      const isSignificant = significantActions.some(sigAction => 
        action?.includes(sigAction)
      );

      if (!isSignificant) {
        console.log(`Action "${action}" not significant, skipping AI summary update`);
        return;
      }

      console.log(`🚀 Significant action detected: ${action}, triggering AI summary update for deal: ${dealId}`);

      // Call the function directly (not as a callable function)
      const db = admin.firestore();
      
      // Get deal data
      const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
      const dealDoc = await dealRef.get();
      
      if (!dealDoc.exists) {
        console.log(`Deal ${dealId} not found, skipping AI summary update`);
        return;
      }

      const dealData = dealDoc.data();

      // Get AI logs for this deal
      const aiLogsRef = db.collection('tenants').doc(tenantId).collection('ai_logs');
      const aiLogsQuery = aiLogsRef.where('dealId', '==', dealId).orderBy('timestamp', 'desc').limit(50);
      const aiLogsSnap = await aiLogsQuery.get();
      
      const aiLogs = aiLogsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Get emails for this deal (if Gmail integration is available)
      let emails: any[] = [];
      try {
        const emailsRef = db.collection('tenants').doc(tenantId).collection('emails');
        const emailsQuery = emailsRef.where('dealId', '==', dealId).orderBy('timestamp', 'desc').limit(100);
        const emailsSnap = await emailsQuery.get();
        
        emails = emailsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      } catch (error) {
        console.log(`No email integration found: ${error}`);
      }

      // Get deal stage history
      const stageHistoryRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).collection('stage_history');
      const stageHistorySnap = await stageHistoryRef.orderBy('timestamp', 'desc').limit(10).get();
      
      const stageHistory = stageHistorySnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Import the analysis functions
      const {
        analyzeEmailResponsiveness,
        analyzeAILogs,
        analyzeDealProgress,
        identifyRoadblocks,
        assessCustomerResponsiveness,
        calculateLikelihoodToClose,
        assessSalespersonPerformance,
        generateSummaryText
      } = await import('./generateDealAISummary');

      // Analyze data
      const emailAnalysis = analyzeEmailResponsiveness(emails);
      const aiLogsAnalysis = analyzeAILogs(aiLogs);
      const dealProgress = analyzeDealProgress(dealData, stageHistory);
      const roadblocks = identifyRoadblocks(dealData, aiLogs, emails);
      const customerResponsiveness = assessCustomerResponsiveness(emailAnalysis, aiLogs);
      const likelihoodToClose = calculateLikelihoodToClose(dealData, aiLogs, emailAnalysis);
      const salespersonPerformance = assessSalespersonPerformance(dealData, aiLogs, emailAnalysis);
      const summary = generateSummaryText(dealData, emailAnalysis, aiLogsAnalysis, dealProgress, roadblocks);

      const aiSummary = {
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

      console.log(`✅ AI summary updated for deal: ${dealId} due to action: ${action}`);

    } catch (error) {
      console.error('❌ Error triggering AI summary update:', error);
    }
  }
);
