import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onlyIgnoredFieldsChanged } from './utils/safeFunctionTemplate';
import { logAIAction } from './feedbackEngine';
import * as admin from 'firebase-admin';
import * as functionsV1 from 'firebase-functions';

// Firestore trigger: Log user creation
export const firestoreLogUserCreated = onDocumentCreated('users/{userId}', async (event) => {
  const userData = event.data?.data();
  const userId = event.params.userId;
  if (!userData) return;
  
  try {
    await logAIAction({
      userId: userData.createdBy || 'system',
      actionType: 'user_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'user.created',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'user',
      traitsAffected: null,
      aiTags: ['user', 'creation'],
      urgencyScore: 5,
      reason: `User "${userData.displayName || userData.email || 'Unknown'}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogUserCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log user update
export const firestoreLogUserUpdated = onDocumentUpdated('users/{userId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const userId = event.params.userId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'user_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'user.updated',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'user',
      traitsAffected: null,
      aiTags: ['user', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `User "${afterData.displayName || afterData.email || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogUserUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log user deletion
export const firestoreLogUserDeleted = onDocumentDeleted('users/{userId}', async (event) => {
  const userData = event.data?.data();
  const userId = event.params.userId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'user_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'user.deleted',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'user',
      traitsAffected: null,
      aiTags: ['user', 'deletion'],
      urgencyScore: 8,
      reason: `User "${userData?.displayName || userData?.email || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogUserDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency creation
export const firestoreLogAgencyCreated = onDocumentCreated('agencies/{agencyId}', async (event) => {
  const agencyData = event.data?.data();
  const agencyId = event.params.agencyId;
  if (!agencyData) return;
  
  try {
    await logAIAction({
      userId: agencyData.createdBy || 'system',
      actionType: 'agency_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency.created',
      targetType: 'agency',
      targetId: agencyId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['agency', 'creation'],
      urgencyScore: 5,
      reason: `Agency "${agencyData.name || 'Unknown'}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency updates
export const firestoreLogAgencyUpdated = onDocumentUpdated('agencies/{agencyId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const agencyId = event.params.agencyId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'agency_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency.updated',
      targetType: 'agency',
      targetId: agencyId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['agency', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Agency "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency deletion
export const firestoreLogAgencyDeleted = onDocumentDeleted('agencies/{agencyId}', async (event) => {
  const agencyData = event.data?.data();
  const agencyId = event.params.agencyId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'agency_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency.deleted',
      targetType: 'agency',
      targetId: agencyId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['agency', 'deletion'],
      urgencyScore: 8,
      reason: `Agency "${agencyData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log customer creation
export const firestoreLogCustomerCreated = onDocumentCreated('customers/{customerId}', async (event) => {
  const customerData = event.data?.data();
  const customerId = event.params.customerId;
  if (!customerData) return;
  
  try {
    await logAIAction({
      userId: customerData.createdBy || 'system',
      actionType: 'customer_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer.created',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['customer', 'creation'],
      urgencyScore: 5,
      reason: `Customer "${customerData.name || 'Unknown'}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer updates
export const firestoreLogCustomerUpdated = onDocumentUpdated('customers/{customerId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const customerId = event.params.customerId;
  
  if (!beforeData || !afterData) return;
  if (onlyIgnoredFieldsChanged(beforeData, afterData, ['updatedAt', 'lastUpdated', '_processingBy', '_processingAt'])) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'customer_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer.updated',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['customer', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Customer "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer deletion
export const firestoreLogCustomerDeleted = onDocumentDeleted('customers/{customerId}', async (event) => {
  const customerData = event.data?.data();
  const customerId = event.params.customerId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'customer_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer.deleted',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['customer', 'deletion'],
      urgencyScore: 8,
      reason: `Customer "${customerData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log assignment creation
export const firestoreLogAssignmentCreated = onDocumentCreated('assignments/{assignmentId}', async (event) => {
  const assignmentData = event.data?.data();
  const assignmentId = event.params.assignmentId;
  if (!assignmentData) return;
  
  try {
    await logAIAction({
      userId: assignmentData.createdBy || 'system',
      actionType: 'assignment_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'assignment.created',
      targetType: 'assignment',
      targetId: assignmentId,
      aiRelevant: true,
      contextType: 'assignment',
      traitsAffected: null,
      aiTags: ['assignment', 'creation'],
      urgencyScore: 6,
      reason: `Assignment created for worker "${assignmentData.workerId || 'Unknown'}" to job "${assignmentData.jobOrderId || 'Unknown'}"`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAssignmentCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log assignment updates
export const firestoreLogAssignmentUpdated = onDocumentUpdated('assignments/{assignmentId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const assignmentId = event.params.assignmentId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'assignment_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'assignment.updated',
      targetType: 'assignment',
      targetId: assignmentId,
      aiRelevant: true,
      contextType: 'assignment',
      traitsAffected: null,
      aiTags: ['assignment', 'update', ...changedFields],
      urgencyScore: 5,
      reason: `Assignment updated for worker "${afterData.workerId || 'Unknown'}": ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAssignmentUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log assignment deletion
export const firestoreLogAssignmentDeleted = onDocumentDeleted('assignments/{assignmentId}', async (event) => {
  const assignmentData = event.data?.data();
  const assignmentId = event.params.assignmentId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'assignment_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'assignment.deleted',
      targetType: 'assignment',
      targetId: assignmentId,
      aiRelevant: true,
      contextType: 'assignment',
      traitsAffected: null,
      aiTags: ['assignment', 'deletion'],
      urgencyScore: 7,
      reason: `Assignment deleted for worker "${assignmentData?.workerId || 'Unknown'}"`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAssignmentDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log conversation creation
export const firestoreLogConversationCreated = onDocumentCreated('conversations/{conversationId}', async (event) => {
  const conversationData = event.data?.data();
  const conversationId = event.params.conversationId;
  if (!conversationData) return;
  
  try {
    await logAIAction({
      userId: conversationData.createdBy || 'system',
      actionType: 'conversation_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'conversation.created',
      targetType: 'conversation',
      targetId: conversationId,
      aiRelevant: true,
      contextType: 'conversation',
      traitsAffected: null,
      aiTags: ['conversation', 'creation'],
      urgencyScore: 4,
      reason: `Conversation created between "${conversationData.participants?.join(', ') || 'Unknown'}"`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogConversationCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log conversation updates
const IGNORE_FIELDS_COMMON = ['updatedAt', 'lastUpdated', '_processingBy', '_processingAt'];

export const firestoreLogConversationUpdated = onDocumentUpdated('conversations/{conversationId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const conversationId = event.params.conversationId;
  
  if (!beforeData || !afterData) return;
  // Skip updates that only changed bookkeeping/meta fields
  if (onlyIgnoredFieldsChanged(beforeData, afterData, IGNORE_FIELDS_COMMON)) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'conversation_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'conversation.updated',
      targetType: 'conversation',
      targetId: conversationId,
      aiRelevant: true,
      contextType: 'conversation',
      traitsAffected: null,
      aiTags: ['conversation', 'update', ...changedFields],
      urgencyScore: 3,
      reason: `Conversation updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogConversationUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log conversation deletion
export const firestoreLogConversationDeleted = onDocumentDeleted('conversations/{conversationId}', async (event) => {
  const conversationId = event.params.conversationId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'conversation_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'conversation.deleted',
      targetType: 'conversation',
      targetId: conversationId,
      aiRelevant: true,
      contextType: 'conversation',
      traitsAffected: null,
      aiTags: ['conversation', 'deletion'],
      urgencyScore: 6,
      reason: `Conversation deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogConversationDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log job order creation
export const firestoreLogJobOrderCreated = onDocumentCreated('jobOrders/{jobOrderId}', async (event) => {
  const jobOrderData = event.data?.data();
  const jobOrderId = event.params.jobOrderId;
  if (!jobOrderData) return;
  
  try {
    await logAIAction({
      userId: jobOrderData.createdBy || 'system',
      actionType: 'job_order_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'jobOrder.created',
      targetType: 'jobOrder',
      targetId: jobOrderId,
      aiRelevant: true,
      contextType: 'jobOrder',
      traitsAffected: null,
      aiTags: ['jobOrder', 'creation'],
      urgencyScore: 6,
      reason: `Job order "${jobOrderData.title || 'Unknown'}" created for customer "${jobOrderData.customerId || 'Unknown'}"`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogJobOrderCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log job order updates
export const firestoreLogJobOrderUpdated = onDocumentUpdated('jobOrders/{jobOrderId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const jobOrderId = event.params.jobOrderId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'job_order_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'jobOrder.updated',
      targetType: 'jobOrder',
      targetId: jobOrderId,
      aiRelevant: true,
      contextType: 'jobOrder',
      traitsAffected: null,
      aiTags: ['jobOrder', 'update', ...changedFields],
      urgencyScore: 5,
      reason: `Job order "${afterData.title || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogJobOrderUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log job order deletion
export const firestoreLogJobOrderDeleted = onDocumentDeleted('jobOrders/{jobOrderId}', async (event) => {
  const jobOrderData = event.data?.data();
  const jobOrderId = event.params.jobOrderId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'job_order_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'jobOrder.deleted',
      targetType: 'jobOrder',
      targetId: jobOrderId,
      aiRelevant: true,
      contextType: 'jobOrder',
      traitsAffected: null,
      aiTags: ['jobOrder', 'deletion'],
      urgencyScore: 7,
      reason: `Job order "${jobOrderData?.title || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogJobOrderDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log campaign creation
export const firestoreLogCampaignCreated = onDocumentCreated('campaigns/{campaignId}', async (event) => {
  const campaignData = event.data?.data();
  const campaignId = event.params.campaignId;
  if (!campaignData) return;
  
  try {
    await logAIAction({
      userId: campaignData.createdBy || 'system',
      actionType: 'campaign_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'campaign.created',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'creation'],
      urgencyScore: 5,
      reason: `Campaign "${campaignData.name || 'Unknown'}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCampaignCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log campaign updates
export const firestoreLogCampaignUpdated = onDocumentUpdated('campaigns/{campaignId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const campaignId = event.params.campaignId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'campaign_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'campaign.updated',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Campaign "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCampaignUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log campaign deletion
export const firestoreLogCampaignDeleted = onDocumentDeleted('campaigns/{campaignId}', async (event) => {
  const campaignData = event.data?.data();
  const campaignId = event.params.campaignId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'campaign_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'campaign.deleted',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'deletion'],
      urgencyScore: 6,
      reason: `Campaign "${campaignData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCampaignDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log motivation creation
export const firestoreLogMotivationCreated = onDocumentCreated('motivations/{motivationId}', async (event) => {
  const motivationData = event.data?.data();
  const motivationId = event.params.motivationId;
  if (!motivationData) return;
  
  try {
    await logAIAction({
      userId: motivationData.createdBy || 'system',
      actionType: 'motivation_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'motivation.created',
      targetType: 'motivation',
      targetId: motivationId,
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: ['motivation', 'creation'],
      urgencyScore: 4,
      reason: `Motivation message created: "${motivationData.title || 'Unknown'}"`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogMotivationCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log motivation updates
export const firestoreLogMotivationUpdated = onDocumentUpdated('motivations/{motivationId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const motivationId = event.params.motivationId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'motivation_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'motivation.updated',
      targetType: 'motivation',
      targetId: motivationId,
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: ['motivation', 'update', ...changedFields],
      urgencyScore: 3,
      reason: `Motivation message updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogMotivationUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log motivation deletion
export const firestoreLogMotivationDeleted = onDocumentDeleted('motivations/{motivationId}', async (event) => {
  const motivationId = event.params.motivationId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'motivation_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'motivation.deleted',
      targetType: 'motivation',
      targetId: motivationId,
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: ['motivation', 'deletion'],
      urgencyScore: 5,
      reason: `Motivation message deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogMotivationDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log message creation
export const firestoreLogMessageCreated = onDocumentCreated('conversations/{conversationId}/messages/{messageId}', async (event) => {
  const messageData = event.data?.data();
  const messageId = event.params.messageId;
  const conversationId = event.params.conversationId;
  if (!messageData) return;
  
  try {
    await logAIAction({
      userId: messageData.senderId || 'system',
      actionType: 'message_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'message.created',
      targetType: 'message',
      targetId: messageId,
      aiRelevant: true,
      contextType: 'conversation',
      traitsAffected: null,
      aiTags: ['message', 'creation', messageData.type || 'text', 'conversation'],
      urgencyScore: 6,
      reason: `Message sent in conversation ${conversationId}: "${messageData.content?.substring(0, 50) || 'Unknown'}..."`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogMessageCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log message updates
export const firestoreLogMessageUpdated = onDocumentUpdated('conversations/{conversationId}/messages/{messageId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const messageId = event.params.messageId;
  const conversationId = event.params.conversationId;
  
  if (!beforeData || !afterData) return;
  if (onlyIgnoredFieldsChanged(beforeData, afterData, IGNORE_FIELDS_COMMON)) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.senderId || 'system',
      actionType: 'message_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'message.updated',
      targetType: 'message',
      targetId: messageId,
      aiRelevant: true,
      contextType: 'conversation',
      traitsAffected: null,
      aiTags: ['message', 'update', ...changedFields, 'conversation'],
      urgencyScore: 4,
      reason: `Message updated in conversation ${conversationId}: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogMessageUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log message deletion
export const firestoreLogMessageDeleted = onDocumentDeleted('conversations/{conversationId}/messages/{messageId}', async (event) => {
  const messageData = event.data?.data();
  const messageId = event.params.messageId;
  const conversationId = event.params.conversationId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'message_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'message.deleted',
      targetType: 'message',
      targetId: messageId,
      aiRelevant: true,
      contextType: 'conversation',
      traitsAffected: null,
      aiTags: ['message', 'deletion', 'conversation'],
      urgencyScore: 7,
      reason: `Message deleted from conversation ${conversationId}: "${messageData?.content?.substring(0, 50) || 'Unknown'}..."`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogMessageDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log shift creation
export const firestoreLogShiftCreated = onDocumentCreated('jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  const shiftData = event.data?.data();
  const shiftId = event.params.shiftId;
  const jobOrderId = event.params.jobOrderId;
  if (!shiftData) return;
  
  try {
    await logAIAction({
      userId: shiftData.createdBy || 'system',
      actionType: 'shift_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'shift.created',
      targetType: 'shift',
      targetId: shiftId,
      aiRelevant: true,
      contextType: 'job_order',
      traitsAffected: null,
      aiTags: ['shift', 'creation', shiftData.status || 'scheduled', 'job_order'],
      urgencyScore: 6,
      reason: `Shift created for job order ${jobOrderId}: ${shiftData.startTime || 'Unknown'} - ${shiftData.endTime || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogShiftCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log shift updates
export const firestoreLogShiftUpdated = onDocumentUpdated('jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const shiftId = event.params.shiftId;
  const jobOrderId = event.params.jobOrderId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    // Check if status changed (high priority for shifts)
    const statusChanged = beforeData.status !== afterData.status;
    const urgencyScore = statusChanged ? 7 : 5;
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'shift_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'shift.updated',
      targetType: 'shift',
      targetId: shiftId,
      aiRelevant: true,
      contextType: 'job_order',
      traitsAffected: null,
      aiTags: ['shift', 'update', ...changedFields, afterData.status || 'unknown', 'job_order'],
      urgencyScore,
      reason: `Shift updated for job order ${jobOrderId}: ${changedFields.join(', ')}${statusChanged ? ` (Status: ${beforeData.status} → ${afterData.status})` : ''}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogShiftUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log shift deletion
export const firestoreLogShiftDeleted = onDocumentDeleted('jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  const shiftData = event.data?.data();
  const shiftId = event.params.shiftId;
  const jobOrderId = event.params.jobOrderId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'shift_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'shift.deleted',
      targetType: 'shift',
      targetId: shiftId,
      aiRelevant: true,
      contextType: 'job_order',
      traitsAffected: null,
      aiTags: ['shift', 'deletion', 'job_order'],
      urgencyScore: 8,
      reason: `Shift deleted from job order ${jobOrderId}: ${shiftData?.startTime || 'Unknown'} - ${shiftData?.endTime || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogShiftDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log user group creation
export const firestoreLogUserGroupCreated = onDocumentCreated('userGroups/{userGroupId}', async (event) => {
  const userGroupData = event.data?.data();
  const userGroupId = event.params.userGroupId;
  if (!userGroupData) return;
  
  try {
    await logAIAction({
      userId: userGroupData.createdBy || 'system',
      actionType: 'user_group_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'user_group.created',
      targetType: 'user_group',
      targetId: userGroupId,
      aiRelevant: true,
      contextType: 'user_group',
      traitsAffected: null,
      aiTags: ['user_group', 'creation', userGroupData.type || 'general'],
      urgencyScore: 5,
      reason: `User group "${userGroupData.name || 'Unknown'}" created for ${userGroupData.agencyId || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogUserGroupCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log user group updates
export const firestoreLogUserGroupUpdated = onDocumentUpdated('userGroups/{userGroupId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const userGroupId = event.params.userGroupId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'user_group_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'user_group.updated',
      targetType: 'user_group',
      targetId: userGroupId,
      aiRelevant: true,
      contextType: 'user_group',
      traitsAffected: null,
      aiTags: ['user_group', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `User group "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogUserGroupUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log user group deletion
export const firestoreLogUserGroupDeleted = onDocumentDeleted('userGroups/{userGroupId}', async (event) => {
  const userGroupData = event.data?.data();
  const userGroupId = event.params.userGroupId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'user_group_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'user_group.deleted',
      targetType: 'user_group',
      targetId: userGroupId,
      aiRelevant: true,
      contextType: 'user_group',
      traitsAffected: null,
      aiTags: ['user_group', 'deletion'],
      urgencyScore: 7,
      reason: `User group "${userGroupData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogUserGroupDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log location creation
export const firestoreLogLocationCreated = onDocumentCreated('locations/{locationId}', async (event) => {
  const locationData = event.data?.data();
  const locationId = event.params.locationId;
  if (!locationData) return;
  
  try {
    await logAIAction({
      userId: locationData.createdBy || 'system',
      actionType: 'location_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'location.created',
      targetType: 'location',
      targetId: locationId,
      aiRelevant: true,
      contextType: 'location',
      traitsAffected: null,
      aiTags: ['location', 'creation', locationData.type || 'general'],
      urgencyScore: 5,
      reason: `Location "${locationData.name || 'Unknown'}" created at ${locationData.address || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogLocationCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log location updates
export const firestoreLogLocationUpdated = onDocumentUpdated('locations/{locationId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const locationId = event.params.locationId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'location_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'location.updated',
      targetType: 'location',
      targetId: locationId,
      aiRelevant: true,
      contextType: 'location',
      traitsAffected: null,
      aiTags: ['location', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Location "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogLocationUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log location deletion
export const firestoreLogLocationDeleted = onDocumentDeleted('locations/{locationId}', async (event) => {
  const locationData = event.data?.data();
  const locationId = event.params.locationId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'location_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'location.deleted',
      targetType: 'location',
      targetId: locationId,
      aiRelevant: true,
      contextType: 'location',
      traitsAffected: null,
      aiTags: ['location', 'deletion'],
      urgencyScore: 7,
      reason: `Location "${locationData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogLocationDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log notification creation
export const firestoreLogNotificationCreated = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const notificationData = event.data?.data();
  const notificationId = event.params.notificationId;
  if (!notificationData) return;
  
  try {
    await logAIAction({
      userId: notificationData.createdBy || 'system',
      actionType: 'notification_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'notification.created',
      targetType: 'notification',
      targetId: notificationId,
      aiRelevant: true,
      contextType: 'notification',
      traitsAffected: null,
      aiTags: ['notification', 'creation', notificationData.type || 'general', notificationData.priority || 'normal'],
      urgencyScore: notificationData.priority === 'high' ? 7 : 5,
      reason: `Notification "${notificationData.title || 'Unknown'}" created for ${notificationData.recipientId || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogNotificationCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log notification updates
export const firestoreLogNotificationUpdated = onDocumentUpdated('notifications/{notificationId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const notificationId = event.params.notificationId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    // Check if status changed (high priority for notifications)
    const statusChanged = beforeData.status !== afterData.status;
    const urgencyScore = statusChanged ? 6 : 4;
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'notification_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'notification.updated',
      targetType: 'notification',
      targetId: notificationId,
      aiRelevant: true,
      contextType: 'notification',
      traitsAffected: null,
      aiTags: ['notification', 'update', ...changedFields, afterData.status || 'unknown'],
      urgencyScore,
      reason: `Notification "${afterData.title || 'Unknown'}" updated: ${changedFields.join(', ')}${statusChanged ? ` (Status: ${beforeData.status} → ${afterData.status})` : ''}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogNotificationUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log notification deletion
export const firestoreLogNotificationDeleted = onDocumentDeleted('notifications/{notificationId}', async (event) => {
  const notificationData = event.data?.data();
  const notificationId = event.params.notificationId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'notification_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'notification.deleted',
      targetType: 'notification',
      targetId: notificationId,
      aiRelevant: true,
      contextType: 'notification',
      traitsAffected: null,
      aiTags: ['notification', 'deletion'],
      urgencyScore: 6,
      reason: `Notification "${notificationData?.title || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogNotificationDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log setting creation
export const firestoreLogSettingCreated = onDocumentCreated('settings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  if (!settingData) return;
  
  try {
    await logAIAction({
      userId: settingData.createdBy || 'system',
      actionType: 'setting_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'setting.created',
      targetType: 'setting',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'setting',
      traitsAffected: null,
      aiTags: ['setting', 'creation', settingData.category || 'general'],
      urgencyScore: 4,
      reason: `Setting "${settingData.name || 'Unknown'}" created for ${settingData.ownerId || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogSettingCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log setting updates
export const firestoreLogSettingUpdated = onDocumentUpdated('settings/{settingId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const settingId = event.params.settingId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'setting_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'setting.updated',
      targetType: 'setting',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'setting',
      traitsAffected: null,
      aiTags: ['setting', 'update', ...changedFields],
      urgencyScore: 3,
      reason: `Setting "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogSettingUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log setting deletion
export const firestoreLogSettingDeleted = onDocumentDeleted('settings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'setting_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'setting.deleted',
      targetType: 'setting',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'setting',
      traitsAffected: null,
      aiTags: ['setting', 'deletion'],
      urgencyScore: 5,
      reason: `Setting "${settingData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogSettingDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log task creation
export const firestoreLogTaskCreated = onDocumentCreated('tasks/{taskId}', async (event) => {
  const taskData = event.data?.data();
  const taskId = event.params.taskId;
  if (!taskData) return;
  
  try {
    await logAIAction({
      userId: taskData.createdBy || 'system',
      actionType: 'task_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'deal.task_created',
      targetType: 'task',
      targetId: taskData.dealId || taskId,
      aiRelevant: true,
      contextType: 'crm',
      traitsAffected: null,
      aiTags: ['task', 'creation', 'deal'],
      urgencyScore: taskData.priority === 'urgent' ? 8 : taskData.priority === 'high' ? 6 : 4,
      reason: `Task created: ${taskData.title}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTaskCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log task updates
export const firestoreLogTaskUpdated = onDocumentUpdated('tasks/{taskId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const taskId = event.params.taskId;
  
  if (!beforeData || !afterData) return;
  if (onlyIgnoredFieldsChanged(beforeData, afterData, [...IGNORE_FIELDS_COMMON, 'processingStartedAt', 'processingCompletedAt'])) return;
  
  try {
    // Determine what changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.createdBy || 'system',
      actionType: 'task_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'deal.task_updated',
      targetType: 'task',
      targetId: afterData.dealId || taskId,
      aiRelevant: true,
      contextType: 'crm',
      traitsAffected: null,
      aiTags: ['task', 'update', 'deal', ...changedFields],
      urgencyScore: afterData.priority === 'urgent' ? 8 : afterData.priority === 'high' ? 6 : 4,
      reason: `Task updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTaskUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log AI log creation (meta-logging)
export const firestoreLogAILogCreated = onDocumentCreated('ai_logs/{logId}', async (event) => {
  const logData = event.data?.data();
  const logId = event.params.logId;
  if (!logData) return;
  
  // Prevent feedback loop: skip any log where sourceModule is 'FirestoreTrigger'
  if (logData.sourceModule === 'FirestoreTrigger') {
    return { success: true };
  }
  
  try {
    await logAIAction({
      userId: logData.userId || 'system',
      actionType: 'ai_log_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'ai_log.created',
      targetType: 'ai_log',
      targetId: logId,
      aiRelevant: true,
      contextType: 'meta_logging',
      traitsAffected: null,
      aiTags: ['ai_log', 'meta_logging', 'creation', logData.actionType || 'unknown'],
      urgencyScore: 3,
      reason: `AI log created: ${logData.actionType || 'Unknown'} for ${logData.targetType || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAILogCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log AI log updates (meta-logging)
export const firestoreLogAILogUpdated = onDocumentUpdated('ai_logs/{logId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const logId = event.params.logId;
  
  if (!beforeData || !afterData) return;
  
  // Prevent feedback loop: skip any log where sourceModule is 'FirestoreTrigger'
  if (afterData.sourceModule === 'FirestoreTrigger') {
    return { success: true };
  }
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.userId || 'system',
      actionType: 'ai_log_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'ai_log.updated',
      targetType: 'ai_log',
      targetId: logId,
      aiRelevant: true,
      contextType: 'meta_logging',
      traitsAffected: null,
      aiTags: ['ai_log', 'meta_logging', 'update', ...changedFields],
      urgencyScore: 2,
      reason: `AI log updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAILogUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log AI log deletion (meta-logging)
export const firestoreLogAILogDeleted = onDocumentDeleted('ai_logs/{logId}', async (event) => {
  const logData = event.data?.data();
  const logId = event.params.logId;
  
  // Prevent feedback loop: skip any log where sourceModule is 'FirestoreTrigger'
  if (logData?.sourceModule === 'FirestoreTrigger') {
    return { success: true };
  }
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'ai_log_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'ai_log.deleted',
      targetType: 'ai_log',
      targetId: logId,
      aiRelevant: true,
      contextType: 'meta_logging',
      traitsAffected: null,
      aiTags: ['ai_log', 'meta_logging', 'deletion'],
      urgencyScore: 4,
      reason: `AI log deleted: ${logData?.actionType || 'Unknown'}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAILogDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log agency contact creation
export const firestoreLogAgencyContactCreated = onDocumentCreated('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  const contactData = event.data?.data();
  const contactId = event.params.contactId;
  const agencyId = event.params.agencyId;
  if (!contactData) return;
  
  try {
    await logAIAction({
      userId: contactData.createdBy || 'system',
      actionType: 'agency_contact_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency_contact.created',
      targetType: 'contact',
      targetId: contactId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['contact', 'agency', 'creation', contactData.role || 'general'],
      urgencyScore: 5,
      reason: `Contact "${contactData.name || 'Unknown'}" added to agency ${agencyId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyContactCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency contact updates
export const firestoreLogAgencyContactUpdated = onDocumentUpdated('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const contactId = event.params.contactId;
  const agencyId = event.params.agencyId;
  
  if (!beforeData || !afterData) return;
  if (onlyIgnoredFieldsChanged(beforeData, afterData, ['updatedAt', 'lastUpdated', '_processingBy', '_processingAt'])) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'agency_contact_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency_contact.updated',
      targetType: 'contact',
      targetId: contactId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['contact', 'agency', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Contact "${afterData.name || 'Unknown'}" updated in agency ${agencyId}: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyContactUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency contact deletion
export const firestoreLogAgencyContactDeleted = onDocumentDeleted('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  const contactData = event.data?.data();
  const contactId = event.params.contactId;
  const agencyId = event.params.agencyId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'agency_contact_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency_contact.deleted',
      targetType: 'contact',
      targetId: contactId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['contact', 'agency', 'deletion'],
      urgencyScore: 6,
      reason: `Contact "${contactData?.name || 'Unknown'}" removed from agency ${agencyId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyContactDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log global AI settings creation
export const firestoreLogGlobalAISettingsCreated = onDocumentCreated('appAiSettings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  if (!settingData) return;
  
  try {
    await logAIAction({
      userId: settingData.createdBy || 'system',
      actionType: 'global_ai_settings_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'ai_settings.created',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'ai_settings',
      traitsAffected: null,
      aiTags: ['ai_settings', 'global', 'creation', settingData.type || 'general'],
      urgencyScore: 6,
      reason: `Global AI settings "${settingData.name || settingId}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogGlobalAISettingsCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log global AI settings updates
export const firestoreLogGlobalAISettingsUpdated = onDocumentUpdated('appAiSettings/{settingId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const settingId = event.params.settingId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'global_ai_settings_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'ai_settings.updated',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'ai_settings',
      traitsAffected: null,
      aiTags: ['ai_settings', 'global', 'update', ...changedFields],
      urgencyScore: 5,
      reason: `Global AI settings "${afterData.name || settingId}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogGlobalAISettingsUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log global AI settings deletion
export const firestoreLogGlobalAISettingsDeleted = onDocumentDeleted('appAiSettings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'global_ai_settings_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'ai_settings.deleted',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'ai_settings',
      traitsAffected: null,
      aiTags: ['ai_settings', 'global', 'deletion'],
      urgencyScore: 7,
      reason: `Global AI settings "${settingData?.name || settingId}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogGlobalAISettingsDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer AI settings creation
export const firestoreLogCustomerAISettingsCreated = onDocumentCreated('customers/{customerId}/aiSettings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  const customerId = event.params.customerId;
  if (!settingData) return;
  
  try {
    await logAIAction({
      userId: settingData.createdBy || 'system',
      actionType: 'customer_ai_settings_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer_ai_settings.created',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['ai_settings', 'customer', 'creation', settingData.type || 'general'],
      urgencyScore: 6,
      reason: `Customer AI settings "${settingData.name || settingId}" created for customer ${customerId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerAISettingsCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer AI settings updates
export const firestoreLogCustomerAISettingsUpdated = onDocumentUpdated('customers/{customerId}/aiSettings/{settingId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const settingId = event.params.settingId;
  const customerId = event.params.customerId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'customer_ai_settings_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer_ai_settings.updated',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['ai_settings', 'customer', 'update', ...changedFields],
      urgencyScore: 5,
      reason: `Customer AI settings "${afterData.name || settingId}" updated for customer ${customerId}: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerAISettingsUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer AI settings deletion
export const firestoreLogCustomerAISettingsDeleted = onDocumentDeleted('customers/{customerId}/aiSettings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  const customerId = event.params.customerId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'customer_ai_settings_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer_ai_settings.deleted',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['ai_settings', 'customer', 'deletion'],
      urgencyScore: 7,
      reason: `Customer AI settings "${settingData?.name || settingId}" deleted for customer ${customerId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerAISettingsDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency AI settings creation
export const firestoreLogAgencyAISettingsCreated = onDocumentCreated('agencies/{agencyId}/aiSettings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  const agencyId = event.params.agencyId;
  if (!settingData) return;
  
  try {
    await logAIAction({
      userId: settingData.createdBy || 'system',
      actionType: 'agency_ai_settings_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency_ai_settings.created',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['ai_settings', 'agency', 'creation', settingData.type || 'general'],
      urgencyScore: 6,
      reason: `Agency AI settings "${settingData.name || settingId}" created for agency ${agencyId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyAISettingsCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency AI settings updates
export const firestoreLogAgencyAISettingsUpdated = onDocumentUpdated('agencies/{agencyId}/aiSettings/{settingId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const settingId = event.params.settingId;
  const agencyId = event.params.agencyId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'agency_ai_settings_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency_ai_settings.updated',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['ai_settings', 'agency', 'update', ...changedFields],
      urgencyScore: 5,
      reason: `Agency AI settings "${afterData.name || settingId}" updated for agency ${agencyId}: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyAISettingsUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log agency AI settings deletion
export const firestoreLogAgencyAISettingsDeleted = onDocumentDeleted('agencies/{agencyId}/aiSettings/{settingId}', async (event) => {
  const settingData = event.data?.data();
  const settingId = event.params.settingId;
  const agencyId = event.params.agencyId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'agency_ai_settings_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'agency_ai_settings.deleted',
      targetType: 'ai_settings',
      targetId: settingId,
      aiRelevant: true,
      contextType: 'agency',
      traitsAffected: null,
      aiTags: ['ai_settings', 'agency', 'deletion'],
      urgencyScore: 7,
      reason: `Agency AI settings "${settingData?.name || settingId}" deleted for agency ${agencyId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogAgencyAISettingsDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Firestore trigger: Log department creation
export const firestoreLogDepartmentCreated = onDocumentCreated('departments/{departmentId}', async (event) => {
  const departmentData = event.data?.data();
  const departmentId = event.params.departmentId;
  if (!departmentData) return;
  
  try {
    await logAIAction({
      userId: departmentData.createdBy || 'system',
      actionType: 'department_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'department.created',
      targetType: 'department',
      targetId: departmentId,
      aiRelevant: true,
      contextType: 'organization',
      traitsAffected: null,
      aiTags: ['department', 'creation', departmentData.customerId || 'global'],
      urgencyScore: 5,
      reason: `Department "${departmentData.name || 'Unknown'}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogDepartmentCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log department updates
export const firestoreLogDepartmentUpdated = onDocumentUpdated('departments/{departmentId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const departmentId = event.params.departmentId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'department_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'department.updated',
      targetType: 'department',
      targetId: departmentId,
      aiRelevant: true,
      contextType: 'organization',
      traitsAffected: null,
      aiTags: ['department', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Department "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogDepartmentUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log department deletion
export const firestoreLogDepartmentDeleted = onDocumentDeleted('departments/{departmentId}', async (event) => {
  const departmentData = event.data?.data();
  const departmentId = event.params.departmentId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'department_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'department.deleted',
      targetType: 'department',
      targetId: departmentId,
      aiRelevant: true,
      contextType: 'organization',
      traitsAffected: null,
      aiTags: ['department', 'deletion'],
      urgencyScore: 7,
      reason: `Department "${departmentData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogDepartmentDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer department creation
export const firestoreLogCustomerDepartmentCreated = onDocumentCreated('customers/{customerId}/departments/{departmentId}', async (event) => {
  const departmentData = event.data?.data();
  const departmentId = event.params.departmentId;
  const customerId = event.params.customerId;
  if (!departmentData) return;
  
  try {
    await logAIAction({
      userId: departmentData.createdBy || 'system',
      actionType: 'customer_department_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer_department.created',
      targetType: 'department',
      targetId: departmentId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['department', 'customer', 'creation'],
      urgencyScore: 5,
      reason: `Department "${departmentData.name || 'Unknown'}" created for customer ${customerId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerDepartmentCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer department updates
export const firestoreLogCustomerDepartmentUpdated = onDocumentUpdated('customers/{customerId}/departments/{departmentId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const departmentId = event.params.departmentId;
  const customerId = event.params.customerId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'customer_department_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer_department.updated',
      targetType: 'department',
      targetId: departmentId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['department', 'customer', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Department "${afterData.name || 'Unknown'}" updated for customer ${customerId}: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerDepartmentUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log customer department deletion
export const firestoreLogCustomerDepartmentDeleted = onDocumentDeleted('customers/{customerId}/departments/{departmentId}', async (event) => {
  const departmentData = event.data?.data();
  const departmentId = event.params.departmentId;
  const customerId = event.params.customerId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'customer_department_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'customer_department.deleted',
      targetType: 'department',
      targetId: departmentId,
      aiRelevant: true,
      contextType: 'customer',
      traitsAffected: null,
      aiTags: ['department', 'customer', 'deletion'],
      urgencyScore: 7,
      reason: `Department "${departmentData?.name || 'Unknown'}" deleted for customer ${customerId}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogCustomerDepartmentDeleted error:', error);
    return { success: false, error: error.message };
  }
}); 

// Simple test trigger to verify user updates are working
export const testUserUpdate = onDocumentUpdated('users/{userId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const userId = event.params.userId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Write to a simple test collection instead of ai_logs
    await admin.firestore().collection('test_logs').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId: userId,
      action: 'user_updated',
      changedFields: Object.keys(afterData).filter(key => 
        JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
      ),
      beforeData: beforeData,
      afterData: afterData
    });
    
    // Also test the logAIAction function
    try {
      await logAIAction({
        userId: afterData.updatedBy || 'system',
        actionType: 'user_updated_test',
        sourceModule: 'FirestoreTrigger',
        success: true,
        eventType: 'user.updated',
        targetType: 'user',
        targetId: userId,
        aiRelevant: true,
        contextType: 'user',
        traitsAffected: null,
        aiTags: ['user', 'update', 'test'],
        urgencyScore: 4,
        reason: `Test: User "${afterData.displayName || afterData.email || 'Unknown'}" updated`,
        versionTag: 'v1',
        latencyMs: 0
      });
      console.log(`Test trigger: AI log written for user ${userId}`);
    } catch (logError: any) {
      console.error('Test trigger: AI log error:', logError);
      await admin.firestore().collection('test_logs').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        userId: userId,
        action: 'ai_log_error',
        error: logError.message,
        stack: logError.stack
      });
    }
    
    console.log(`Test trigger: User ${userId} updated successfully`);
    return { success: true };
  } catch (error: any) {
    console.error('testUserUpdate error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant creation
export const firestoreLogTenantCreated = onDocumentCreated('tenants/{tenantId}', async (event) => {
  const tenantData = event.data?.data();
  const tenantId = event.params.tenantId;
  if (!tenantData) return;
  
  try {
    // Auto-create Flex division if hrxFlex is enabled
    if (tenantData.hrxFlex === true) {
      try {
        await admin.firestore()
          .collection('tenants')
          .doc(tenantId)
          .collection('divisions')
          .doc('auto_flex')
          .set({
            name: 'Flex',
            shortcode: 'FLEX',
            type: 'System',
            description: 'System-managed division for workers with securityLevel: "Flex"',
            isSystem: true,
            autoAssignRules: {
              securityLevel: 'Flex'
            },
            status: 'Active',
            tags: ['system', 'flex', 'auto-managed'],
            externalIds: {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        
        console.log(`Auto-created Flex division for tenant ${tenantId}`);
      } catch (flexError: any) {
        console.error(`Failed to create Flex division for tenant ${tenantId}:`, flexError);
        // Don't fail the entire operation if Flex division creation fails
      }
    }

    await logAIAction({
      userId: tenantData.createdBy || 'system',
      actionType: 'tenant_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.created',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'creation', tenantData.hrxFlex ? 'flex_enabled' : 'flex_disabled'],
      urgencyScore: 5,
      reason: `Tenant "${tenantData.name || 'Unknown'}" created${tenantData.hrxFlex ? ' with Flex division enabled' : ''}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant updates
export const firestoreLogTenantUpdated = onDocumentUpdated('tenants/{tenantId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const tenantId = event.params.tenantId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'tenant_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.updated',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'update', ...changedFields],
      urgencyScore: 4,
      reason: `Tenant "${afterData.name || 'Unknown'}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant deletion
export const firestoreLogTenantDeleted = onDocumentDeleted('tenants/{tenantId}', async (event) => {
  const tenantData = event.data?.data();
  const tenantId = event.params.tenantId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'tenant_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.deleted',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'deletion'],
      urgencyScore: 8,
      reason: `Tenant "${tenantData?.name || 'Unknown'}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant contact creation
export const firestoreLogTenantContactCreated = onDocumentCreated('tenants/{tenantId}/contacts/{contactId}', async (event) => {
  const contactData = event.data?.data();
  const contactId = event.params.contactId;
  if (!contactData) return;
  
  try {
    await logAIAction({
      userId: contactData.createdBy || 'system',
      actionType: 'tenant_contact_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.contact.created',
      targetType: 'contact',
      targetId: contactId,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'contact', 'creation'],
      urgencyScore: 3,
      reason: `Tenant contact "${contactData.firstName || 'Unknown'} ${contactData.lastName || ''}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantContactCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant contact updates
export const firestoreLogTenantContactUpdated = onDocumentUpdated('tenants/{tenantId}/contacts/{contactId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const contactId = event.params.contactId;
  
  if (!beforeData || !afterData) return;
  if (onlyIgnoredFieldsChanged(beforeData, afterData, ['updatedAt', 'lastUpdated', '_processingBy', '_processingAt'])) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'tenant_contact_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.contact.updated',
      targetType: 'contact',
      targetId: contactId,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'contact', 'update', ...changedFields],
      urgencyScore: 2,
      reason: `Tenant contact "${afterData.firstName || 'Unknown'} ${afterData.lastName || ''}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantContactUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant contact deletion
export const firestoreLogTenantContactDeleted = onDocumentDeleted('tenants/{tenantId}/contacts/{contactId}', async (event) => {
  const contactData = event.data?.data();
  const contactId = event.params.contactId;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'tenant_contact_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.contact.deleted',
      targetType: 'contact',
      targetId: contactId,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'contact', 'deletion'],
      urgencyScore: 6,
      reason: `Tenant contact "${contactData?.firstName || 'Unknown'} ${contactData?.lastName || ''}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantContactDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant AI settings creation
export const firestoreLogTenantAISettingsCreated = onDocumentCreated('tenants/{tenantId}/aiSettings/{settingName}', async (event) => {
  const settingsData = event.data?.data();
  const settingName = event.params.settingName;
  if (!settingsData) return;
  
  try {
    await logAIAction({
      userId: settingsData.createdBy || 'system',
      actionType: 'tenant_ai_settings_created',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.ai_settings.created',
      targetType: 'ai_settings',
      targetId: settingName,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'ai_settings', 'creation'],
      urgencyScore: 4,
      reason: `Tenant AI settings "${settingName}" created`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantAISettingsCreated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant AI settings updates
export const firestoreLogTenantAISettingsUpdated = onDocumentUpdated('tenants/{tenantId}/aiSettings/{settingName}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const settingName = event.params.settingName;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Determine what fields changed
    const changedFields = Object.keys(afterData).filter(key => 
      JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
    );
    
    await logAIAction({
      userId: afterData.updatedBy || 'system',
      actionType: 'tenant_ai_settings_updated',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.ai_settings.updated',
      targetType: 'ai_settings',
      targetId: settingName,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'ai_settings', 'update', ...changedFields],
      urgencyScore: 3,
      reason: `Tenant AI settings "${settingName}" updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantAISettingsUpdated error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Log tenant AI settings deletion
export const firestoreLogTenantAISettingsDeleted = onDocumentDeleted('tenants/{tenantId}/aiSettings/{settingName}', async (event) => {
  const settingName = event.params.settingName;
  
  try {
    await logAIAction({
      userId: 'system',
      actionType: 'tenant_ai_settings_deleted',
      sourceModule: 'FirestoreTrigger',
      success: true,
      eventType: 'tenant.ai_settings.deleted',
      targetType: 'ai_settings',
      targetId: settingName,
      aiRelevant: true,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'ai_settings', 'deletion'],
      urgencyScore: 7,
      reason: `Tenant AI settings "${settingName}" deleted`,
      versionTag: 'v1',
      latencyMs: 0
    });
    return { success: true };
  } catch (error: any) {
    console.error('firestoreLogTenantAISettingsDeleted error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Auto-assign Flex workers to Flex division
export const firestoreAutoAssignFlexWorker = onDocumentCreated('users/{userId}', async (event) => {
  const userData = event.data?.data();
  const userId = event.params.userId;
  if (!userData) return;
  
  try {
    // Check if user has securityLevel "Flex" or employmentType "Flex"
    if ((userData.securityLevel === 'Flex' || userData.employmentType === 'Flex') && userData.tenantId) {
      try {
        // Check if tenant has hrxFlex enabled and Flex division exists
        const tenantDoc = await admin.firestore()
          .collection('tenants')
          .doc(userData.tenantId)
          .get();
        
        if (tenantDoc.exists && tenantDoc.data()?.hrxFlex === true) {
          // Check if Flex division exists
          const flexDivisionDoc = await admin.firestore()
            .collection('tenants')
            .doc(userData.tenantId)
            .collection('divisions')
            .doc('auto_flex')
            .get();
          
          if (flexDivisionDoc.exists) {
            // Add user to Flex division
            await admin.firestore()
              .collection('tenants')
              .doc(userData.tenantId)
              .collection('divisions')
              .doc('auto_flex')
              .update({
                memberIds: admin.firestore.FieldValue.arrayUnion(userId),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            
            // Update user's divisionId
            await admin.firestore()
              .collection('users')
              .doc(userId)
              .update({
                divisionId: 'auto_flex',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            
            console.log(`Auto-assigned user ${userId} to Flex division in tenant ${userData.tenantId}`);
            
            // Log the auto-assignment
            await logAIAction({
              userId: 'system',
              actionType: 'flex_worker_auto_assigned',
              sourceModule: 'FirestoreTrigger',
              success: true,
              eventType: 'user.flex_auto_assigned',
              targetType: 'user',
              targetId: userId,
              aiRelevant: true,
              contextType: 'user',
              traitsAffected: null,
              aiTags: ['user', 'flex', 'auto_assignment', 'division'],
              urgencyScore: 3,
              reason: `User "${userData.firstName || ''} ${userData.lastName || ''}" automatically assigned to Flex division`,
              versionTag: 'v1',
              latencyMs: 0
            });
          }
        }
      } catch (assignmentError: any) {
        console.error(`Failed to auto-assign user ${userId} to Flex division:`, assignmentError);
        // Don't fail the entire operation if auto-assignment fails
      }
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('firestoreAutoAssignFlexWorker error:', error);
    return { success: false, error: error.message };
  }
});

// Firestore trigger: Handle Flex worker updates
export const firestoreHandleFlexWorkerUpdate = onDocumentUpdated('users/{userId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const userId = event.params.userId;
  
  if (!beforeData || !afterData) return;
  
  try {
    // Check if securityLevel or employmentType changed to or from "Flex"
    const wasFlex = beforeData.securityLevel === 'Flex' || beforeData.employmentType === 'Flex';
    const isFlex = afterData.securityLevel === 'Flex' || afterData.employmentType === 'Flex';
    const tenantId = afterData.tenantId;
    
    if (wasFlex !== isFlex && tenantId) {
      try {
        // Check if tenant has hrxFlex enabled
        const tenantDoc = await admin.firestore()
          .collection('tenants')
          .doc(tenantId)
          .get();
        
        if (tenantDoc.exists && tenantDoc.data()?.hrxFlex === true) {
          const flexDivisionRef = admin.firestore()
            .collection('tenants')
            .doc(tenantId)
            .collection('divisions')
            .doc('auto_flex');
          
          if (isFlex) {
            // User became Flex - add to division
            await flexDivisionRef.update({
              memberIds: admin.firestore.FieldValue.arrayUnion(userId),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            
            await admin.firestore()
              .collection('users')
              .doc(userId)
              .update({
                divisionId: 'auto_flex',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            
            console.log(`User ${userId} became Flex - added to Flex division`);
          } else {
            // User is no longer Flex - remove from division
            await flexDivisionRef.update({
              memberIds: admin.firestore.FieldValue.arrayRemove(userId),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            
            // Clear divisionId if it was auto_flex
            if (afterData.divisionId === 'auto_flex') {
              await admin.firestore()
                .collection('users')
                .doc(userId)
                .update({
                  divisionId: null,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            
            console.log(`User ${userId} is no longer Flex - removed from Flex division`);
          }
          
          // Log the change
          await logAIAction({
            userId: afterData.updatedBy || 'system',
            actionType: isFlex ? 'flex_worker_added' : 'flex_worker_removed',
            sourceModule: 'FirestoreTrigger',
            success: true,
            eventType: isFlex ? 'user.flex_added' : 'user.flex_removed',
            targetType: 'user',
            targetId: userId,
            aiRelevant: true,
            contextType: 'user',
            traitsAffected: null,
            aiTags: ['user', 'flex', 'security_level_change', 'division'],
            urgencyScore: 4,
            reason: `User "${afterData.firstName || ''} ${afterData.lastName || ''}" ${isFlex ? 'added to' : 'removed from'} Flex division`,
            versionTag: 'v1',
            latencyMs: 0
          });
        }
      } catch (updateError: any) {
        console.error(`Failed to handle Flex worker update for user ${userId}:`, updateError);
        // Don't fail the entire operation if update fails
      }
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('firestoreHandleFlexWorkerUpdate error:', error);
    return { success: false, error: error.message };
  }
});

// -------------------------
// Associations Snapshot Fan-out Triggers (Phase 1)
// -------------------------

function isDualWriteEnabled(): boolean {
  try {
    const cfg = (functionsV1 as any).config?.() || {};
    const val = cfg?.flags?.enable_dual_write;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    if (typeof val === 'boolean') return val === true;
  } catch {
    // ignore
  }
  return true; // default on
}

function pickDefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = (obj as any)[k];
    if (v !== undefined && v !== null && v !== '') {
      (out as any)[k] = v;
    }
  });
  return out;
}

async function updateDealsForEntity(
  tenantId: string,
  idArrayField: 'companyIds' | 'contactIds' | 'salespersonIds' | 'locationIds',
  entityId: string,
  associationArrayField: 'companies' | 'contacts' | 'salespeople' | 'locations',
  snapshotData: Record<string, any>
) {
  const db = admin.firestore();
  const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
  const snapshot = await dealsRef.where(idArrayField as any, 'array-contains' as any, entityId).get();

  if (snapshot.empty) return;

  const batch = db.batch();

  snapshot.docs.forEach((dealDoc) => {
    const dealData: any = dealDoc.data() || {};
    const assocArr: any[] = (dealData.associations?.[associationArrayField] || []).slice();
    if (!Array.isArray(assocArr) || assocArr.length === 0) return;

    let changed = false;
    const updatedArr = assocArr.map((entry) => {
      if (typeof entry === 'string') {
        // keep string form as-is
        return entry;
      }
      if (entry && entry.id === entityId) {
        const existingSnapshot = entry.snapshot || {};
        const nextSnapshot = { ...existingSnapshot, ...snapshotData };
        changed = true;
        return { ...entry, snapshot: nextSnapshot };
      }
      return entry;
    });

    if (changed) {
      const nextAssociations = {
        ...(dealData.associations || {}),
        [associationArrayField]: updatedArr,
      };
      batch.update(dealDoc.ref, {
        associations: nextAssociations,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  await batch.commit();
}

// Company snapshot fan-out - FIXED WITH PROPER SAFEGUARDS
export const firestoreCompanySnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}', async (event) => {
  if (!isDualWriteEnabled()) return;
  
  const tenantId = event.params.tenantId as string;
  const companyId = event.params.companyId as string;
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  
  if (!after) return;

  // Check if relevant fields actually changed to prevent unnecessary updates
  const relevantFields = ['companyName', 'name', 'industry', 'city', 'state', 'companyPhone', 'phone', 'companyUrl', 'website', 'logo'];
  const hasRelevantChanges = !before || relevantFields.some(field => {
    const beforeValue = before[field];
    const afterValue = after[field];
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  });

  if (!hasRelevantChanges) {
    console.log('No relevant company fields changed, skipping deal association update');
    return;
  }

  const snap = pickDefined({
    name: after.companyName || after.name,
    industry: after.industry,
    city: after.city,
    state: after.state,
    phone: after.companyPhone || after.phone,
    companyUrl: after.companyUrl || after.website,
    logo: after.logo,
  });

  await updateDealsForEntity(tenantId, 'companyIds', companyId, 'companies', snap);
});

// Contact snapshot fan-out
export const firestoreContactSnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_contacts/{contactId}', async (event) => {
  if (!isDualWriteEnabled()) return;
  const tenantId = event.params.tenantId as string;
  const contactId = event.params.contactId as string;
  const after = event.data?.after.data();
  if (!after) return;

  const fullName = after.fullName || [after.firstName, after.lastName].filter(Boolean).join(' ').trim();
  const snap = pickDefined({
    fullName,
    firstName: after.firstName,
    lastName: after.lastName,
    email: after.email,
    phone: after.phone,
    title: after.title,
    companyId: after.companyId,
    companyName: after.companyName,
  });

  await updateDealsForEntity(tenantId, 'contactIds', contactId, 'contacts', snap);
});

// Location snapshot fan-out (company subcollection)
export const firestoreLocationSnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  if (!isDualWriteEnabled()) return;
  const tenantId = event.params.tenantId as string;
  const locationId = event.params.locationId as string;
  const after = event.data?.after.data();
  if (!after) return;

  const snap = pickDefined({
    name: after.nickname || after.name,
    addressLine1: after.address || after.addressLine1,
    city: after.city,
    state: after.state,
    zipCode: after.zipCode,
  });

  await updateDealsForEntity(tenantId, 'locationIds', locationId, 'locations', snap);
});

// Salesperson snapshot fan-out (user)
export const firestoreSalespersonSnapshotFanout = onDocumentUpdated('users/{userId}', async (event) => {
  if (!isDualWriteEnabled()) return;
  const userId = event.params.userId as string;
  const after = event.data?.after.data();
  const before = event.data?.before.data();
  if (!after) return;

  // Only process if crm_sales true or display fields changed
  const isSales = after.crm_sales === true;
  const changedDisplay = !before || ['displayName','firstName','lastName','email','phone'].some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!isSales && !changedDisplay) return;

  // Iterate tenants where user is active
  const tenantIds = Object.keys(after.tenantIds || {});
  const db = admin.firestore();
  const snapBase = pickDefined({
    displayName: after.displayName || [after.firstName, after.lastName].filter(Boolean).join(' ').trim() || (after.email ? after.email.split('@')[0] : undefined),
    firstName: after.firstName,
    lastName: after.lastName,
    email: after.email,
    phone: after.phone,
    department: after.department,
    jobTitle: after.jobTitle,
  });

  await Promise.all(
    tenantIds.map(async (tenantId) => {
      const status = after.tenantIds?.[tenantId]?.status;
      if (status !== 'active') return;
      const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
      const dealsSnap = await dealsRef.where('salespersonIds', 'array-contains' as any, userId).get();
      if (dealsSnap.empty) return;

      const batch = db.batch();
      dealsSnap.docs.forEach((dealDoc) => {
        const dealData: any = dealDoc.data() || {};
        const salesArr: any[] = (dealData.associations?.salespeople || []).slice();
        if (!Array.isArray(salesArr) || salesArr.length === 0) return;
        let changed = false;
        const updatedArr = salesArr.map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && entry.id === userId) {
            const nextSnapshot = { ...(entry.snapshot || {}), ...snapBase };
            changed = true;
            return { ...entry, snapshot: nextSnapshot };
          }
          return entry;
        });
        if (changed) {
          const nextAssociations = { ...(dealData.associations || {}), salespeople: updatedArr };
          batch.update(dealDoc.ref, { associations: nextAssociations, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
      });
      await batch.commit();
    })
  );
});