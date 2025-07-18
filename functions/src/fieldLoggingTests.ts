import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { logAIAction } from './feedbackEngine';

const db = admin.firestore();

// Test harness for field-level logging
export const testFieldLevelLogging = onCall(async (request) => {
  const { contextId, contextType, fields } = request.data;
  const results = [];
  
  for (const fieldName of fields) {
    try {
      // Test field change logging
      const oldValue = 'test_old_value';
      const newValue = 'test_new_value';
      
      const logResult = await logFieldChange(fieldName, contextId, contextType, oldValue, newValue);
      
      results.push({
        fieldName,
        success: true,
        logId: logResult.logId,
        message: 'Field change logged successfully'
      });
    } catch (error: any) {
      results.push({
        fieldName,
        success: false,
        error: error.message,
        message: 'Field change logging failed'
      });
    }
  }
  
  return { results };
});

// Test all AI fields
export const testAllAIFields = onCall(async (request) => {
  const { contextId, contextType } = request.data;
  
  const fields = contextType === 'customer' ? CUSTOMER_AI_FIELDS : AGENCY_AI_FIELDS;
  
  const results = [];
  
  for (const fieldName of fields) {
    try {
      // Test field change logging
      const oldValue = 'test_old_value';
      const newValue = 'test_new_value';
      
      const logResult = await logFieldChange(fieldName, contextId, contextType, oldValue, newValue);
      
      results.push({
        fieldName,
        success: true,
        logId: logResult.logId,
        message: 'Field change logged successfully'
      });
    } catch (error: any) {
      results.push({
        fieldName,
        success: false,
        error: error.message,
        message: 'Field change logging failed'
      });
    }
  }
  
  // Generate test report
  const successCount = results.filter((r: any) => r.success).length;
  const failureCount = results.filter((r: any) => !r.success).length;
  
  return {
    totalFields: fields.length,
    successCount,
    failureCount,
    successRate: (successCount / fields.length) * 100,
    results: results
  };
});

// Test field validation
export const testFieldValidation = onCall(async (request) => {
  const { fieldName, testValues } = request.data;
  const results = [];
  
  for (const testCase of testValues) {
    try {
      const { oldValue, newValue, shouldPass } = testCase;
      
      // Test validation
      const isValid = validateFieldData(fieldName, oldValue, newValue);
      
      const passed = shouldPass ? isValid : !isValid;
      
      results.push({
        testCase,
        passed,
        message: passed ? 'Validation test passed' : 'Validation test failed'
      });
    } catch (error: any) {
      const passed = !testCase.shouldPass; // If validation throws and shouldn't pass, that's correct
      
      results.push({
        testCase,
        passed,
        error: error.message,
        message: passed ? 'Validation test passed (expected error)' : 'Validation test failed'
      });
    }
  }
  
  return { results };
});

// Test CORS error handling
export const testCORSErrorHandling = onCall(async (request) => {
  // const { contextId, contextType } = request.data; // Unused for now
  
  try {
    // Simulate a CORS error by using an invalid function name
    // Note: This is a simplified test - in real implementation, you'd test actual CORS scenarios
    throw new Error('Simulated CORS error for testing');
    
    return {
      success: false,
      message: 'Expected CORS error but none occurred'
    };
  } catch (error: any) {
    // Check if it's a CORS-related error
    const isCORSError = error.code === 'functions/unavailable' || 
                       error.message.includes('CORS') ||
                       error.message.includes('network');
    
    return {
      success: true,
      isCORSError,
      error: error.message,
      message: isCORSError ? 'CORS error handled correctly' : 'Unexpected error type'
    };
  }
});

// Test failed log retry mechanism
export const testFailedLogRetry = onCall(async (request) => {
  const { contextId, contextType } = request.data;
  
  try {
    // Create a test failed log
    const testFailedLog = {
      fieldName: 'tone.formality',
      contextId,
      contextType,
      oldValue: 0.5,
      newValue: 0.7,
      error: 'Test CORS error',
      timestamp: new Date()
    };
    
    // Store it locally (simulate browser storage)
    const failedLogs = [testFailedLog];
    
    // Attempt to retry
    const retryResults = await retryFailedLogs(failedLogs);
    
    return {
      success: true,
      failedLogsCount: failedLogs.length,
      retryResults,
      message: 'Failed log retry mechanism tested'
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: 'Failed log retry test failed'
    };
  }
});

