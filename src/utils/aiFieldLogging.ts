import { useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

// AI Field Patterns - defines which fields are AI-relevant and their metadata
export const AI_FIELD_PATTERNS: Record<string, { contextType: string; urgencyScore: number }> = {
  // Tone & Style Settings
  'tone.formality': { contextType: 'tone', urgencyScore: 3 },
  'tone.friendliness': { contextType: 'tone', urgencyScore: 3 },
  'tone.conciseness': { contextType: 'tone', urgencyScore: 3 },
  'tone.assertiveness': { contextType: 'tone', urgencyScore: 3 },
  'tone.enthusiasm': { contextType: 'tone', urgencyScore: 3 },
  
  // Custom Prompts
  'prompts.custom.0': { contextType: 'prompts', urgencyScore: 5 },
  'prompts.custom.1': { contextType: 'prompts', urgencyScore: 5 },
  'prompts.custom.2': { contextType: 'prompts', urgencyScore: 5 },
  
  // Prompt Frequency & Goals
  'prompts.frequency': { contextType: 'prompts', urgencyScore: 4 },
  'prompts.goals': { contextType: 'prompts', urgencyScore: 4 },
  
  // Context & Branding
  'context.websiteUrl': { contextType: 'context', urgencyScore: 2 },
  'context.sampleSocialPosts.0': { contextType: 'context', urgencyScore: 2 },
  'context.sampleSocialPosts.1': { contextType: 'context', urgencyScore: 2 },
  'context.sampleSocialPosts.2': { contextType: 'context', urgencyScore: 2 },
  'context.uploadedDocs': { contextType: 'context', urgencyScore: 2 },
  
  // Traits Engine
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
  
  // Moments Engine
  'moments.onboarding.enabled': { contextType: 'moments', urgencyScore: 5 },
  'moments.onboarding.trigger': { contextType: 'moments', urgencyScore: 5 },
  'moments.onboarding.frequency': { contextType: 'moments', urgencyScore: 5 },
  'moments.checkin.enabled': { contextType: 'moments', urgencyScore: 5 },
  'moments.checkin.trigger': { contextType: 'moments', urgencyScore: 5 },
  'moments.checkin.frequency': { contextType: 'moments', urgencyScore: 5 },
  'moments.feedback.enabled': { contextType: 'moments', urgencyScore: 5 },
  'moments.feedback.trigger': { contextType: 'moments', urgencyScore: 5 },
  'moments.feedback.frequency': { contextType: 'moments', urgencyScore: 5 },
  
  // Feedback Engine
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
  
  // Weights Engine
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
  
  // Vector Settings
  'vector.chunkSize': { contextType: 'vector', urgencyScore: 4 },
  'vector.similarityThreshold': { contextType: 'vector', urgencyScore: 4 },
  'vector.maxResults': { contextType: 'vector', urgencyScore: 4 },
  'vector.indexingStrategy': { contextType: 'vector', urgencyScore: 4 },
  'vector.updateFrequency': { contextType: 'vector', urgencyScore: 4 },
  
  // Conversation Settings
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

// Field inventories for comprehensive testing
export const CUSTOMER_AI_FIELDS = [
  // Tone & Style Settings
  'tone.formality',
  'tone.friendliness', 
  'tone.conciseness',
  'tone.assertiveness',
  'tone.enthusiasm',
  
  // Custom Prompts
  'prompts.custom.0',
  'prompts.custom.1', 
  'prompts.custom.2',
  
  // Prompt Frequency & Goals
  'prompts.frequency',
  'prompts.goals',
  
  // Context & Branding
  'context.websiteUrl',
  'context.sampleSocialPosts.0',
  'context.sampleSocialPosts.1',
  'context.sampleSocialPosts.2',
  'context.uploadedDocs'
];

export const AGENCY_AI_FIELDS = [
  // Tone & Style Settings
  'tone.formality',
  'tone.friendliness',
  'tone.conciseness', 
  'tone.assertiveness',
  'tone.enthusiasm',
  
  // Custom Prompts
  'prompts.custom.0',
  'prompts.custom.1',
  'prompts.custom.2',
  
  // Prompt Frequency & Goals
  'prompts.frequency',
  'prompts.goals',
  
  // Context & Branding
  'context.websiteUrl',
  'context.sampleSocialPosts.0',
  'context.sampleSocialPosts.1', 
  'context.sampleSocialPosts.2',
  'context.uploadedDocs',
  
  // Traits Engine
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
  
  // Moments Engine
  'moments.onboarding.enabled',
  'moments.onboarding.trigger',
  'moments.onboarding.frequency',
  'moments.checkin.enabled',
  'moments.checkin.trigger',
  'moments.checkin.frequency',
  'moments.feedback.enabled',
  'moments.feedback.trigger',
  'moments.feedback.frequency',
  
  // Feedback Engine
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
  
  // Weights Engine
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
  
  // Vector Settings
  'vector.chunkSize',
  'vector.similarityThreshold',
  'vector.maxResults',
  'vector.indexingStrategy',
  'vector.updateFrequency',
  
  // Conversation Settings
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

// Validate field data before logging
export const validateFieldData = (fieldName: string, oldValue: any, newValue: any): boolean => {
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
};

// Store failed logs locally for retry
export const storeFailedLog = async (logData: {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  oldValue: any;
  newValue: any;
  error: string;
  timestamp: Date;
}) => {
  try {
    const failedLogs: any[] = JSON.parse(localStorage.getItem('ai_failed_logs') || '[]');
    failedLogs.push(logData);
    localStorage.setItem('ai_failed_logs', JSON.stringify(failedLogs));
    console.log('Stored failed log for retry:', logData);
  } catch (error) {
    console.error('Failed to store failed log:', error);
  }
};

// Retry failed logs
export const retryFailedLogs = async () => {
  try {
    const failedLogs: any[] = JSON.parse(localStorage.getItem('ai_failed_logs') || '[]');
    if (failedLogs.length === 0) return;
    
    const functions = getFunctions(app, 'us-central1');
    const logAIAction = httpsCallable(functions, 'logAIAction');
    
    const retryPromises = failedLogs.map(async (logData: any) => {
      try {
        const pattern = AI_FIELD_PATTERNS[logData.fieldName];
        if (!pattern) return { success: false, error: 'Unknown field' };
        
        await logAIAction({
          userId: 'system', // Will be updated with actual user ID
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
    
    const results = await Promise.all(retryPromises);
    const successfulRetries = results.filter(r => r.success).length;
    
    if (successfulRetries === failedLogs.length) {
      localStorage.removeItem('ai_failed_logs');
      console.log(`Successfully retried ${successfulRetries} failed logs`);
    } else {
      // Keep failed logs for next retry
      const stillFailed = failedLogs.filter((_: any, index: number) => !results[index].success);
      localStorage.setItem('ai_failed_logs', JSON.stringify(stillFailed));
      console.log(`Retried ${successfulRetries}/${failedLogs.length} failed logs`);
    }
  } catch (error) {
    console.error('Failed to retry failed logs:', error);
  }
};

// Custom hook for AI field changes
export const useAIFieldLogging = (fieldName: string, contextId: string, contextType: 'customer' | 'agency') => {
  const logFieldChange = useCallback(async (oldValue: any, newValue: any) => {
    const pattern = AI_FIELD_PATTERNS[fieldName];
    if (!pattern) return; // Not an AI-relevant field
    
    try {
      // Validate the data
      validateFieldData(fieldName, oldValue, newValue);
      
      const functions = getFunctions(app, 'us-central1');
      const logAIAction = httpsCallable(functions, 'logAIAction');
      
      await logAIAction({
        userId: 'current-user-id', // TODO: Get from auth context
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
      });
    } catch (error: any) {
      console.error('Failed to log AI field change:', error);
      
      // Handle CORS errors specifically
      if (error.code === 'functions/unavailable' || error.message.includes('CORS')) {
        console.error('CORS error in field logging:', error);
        // Fallback: store locally and retry later
        await storeFailedLog({
          fieldName,
          contextId,
          contextType,
          oldValue,
          newValue,
          error: error.message,
          timestamp: new Date()
        });
      }
      // Don't throw - field change should still work even if logging fails
    }
  }, [fieldName, contextId, contextType]);
  
  return logFieldChange;
};

// Check if a field is AI-relevant
export const isAIField = (fieldName: string): boolean => {
  return fieldName in AI_FIELD_PATTERNS;
};

// Get field metadata
export const getFieldMetadata = (fieldName: string) => {
  return AI_FIELD_PATTERNS[fieldName] || null;
}; 