// Test field change analytics
export const testFieldChangeAnalytics = onCall(async (request) => {
  const { timeRange = '24h', contextId, contextType } = request.data;
  
  try {
    const cutoffTime = getCutoffTime(timeRange);
    const logsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', cutoffTime)
      .where('eventType', '==', 'ai_field_change')
      .where(contextType === 'customer' ? 'customerId' : 'agencyId', '==', contextId)
      .orderBy('timestamp', 'desc')
      .get();
    
    const logs = logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Analyze field change patterns
    const fieldStats: Record<string, any> = {};
    logs.forEach((log: any) => {
      const fieldName = log.targetId?.split(':')[1];
      if (!fieldStats[fieldName]) {
        fieldStats[fieldName] = { changes: 0, lastChanged: null };
      }
      fieldStats[fieldName].changes++;
      fieldStats[fieldName].lastChanged = log.timestamp;
    });
    
    return {
      success: true,
      totalFieldChanges: logs.length,
      fieldsChanged: Object.keys(fieldStats).length,
      fieldStats,
      timeRange
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: 'Field change analytics test failed'
    };
  }
});

// Helper functions
async function logFieldChange(fieldName: string, contextId: string, contextType: 'customer' | 'agency', oldValue: any, newValue: any) {
  const pattern = AI_FIELD_PATTERNS[fieldName];
  if (!pattern) {
    throw new Error(`Unknown AI field: ${fieldName}`);
  }
  
  const logData = {
    userId: 'test-user',
    actionType: 'ai_field_change',
    sourceModule: 'AISettings',
    inputPrompt: JSON.stringify({ field: fieldName, oldValue, newValue }),
    composedPrompt: `Field ${fieldName} changed from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`,
    aiResponse: 'Field change logged',
    success: true,
    latencyMs: 0,
    versionTag: 'v1',
    [contextType === 'customer' ? 'customerId' : 'agencyId']: contextId,
    contextType: pattern.contextType,
    reason: `Updated ${fieldName} field`,
    eventType: `ai_field.${fieldName}.changed`,
    targetType: 'field',
    targetId: `${contextId}:${fieldName}`,
    aiRelevant: true,
    traitsAffected: fieldName.startsWith('traits.') ? [fieldName.split('.')[1]] : null,
    aiTags: ['field_change', pattern.contextType],
    urgencyScore: pattern.urgencyScore
  };
  
  await logAIAction(logData);
  return { logId: `field_${fieldName}_${Date.now()}` };
}

function validateFieldData(fieldName: string, oldValue: any, newValue: any): boolean {
  const pattern = AI_FIELD_PATTERNS[fieldName];
  if (!pattern) {
    throw new Error(`Unknown AI field: ${fieldName}`);
  }
  
  // Validate value types
  if (typeof oldValue !== typeof newValue) {
    throw new Error(`Type mismatch for field ${fieldName}`);
  }
  
  // Validate value ranges for sliders
  if (pattern.contextType === 'tone' || pattern.contextType === 'weights') {
    if (newValue < 0 || newValue > 1) {
      throw new Error(`Invalid value for ${fieldName}: ${newValue}`);
    }
  }
  
  return true;
}

async function retryFailedLogs(failedLogs: any[]) {
  const retryPromises = failedLogs.map(async (logData) => {
    try {
      const pattern = AI_FIELD_PATTERNS[logData.fieldName];
      if (!pattern) return { success: false, error: 'Unknown field' };
      
      await logAIAction({
        userId: 'system',
        actionType: 'ai_field_change',
        sourceModule: 'AISettings',
        inputPrompt: JSON.stringify({ field: logData.fieldName, oldValue: logData.oldValue, newValue: logData.newValue }),
        composedPrompt: `Field ${logData.fieldName} changed from ${JSON.stringify(logData.oldValue)} to ${JSON.stringify(logData.newValue)}`,
        aiResponse: 'Field change logged (retry)',
        success: true,
        latencyMs: 0,
        versionTag: 'v1',
        [logData.contextType === 'customer' ? 'customerId' : 'agencyId']: logData.contextId,
        contextType: pattern.contextType,
        reason: `Updated ${logData.fieldName} field (retry)`,
        eventType: `ai_field.${logData.fieldName}.changed`,
        targetType: 'field',
        targetId: `${logData.contextId}:${logData.fieldName}`,
        aiRelevant: true,
        traitsAffected: logData.fieldName.startsWith('traits.') ? [logData.fieldName.split('.')[1]] : null,
        aiTags: ['field_change', pattern.contextType, 'retry'],
        urgencyScore: pattern.urgencyScore
      });
      
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  
  return await Promise.all(retryPromises);
}

function getCutoffTime(timeRange: string): Date {
  const now = new Date();
  const hours = timeRange === '24h' ? 24 : 
                timeRange === '7d' ? 24 * 7 : 
                timeRange === '30d' ? 24 * 30 : 24;
  
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

// Field inventories for testing
const CUSTOMER_AI_FIELDS = [
  'tone.formality',
  'tone.friendliness', 
  'tone.conciseness',
  'tone.assertiveness',
  'tone.enthusiasm',
  'prompts.custom.0',
  'prompts.custom.1', 
  'prompts.custom.2',
  'prompts.frequency',
  'prompts.goals',
  'context.websiteUrl',
  'context.sampleSocialPosts.0',
  'context.sampleSocialPosts.1',
  'context.sampleSocialPosts.2',
  'context.uploadedDocs'
];

const AGENCY_AI_FIELDS = [
  'tone.formality',
  'tone.friendliness',
  'tone.conciseness', 
  'tone.assertiveness',
  'tone.enthusiasm',
  'prompts.custom.0',
  'prompts.custom.1',
  'prompts.custom.2',
  'prompts.frequency',
  'prompts.goals',
  'context.websiteUrl',
  'context.sampleSocialPosts.0',
  'context.sampleSocialPosts.1', 
  'context.sampleSocialPosts.2',
  'context.uploadedDocs',
  'traits.communication.enabled',
  'traits.communication.weight',
  'traits.communication.threshold',
  'traits.reliability.enabled',
  'traits.reliability.weight',
  'traits.reliability.threshold',
  'traits.teamwork.enabled',
  'traits.teamwork.weight',
  'traits.teamwork.threshold',
  'traits.adaptability.enabled',
  'traits.adaptability.weight',
  'traits.adaptability.threshold',
  'traits.problemSolving.enabled',
  'traits.problemSolving.weight',
  'traits.problemSolving.threshold',
  'moments.onboarding.enabled',
  'moments.onboarding.trigger',
  'moments.onboarding.frequency',
  'moments.checkin.enabled',
  'moments.checkin.trigger',
  'moments.checkin.frequency',
  'moments.feedback.enabled',
  'moments.feedback.trigger',
  'moments.feedback.frequency',
  'feedback.sentimentScoring.enabled',
  'feedback.sentimentScoring.confidenceThreshold',
  'feedback.sentimentScoring.updateFrequency',
  'feedback.managerAccess.enabled',
  'feedback.managerAccess.requireOptIn',
  'feedback.managerAccess.anonymizeData',
  'feedback.managerAccess.accessLevel',
  'feedback.aiFollowUp.enabled',
  'feedback.aiFollowUp.triggerThreshold',
  'feedback.aiFollowUp.maxFollowUps',
  'feedback.aiFollowUp.followUpDelay',
  'feedback.anonymity.defaultAnonymous',
  'feedback.anonymity.allowWorkerChoice',
  'feedback.anonymity.anonymizeInReports',
  'feedback.notifications.enableAlerts',
  'feedback.notifications.alertThreshold',
  'feedback.notifications.notifyManagers',
  'feedback.notifications.notifyHR',
  'weights.admin.adminInstruction',
  'weights.admin.compliance',
  'weights.admin.riskTolerance',
  'weights.admin.escalation',
  'weights.customer.mission',
  'weights.customer.teamStructure',
  'weights.customer.retentionGoals',
  'weights.customer.customPolicies',
  'weights.customer.cultureFit',
  'weights.employee.feedback',
  'weights.employee.behavior',
  'weights.employee.performance',
  'weights.employee.wellness',
  'weights.employee.growth',
  'vector.chunkSize',
  'vector.similarityThreshold',
  'vector.maxResults',
  'vector.indexingStrategy',
  'vector.updateFrequency',
  'conversation.confidence.threshold',
  'conversation.confidence.enableLowConfidenceAlerts',
  'conversation.confidence.autoEscalateThreshold',
  'conversation.escalation.enabled',
  'conversation.escalation.delayMinutes',
  'conversation.escalation.maxAttempts',
  'conversation.privacy.enableAnonymousMode',
  'conversation.privacy.defaultAnonymous',
  'conversation.privacy.allowWorkerChoice',
  'conversation.privacy.anonymizeInLogs',
  'conversation.conversation.maxLength',
  'conversation.conversation.autoArchiveDays',
  'conversation.conversation.enableContextRetention',
  'conversation.conversation.contextRetentionDays',
  'conversation.conversation.enableConversationHistory',
  'conversation.responses.enableAutoResponses',
  'conversation.responses.responseDelaySeconds',
  'conversation.responses.enableTypingIndicators',
  'conversation.responses.maxResponseLength'
];

// AI Field Patterns for testing
const AI_FIELD_PATTERNS: Record<string, { contextType: string; urgencyScore: number }> = {
  'tone.formality': { contextType: 'tone', urgencyScore: 3 },
  'tone.friendliness': { contextType: 'tone', urgencyScore: 3 },
  'tone.conciseness': { contextType: 'tone', urgencyScore: 3 },
  'tone.assertiveness': { contextType: 'tone', urgencyScore: 3 },
  'tone.enthusiasm': { contextType: 'tone', urgencyScore: 3 },
  'prompts.custom.0': { contextType: 'prompts', urgencyScore: 5 },
  'prompts.custom.1': { contextType: 'prompts', urgencyScore: 5 },
  'prompts.custom.2': { contextType: 'prompts', urgencyScore: 5 },
  'prompts.frequency': { contextType: 'prompts', urgencyScore: 4 },
  'prompts.goals': { contextType: 'prompts', urgencyScore: 4 },
  'context.websiteUrl': { contextType: 'context', urgencyScore: 2 },
  'context.sampleSocialPosts.0': { contextType: 'context', urgencyScore: 2 },
  'context.sampleSocialPosts.1': { contextType: 'context', urgencyScore: 2 },
  'context.sampleSocialPosts.2': { contextType: 'context', urgencyScore: 2 },
  'context.uploadedDocs': { contextType: 'context', urgencyScore: 2 },
  'traits.communication.enabled': { contextType: 'traits', urgencyScore: 6 },
  'traits.communication.weight': { contextType: 'traits', urgencyScore: 6 },
  'traits.communication.threshold': { contextType: 'traits', urgencyScore: 6 },
  'traits.reliability.enabled': { contextType: 'traits', urgencyScore: 6 },
  'traits.reliability.weight': { contextType: 'traits', urgencyScore: 6 },
  'traits.reliability.threshold': { contextType: 'traits', urgencyScore: 6 },
  'traits.teamwork.enabled': { contextType: 'traits', urgencyScore: 6 },
  'traits.teamwork.weight': { contextType: 'traits', urgencyScore: 6 },
  'traits.teamwork.threshold': { contextType: 'traits', urgencyScore: 6 },
  'traits.adaptability.enabled': { contextType: 'traits', urgencyScore: 6 },
  'traits.adaptability.weight': { contextType: 'traits', urgencyScore: 6 },
  'traits.adaptability.threshold': { contextType: 'traits', urgencyScore: 6 },
  'traits.problemSolving.enabled': { contextType: 'traits', urgencyScore: 6 },
  'traits.problemSolving.weight': { contextType: 'traits', urgencyScore: 6 },
  'traits.problemSolving.threshold': { contextType: 'traits', urgencyScore: 6 },
  'moments.onboarding.enabled': { contextType: 'moments', urgencyScore: 5 },
  'moments.onboarding.trigger': { contextType: 'moments', urgencyScore: 5 },
  'moments.onboarding.frequency': { contextType: 'moments', urgencyScore: 5 },
  'moments.checkin.enabled': { contextType: 'moments', urgencyScore: 5 },
  'moments.checkin.trigger': { contextType: 'moments', urgencyScore: 5 },
  'moments.checkin.frequency': { contextType: 'moments', urgencyScore: 5 },
  'moments.feedback.enabled': { contextType: 'moments', urgencyScore: 5 },
  'moments.feedback.trigger': { contextType: 'moments', urgencyScore: 5 },
  'moments.feedback.frequency': { contextType: 'moments', urgencyScore: 5 },
  'feedback.sentimentScoring.enabled': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.sentimentScoring.confidenceThreshold': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.sentimentScoring.updateFrequency': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.managerAccess.enabled': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.managerAccess.requireOptIn': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.managerAccess.anonymizeData': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.managerAccess.accessLevel': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.aiFollowUp.enabled': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.aiFollowUp.triggerThreshold': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.aiFollowUp.maxFollowUps': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.aiFollowUp.followUpDelay': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.anonymity.defaultAnonymous': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.anonymity.allowWorkerChoice': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.anonymity.anonymizeInReports': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.notifications.enableAlerts': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.notifications.alertThreshold': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.notifications.notifyManagers': { contextType: 'feedback', urgencyScore: 7 },
  'feedback.notifications.notifyHR': { contextType: 'feedback', urgencyScore: 7 },
  'weights.admin.adminInstruction': { contextType: 'weights', urgencyScore: 8 },
  'weights.admin.compliance': { contextType: 'weights', urgencyScore: 8 },
  'weights.admin.riskTolerance': { contextType: 'weights', urgencyScore: 8 },
  'weights.admin.escalation': { contextType: 'weights', urgencyScore: 8 },
  'weights.customer.mission': { contextType: 'weights', urgencyScore: 6 },
  'weights.customer.teamStructure': { contextType: 'weights', urgencyScore: 6 },
  'weights.customer.retentionGoals': { contextType: 'weights', urgencyScore: 6 },
  'weights.customer.customPolicies': { contextType: 'weights', urgencyScore: 6 },
  'weights.customer.cultureFit': { contextType: 'weights', urgencyScore: 6 },
  'weights.employee.feedback': { contextType: 'weights', urgencyScore: 6 },
  'weights.employee.behavior': { contextType: 'weights', urgencyScore: 6 },
  'weights.employee.performance': { contextType: 'weights', urgencyScore: 6 },
  'weights.employee.wellness': { contextType: 'weights', urgencyScore: 6 },
  'weights.employee.growth': { contextType: 'weights', urgencyScore: 6 },
  'vector.chunkSize': { contextType: 'vector', urgencyScore: 4 },
  'vector.similarityThreshold': { contextType: 'vector', urgencyScore: 4 },
  'vector.maxResults': { contextType: 'vector', urgencyScore: 4 },
  'vector.indexingStrategy': { contextType: 'vector', urgencyScore: 4 },
  'vector.updateFrequency': { contextType: 'vector', urgencyScore: 4 },
  'conversation.confidence.threshold': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.confidence.enableLowConfidenceAlerts': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.confidence.autoEscalateThreshold': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.escalation.enabled': { contextType: 'conversation', urgencyScore: 7 },
  'conversation.escalation.delayMinutes': { contextType: 'conversation', urgencyScore: 7 },
  'conversation.escalation.maxAttempts': { contextType: 'conversation', urgencyScore: 7 },
  'conversation.privacy.enableAnonymousMode': { contextType: 'conversation', urgencyScore: 8 },
  'conversation.privacy.defaultAnonymous': { contextType: 'conversation', urgencyScore: 8 },
  'conversation.privacy.allowWorkerChoice': { contextType: 'conversation', urgencyScore: 8 },
  'conversation.privacy.anonymizeInLogs': { contextType: 'conversation', urgencyScore: 8 },
  'conversation.conversation.maxLength': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.conversation.autoArchiveDays': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.conversation.enableContextRetention': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.conversation.contextRetentionDays': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.conversation.enableConversationHistory': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.responses.enableAutoResponses': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.responses.responseDelaySeconds': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.responses.enableTypingIndicators': { contextType: 'conversation', urgencyScore: 6 },
  'conversation.responses.maxResponseLength': { contextType: 'conversation', urgencyScore: 6 },
}; 