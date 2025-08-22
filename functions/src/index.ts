import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https'; // v2 for callable functions
import { onSchedule } from 'firebase-functions/v2/scheduler'; // v2 for scheduler
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { runAIScheduler, manualSchedulerRun } from './scheduler';
import { logAIAction } from './feedbackEngine';
import { getTraitsAndTags } from './utils/openaiHelper';
import * as FirebaseFirestore from 'firebase-admin/firestore';
import sgMail from '@sendgrid/mail';
import { runFirestoreTriggerTests } from './testTriggersCLI';
import type { TestResult } from './testFirestoreTriggers';
import { parseResume, getResumeParsingStatus, getUserParsedResumes } from './resumeParser';
import { logMobileAppError, monitorMobileAppErrors, getMobileErrorStats } from './mobileErrorMonitoring';
import {
  getSSOConfig, updateSSOConfig, testSSOConnection,
  getSCIMConfig, updateSCIMConfig, syncSCIMUsers,
  getHRISConfig, updateHRISConfig, syncHRISData,
  getSlackConfig, updateSlackConfig, testSlackConnection,
  getIntegrationLogs, manualSync, getIntegrationStatuses
} from './integrations';
import { getUsersByTenant } from './getUsersByTenant';
import { fetchCompanyNews } from './fetchCompanyNews';
import { discoverCompanyLocations } from './discoverCompanyLocations';
import { discoverCompanyUrls } from './discoverCompanyUrls';
import { getSalespeople } from './getSalespeople';
import { scrapeIndeedJobs } from './scrapeIndeedJobs';

import { linkContactsToCompanies } from './linkContactsToCompanies';
import { linkCRMEntities } from './linkCRMEntities';
import { triggerAINoteReview, triggerAINoteReviewHttp } from './triggerAINoteReview';
import { findDecisionMakers, findDecisionMakersHttp } from './findDecisionMakers';
import { enhanceCompanyWithSerp } from './enhanceCompanyWithSerp';
import { enhanceContactWithAI } from './enhanceContactWithAI';
import { fetchFollowedCompanyNews } from './fetchFollowedCompanyNews';
import { removeDuplicateCompanies } from './removeDuplicateCompanies';
import { removeContactsWithoutNames } from './removeContactsWithoutNames';
import { removeDuplicateContacts } from './removeDuplicateContacts';
import { removePhoneNumberContacts } from './removePhoneNumberContacts';
import { migrateContactSchema } from './migrateContactSchema';
import { findTenantIds } from './findTenantIds';
import { extractCompanyInfoFromUrls } from './extractCompanyInfoFromUrls';
import { manageAssociations } from './manageAssociations';
import { fixContactAssociations } from './fixContactAssociations';
import { findContactInfo } from './findContactEmail';
import { updateCompanyPipelineTotals, onDealUpdated } from './updateCompanyPipelineTotals';
import { generateDealAISummary } from './generateDealAISummary';
import { triggerAISummaryUpdate } from './triggerAISummaryUpdate';
import { dealCoachAnalyze, dealCoachChat, dealCoachAction, dealCoachAnalyzeCallable, dealCoachChatCallable, dealCoachActionCallable, dealCoachStartNewCallable, dealCoachLoadConversationCallable, dealCoachFeedbackCallable, analyzeDealOutcomeCallable, dealCoachProactiveCallable } from './dealCoach';
import { associationsIntegrityReport, associationsIntegrityNightly } from './telemetry/metrics';
import { rebuildDealAssociations, rebuildEntityReverseIndex } from './rebuilders';
import { onCompanyLocationCreated, onCompanyLocationUpdated, onCompanyLocationDeleted, rebuildCompanyLocationMirror, rebuildCompanyLocationMirrorHttp, companyLocationMirrorStats } from './locationMirror';
import { deleteDuplicateCompanies } from './deleteDuplicateCompanies';
import { cleanupContactCompanyAssociations, cleanupContactCompanyAssociationsHttp } from './cleanupContactCompanyAssociations';
import { cleanupUndefinedValues } from './cleanupUndefinedValues';
import { bulkEmailDomainMatching } from './bulkEmailDomainMatching';
import { firestoreCompanySnapshotFanout, firestoreContactSnapshotFanout, firestoreLocationSnapshotFanout, firestoreSalespersonSnapshotFanout } from './firestoreTriggers';
import { logContactEnhanced } from './activityLogCallables';
import { enrichCompanyOnCreate, enrichCompanyOnDemand, enrichCompanyWeekly, getEnrichmentStats, enrichCompanyBatch } from './companyEnrichment';
import { enrichContactOnDemand } from './contactEnrichment';
import { queueGmailBulkImport, getGmailImportProgress, getGmailImportProgressHttp, queueGmailBulkImportHttp, processGmailImportWorker } from './gmailBulkImport';
import { getEmailLogBody } from './emailLogs';
import { runProspecting, saveProspectingSearch, addProspectsToCRM, createCallList } from './prospecting';

// 📅 CALENDAR WEBHOOKS IMPORTS
import { setupCalendarWatch, calendarWebhook, stopCalendarWatch, refreshCalendarWatch } from './calendarWebhooks';
import { getCalendarWebhookStatus } from './calendarWebhookStatus';

// Export Deal Coach endpoints for deployment
export {
  dealCoachAnalyze,
  dealCoachChat,
  dealCoachAction,
  dealCoachAnalyzeCallable,
  dealCoachChatCallable,
  dealCoachActionCallable,
  dealCoachStartNewCallable,
  dealCoachLoadConversationCallable,
  dealCoachFeedbackCallable,
  analyzeDealOutcomeCallable,
  dealCoachProactiveCallable
};

// 📅 Export Calendar Webhook endpoints
export {
  setupCalendarWatch,
  calendarWebhook,
  stopCalendarWatch,
  refreshCalendarWatch,
  getCalendarWebhookStatus
};

// Export association snapshot fan-out triggers
export {
  firestoreCompanySnapshotFanout, // RE-ENABLED WITH FIXES
  firestoreContactSnapshotFanout,
  firestoreLocationSnapshotFanout,
  firestoreSalespersonSnapshotFanout
};

// Associations telemetry and rebuilders
export { associationsIntegrityReport, associationsIntegrityNightly };
export { rebuildDealAssociations, rebuildEntityReverseIndex };
export { logContactEnhanced };

// Gmail Bulk Import Functions
export { queueGmailBulkImport, getGmailImportProgress, getGmailImportProgressHttp, queueGmailBulkImportHttp, processGmailImportWorker };
export { getEmailLogBody };
export { enrichCompanyOnCreate, enrichCompanyOnDemand, enrichCompanyWeekly, getEnrichmentStats, enrichCompanyBatch };
export { enrichContactOnDemand };
export { onCompanyLocationCreated, onCompanyLocationUpdated, onCompanyLocationDeleted };
export { rebuildCompanyLocationMirror, rebuildCompanyLocationMirrorHttp };
export { companyLocationMirrorStats };
export { deleteDuplicateCompanies };
export { cleanupContactCompanyAssociations, cleanupContactCompanyAssociationsHttp };

// Data Cleanup Functions
export { cleanupUndefinedValues };

// Bulk Operations
export { bulkEmailDomainMatching };

// 🚀 DENORMALIZED ASSOCIATIONS IMPORTS
// Temporarily commented out due to TypeScript errors
// import { syncDenormalizedAssociations, bulkSyncAssociations } from './syncDenormalizedAssociations';
// import { migrateToDenormalizedAssociations, cleanupOldAssociations } from './migrateToDenormalizedAssociations';

// 🎯 TASK ENGINE IMPORTS
import {
  createTask,
  updateTask,
  completeTask,
  quickCompleteTask,
  deleteTask,
  getTasks,
  getTasksForDate,
  getTaskDashboard,
  getAITaskSuggestions,
  acceptAITaskSuggestion,
  rejectAITaskSuggestion,
  getDealStageAISuggestions,
  generateTaskContent,
  createNextRepeatingTask
} from './taskEngine';

// 🎯 DEAL ASSOCIATION IMPORTS
import {
  associateDealsWithSalespeople,
  createExplicitAssociations
} from './associateDealsWithSalespeople';

// Export task functions
export {
  createTask,
  updateTask,
  completeTask,
  quickCompleteTask,
  deleteTask,
  getTasks,
  getTasksForDate,
  getTaskDashboard,
  getAITaskSuggestions,
  acceptAITaskSuggestion,
  rejectAITaskSuggestion,
  getDealStageAISuggestions,
  generateTaskContent,
  createNextRepeatingTask
};

// Export deal association functions
export {
  associateDealsWithSalespeople,
  createExplicitAssociations,
};

// Get SendGrid API key from environment variables
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
sgMail.setApiKey(SENDGRID_API_KEY);

// Log SendGrid configuration status for debugging
console.log('SendGrid API Key configured:', !!SENDGRID_API_KEY);
console.log('SendGrid API Key starts with SG:', SENDGRID_API_KEY.startsWith('SG.'));

// Initialize Firebase Admin only if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const { OpenAI } = require('openai');

const db = admin.firestore();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export const logAIActionCallable = onCall(async (request) => {
  try {
    const logData = request.data;
    await logAIAction(logData);
    return { success: true, message: 'AI action logged successfully' };
  } catch (error) {
    console.error('Error in logAIAction Cloud Function:', error);
    throw new HttpsError('internal', 'Failed to log AI action');
  }
});

export const analyzeAITraining = onCall(async (request) => {
  const { customerId, userId } = request.data;
  if (!customerId) throw new Error('customerId is required');

  // Fetch global training
  const globalSnap = await db.doc('aiTraining/global').get();
  const globalData = globalSnap.exists ? globalSnap.data() : {};

  // Fetch customer-specific training
  const customerSnap = await db.doc(`customers/${customerId}/aiTraining/main`).get();
  const customerData = customerSnap.exists ? customerSnap.data() : {};

  // Build prompt
  const prompt = `
==== HRX-WIDE INSTRUCTIONS ====
Mission: ${(globalData || {}).mission || ''}
Core Values: ${(globalData || {}).coreValues || ''}
Communication Style: ${(globalData || {}).communicationStyle || ''}
...
==== CUSTOMER-SPECIFIC INSTRUCTIONS ====
Mission: ${(customerData || {}).mission || ''}
Core Values: ${(customerData || {}).coreValues || ''}
Communication Style: ${(customerData || {}).communicationStyle || ''}
...
`;

  const start = Date.now();
  let aiResponse = '';
  let success = false;
  let errorMessage = '';
  try {
    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'system', content: prompt }]
    });
    aiResponse = response.choices[0].message.content;
    success = true;
    return { result: aiResponse };
  } catch (err: any) {
    errorMessage = err.message || 'OpenAI error';
    throw err;
  } finally {
    const latencyMs = Date.now() - start;
    // AI LOG: Training analysis event
    await logAIAction({
      userId: userId || null,
      actionType: 'training_analysis',
      sourceModule: 'TrainingEngine',
      customerId,
      inputPrompt: prompt,
      composedPrompt: prompt,
      aiResponse,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      // --- New schema fields ---
      eventType: 'training.analysis',
      targetType: 'user',
      targetId: userId || null,
      aiRelevant: true,
      contextType: 'training',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
});

// Generate job description using OpenAI
export const generateJobDescription = onCall(async (request) => {
  const { title } = request.data;
  if (!title) throw new Error('Missing job title');

  const prompt = `Write a professional job description for the position: ${title}. Include key responsibilities, qualifications, and skills.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 300,
    });
    const description = response.choices[0].message.content;
    return { description };
  } catch (err: any) {
    throw new HttpsError('internal', 'Failed to generate description');
  }
});

// Vector Management Functions
export const getVectorCollections = onCall(async (request) => {
  try {
    const collectionsRef = db.collection('vectorCollections');
    const snapshot = await collectionsRef.get();
    const collections = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      lastIndexed: doc.data().lastIndexed?.toDate()
    }));
    return { collections };
  } catch (error: any) {
    throw new Error(`Failed to fetch vector collections: ${error.message}`);
  }
});

export const reindexVectorCollection = onCall(async (request) => {
  const { collectionId, userId } = request.data;
  const start = Date.now();
  
  try {
    // Update collection status to indexing
    await db.collection('vectorCollections').doc(collectionId).update({
      status: 'indexing',
      lastIndexed: admin.firestore.FieldValue.serverTimestamp()
    });

    // Simulate indexing process (in real implementation, this would trigger actual vector indexing)
    // For now, we'll just update the status after a delay
    setTimeout(async () => {
      await db.collection('vectorCollections').doc(collectionId).update({
        status: 'active',
        lastIndexed: admin.firestore.FieldValue.serverTimestamp()
      });
    }, 3000);

    await logAIAction({
      userId,
      actionType: 'vector_reindex',
      sourceModule: 'VectorSettings',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Reindexed vector collection: ${collectionId}`,
      // --- New schema fields ---
      eventType: 'vector.collection.reindexed',
      targetType: 'collection',
      targetId: collectionId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true, message: 'Reindexing started' };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'vector_reindex',
      sourceModule: 'VectorSettings',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to reindex vector collection: ${collectionId}`,
      // --- New schema fields ---
      eventType: 'vector.collection.reindexed',
      targetType: 'collection',
      targetId: collectionId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Context Engine Functions
export const getContextEngines = onCall(async (request) => {
  try {
    const enginesRef = db.collection('contextEngines');
    const snapshot = await enginesRef.get();
    const engines = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      lastRun: doc.data().lastRun?.toDate()
    }));
    return { engines };
  } catch (error: any) {
    throw new Error(`Failed to fetch context engines: ${error.message}`);
  }
});

export const getContextSources = onCall(async (request) => {
  try {
    const sourcesRef = db.collection('contextSources');
    const snapshot = await sourcesRef.get();
    const sources = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      lastUpdated: doc.data().lastUpdated?.toDate()
    }));
    return { sources };
  } catch (error: any) {
    throw new Error(`Failed to fetch context sources: ${error.message}`);
  }
});

export const runContextAssembly = onCall(async (request) => {
  const { engineId, userId, liveRequest } = request.data;
  const start = Date.now();
  
  try {
    // Get engine configuration
    const engineDoc = await db.collection('contextEngines').doc(engineId).get();
    if (!engineDoc.exists) {
      throw new Error('Context engine not found');
    }
    const engine = engineDoc.data();

    // Get context sources
    const sourcesRef = db.collection('contextSources');
    const sourcesSnapshot = await sourcesRef.get();
    const sources = sourcesSnapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Simulate context assembly (in real implementation, this would assemble actual context)
    const assembledPrompt = `[System Context] ${sources.map((s: any) => s.dataPreview).join(' ')}\n\n[User Request] ${liveRequest}`;

    await logAIAction({
      userId,
      actionType: 'context_assembly',
      sourceModule: 'AutoContextEngine',
      inputPrompt: liveRequest,
      composedPrompt: assembledPrompt,
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Context assembly for engine: ${engineId}`,
      // --- New schema fields ---
      eventType: 'context.assembly.completed',
      targetType: 'engine',
      targetId: engineId,
      aiRelevant: true,
      contextType: 'context',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { 
      success: true, 
      assembledPrompt,
      engine: engine?.name
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'context_assembly',
      sourceModule: 'AutoContextEngine',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed context assembly for engine: ${engineId}`,
      // --- New schema fields ---
      eventType: 'context.assembly.failed',
      targetType: 'engine',
      targetId: engineId,
      aiRelevant: true,
      contextType: 'context',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Retrieval Filter Functions
export const getRetrievalFilters = onCall(async (request) => {
  try {
    const filtersRef = db.collection('retrievalFilters');
    const snapshot = await filtersRef.get();
    const filters = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));
    return { filters };
  } catch (error: any) {
    throw new Error(`Failed to fetch retrieval filters: ${error.message}`);
  }
});

export const createRetrievalFilter = onCall(async (request) => {
  const { filter, userId } = request.data;
  const start = Date.now();
  
  try {
    const docRef = await db.collection('retrievalFilters').add({
      ...filter,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId,
      actionType: 'retrieval_filter_create',
      sourceModule: 'RetrievalFilters',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Created retrieval filter: ${filter.name}`,
      // --- New schema fields ---
      eventType: 'retrieval.filter.created',
      targetType: 'filter',
      targetId: docRef.id,
      aiRelevant: true,
      contextType: 'retrieval',
      traitsAffected: null,
      aiTags: filter.tags || null,
      urgencyScore: null
    });

    return { id: docRef.id };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'retrieval_filter_create',
      sourceModule: 'RetrievalFilters',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to create retrieval filter: ${filter.name}`,
      // --- New schema fields ---
      eventType: 'retrieval.filter.created',
      targetType: 'filter',
      // omit optional when undefined
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'retrieval',
      traitsAffected: null,
      aiTags: filter.tags || null,
      urgencyScore: null
    });
    throw error;
  }
});

export const updateRetrievalFilter = onCall(async (request) => {
  const { filterId, filter, userId } = request.data;
  const start = Date.now();
  
  try {
    await db.collection('retrievalFilters').doc(filterId).update({
      ...filter,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId,
      actionType: 'retrieval_filter_update',
      sourceModule: 'RetrievalFilters',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated retrieval filter: ${filter.name}`
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'retrieval_filter_update',
      sourceModule: 'RetrievalFilters',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update retrieval filter: ${filter.name}`
    });
    throw error;
  }
});

export const deleteRetrievalFilter = onCall(async (request) => {
  const { filterId, filterName, userId } = request.data;
  const start = Date.now();
  
  try {
    await db.collection('retrievalFilters').doc(filterId).delete();

    await logAIAction({
      userId,
      actionType: 'retrieval_filter_delete',
      sourceModule: 'RetrievalFilters',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Deleted retrieval filter: ${filterName}`
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'retrieval_filter_delete',
      sourceModule: 'RetrievalFilters',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to delete retrieval filter: ${filterName}`
    });
    throw error;
  }
});

// Prompt Builder Functions
export const getPromptTemplates = onCall(async (request) => {
  try {
    const templatesRef = db.collection('promptTemplates');
    const snapshot = await templatesRef.get();
    const templates = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));
    return { templates };
  } catch (error: any) {
    throw new Error(`Failed to fetch prompt templates: ${error.message}`);
  }
});

export const createPromptTemplate = onCall(async (request) => {
  const { template, userId } = request.data;
  const start = Date.now();
  
  try {
    const docRef = await db.collection('promptTemplates').add({
      ...template,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId,
      actionType: 'prompt_template_create',
      sourceModule: 'PromptBuilder',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Created prompt template: ${template.name}`
    });

    return { id: docRef.id };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'prompt_template_create',
      sourceModule: 'PromptBuilder',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to create prompt template: ${template.name}`
    });
    throw error;
  }
});

export const updatePromptTemplate = onCall(async (request) => {
  const { templateId, template, userId } = request.data;
  const start = Date.now();
  
  try {
    await db.collection('promptTemplates').doc(templateId).update({
      ...template,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId,
      actionType: 'prompt_template_update',
      sourceModule: 'PromptBuilder',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated prompt template: ${template.name}`
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'prompt_template_update',
      sourceModule: 'PromptBuilder',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update prompt template: ${template.name}`
    });
    throw error;
  }
});

export const testPromptTemplate = onCall(async (request) => {
  const { template, inputData, userId } = request.data;
  const start = Date.now();
  
  try {
    // Simple template variable replacement
    let assembledPrompt = template.content;
    Object.entries(inputData).forEach(([key, value]) => {
      assembledPrompt = assembledPrompt.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    });

    await logAIAction({
      userId,
      actionType: 'prompt_template_test',
      sourceModule: 'PromptBuilder',
      inputPrompt: template.content,
      composedPrompt: assembledPrompt,
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Tested prompt template: ${template.name}`
    });

    return { 
      success: true, 
      assembledPrompt,
      latency: Date.now() - start
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'prompt_template_test',
      sourceModule: 'PromptBuilder',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to test prompt template: ${template.name}`
    });
    throw error;
  }
});

// AutoDevOps Functions
export const getAutoDevOpsLogs = onCall(async (request) => {
  try {
    const logsRef = db.collection('autoDevOpsLogs');
    const snapshot = await logsRef.get();
    const logs = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));
    return { logs };
  } catch (error: any) {
    throw new Error(`Failed to fetch AutoDevOps logs: ${error.message}`);
  }
});

export const getAutoDevOpsSettings = onCall(async (request) => {
  try {
    const settingsRef = db.collection('autoDevOpsSettings');
    const snapshot = await settingsRef.get();
    const settings = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));
    return { settings: settings[0] || null };
  } catch (error: any) {
    throw new Error(`Failed to fetch AutoDevOps settings: ${error.message}`);
  }
});

export const updateAutoDevOpsSettings = onCall(async (request) => {
  const { settings, userId } = request.data;
  const start = Date.now();
  
  try {
    await db.collection('autoDevOpsSettings').doc(settings.id).set({
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    });

    await logAIAction({
      userId,
      actionType: 'autodevops_settings_update',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated AutoDevOps settings`
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'autodevops_settings_update',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update AutoDevOps settings`
    });
    throw error;
  }
});

export const applyAutoDevOpsPatch = onCall(async (request) => {
  const { logId, userId } = request.data;
  const start = Date.now();
  
  try {
    // Update log status to fixed
    await db.collection('autoDevOpsLogs').doc(logId).update({
      status: 'Fixed',
      fixedAt: admin.firestore.FieldValue.serverTimestamp(),
      fixedBy: userId
    });

    // In a real implementation, this would apply the actual code patch
    // For now, we'll just log the action
    await logAIAction({
      userId,
      actionType: 'autodevops_patch_apply',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Applied AutoDevOps patch for log: ${logId}`
    });

    return { success: true, message: 'Patch applied successfully' };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'autodevops_patch_apply',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to apply AutoDevOps patch for log: ${logId}`
    });
    throw error;
  }
});

export const createAutoDevOpsLog = onCall(async (request) => {
  const { log, userId } = request.data;
  const start = Date.now();
  
  try {
    const docRef = await db.collection('autoDevOpsLogs').add({
      ...log,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: userId
    });

    await logAIAction({
      userId,
      actionType: 'autodevops_log_create',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Created AutoDevOps log: ${log.summary}`
    });

    return { id: docRef.id };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'autodevops_log_create',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to create AutoDevOps log: ${log.summary}`
    });
    throw error;
  }
});

// Enhanced AutoDevOps Functions for Real-time AI Monitoring
export const analyzeAILogsForPatterns = onCall(async (request) => {
  const { timeRange, userId } = request.data;
  const start = Date.now();
  
  try {
    // Get AI logs from the specified time range
    const logsRef = db.collection('ai_logs');
    const timeFilter = timeRange || 24; // Default to 24 hours
    const cutoffTime = new Date(Date.now() - timeFilter * 60 * 60 * 1000);
    
    const snapshot = await logsRef
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(cutoffTime))
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    const logs = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));

    // Analyze patterns
    const patterns = await analyzeLogPatterns(logs);
    
    // Generate AutoDevOps logs for detected issues
    const autoDevOpsLogs = await generateAutoDevOpsLogs(patterns, logs);

    await logAIAction({
      userId,
      actionType: 'autodevops_pattern_analysis',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Analyzed ${logs.length} AI logs for patterns`
    });

    return { patterns, autoDevOpsLogs };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'autodevops_pattern_analysis',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to analyze AI logs for patterns'
    });
    throw error;
  }
});

export const getAILogQualityMetrics = onCall(async (request) => {
  const { customerId, module, timeRange } = request.data;
  
  try {
    const logsRef = db.collection('ai_logs');
    const timeFilter = timeRange || 24;
    const cutoffTime = new Date(Date.now() - timeFilter * 60 * 60 * 1000);
    
    let query = logsRef.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(cutoffTime));
    
    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }
    
    if (module) {
      query = query.where('sourceModule', '==', module);
    }
    
    const snapshot = await query.orderBy('timestamp', 'desc').get();
    const logs = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));

    // Calculate quality metrics
    const metrics = calculateQualityMetrics(logs);
    
    return { metrics, totalLogs: logs.length };
  } catch (error: any) {
    throw new Error(`Failed to get AI log quality metrics: ${error.message}`);
  }
});

export const suggestConfigImprovements = onCall(async (request) => {
  const { customerId, module, issueType, userId } = request.data;
  const start = Date.now();
  
  try {
    // Get current configuration
    const config = await getCurrentConfig(customerId, module);
    
    // Get recent logs for context
    const logsRef = db.collection('ai_logs');
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    let query = logsRef.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(cutoffTime));
    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }
    if (module) {
      query = query.where('sourceModule', '==', module);
    }
    
    const snapshot = await query.orderBy('timestamp', 'desc').limit(100).get();
    const logs = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));

    // Generate improvement suggestions
    const suggestions = await generateConfigSuggestions(config, logs, issueType);
    
    await logAIAction({
      userId,
      actionType: 'autodevops_config_suggestions',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Generated config suggestions for ${module}`
    });

    return { suggestions };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'autodevops_config_suggestions',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to generate config suggestions for ${module}`
    });
    throw error;
  }
});

// Helper functions for AI log analysis
interface LogPattern {
  type: string;
  errorType?: string;
  issue?: string;
  count: number;
  logs: any[];
  suggestion: string;
  avgLatency?: number;
}

interface PatternAnalysis {
  repeatedErrors: LogPattern[];
  performanceIssues: LogPattern[];
  toneMismatches: LogPattern[];
  contextFailures: LogPattern[];
  userCorrections: LogPattern[];
  emptyResponses: LogPattern[];
  hallucinations: LogPattern[];
}

async function analyzeLogPatterns(logs: any[]): Promise<PatternAnalysis> {
  const patterns: PatternAnalysis = {
    repeatedErrors: [],
    performanceIssues: [],
    toneMismatches: [],
    contextFailures: [],
    userCorrections: [],
    emptyResponses: [],
    hallucinations: []
  };

  // Group logs by user, customer, and module
  const groupedLogs = groupLogsByContext(logs);
  
  // Analyze each group for patterns
  for (const [, contextLogs] of Object.entries(groupedLogs)) {
    // Detect repeated errors
    const errorPatterns = detectErrorPatterns(contextLogs);
    if (errorPatterns.length > 0) {
      patterns.repeatedErrors.push(...errorPatterns);
    }
    
    // Detect performance issues
    const performanceIssues = detectPerformanceIssues(contextLogs);
    if (performanceIssues.length > 0) {
      patterns.performanceIssues.push(...performanceIssues);
    }
    
    // Detect tone mismatches
    const toneIssues = detectToneMismatches(contextLogs);
    if (toneIssues.length > 0) {
      patterns.toneMismatches.push(...toneIssues);
    }
    
    // Detect context failures
    const contextIssues = detectContextFailures(contextLogs);
    if (contextIssues.length > 0) {
      patterns.contextFailures.push(...contextIssues);
    }
  }

  return patterns;
}

function groupLogsByContext(logs: any[]) {
  const grouped: Record<string, any[]> = {};
  
  logs.forEach(log => {
    const key = `${log.customerId || 'global'}_${log.sourceModule}_${log.userId || 'system'}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(log);
  });
  
  return grouped;
}

function detectErrorPatterns(logs: any[]): LogPattern[] {
  const errors = logs.filter(log => !log.success);
  const errorPatterns: LogPattern[] = [];
  
  // Group errors by type
  const errorGroups: Record<string, any[]> = {};
  errors.forEach(error => {
    const errorType = error.errorMessage || 'unknown';
    if (!errorGroups[errorType]) {
      errorGroups[errorType] = [];
    }
    errorGroups[errorType].push(error);
  });
  
  // Find repeated errors
  Object.entries(errorGroups).forEach(([errorType, errorLogs]) => {
    if (errorLogs.length >= 3) { // Threshold for repeated errors
      errorPatterns.push({
        type: 'repeated_error',
        errorType,
        count: errorLogs.length,
        logs: errorLogs,
        suggestion: `Investigate and fix ${errorType} occurring ${errorLogs.length} times`
      });
    }
  });
  
  return errorPatterns;
}

function detectPerformanceIssues(logs: any[]) {
  const performanceIssues = [];
  const slowLogs = logs.filter(log => log.latencyMs && log.latencyMs > 5000); // 5 second threshold
  
  if (slowLogs.length > 0) {
    const avgLatency = slowLogs.reduce((sum, log) => sum + log.latencyMs, 0) / slowLogs.length;
    performanceIssues.push({
      type: 'performance_issue',
      issue: 'high_latency',
      count: slowLogs.length,
      avgLatency,
      logs: slowLogs,
      suggestion: `Optimize AI response time - ${slowLogs.length} responses exceeded 5s threshold`
    });
  }
  
  return performanceIssues;
}

function detectToneMismatches(logs: any[]) {
  const toneIssues = [];
  
  // Look for logs with tone-related errors or mismatches
  const toneLogs = logs.filter(log => 
    log.errorMessage?.includes('tone') || 
    log.reason?.includes('tone') ||
    log.sourceModule === 'CustomerToneOverrides'
  );
  
  if (toneLogs.length > 0) {
    toneIssues.push({
      type: 'tone_mismatch',
      count: toneLogs.length,
      logs: toneLogs,
      suggestion: 'Review and adjust tone settings for better alignment'
    });
  }
  
  return toneIssues;
}

function detectContextFailures(logs: any[]) {
  const contextIssues = [];
  
  // Look for context-related failures
  const contextLogs = logs.filter(log => 
    log.errorMessage?.includes('context') ||
    log.sourceModule === 'ContextEngine' ||
    log.sourceModule === 'AutoContextEngine'
  );
  
  if (contextLogs.length > 0) {
    const failedContexts = contextLogs.filter(log => !log.success);
    if (failedContexts.length > 0) {
      contextIssues.push({
        type: 'context_failure',
        count: failedContexts.length,
        logs: failedContexts,
        suggestion: 'Review context assembly and injection logic'
      });
    }
  }
  
  return contextIssues;
}

interface AutoDevOpsLog {
  source: string;
  category: string;
  summary: string;
  severity: string;
  needsHumanReview: boolean;
  status: string;
  userImpact: string;
  estimatedFixTime: string;
}

async function generateAutoDevOpsLogs(patterns: PatternAnalysis, originalLogs: any[]): Promise<AutoDevOpsLog[]> {
  const autoDevOpsLogs: AutoDevOpsLog[] = [];
  
  // Convert patterns to AutoDevOps logs
  Object.entries(patterns).forEach(([patternType, patternList]) => {
    (patternList as LogPattern[]).forEach((pattern: LogPattern) => {
      const log: AutoDevOpsLog = {
        source: 'AI Engine',
        category: pattern.type.includes('error') ? 'Error' : 
                  pattern.type.includes('performance') ? 'Performance' : 'Optimization',
        summary: pattern.suggestion,
        severity: pattern.count > 10 ? 'High' : pattern.count > 5 ? 'Medium' : 'Low',
        needsHumanReview: pattern.count > 5,
        status: 'New',
        userImpact: `Affects ${pattern.count} AI interactions`,
        estimatedFixTime: pattern.type.includes('error') ? '30 minutes' : '1 hour'
      };
      
      autoDevOpsLogs.push(log);
    });
  });
  
  return autoDevOpsLogs;
}

function calculateQualityMetrics(logs: any[]) {
  const totalLogs = logs.length;
  const successfulLogs = logs.filter(log => log.success);
  const failedLogs = logs.filter(log => !log.success);
  
  const metrics = {
    successRate: totalLogs > 0 ? (successfulLogs.length / totalLogs) * 100 : 0,
    avgLatency: logs.reduce((sum, log) => sum + (log.latencyMs || 0), 0) / totalLogs,
    errorRate: totalLogs > 0 ? (failedLogs.length / totalLogs) * 100 : 0,
    totalInteractions: totalLogs,
    qualityScore: 0
  };
  
  // Calculate quality score based on success rate, latency, and error patterns
  const successWeight = 0.6;
  const latencyWeight = 0.3;
  const errorWeight = 0.1;
  
  const successScore = metrics.successRate / 100;
  const latencyScore = Math.max(0, 1 - (metrics.avgLatency / 10000)); // Normalize to 10s max
  const errorScore = 1 - (metrics.errorRate / 100);
  
  metrics.qualityScore = (successScore * successWeight) + 
                        (latencyScore * latencyWeight) + 
                        (errorScore * errorWeight);
  
  return metrics;
}

async function getCurrentConfig(customerId: string, module: string) {
  // Get current configuration based on module
  switch (module) {
    case 'ToneSettings':
      return await db.collection('appAiSettings').doc('global').get();
    case 'WeightsEngine':
      return await db.collection('appAiSettings').doc('weights').get();
    case 'ContextEngine':
      return await db.collection('settings').doc('contextGlobal').get();
    default:
      return null;
  }
}

async function generateConfigSuggestions(config: any, logs: any[], issueType: string) {
  const suggestions = [];
  
  // Analyze logs and config to generate specific suggestions
  if (issueType === 'tone_mismatch') {
    suggestions.push({
      type: 'tone_adjustment',
      description: 'Adjust tone settings based on user feedback patterns',
      configChanges: {
        formality: 'increase',
        friendliness: 'maintain',
        conciseness: 'decrease'
      },
      confidence: 0.8
    });
  }
  
  if (issueType === 'performance_issue') {
    suggestions.push({
      type: 'context_optimization',
      description: 'Optimize context loading to reduce latency',
      configChanges: {
        maxContextLength: 'reduce',
        cacheEnabled: 'enable',
        parallelLoading: 'enable'
      },
      confidence: 0.7
    });
  }
  
  if (issueType === 'context_failure') {
    suggestions.push({
      type: 'context_fallback',
      description: 'Add fallback context handling for failed assemblies',
      configChanges: {
        fallbackEnabled: 'enable',
        defaultContext: 'enhance',
        errorHandling: 'improve'
      },
      confidence: 0.9
    });
  }
  
  return suggestions;
}

export { runAIScheduler, manualSchedulerRun };
export { 
  generateFeedbackPrompts, 
  createFeedbackCampaign, 
  submitFeedbackResponse, 
  getFeedbackResults, 
  getFeedbackAISummary,
  listFeedbackCampaigns,
  listCustomerToneOverrides,
  getCustomerTone,
  setCustomerTone,
  resetCustomerTone,
  getGlobalContext,
  setGlobalContext,
  listScenarios,
  getScenario,
  setScenario,
  deleteScenario,
  listContextVersions,
  restoreContextVersion,
  listAILogs,
  setWeightsConfig
} from './feedbackEngine';

// Export AI Engine Processor functions
export { processAILog, reprocessLog } from './aiEngineProcessor';

// Export Test Harness functions
export { 
  runAILogTests, 
  createTestLog, 
  reprocessTestLog, 
  getTestResults, 
  cleanupTestData 
} from './testHarness';

// Export Analytics Engine functions
export { 
  getAIAnalytics, 
  getRealTimeAIAnalytics, 
  exportAnalyticsData 
} from './analyticsEngine';

// AI Chat Functions
export const getAIChatSettings = onCall(async (request) => {
  const { customerId } = request.data;
  const start = Date.now();
  
  try {
    let settings = null;
    
    if (customerId) {
      // Get customer-specific settings
      const customerDoc = await db.collection('customers').doc(customerId).get();
      if (customerDoc.exists) {
        const customerData = customerDoc.data();
        settings = customerData?.aiChatSettings || null;
      }
    } else {
      // Get global settings
      const settingsDoc = await db.collection('modules').doc('ai-chat').get();
      if (settingsDoc.exists) {
        settings = settingsDoc.data();
      }
    }

    await logAIAction({
      userId: 'admin',
      actionType: 'ai_chat_settings_get',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Retrieved AI Chat settings for ${customerId || 'global'}`
    });

    return { settings };
  } catch (error: any) {
    await logAIAction({
      userId: 'admin',
      actionType: 'ai_chat_settings_get',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to get AI Chat settings'
    });
    throw error;
  }
});

export const updateAIChatSettings = onCall(async (request) => {
  const { settings, customerId } = request.data;
  const start = Date.now();
  
  try {
    if (customerId) {
      // Update customer-specific settings
      await db.collection('customers').doc(customerId).update({
        aiChatSettings: settings,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Update global settings
      const settingsRef = db.collection('modules').doc('ai-chat');
      await settingsRef.set({
        ...settings,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    await logAIAction({
      userId: 'admin',
      actionType: 'ai_chat_settings_update',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated AI Chat settings for ${customerId || 'global'}`
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId: 'admin',
      actionType: 'ai_chat_settings_update',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to update AI Chat settings'
    });
    throw error;
  }
});

export const getAIChatConversations = onCall(async (request) => {
  const { userId, limit = 50 } = request.data;
  const start = Date.now();
  
  try {
    const conversationsRef = db.collection('conversations');
    const snapshot = await conversationsRef
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    const conversations = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));

    await logAIAction({
      userId,
      actionType: 'ai_chat_conversations_get',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Retrieved ${conversations.length} conversations`
    });

    return { conversations };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'ai_chat_conversations_get',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to retrieve conversations'
    });
    throw error;
  }
});

export const createAIChatConversation = onCall(async (request) => {
  const { workerId, initialMessage, customerId } = request.data;
  const start = Date.now();
  
  try {
    // Get AI Chat settings
    const settingsDoc = await db.collection('modules').doc('ai-chat').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : null;
    
    // Create conversation
    const conversationRef = await db.collection('conversations').add({
      workerId,
      customerId,
      messages: [{
        id: Date.now().toString(),
        sender: 'worker',
        content: initialMessage,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      }],
      status: 'active',
      confidence: 1.0,
      escalated: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      tags: []
    });

    // Generate AI response
    const aiResponse = await generateAIResponse(initialMessage, settings, customerId);
    
    // Add AI response to conversation
    await conversationRef.update({
      messages: admin.firestore.FieldValue.arrayUnion({
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        content: aiResponse.content,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        confidence: aiResponse.confidence,
        tone: aiResponse.tone
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_conversation_create',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Created conversation with AI response (confidence: ${aiResponse.confidence})`
    });

    return { conversationId: conversationRef.id, aiResponse };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_conversation_create',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to create conversation'
    });
    throw error;
  }
});

export const sendAIChatMessage = onCall(async (request) => {
  const { conversationId, message, workerId } = request.data;
  const start = Date.now();
  
  try {
    // Get conversation and settings
    const [conversationDoc, settingsDoc] = await Promise.all([
      db.collection('conversations').doc(conversationId).get(),
      db.collection('modules').doc('ai-chat').get()
    ]);
    
    if (!conversationDoc.exists) {
      throw new Error('Conversation not found');
    }
    
    const conversation = conversationDoc.data()!;
    const settings = settingsDoc.exists ? settingsDoc.data() : null;
    
    // Add worker message
    await db.collection('conversations').doc(conversationId).update({
      messages: admin.firestore.FieldValue.arrayUnion({
        id: Date.now().toString(),
        sender: 'worker',
        content: message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Generate AI response
    const aiResponse = await generateAIResponse(message, settings, conversation.customerId);
    
    // Check if escalation is needed
    const shouldEscalate = aiResponse.confidence < (settings?.systemDefaults?.confidenceThreshold || 0.8);
    
    if (shouldEscalate) {
      await escalateConversationInternal(conversationId, conversation, settings);
    }
    
    // Add AI response
    await db.collection('conversations').doc(conversationId).update({
      messages: admin.firestore.FieldValue.arrayUnion({
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        content: aiResponse.content,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        confidence: aiResponse.confidence,
        tone: aiResponse.tone
      }),
      escalated: shouldEscalate,
      status: shouldEscalate ? 'escalated' : 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_message_send',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `AI response sent (confidence: ${aiResponse.confidence}, escalated: ${shouldEscalate})`
    });

    return { aiResponse, escalated: shouldEscalate };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_message_send',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to send message'
    });
    throw error;
  }
});

export const escalateConversation = onCall(async (request) => {
  const { conversationId, escalationPath, userId } = request.data;
  const start = Date.now();
  
  try {
    await db.collection('conversations').doc(conversationId).update({
      escalated: true,
      status: 'escalated',
      escalatedTo: escalationPath.contactName,
      escalatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Add escalation message
    await db.collection('conversations').doc(conversationId).update({
      messages: admin.firestore.FieldValue.arrayUnion({
        id: Date.now().toString(),
        sender: 'system',
        content: `This conversation has been escalated to ${escalationPath.contactName} (${escalationPath.contactEmail}). You will receive a response shortly.`,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      })
    });

    await logAIAction({
      userId,
      actionType: 'ai_chat_conversation_escalate',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Conversation escalated to ${escalationPath.contactName}`
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'ai_chat_conversation_escalate',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to escalate conversation'
    });
    throw error;
  }
});

// Helper function to generate AI response
async function generateAIResponse(message: string, settings: any, customerId: string) {
  try {
    // Get customer-specific context
    const customerContext = await getCustomerContext(customerId);
    
    // Build system prompt
    const systemPrompt = buildSystemPrompt(settings, customerContext);
    
    // Call OpenAI
    const openaiResponse = await callOpenAI(systemPrompt, message);
    
    return {
      content: openaiResponse.content,
      confidence: openaiResponse.confidence,
      tone: settings?.customerSettings?.companyTone || settings?.systemDefaults?.defaultTone
    };
  } catch (error) {
    console.error('Error generating AI response:', error);
    return {
      content: "I'm sorry, I'm having trouble processing your request right now. Please try again or contact HR directly.",
      confidence: 0.0,
      tone: 'professional'
    };
  }
}

// Helper function to get customer context
async function getCustomerContext(customerId: string) {
  try {
    const [toneDoc, handbookDoc] = await Promise.all([
      db.collection('customers').doc(customerId).collection('aiSettings').doc('tone').get(),
      db.collection('customers').doc(customerId).collection('aiSettings').doc('handbook').get()
    ]);
    
    return {
      tone: toneDoc.exists ? toneDoc.data() : null,
      handbook: handbookDoc.exists ? handbookDoc.data() : null
    };
  } catch (error) {
    console.error('Error getting customer context:', error);
    return { tone: null, handbook: null };
  }
}

// Helper function to build system prompt
function buildSystemPrompt(settings: any, customerContext: any) {
  let prompt = `You are an HR assistant for the HRX platform. You help workers with HR-related questions and concerns. `;
  
  if (customerContext.handbook) {
    prompt += `\n\nCompany Handbook:\n${customerContext.handbook.content}\n`;
  }
  
  if (settings?.systemDefaults?.enableHRXHandbook) {
    prompt += `\n\nHRX Default Policies:\n- Standard PTO policies\n- Basic labor law information\n- Common HR procedures\n`;
  }
  
  prompt += `\n\nGuidelines:\n- Be helpful and supportive\n- Use a ${customerContext.tone?.tone || settings?.customerSettings?.companyTone || 'professional'} tone\n- If you're not confident about an answer, suggest escalating to HR\n- For urgent matters (harassment, safety), always escalate\n- Keep responses concise but thorough\n`;
  
  return prompt;
}

// Helper function to call OpenAI
async function callOpenAI(systemPrompt: string, userMessage: string) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
  
  const payload = {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_completion_tokens: 500,
    temperature: 0.7
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || 'No response from AI.';
  
  // Simple confidence scoring based on response length and content
  const confidence = Math.min(0.9, Math.max(0.3, content.length / 200));
  
  return { content, confidence };
}

// Helper function to escalate conversation internally
async function escalateConversationInternal(conversationId: string, conversation: any, settings: any) {
  // Find appropriate escalation path based on conversation content
  const escalationPaths = settings?.customerSettings?.escalationPaths || [];
  
  // Simple escalation logic - can be enhanced with topic classification
  const defaultPath = escalationPaths.find((p: any) => p.category === 'General') || 
                     escalationPaths[0] || 
                     { contactName: 'HR Team', contactEmail: settings?.systemDefaults?.fallbackContact };
  
  await db.collection('conversations').doc(conversationId).update({
    escalated: true,
    status: 'escalated',
    escalatedTo: defaultPath.contactName,
    escalatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

export const getAIChatAnalytics = onCall(async (request) => {
  try {
    const now = new Date();
    const weeks = 7;
    const weekBuckets: { [key: string]: any } = {};
    const faqCounts: { [key: string]: number } = {};
    let totalSatisfaction = 0;
    let satisfactionCount = 0;

    // Prepare week keys
    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() - (6 - i) * 7);
      const key = weekStart.toISOString().slice(0, 10);
      weekBuckets[key] = { count: 0, escalated: 0, sentimentSum: 0, sentimentCount: 0 };
    }

    // Query last 7 weeks of conversations
    const since = new Date(now);
    since.setDate(now.getDate() - weeks * 7);
    const snapshot = await db.collection('conversations')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(since))
      .get();

    snapshot.forEach((doc: any) => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate?.() || new Date();
      // Find week bucket
      const weekStart = new Date(createdAt);
      weekStart.setDate(createdAt.getDate() - createdAt.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weekBuckets[key]) return;
      weekBuckets[key].count++;
      if (data.escalated) weekBuckets[key].escalated++;
      // Sentiment
      if (typeof data.sentiment === 'number') {
        weekBuckets[key].sentimentSum += data.sentiment;
        weekBuckets[key].sentimentCount++;
      }
      // Satisfaction
      if (typeof data.satisfaction === 'number') {
        totalSatisfaction += data.satisfaction;
        satisfactionCount++;
      }
      // FAQ leaderboard (count first AI message/question)
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        const firstMsg = data.messages[0];
        if (firstMsg && firstMsg.content) {
          const q = firstMsg.content.trim();
          faqCounts[q] = (faqCounts[q] || 0) + 1;
        }
      }
    });

    // Prepare analytics arrays
    const weekKeys = Object.keys(weekBuckets).sort();
    const conversationVolume = weekKeys.map(k => weekBuckets[k].count);
    const escalationRate = weekKeys.map(k => weekBuckets[k].count ? weekBuckets[k].escalated / weekBuckets[k].count : 0);
    const sentiment = weekKeys.map(k => weekBuckets[k].sentimentCount ? weekBuckets[k].sentimentSum / weekBuckets[k].sentimentCount : 0);
    const satisfaction = satisfactionCount ? totalSatisfaction / satisfactionCount : 0.87;
    const faqLeaderboard = Object.entries(faqCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([question, count]) => ({ question, count }));

    return {
      conversationVolume,
      escalationRate,
      satisfaction,
      sentiment,
      faqLeaderboard
    };
  } catch (err) {
    // Fallback to mock data
    return {
      conversationVolume: [12, 18, 25, 30, 22, 28, 35],
      escalationRate: [0.1, 0.15, 0.2, 0.12, 0.18, 0.22, 0.13],
      satisfaction: 0.87,
      sentiment: [0.2, 0.1, 0.3, 0.15, 0.05, 0.25, 0.18],
      faqLeaderboard: [
        { question: 'How do I request time off?', count: 14 },
        { question: 'When is payday?', count: 11 },
        { question: 'What if I am sick?', count: 8 },
        { question: 'How do I update my address?', count: 6 },
      ]
    };
  }
});

// FAQ Suggestions for Worker Chat
export const getFAQSuggestions = onCall(async (request) => {
  const { workerId, currentMessage } = request.data;
  const start = Date.now();
  
  try {
    // Mock FAQ suggestions based on message content and customer context
    const suggestions = [
      { id: '1', question: 'How do I request PTO?' },
      { id: '2', question: 'What is the company holiday policy?' },
      { id: '3', question: 'How do I update my address?' },
      { id: '4', question: 'What are the benefits options?' },
      { id: '5', question: 'How do I report a workplace issue?' }
    ];
    
    // Filter suggestions based on current message content
    const filteredSuggestions = suggestions.filter(suggestion => 
      suggestion.question.toLowerCase().includes(currentMessage?.toLowerCase() || '')
    ).slice(0, 3);
    
    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_faq_suggestions',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Generated ${filteredSuggestions.length} FAQ suggestions`
    });

    return { suggestions: filteredSuggestions };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_faq_suggestions',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to get FAQ suggestions'
    });
    throw error;
  }
});

// Schedule Recurring Check-ins
export const scheduleRecurringCheckinV2 = onCall(async (request) => {
  const { workerId, customerId, frequency, nextCheckinDate } = request.data;
  const start = Date.now();
  
  try {
    // Create or update check-in schedule
    const checkinRef = await db.collection('checkins').add({
      workerId,
      customerId,
      frequency, // 'weekly', 'monthly', 'quarterly'
      nextCheckinDate: new Date(nextCheckinDate),
      status: 'scheduled',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_checkin_schedule',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Scheduled ${frequency} check-in for ${nextCheckinDate}`
    });

    return { checkinId: checkinRef.id };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_checkin_schedule',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to schedule check-in'
    });
    throw error;
  }
});

// Get Pending Check-ins for Worker
export const getPendingCheckins = onCall(async (request) => {
  const { workerId } = request.data;
  const start = Date.now();
  
  try {
    const now = new Date();
    const checkinsSnapshot = await db.collection('checkins')
      .where('workerId', '==', workerId)
      .where('status', '==', 'scheduled')
      .where('nextCheckinDate', '<=', now)
      .get();
    
    const pendingCheckins = checkinsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_checkin_pending',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Found ${pendingCheckins.length} pending check-ins`
    });

    return { checkins: pendingCheckins };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'ai_chat_checkin_pending',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to get pending check-ins'
    });
    throw error;
  }
});

// Analyze Conversation Sentiment
export const analyzeConversationSentiment = onCall(async (request) => {
  const { conversationId, overrideSentiment } = request.data;
  const start = Date.now();
  
  try {
    const conversationDoc = await db.collection('conversations').doc(conversationId).get();
    if (!conversationDoc.exists) {
      throw new Error('Conversation not found');
    }
    
    const conversation = conversationDoc.data()!;
    if (!conversation) {
      throw new Error('Conversation data is null');
    }
    let sentiment = 0;
    if (typeof overrideSentiment === 'number') {
      sentiment = overrideSentiment;
    } else {
      const messages = conversation.messages || [];
      const messageText = messages.map((m: any) => m.content).join(' ');
      const openaiResponse = await callOpenAI(
        'Analyze the sentiment of this conversation. Return only a number between -1 (very negative) and 1 (very positive).',
        messageText
      );
      sentiment = parseFloat(openaiResponse.content) || 0;
    }
    // Update conversation with sentiment
    await db.collection('conversations').doc(conversationId).update({
      sentiment,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // --- Automation: Read rules and trigger actions ---
    const rulesDoc = await db.collection('modules').doc('ai-chat').get();
    const automationRules = rulesDoc.exists && rulesDoc.data()?.automationRules ? rulesDoc.data()!.automationRules : {
      sentimentCheckinThreshold: -0.3,
      checkinDelayDays: 3,
      sentimentEscalateThreshold: -0.5
    };
    const workerId = conversation.workerId;
    const customerId = conversation.customerId ?? null;
    let actionsTaken: string[] = [];

    // If sentiment is below check-in threshold, schedule a check-in and update traits
    if (sentiment < automationRules.sentimentCheckinThreshold) {
      // Update worker traits (increase frustration)
      const userRef = db.collection('users').doc(workerId);
      await userRef.set({
        traits: { frustration: admin.firestore.FieldValue.increment(1) }
      }, { merge: true });
      actionsTaken.push('traits.frustration++');
      // Schedule a check-in
      const checkinDate = new Date();
      checkinDate.setDate(checkinDate.getDate() + (automationRules.checkinDelayDays || 3));
      await db.collection('checkins').add({
        workerId,
        customerId,
        frequency: 'ad-hoc',
        nextCheckinDate: checkinDate,
        status: 'scheduled',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'auto-scheduled due to negative sentiment'
      });
      actionsTaken.push('scheduled_checkin');
    }
    // If sentiment is very negative, escalate
    if (sentiment < automationRules.sentimentEscalateThreshold) {
      await db.collection('conversations').doc(conversationId).update({
        escalated: true,
        status: 'escalated',
        escalatedAt: admin.firestore.FieldValue.serverTimestamp(),
        escalationReason: 'auto-escalated due to very negative sentiment'
      });
      actionsTaken.push('escalated');
    }
    // Log feedback for self-improvement
    await db.collection('ai_automation_feedback').add({
      conversationId,
      workerId,
      sentiment,
      actionsTaken,
      rules: automationRules,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    await logAIAction({
      userId: conversation.workerId,
      actionType: 'ai_chat_sentiment_analysis',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Analyzed sentiment: ${sentiment.toFixed(2)} | Actions: ${actionsTaken.join(', ')}`
    });
    return { sentiment, actionsTaken };
  } catch (error: any) {
    await logAIAction({
      userId: 'unknown',
      actionType: 'ai_chat_sentiment_analysis',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to analyze sentiment'
    });
    throw error;
  }
});

// Scheduled Check-in Trigger (runs daily at 9 AM)
export const triggerScheduledCheckins = onSchedule('0 9 * * *', async (event) => {
  const start = Date.now();
  
  try {
    const now = new Date();
    const checkinsSnapshot = await db.collection('checkins')
      .where('status', '==', 'scheduled')
      .where('nextCheckinDate', '<=', now)
      .get();
    
    const triggeredCheckins = [];
    
    for (const doc of checkinsSnapshot.docs) {
      const checkin = doc.data();
      
      // Create notification for the worker
      await db.collection('notifications').add({
        userId: checkin.workerId,
        type: 'checkin_reminder',
        title: 'HR Check-in Due',
        message: `It's time for your ${checkin.frequency} HR check-in. How are things going?`,
        data: {
          checkinId: doc.id,
          frequency: checkin.frequency,
          customerId: checkin.customerId
        },
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Update check-in status
      await doc.ref.update({
        status: 'triggered',
        triggeredAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      triggeredCheckins.push(doc.id);
    }
    
    console.log(`Triggered ${triggeredCheckins.length} check-ins`);
    
    await logAIAction({
      userId: 'system',
      actionType: 'ai_chat_checkin_trigger',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Triggered ${triggeredCheckins.length} scheduled check-ins`
    });
  } catch (error: any) {
    console.error('Error triggering check-ins:', error);
    
    await logAIAction({
      userId: 'system',
      actionType: 'ai_chat_checkin_trigger',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to trigger scheduled check-ins'
    });
    
    throw error;
  }
});

// Real-time Analytics for AI Chat
export const getRealTimeAIChatAnalytics = onCall(async (request) => {
  const { customerId, timeRange } = request.data;
  const start = Date.now();
  
  try {
    const now = new Date();
    const timeRangeMs = timeRange || 7 * 24 * 60 * 60 * 1000; // Default 7 days
    const startTime = new Date(now.getTime() - timeRangeMs);
    
    // Get conversations
    let conversationsQuery = db.collection('conversations')
      .where('createdAt', '>=', startTime);
    
    if (customerId) {
      conversationsQuery = conversationsQuery.where('customerId', '==', customerId);
    }
    
    const conversationsSnapshot = await conversationsQuery.get();
    const conversations = conversationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    // Get feedback
    let feedbackQuery = db.collection('ai_automation_feedback')
      .where('timestamp', '>=', startTime);
    
    if (customerId) {
      feedbackQuery = feedbackQuery.where('customerId', '==', customerId);
    }
    
    const feedbackSnapshot = await feedbackQuery.get();
    const feedback = feedbackSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    // Get check-ins
    let checkinsQuery = db.collection('checkins')
      .where('createdAt', '>=', startTime);
    
    if (customerId) {
      checkinsQuery = checkinsQuery.where('customerId', '==', customerId);
    }
    
    const checkinsSnapshot = await checkinsQuery.get();
    const checkins = checkinsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    // Calculate metrics
    const totalConversations = conversations.length;
    const activeConversations = conversations.filter((c: any) => c.status === 'active').length;
    const escalatedConversations = conversations.filter((c: any) => c.escalated).length;
    const avgSentiment = conversations.reduce((sum, c: any) => sum + (c.sentiment || 0), 0) / totalConversations || 0;
    
    // Automation metrics
    const autoCheckins = feedback.filter((f: any) => f.actionsTaken?.includes('scheduled_checkin')).length;
    const autoEscalations = feedback.filter((f: any) => f.actionsTaken?.includes('escalated')).length;
    const traitUpdates = feedback.filter((f: any) => f.actionsTaken?.includes('traits.frustration++')).length;
    
    // Satisfaction tracking
    const satisfactionScores = conversations
      .filter((c: any) => c.satisfactionScore !== undefined)
      .map((c: any) => c.satisfactionScore);
    const avgSatisfaction = satisfactionScores.length > 0 
      ? satisfactionScores.reduce((sum, score) => sum + score, 0) / satisfactionScores.length 
      : null;
    
    // Customer/agency specific metrics
    const customerMetrics = customerId ? {
      totalWorkers: new Set(conversations.map((c: any) => c.workerId)).size,
      avgConversationsPerWorker: totalConversations / new Set(conversations.map((c: any) => c.workerId)).size || 0,
      topIssues: getTopIssues(conversations),
      satisfactionTrend: getSatisfactionTrend(conversations, timeRangeMs)
    } : null;
    
    // Real-time activity (last 24 hours)
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentConversations = conversations.filter((c: any) => c.createdAt >= last24h).length;
    const recentCheckins = checkins.filter((c: any) => c.createdAt >= last24h).length;
    
    const analytics = {
      overview: {
        totalConversations,
        activeConversations,
        escalatedConversations,
        avgSentiment: parseFloat(avgSentiment.toFixed(3)),
        avgSatisfaction: avgSatisfaction ? parseFloat(avgSatisfaction.toFixed(3)) : null,
        recentActivity: {
          conversations24h: recentConversations,
          checkins24h: recentCheckins
        }
      },
      automation: {
        autoCheckins,
        autoEscalations,
        traitUpdates,
        overrideRate: feedback.length > 0 ? 
          feedback.filter(f => f.adminStatus === 'needs_improvement').length / feedback.length : 0
      },
      customer: customerMetrics,
      trends: {
        conversationsByDay: getConversationsByDay(conversations, timeRangeMs),
        sentimentByDay: getSentimentByDay(conversations, timeRangeMs),
        satisfactionByDay: getSatisfactionByDay(conversations, timeRangeMs)
      }
    };
    
    await logAIAction({
      userId: 'admin',
      actionType: 'ai_chat_analytics_generate',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Generated real-time analytics for ${customerId || 'all'} customers`
    });
    
    return { analytics };
  } catch (error: any) {
    await logAIAction({
      userId: 'admin',
      actionType: 'ai_chat_analytics_generate',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to generate analytics'
    });
    throw error;
  }
});

// Helper functions for analytics
function getTopIssues(conversations: any[]) {
  const issues = conversations
    .map(c => c.tags || [])
    .flat()
    .filter(tag => tag.startsWith('issue:'))
    .map(tag => tag.replace('issue:', ''));
  
  const issueCounts = issues.reduce((acc, issue) => {
    acc[issue] = (acc[issue] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return Object.entries(issueCounts)
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([issue, count]) => ({ issue, count }));
}

function getSatisfactionTrend(conversations: any[], timeRangeMs: number) {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const trend = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const dayConversations = conversations.filter(c => 
      c.createdAt >= dayStart && c.createdAt < dayEnd
    );
    
    const satisfactionScores = dayConversations
      .filter(c => c.satisfactionScore !== undefined)
      .map(c => c.satisfactionScore);
    
    const avgSatisfaction = satisfactionScores.length > 0 
      ? satisfactionScores.reduce((sum, score) => sum + score, 0) / satisfactionScores.length 
      : null;
    
    trend.push({
      date: dayStart.toISOString().split('T')[0],
      satisfaction: avgSatisfaction,
      conversations: dayConversations.length
    });
  }
  
  return trend;
}

function getConversationsByDay(conversations: any[], timeRangeMs: number) {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const data = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const dayConversations = conversations.filter(c => 
      c.createdAt >= dayStart && c.createdAt < dayEnd
    );
    
    data.push({
      date: dayStart.toISOString().split('T')[0],
      count: dayConversations.length
    });
  }
  
  return data;
}

function getSentimentByDay(conversations: any[], timeRangeMs: number) {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const data = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const dayConversations = conversations.filter(c => 
      c.createdAt >= dayStart && c.createdAt < dayEnd
    );
    
    const avgSentiment = dayConversations.length > 0 
      ? dayConversations.reduce((sum, c) => sum + (c.sentiment || 0), 0) / dayConversations.length 
      : 0;
    
    data.push({
      date: dayStart.toISOString().split('T')[0],
      sentiment: parseFloat(avgSentiment.toFixed(3))
    });
  }
  
  return data;
}

function getSatisfactionByDay(conversations: any[], timeRangeMs: number) {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const data = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const dayConversations = conversations.filter(c => 
      c.createdAt >= dayStart && c.createdAt < dayEnd
    );
    
    const satisfactionScores = dayConversations
      .filter(c => c.satisfactionScore !== undefined)
      .map(c => c.satisfactionScore);
    
    const avgSatisfaction = satisfactionScores.length > 0 
      ? satisfactionScores.reduce((sum, score) => sum + score, 0) / satisfactionScores.length 
      : null;
    
    data.push({
      date: dayStart.toISOString().split('T')[0],
      satisfaction: avgSatisfaction
    });
  }
  
  return data;
}

// Customer-specific FAQ and Handbook Management
export const manageCustomerFAQ = onCall(async (request) => {
  const { action, customerId, agencyId, data } = request.data;
  const start = Date.now();
  
  try {
    switch (action) {
      case 'get':
        let faqQuery = db.collection('customer_faqs')
          .where('customerId', '==', customerId);
        if (agencyId) {
          faqQuery = faqQuery.where('agencyId', '==', agencyId);
        }
        const faqSnapshot = await faqQuery.get();
        const faqs = faqSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        return { faqs };
        
      case 'add':
        const newFAQ = {
          customerId,
          agencyId: agencyId || null,
          question: data.question,
          answer: data.answer,
          category: data.category || 'general',
          tags: data.tags || [],
          priority: data.priority || 'medium',
          createdAt: new Date(),
          updatedAt: new Date(),
          usageCount: 0,
          lastUsed: null
        };
        const faqRef = await db.collection('customer_faqs').add(newFAQ);
        return { id: faqRef.id, ...newFAQ };
        
      case 'update':
        const updateData = {
          ...data,
          updatedAt: new Date()
        };
        await db.collection('customer_faqs').doc(data.id).update(updateData);
        return { success: true };
        
      case 'delete':
        await db.collection('customer_faqs').doc(data.id).delete();
        return { success: true };
        
      case 'increment_usage':
        await db.collection('customer_faqs').doc(data.id).update({
          usageCount: admin.firestore.FieldValue.increment(1),
          lastUsed: new Date()
        });
        return { success: true };
        
      default:
        throw new Error('Invalid action');
    }
  } catch (error: any) {
    await logAIAction({
      userId: 'admin',
      actionType: 'customer_faq_manage',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to ${action} FAQ for customer ${customerId}`
    });
    throw error;
  }
});

// Advanced Satisfaction Tracking and Feedback Loop
export const trackSatisfaction = onCall(async (request) => {
  const { conversationId, satisfactionScore, feedback, customerId, workerId } = request.data;
  const start = Date.now();
  
  try {
    // Update conversation with satisfaction data
    await db.collection('conversations').doc(conversationId).update({
      satisfactionScore,
      feedback,
      satisfactionTrackedAt: new Date()
    });
    
    // Create satisfaction tracking record
    const satisfactionRecord = {
      conversationId,
      customerId,
      workerId,
      satisfactionScore,
      feedback,
      timestamp: new Date(),
      analyzed: false
    };
    
    await db.collection('satisfaction_tracking').add(satisfactionRecord);
    
    // Trigger satisfaction analysis if score is low
    if (satisfactionScore < 3) {
      await analyzeLowSatisfaction(conversationId, customerId, workerId, satisfactionScore, feedback);
    }
    
    await logAIAction({
      userId: workerId,
      actionType: 'satisfaction_tracked',
      sourceModule: 'AIChat',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Satisfaction tracked: ${satisfactionScore}/5 for conversation ${conversationId}`
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'satisfaction_tracked',
      sourceModule: 'AIChat',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to track satisfaction'
    });
    throw error;
  }
});

// Analyze low satisfaction and trigger improvements
async function analyzeLowSatisfaction(conversationId: string, customerId: string, workerId: string, score: number, feedback: string) {
  try {
    // Get conversation details
    const conversationDoc = await db.collection('conversations').doc(conversationId).get();
    const conversation = conversationDoc.data();
    
    if (!conversation) return;
    
    // Create improvement suggestion
    const improvementSuggestion = {
      conversationId,
      customerId,
      workerId,
      originalScore: score,
      feedback,
      conversationContext: conversation.messages?.slice(-5), // Last 5 messages
      suggestedImprovements: [],
      createdAt: new Date(),
      status: 'pending_review'
    };
    
    // Generate AI-powered improvement suggestions
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    const prompt = `Analyze this low-satisfaction conversation and suggest improvements:

Conversation Score: ${score}/5
Feedback: ${feedback}
Last Messages: ${JSON.stringify(conversation.messages?.slice(-5))}

Provide 3-5 specific, actionable improvements for:
1. Response quality and accuracy
2. Tone and empathy
3. Escalation timing
4. Knowledge base gaps
5. System improvements

Format as JSON array of improvement objects with fields: category, suggestion, priority`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    });

    const suggestions = JSON.parse(completion.choices[0].message.content || '[]');
    improvementSuggestion.suggestedImprovements = suggestions;
    
    await db.collection('improvement_suggestions').add(improvementSuggestion);
    
    // Trigger immediate escalation if score is very low
    if (score <= 2) {
      const customerSettings = await getCurrentConfig(customerId, 'ai_settings');
      await escalateConversationInternal(conversationId, conversation, customerSettings);
    }
    
  } catch (error) {
    console.error('Error analyzing low satisfaction:', error);
  }
}

// AI Feedback Loop & Continuous Learning Functions

// Collect and analyze AI feedback for continuous learning
export const collectAIFeedback = onCall(async (request) => {
  const { feedbackType, feedbackData, userId, customerId, moduleId } = request.data;
  const start = Date.now();
  
  try {
    // Create feedback record
    const feedbackRecord: any = {
      feedbackType, // 'satisfaction', 'accuracy', 'helpfulness', 'tone', 'escalation'
      feedbackData,
      userId,
      customerId,
      moduleId,
      timestamp: new Date(),
      analyzed: false,
      learningApplied: false,
      confidenceScore: feedbackData.confidence || 0,
      satisfactionScore: feedbackData.satisfaction || 0,
      improvementAreas: [],
      suggestedActions: []
    };

    // Analyze feedback for learning opportunities
    const analysis = await analyzeFeedbackForLearning(feedbackRecord);
    feedbackRecord.analysis = analysis;
    feedbackRecord.analyzed = true;

    // Store feedback
    const feedbackRef = await db.collection('ai_feedback_loop').add(feedbackRecord);

    // Trigger learning if confidence is low or satisfaction is poor
    if (feedbackData.confidence < 0.7 || feedbackData.satisfaction < 3) {
      await triggerLearningCycle(feedbackRecord, analysis);
    }

    await logAIAction({
      userId,
      actionType: 'ai_feedback_collected',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Collected ${feedbackType} feedback for ${moduleId}`,
      eventType: 'feedback.collected',
      targetType: 'feedback',
      targetId: feedbackRef.id,
      aiRelevant: true,
      contextType: 'feedback_loop',
      traitsAffected: null,
      aiTags: ['feedback', 'learning', 'improvement'],
      urgencyScore: feedbackData.confidence < 0.7 ? 0.8 : 0.4
    });

    return { success: true, feedbackId: feedbackRef.id };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'ai_feedback_collected',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to collect AI feedback'
    });
    throw error;
  }
});

// Analyze feedback for learning opportunities
async function analyzeFeedbackForLearning(feedbackRecord: any) {
  const analysis: any = {
    learningOpportunities: [],
    patternMatches: [],
    improvementSuggestions: [],
    confidenceImpact: 0,
    satisfactionImpact: 0
  };

  // Analyze patterns in feedback
  const similarFeedback = await db.collection('ai_feedback_loop')
    .where('feedbackType', '==', feedbackRecord.feedbackType)
    .where('moduleId', '==', feedbackRecord.moduleId)
    .where('timestamp', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
    .get();

  const feedbackHistory = similarFeedback.docs.map(doc => doc.data());
  
  // Identify patterns
  if (feedbackHistory.length > 5) {
    const avgConfidence = feedbackHistory.reduce((sum, f) => sum + f.confidenceScore, 0) / feedbackHistory.length;
    const avgSatisfaction = feedbackHistory.reduce((sum, f) => sum + f.satisfactionScore, 0) / feedbackHistory.length;
    
    analysis.confidenceImpact = feedbackRecord.confidenceScore - avgConfidence;
    analysis.satisfactionImpact = feedbackRecord.satisfactionScore - avgSatisfaction;
    
    // Identify improvement areas
    if (analysis.confidenceImpact < -0.2) {
      analysis.improvementSuggestions.push({
        area: 'confidence',
        suggestion: 'Improve response accuracy and relevance',
        priority: 'high'
      });
    }
    
    if (analysis.satisfactionImpact < -1) {
      analysis.improvementSuggestions.push({
        area: 'satisfaction',
        suggestion: 'Enhance user experience and tone',
        priority: 'high'
      });
    }
  }

  return analysis;
}

// Trigger learning cycle based on feedback
async function triggerLearningCycle(feedbackRecord: any, analysis: any) {
  try {
    // Create learning task
    const learningTask = {
      feedbackId: feedbackRecord.id,
      moduleId: feedbackRecord.moduleId,
      customerId: feedbackRecord.customerId,
      learningType: 'feedback_based',
      priority: analysis.improvementSuggestions.some((s: any) => s.priority === 'high') ? 'high' : 'medium',
      status: 'pending',
      createdAt: new Date(),
      analysis,
      suggestedActions: analysis.improvementSuggestions,
      appliedChanges: []
    };

    await db.collection('ai_learning_tasks').add(learningTask);

    // Trigger immediate learning for high-priority issues
    if (learningTask.priority === 'high') {
      await applyImmediateLearning(feedbackRecord, analysis);
    }
  } catch (error) {
    console.error('Error triggering learning cycle:', error);
  }
}

// Apply immediate learning for critical issues
async function applyImmediateLearning(feedbackRecord: any, analysis: any) {
  try {
    // Get current module configuration
    const moduleConfig = await getCurrentConfig(feedbackRecord.customerId, feedbackRecord.moduleId);
    const changes = [];

    if (moduleConfig) {
      const config = moduleConfig as any;
      for (const suggestion of analysis.improvementSuggestions) {
        if (suggestion.area === 'confidence') {
          if (config.confidenceThreshold !== undefined) {
            const oldThreshold = config.confidenceThreshold;
            config.confidenceThreshold = Math.max(0.5, oldThreshold - 0.1);
            if (config.confidenceThreshold !== oldThreshold) {
              changes.push('Lowered confidence threshold');
            }
          }
        }

        if (suggestion.area === 'satisfaction') {
          if (config.toneSettings) {
            const oldEmpathy = config.toneSettings.empathy || 0.5;
            config.toneSettings.empathy = Math.min(1.0, oldEmpathy + 0.1);
            if (config.toneSettings.empathy !== oldEmpathy) {
              changes.push('Increased empathy in tone settings');
            }
          }
        }
      }

      if (changes.length > 0) {
        // 🔧 Persist the changes - use direct Firestore update
        try {
          await db.collection('customers')
            .doc(feedbackRecord.customerId)
            .collection('aiSettings')
            .doc(feedbackRecord.moduleId)
            .set(config, { merge: true });
        } catch (error) {
          console.error('Error updating AI settings:', error);
        }

        // 🧠 Log AI learning action
        await logAIAction({
          userId: 'system',
          actionType: 'ai_learning_applied',
          sourceModule: 'AIFeedbackLoop',
          success: true,
          latencyMs: 0,
          versionTag: 'v1',
          reason: `Applied learning: ${changes.join(', ')}`,
          eventType: 'learning.applied',
          targetType: 'configuration',
          targetId: feedbackRecord.moduleId,
          aiRelevant: true,
          contextType: 'learning',
          traitsAffected: null,
          aiTags: ['learning', 'improvement', 'automation'],
          urgencyScore: 0.7
        });

        console.log('✅ Applied and logged immediate learning:', changes);
      } else {
        console.log('ℹ️ No actionable changes based on suggestions.');
      }
    }
  } catch (error) {
    console.error('❌ Error applying immediate learning:', error);
  }
}

// Generate AI performance insights and recommendations
export const generateAIPerformanceInsights = onCall(async (request) => {
  const { customerId, moduleId, timeRange } = request.data;
  const start = Date.now();
  
  try {
    // Get feedback data
    const feedbackQuery = db.collection('ai_feedback_loop')
      .where('customerId', '==', customerId);
    
    if (moduleId) {
      feedbackQuery.where('moduleId', '==', moduleId);
    }
    
    const cutoffTime = new Date(Date.now() - (parseInt(timeRange || '30') * 24 * 60 * 60 * 1000));
    feedbackQuery.where('timestamp', '>=', cutoffTime);
    
    const feedbackSnapshot = await feedbackQuery.get();
    const feedbackData = feedbackSnapshot.docs.map(doc => doc.data());

    // Generate insights
    const insights = await analyzePerformanceTrends(feedbackData, customerId, moduleId);
    
    // Store insights
    const insightsRecord = {
      customerId,
      moduleId,
      timeRange,
      insights,
      generatedAt: new Date(),
      feedbackCount: feedbackData.length
    };

    const insightsRef = await db.collection('ai_performance_insights').add(insightsRecord);

    await logAIAction({
      userId: 'system',
      actionType: 'ai_performance_insights_generated',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Generated performance insights for ${moduleId || 'all modules'}`,
      eventType: 'insights.generated',
      targetType: 'insights',
      targetId: insightsRef.id,
      aiRelevant: true,
      contextType: 'performance_analysis',
      traitsAffected: null,
      aiTags: ['insights', 'performance', 'analytics'],
      urgencyScore: 0.3
    });

    return { success: true, insights };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'ai_performance_insights_generated',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to generate performance insights'
    });
    throw error;
  }
});

// Analyze performance trends
async function analyzePerformanceTrends(feedbackData: any[], customerId: string, moduleId?: string) {
  const insights = {
    overallPerformance: {
      averageConfidence: 0,
      averageSatisfaction: 0,
      totalFeedback: feedbackData.length,
      improvementTrend: 'stable'
    },
    moduleBreakdown: {} as any,
    topIssues: [] as Array<{ issue: string; count: number }>,
    recommendations: [] as Array<{ type: string; priority: string; suggestion: string; impact: string }>,
    learningProgress: {
      tasksCompleted: 0,
      improvementsApplied: 0,
      successRate: 0
    }
  };

  if (feedbackData.length === 0) {
    return insights;
  }

  // Calculate overall metrics
  insights.overallPerformance.averageConfidence = 
    feedbackData.reduce((sum, f) => sum + f.confidenceScore, 0) / feedbackData.length;
  insights.overallPerformance.averageSatisfaction = 
    feedbackData.reduce((sum, f) => sum + f.satisfactionScore, 0) / feedbackData.length;

  // Analyze trends
  const recentFeedback = feedbackData.filter(f => 
    new Date(f.timestamp).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
  );
  const olderFeedback = feedbackData.filter(f => 
    new Date(f.timestamp).getTime() <= Date.now() - 7 * 24 * 60 * 60 * 1000
  );

  if (recentFeedback.length > 0 && olderFeedback.length > 0) {
    const recentAvg = recentFeedback.reduce((sum, f) => sum + f.satisfactionScore, 0) / recentFeedback.length;
    const olderAvg = olderFeedback.reduce((sum, f) => sum + f.satisfactionScore, 0) / olderFeedback.length;
    
    if (recentAvg > olderAvg + 0.5) {
      insights.overallPerformance.improvementTrend = 'improving';
    } else if (recentAvg < olderAvg - 0.5) {
      insights.overallPerformance.improvementTrend = 'declining';
    }
  }

  // Identify top issues
  const issueCounts: { [key: string]: number } = {};
  feedbackData.forEach(f => {
    if (f.analysis?.improvementSuggestions) {
      f.analysis.improvementSuggestions.forEach((s: any) => {
        issueCounts[s.area] = (issueCounts[s.area] || 0) + 1;
      });
    }
  });

  insights.topIssues = Object.entries(issueCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([issue, count]) => ({ issue, count }));

  // Generate recommendations
  if (insights.overallPerformance.averageConfidence < 0.7) {
    insights.recommendations.push({
      type: 'confidence',
      priority: 'high',
      suggestion: 'Review and improve response accuracy and relevance',
      impact: 'high'
    });
  }

  if (insights.overallPerformance.averageSatisfaction < 3.5) {
    insights.recommendations.push({
      type: 'satisfaction',
      priority: 'high',
      suggestion: 'Enhance user experience and tone settings',
      impact: 'high'
    });
  }

  // Get learning progress
  const learningTasks = await db.collection('ai_learning_tasks')
    .where('customerId', '==', customerId)
    .where('status', '==', 'completed')
    .get();

  const completedTasks = learningTasks.docs.length;
  const appliedChanges = learningTasks.docs.filter(doc => 
    doc.data().appliedChanges && doc.data().appliedChanges.length > 0
  ).length;

  insights.learningProgress = {
    tasksCompleted: completedTasks,
    improvementsApplied: appliedChanges,
    successRate: completedTasks > 0 ? (appliedChanges / completedTasks) * 100 : 0
  };

  return insights;
}

// Get AI feedback data for dashboard
export const getAIFeedbackData = onCall(async (request) => {
  const { filters } = request.data;
  const start = Date.now();
  
  try {
    let feedbackQuery: any = db.collection('ai_feedback_loop');
    
    // Apply filters
    if (filters?.feedbackType && filters.feedbackType !== 'all') {
      feedbackQuery = feedbackQuery.where('feedbackType', '==', filters.feedbackType);
    }
    
    if (filters?.moduleId && filters.moduleId !== 'all') {
      feedbackQuery = feedbackQuery.where('moduleId', '==', filters.moduleId);
    }
    
    if (filters?.dateRange) {
      feedbackQuery = feedbackQuery
        .where('timestamp', '>=', new Date(filters.dateRange.start))
        .where('timestamp', '<=', new Date(filters.dateRange.end));
    }
    
    // Order by timestamp descending
    feedbackQuery = feedbackQuery.orderBy('timestamp', 'desc');
    
    const feedbackSnapshot = await feedbackQuery.get();
    const feedback = feedbackSnapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp.toDate()
    }));

    await logAIAction({
      userId: 'system',
      actionType: 'ai_feedback_data_retrieved',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Retrieved AI feedback data for dashboard',
      eventType: 'data.retrieved',
      targetType: 'feedback',
      targetId: 'dashboard',
      aiRelevant: true,
      contextType: 'dashboard',
      traitsAffected: null,
      aiTags: ['feedback', 'dashboard', 'analytics'],
      urgencyScore: 0.2
    });

    return { success: true, feedback };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'ai_feedback_data_retrieved',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to retrieve AI feedback data'
    });
    throw error;
  }
});

// Get AI learning tasks
export const getAILearningTasks = onCall(async (request) => {
  const { status } = request.data;
  const start = Date.now();
  
  try {
    let tasksQuery: any = db.collection('ai_learning_tasks');
    
    if (status && status !== 'all') {
      tasksQuery = tasksQuery.where('status', '==', status);
    }
    
    tasksQuery = tasksQuery.orderBy('createdAt', 'desc');
    
    const tasksSnapshot = await tasksQuery.get();
    const tasks = tasksSnapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate()
    }));

    await logAIAction({
      userId: 'system',
      actionType: 'ai_learning_tasks_retrieved',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Retrieved AI learning tasks',
      eventType: 'data.retrieved',
      targetType: 'learning_tasks',
      targetId: 'dashboard',
      aiRelevant: true,
      contextType: 'dashboard',
      traitsAffected: null,
      aiTags: ['learning', 'tasks', 'dashboard'],
      urgencyScore: 0.2
    });

    return { success: true, tasks };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'ai_learning_tasks_retrieved',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to retrieve AI learning tasks'
    });
    throw error;
  }
});

// Get feedback analytics
export const getFeedbackAnalytics = onCall(async (request) => {
  const start = Date.now();
  
  try {
    // Get feedback data for last 30 days
    const cutoffTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const feedbackSnapshot = await db.collection('ai_feedback_loop')
      .where('timestamp', '>=', cutoffTime)
      .get();
    
    const feedback = feedbackSnapshot.docs.map(doc => doc.data());
    
    // Calculate analytics
    const analytics = {
      totalFeedback: feedback.length,
      averageConfidence: feedback.length > 0 ? 
        feedback.reduce((sum, f) => sum + f.confidenceScore, 0) / feedback.length : 0,
      averageSatisfaction: feedback.length > 0 ? 
        feedback.reduce((sum, f) => sum + f.satisfactionScore, 0) / feedback.length : 0,
      feedbackByType: {} as Record<string, number>,
      feedbackByModule: {} as Record<string, number>,
      recentTrends: {
        confidence: [] as number[],
        satisfaction: [] as number[],
        dates: [] as string[]
      },
      learningTasks: {
        pending: 0,
        inProgress: 0,
        completed: 0,
        failed: 0
      }
    };
    
    // Calculate feedback by type
    feedback.forEach(f => {
      analytics.feedbackByType[f.feedbackType] = (analytics.feedbackByType[f.feedbackType] || 0) + 1;
      analytics.feedbackByModule[f.moduleId] = (analytics.feedbackByModule[f.moduleId] || 0) + 1;
    });
    
    // Get learning tasks status
    const tasksSnapshot = await db.collection('ai_learning_tasks').get();
    const tasks = tasksSnapshot.docs.map(doc => doc.data());
    
    tasks.forEach(task => {
      analytics.learningTasks[task.status as keyof typeof analytics.learningTasks]++;
    });
    
    // Calculate recent trends (last 7 days)
    const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentFeedback = feedback.filter(f => f.timestamp >= recentCutoff);
    
    // Group by day
    const dailyData: { [key: string]: { confidence: number[]; satisfaction: number[] } } = {};
    recentFeedback.forEach(f => {
      const date = new Date(f.timestamp).toDateString();
      if (!dailyData[date]) {
        dailyData[date] = { confidence: [], satisfaction: [] };
      }
      dailyData[date].confidence.push(f.confidenceScore);
      dailyData[date].satisfaction.push(f.satisfactionScore);
    });
    
    // Calculate daily averages
    Object.entries(dailyData).forEach(([date, data]) => {
      analytics.recentTrends.dates.push(date);
      analytics.recentTrends.confidence.push(
        data.confidence.reduce((sum, c) => sum + c, 0) / data.confidence.length
      );
      analytics.recentTrends.satisfaction.push(
        data.satisfaction.reduce((sum, s) => sum + s, 0) / data.satisfaction.length
      );
    });

    await logAIAction({
      userId: 'system',
      actionType: 'feedback_analytics_retrieved',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Retrieved feedback analytics',
      eventType: 'analytics.retrieved',
      targetType: 'analytics',
      targetId: 'dashboard',
      aiRelevant: true,
      contextType: 'analytics',
      traitsAffected: null,
      aiTags: ['analytics', 'feedback', 'dashboard'],
      urgencyScore: 0.2
    });

    return { success: true, analytics };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'feedback_analytics_retrieved',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to retrieve feedback analytics'
    });
    throw error;
  }
});

// Apply AI learning
export const applyAILearning = onCall(async (request) => {
  const { taskId } = request.data;
  const start = Date.now();
  
  try {
    // Get the learning task
    const taskDoc = await db.collection('ai_learning_tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Learning task not found');
    }
    
    const task = taskDoc.data()!;
    
    // Update task status
    await db.collection('ai_learning_tasks').doc(taskId).update({
      status: 'in_progress',
      startedAt: new Date()
    });
    
    // Apply the suggested actions
    const appliedChanges = [];
    
    for (const action of task.suggestedActions) {
      try {
        if (action.area === 'confidence') {
          // Apply confidence improvements
          appliedChanges.push(`Applied confidence improvement: ${action.suggestion}`);
        } else if (action.area === 'satisfaction') {
          // Apply satisfaction improvements
          appliedChanges.push(`Applied satisfaction improvement: ${action.suggestion}`);
        }
      } catch (error) {
        console.error(`Error applying action ${action.area}:`, error);
      }
    }
    
    // Update task with results
    await db.collection('ai_learning_tasks').doc(taskId).update({
      status: 'completed',
      completedAt: new Date(),
      appliedChanges,
      success: appliedChanges.length > 0
    });
    
    // Log the learning application
    await logAIAction({
      userId: 'system',
      actionType: 'ai_learning_applied',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Applied learning for task ${taskId}: ${appliedChanges.join(', ')}`,
      eventType: 'learning.applied',
      targetType: 'learning_task',
      targetId: taskId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: ['learning', 'improvement', 'automation'],
      urgencyScore: 0.7
    });

    return { success: true, appliedChanges };
  } catch (error: any) {
    // Update task status to failed
    if (taskId) {
      try {
        await db.collection('ai_learning_tasks').doc(taskId).update({
          status: 'failed',
          error: error.message,
          failedAt: new Date()
        });
      } catch (updateError) {
        console.error('Error updating task status:', updateError);
      }
    }
    
    await logAIAction({
      userId: 'system',
      actionType: 'ai_learning_applied',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to apply AI learning'
    });
    throw error;
  }
});

// Continuous learning scheduler
export const scheduleContinuousLearning = onCall(async (request) => {
  const { customerId, schedule } = request.data;
  const start = Date.now();
  
  try {
    const scheduleId = `${customerId}_continuous_learning_${Date.now()}`;
    
    const scheduleData = {
      customerId,
      schedule: {
        frequency: schedule.frequency || 'weekly',
        modules: schedule.modules || ['all'],
        timeRange: schedule.timeRange || '30',
        autoApply: schedule.autoApply || false
      },
      isActive: true,
      createdAt: new Date(),
      lastRun: null,
      nextRun: calculateNextLearningRun(schedule.frequency || 'weekly'),
      totalRuns: 0
    };

    await db.collection('ai_learning_schedules').doc(scheduleId).set(scheduleData);

    await logAIAction({
      userId: 'system',
      actionType: 'continuous_learning_scheduled',
      sourceModule: 'AIFeedbackLoop',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Scheduled continuous learning for ${customerId}`,
      eventType: 'learning.scheduled',
      targetType: 'schedule',
      targetId: scheduleId,
      aiRelevant: true,
      contextType: 'learning_schedule',
      traitsAffected: null,
      aiTags: ['learning', 'scheduling', 'automation'],
      urgencyScore: 0.3
    });

    return { success: true, scheduleId };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'continuous_learning_scheduled',
      sourceModule: 'AIFeedbackLoop',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to schedule continuous learning'
    });
    throw error;
  }
});

// Calculate next learning run
function calculateNextLearningRun(frequency: string): string {
  const now = new Date();
  
  switch (frequency) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

// Get improvement suggestions for admin review
export const getImprovementSuggestions = onCall(async (request) => {
  const { customerId, status } = request.data;
  
  try {
    let query: any = db.collection('improvement_suggestions');
    
    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    const snapshot = await query.orderBy('createdAt', 'desc').limit(50).get();
    const suggestions = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));
    
    return { suggestions };
  } catch (error: any) {
    throw error;
  }
});

// Update improvement suggestion status
export const updateImprovementStatus = onCall(async (request) => {
  const { suggestionId, status, adminNotes } = request.data;
  
  try {
    await db.collection('improvement_suggestions').doc(suggestionId).update({
      status,
      adminNotes,
      reviewedAt: new Date()
    });
    
    return { success: true };
  } catch (error: any) {
    throw error;
  }
});

// Broadcast Module Functions
export const createBroadcast = onCall(async (request) => {
  const { 
    senderId, 
    tenantId, 
    audienceFilter, 
    message, 
    aiAssistReplies, 
    escalationEmail,
    scheduledFor,
    templateId 
  } = request.data;
  const start = Date.now();
  
  try {
    // Validate audience filter
    if (!audienceFilter || Object.keys(audienceFilter).length === 0) {
      throw new Error('Audience filter is required');
    }
    
    // Get recipients based on filter
    const recipients = await getRecipientsByFilter(tenantId, audienceFilter);
    
    const broadcast = {
      senderId,
      tenantId,
      audienceFilter,
      message,
      aiAssistReplies: aiAssistReplies || false,
      escalationEmail: escalationEmail || null,
      scheduledFor: scheduledFor || null,
      templateId: templateId || null,
      status: scheduledFor ? 'scheduled' : 'ready',
      createdAt: new Date(),
      metadata: {
        numRecipients: recipients.length,
        numRead: 0,
        numReplied: 0,
        numEscalated: 0
      }
    };
    
    const broadcastRef = await db.collection('broadcasts').add(broadcast);
    
    // If not scheduled, send immediately
    if (!scheduledFor) {
      await sendBroadcastInternal(broadcastRef.id, recipients);
    }
    
    await logAIAction({
      userId: senderId,
      actionType: 'broadcast_created',
      sourceModule: 'Broadcast',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Created broadcast to ${recipients.length} recipients`
    });
    
    return { 
      broadcastId: broadcastRef.id, 
      numRecipients: recipients.length,
      status: broadcast.status 
    };
  } catch (error: any) {
    await logAIAction({
      userId: senderId,
      actionType: 'broadcast_created',
      sourceModule: 'Broadcast',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to create broadcast'
    });
    throw error;
  }
});

// Internal function for sending broadcasts
async function sendBroadcastInternal(broadcastId: string, recipients: any[]) {
  const start = Date.now();
  
  try {
    const broadcastDoc = await db.collection('broadcasts').doc(broadcastId).get();
    if (!broadcastDoc.exists) {
      throw new Error('Broadcast not found');
    }
    
    const broadcast = broadcastDoc.data()!;
    
    // If jobOrderId is present in the audienceFilter, fetch the job order's AI Prompts
    let aiPrompts = '';
    if (broadcast.audienceFilter && broadcast.audienceFilter.jobOrderId) {
      const jobOrderSnap = await db.collection('jobOrders').doc(broadcast.audienceFilter.jobOrderId).get();
      if (jobOrderSnap.exists) {
        const jobOrder = jobOrderSnap.data();
        if (jobOrder && jobOrder.aiPrompts) {
          aiPrompts = jobOrder.aiPrompts;
        }
      }
    }

    // Create notifications for each recipient, including AI Prompts if present
    const notifications = recipients.map(recipient => ({
      recipientId: recipient.id,
      broadcastId,
      tenantId: broadcast.tenantId,
      message: aiPrompts ? `${aiPrompts}\n\n${broadcast.message}` : broadcast.message,
      aiAssistReplies: broadcast.aiAssistReplies,
      escalationEmail: broadcast.escalationEmail,
      status: 'unread',
      createdAt: new Date(),
      readAt: null,
      repliedAt: null
    }));
    
    // Batch write notifications
    const batch = db.batch();
    notifications.forEach(notification => {
      const notificationRef = db.collection('broadcast_notifications').doc();
      batch.set(notificationRef, notification);
    });
    
    // Update broadcast status
    batch.update(db.collection('broadcasts').doc(broadcastId), {
      status: 'sent',
      sentAt: new Date(),
      'metadata.numRecipients': recipients.length
    });
    
    await batch.commit();
    
    await logAIAction({
      userId: broadcast.senderId,
      actionType: 'broadcast_sent',
      sourceModule: 'Broadcast',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Sent broadcast to ${recipients.length} recipients`
    });
    
    return { success: true, numRecipients: recipients.length };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'broadcast_sent',
      sourceModule: 'Broadcast',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to send broadcast'
    });
    throw error;
  }
}

export const sendBroadcast = onCall(async (request) => {
  const { broadcastId } = request.data;
  
  try {
    const broadcastDoc = await db.collection('broadcasts').doc(broadcastId).get();
    if (!broadcastDoc.exists) {
      throw new Error('Broadcast not found');
    }
    
    const broadcast = broadcastDoc.data()!;
    const recipients = await getRecipientsByFilter(broadcast.tenantId, broadcast.audienceFilter);
    
    return await sendBroadcastInternal(broadcastId, recipients);
  } catch (error: any) {
    throw error;
  }
});

export const replyToBroadcast = onCall(async (request) => {
  const { 
    notificationId, 
    workerId, 
    reply, 
    broadcastId 
  } = request.data;
  const start = Date.now();
  
  try {
    // Get broadcast details
    const broadcastDoc = await db.collection('broadcasts').doc(broadcastId).get();
    const broadcast = broadcastDoc.data()!;
    
    // Create reply record
    const replyRecord = {
      notificationId,
      broadcastId,
      workerId,
      reply,
      timestamp: new Date(),
      aiResponse: null,
      escalated: false,
      escalationReason: null
    };
    
    const replyRef = await db.collection('broadcast_replies').add(replyRecord);
    
    // Update notification status
    await db.collection('broadcast_notifications').doc(notificationId).update({
      status: 'replied',
      repliedAt: new Date()
    });
    
    // Update broadcast metadata
    await db.collection('broadcasts').doc(broadcastId).update({
      'metadata.numReplied': admin.firestore.FieldValue.increment(1)
    });
    
    let aiResponse = null;
    let escalated = false;
    let escalationReason = null;
    
    // Handle AI-assisted replies if enabled
    if (broadcast.aiAssistReplies) {
      const aiResult = await handleAIBroadcastReply(reply, broadcast, workerId);
      aiResponse = aiResult.response;
      escalated = aiResult.escalated;
      escalationReason = aiResult.escalationReason;
      
      if (escalated) {
        await db.collection('broadcast_replies').doc(replyRef.id).update({
          escalated: true,
          escalationReason: aiResult.escalationReason
        });
        
        await db.collection('broadcasts').doc(broadcastId).update({
          'metadata.numEscalated': admin.firestore.FieldValue.increment(1)
        });
      }
    }
    
    await logAIAction({
      userId: workerId,
      actionType: 'broadcast_reply',
      sourceModule: 'Broadcast',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Worker replied to broadcast, AI response: ${aiResponse ? 'generated' : 'none'}`
    });
    
    return { 
      success: true, 
      aiResponse, 
      escalated,
      escalationReason: escalated ? escalationReason : null
    };
  } catch (error: any) {
    await logAIAction({
      userId: workerId,
      actionType: 'broadcast_reply',
      sourceModule: 'Broadcast',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to process broadcast reply'
    });
    throw error;
  }
});

export const markBroadcastRead = onCall(async (request) => {
  const { notificationId } = request.data;
  
  try {
    await db.collection('broadcast_notifications').doc(notificationId).update({
      status: 'read',
      readAt: new Date()
    });
    
    // Update broadcast metadata
    const notificationDoc = await db.collection('broadcast_notifications').doc(notificationId).get();
    const notification = notificationDoc.data()!;
    
    await db.collection('broadcasts').doc(notification.broadcastId).update({
      'metadata.numRead': admin.firestore.FieldValue.increment(1)
    });
    
    return { success: true };
  } catch (error: any) {
    throw error;
  }
});

export const getBroadcastAnalytics = onCall(async (request) => {
  const { tenantId, timeRange } = request.data;
  const start = Date.now();
  
  try {
    const now = new Date();
    const timeRangeMs = timeRange || 30 * 24 * 60 * 60 * 1000; // Default 30 days
    const startTime = new Date(now.getTime() - timeRangeMs);
    
    // Get broadcasts
    const broadcastsSnapshot = await db.collection('broadcasts')
      .where('tenantId', '==', tenantId)
      .where('createdAt', '>=', startTime)
      .orderBy('createdAt', 'desc')
      .get();
    
    const broadcasts = broadcastsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    // Get replies for sentiment analysis
    const repliesSnapshot = await db.collection('broadcast_replies')
      .where('timestamp', '>=', startTime)
      .get();
    
    const replies = repliesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Calculate analytics
    const totalBroadcasts = broadcasts.length;
    const totalRecipients = broadcasts.reduce((sum: number, b: any) => sum + (b.metadata?.numRecipients || 0), 0);
    const totalRead = broadcasts.reduce((sum: number, b: any) => sum + (b.metadata?.numRead || 0), 0);
    const totalReplies = broadcasts.reduce((sum: number, b: any) => sum + (b.metadata?.numReplied || 0), 0);
    const totalEscalated = broadcasts.reduce((sum: number, b: any) => sum + (b.metadata?.numEscalated || 0), 0);
    
    const readRate = totalRecipients > 0 ? totalRead / totalRecipients : 0;
    const replyRate = totalRecipients > 0 ? totalReplies / totalRecipients : 0;
    const escalationRate = totalReplies > 0 ? totalEscalated / totalReplies : 0;
    
    // Analyze reply sentiment
    const sentiments = await analyzeReplySentiments(replies);
    
    const analytics = {
      overview: {
        totalBroadcasts,
        totalRecipients,
        totalRead,
        totalReplies,
        totalEscalated,
        readRate: parseFloat(readRate.toFixed(3)),
        replyRate: parseFloat(replyRate.toFixed(3)),
        escalationRate: parseFloat(escalationRate.toFixed(3))
      },
      sentiments,
      broadcastsByDay: getBroadcastsByDay(broadcasts, timeRangeMs),
      repliesByDay: getRepliesByDay(replies, timeRangeMs)
    };
    
    await logAIAction({
      userId: 'admin',
      actionType: 'broadcast_analytics_generate',
      sourceModule: 'Broadcast',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Generated analytics for ${tenantId}`
    });
    
    return { analytics };
  } catch (error: any) {
    await logAIAction({
      userId: 'admin',
      actionType: 'broadcast_analytics_generate',
      sourceModule: 'Broadcast',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to generate broadcast analytics'
    });
    throw error;
  }
});

// Helper functions
async function getRecipientsByFilter(tenantId: string, filter: any) {
  let query = db.collection('users').where('tenantId', '==', tenantId);
  
  if (filter.location && filter.location.length > 0) {
    query = query.where('location', 'in', filter.location);
  }
  
  if (filter.jobTitle && filter.jobTitle.length > 0) {
    query = query.where('jobTitle', 'in', filter.jobTitle);
  }
  
  if (filter.department && filter.department.length > 0) {
    query = query.where('department', 'in', filter.department);
  }
  
  if (filter.costCenter && filter.costCenter.length > 0) {
    query = query.where('costCenter', 'in', filter.costCenter);
  }
  
  const snapshot = await query.get();
  let recipients = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as any[];
  
  // Apply trait and tag filters in memory
  if (filter.traits && filter.traits.length > 0) {
    recipients = recipients.filter((user: any) => 
      filter.traits.some((trait: string) => user.traits?.includes(trait))
    );
  }
  
  if (filter.tags && filter.tags.length > 0) {
    recipients = recipients.filter((user: any) => 
      filter.tags.some((tag: string) => user.tags?.includes(tag))
    );
  }
  
  // Apply specific user IDs filter
  if (filter.userIds && filter.userIds.length > 0) {
    recipients = recipients.filter(user => filter.userIds.includes(user.id));
  }
  
  // Apply job order filter
  if (filter.jobOrderId) {
    const jobOrderAssignments = await db.collection('assignments')
      .where('jobOrderId', '==', filter.jobOrderId)
      .get();
    
    const assignedUserIds = jobOrderAssignments.docs.map(doc => doc.data().userId);
    recipients = recipients.filter(user => assignedUserIds.includes(user.id));
  }
  
  // Apply user group filter
  if (filter.userGroupId) {
    const userGroupDoc = await db.collection('userGroups').doc(filter.userGroupId).get();
    if (userGroupDoc.exists) {
      const userGroup = userGroupDoc.data()!;
      const groupUserIds = userGroup.memberIds || [];
      recipients = recipients.filter(user => groupUserIds.includes(user.id));
    }
  }
  
  return recipients;
}

async function handleAIBroadcastReply(reply: string, broadcast: any, workerId: string) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    const prompt = `You are an HR assistant responding to a worker's reply to a company broadcast.

Original Broadcast: "${broadcast.message}"

Worker's Reply: "${reply}"

Instructions:
1. Provide a helpful, professional response
2. If the worker needs specific information or has a complex question, escalate
3. If the reply is just acknowledgment or simple question, respond directly
4. Be empathetic and supportive

Respond with JSON:
{
  "response": "Your AI response here",
  "escalated": true/false,
  "escalationReason": "Reason if escalated",
  "confidence": 0.0-1.0
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    
    // Escalate if confidence is low or explicitly marked
    if (result.confidence < 0.7 || result.escalated) {
      return {
        response: null,
        escalated: true,
        escalationReason: result.escalationReason || 'Low confidence in AI response'
      };
    }
    
    return {
      response: result.response,
      escalated: false,
      escalationReason: null
    };
  } catch (error) {
    console.error('Error handling AI broadcast reply:', error);
    return {
      response: null,
      escalated: true,
      escalationReason: 'AI processing error'
    };
  }
}

async function analyzeReplySentiments(replies: any[]) {
  if (replies.length === 0) return { positive: 0, neutral: 0, negative: 0 };
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  
  for (const reply of replies.slice(0, 50)) { // Limit to 50 for performance
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-5',
        messages: [{
          role: 'user',
          content: `Analyze the sentiment of this reply: "${reply.reply}". Respond with only: positive, neutral, or negative.`
        }],
        temperature: 0.1
      });
      
      const sentiment = completion.choices[0].message.content?.toLowerCase();
      if (sentiment === 'positive') sentiments.positive++;
      else if (sentiment === 'negative') sentiments.negative++;
      else sentiments.neutral++;
    } catch (error) {
      sentiments.neutral++; // Default to neutral on error
    }
  }
  
  return sentiments;
}

function getBroadcastsByDay(broadcasts: any[], timeRangeMs: number) {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const data = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const dayBroadcasts = broadcasts.filter(b => 
      b.createdAt >= dayStart && b.createdAt < dayEnd
    );
    
    data.push({
      date: dayStart.toISOString().split('T')[0],
      count: dayBroadcasts.length
    });
  }
  
  return data;
}

function getRepliesByDay(replies: any[], timeRangeMs: number) {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const data = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const dayReplies = replies.filter(r => 
      r.timestamp >= dayStart && r.timestamp < dayEnd
    );
    
    data.push({
      date: dayStart.toISOString().split('T')[0],
      count: dayReplies.length
    });
  }
  
  return data;
}

// Export new AI orchestration functions
export {
  orchestratePrompt,
  getOrchestrationHistory,
  testOrchestration
} from './autoContextEngine';

export {
  applyFiltersToChunks,
  testFilterEffectiveness,
  getFilterAnalytics
} from './retrievalFilters';

export {
  createVectorChunk,
  searchVectorChunks,
  updateChunkRelevance,
  archiveChunk,
  createChunkingStrategy,
  getChunkingStrategies,
  getVectorAnalytics
} from './vectorSettings';

// ===== PHASE 2: ENHANCED AI ORCHESTRATION FUNCTIONS =====

// Enhanced Retrieval Filters Functions
export const evaluatePromptWithFilters = onCall(async (request) => {
  const { promptId, customerId, userId } = request.data;
  const start = Date.now();
  
  try {
    // Get active filters for this customer
    const filtersSnapshot = await db.collection('retrieval_filters')
      .where('active', '==', true)
      .where('customerId', '==', customerId)
      .get();
    
    const filters = filtersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Get vector chunks that would be retrieved
    const chunksSnapshot = await db.collection('vectorChunks')
      .where('customerId', '==', customerId)
      .limit(50)
      .get();
    
    const chunks = chunksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Apply filters to chunks
    const filteredChunks = chunks.filter((chunk: any) => {
      return filters.every((filter: any) => {
        // Check include tags
        if (filter.includeTags && filter.includeTags.length > 0) {
          const chunkTags = chunk.tags || [];
          if (!filter.includeTags.some((tag: string) => chunkTags.includes(tag))) {
            return false;
          }
        }
        
        // Check exclude tags
        if (filter.excludeTags && filter.excludeTags.length > 0) {
          const chunkTags = chunk.tags || [];
          if (filter.excludeTags.some((tag: string) => chunkTags.includes(tag))) {
            return false;
          }
        }
        
        // Check max age
        if (filter.maxAgeDays && chunk.createdAt) {
          const chunkDate = chunk.createdAt.toDate ? chunk.createdAt.toDate() : new Date(chunk.createdAt);
          const daysOld = (Date.now() - chunkDate.getTime()) / (1000 * 60 * 60 * 24);
          if (daysOld > filter.maxAgeDays) {
            return false;
          }
        }
        
        // Check min relevance
        if (filter.minRelevance && chunk.score !== undefined) {
          if (chunk.score < filter.minRelevance) {
            return false;
          }
        }
        
        return true;
      });
    });
    
    await logAIAction({
      userId,
      actionType: 'filter_evaluation',
      sourceModule: 'RetrievalFilters',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Evaluated prompt ${promptId} with ${filters.length} filters`,
      eventType: 'filter.evaluated',
      targetType: 'prompt',
      targetId: promptId,
      aiRelevant: true,
      contextType: 'filter',
      traitsAffected: [],
      aiTags: [],
      urgencyScore: 0
    });
    
    return {
      originalChunks: chunks.length,
      filteredChunks: filteredChunks.length,
      filtersApplied: filters.length,
      chunks: filteredChunks.slice(0, 10) // Return first 10 for preview
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'filter_evaluation',
      sourceModule: 'RetrievalFilters',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to evaluate prompt ${promptId}`,
      eventType: 'filter.evaluated',
      targetType: 'prompt',
      targetId: promptId,
      aiRelevant: true,
      contextType: 'filter',
      traitsAffected: [],
      aiTags: [],
      urgencyScore: 0
    });
    throw error;
  }
});

export const assignFilterToModule = onCall(async (request) => {
  const { customerId, moduleName, filterId, userId } = request.data;
  const start = Date.now();
  
  try {
    await db.collection('moduleFilters').doc(`${customerId}_${moduleName}`).set({
      customerId,
      moduleName,
      filterId,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      assignedBy: userId
    });
    
    await logAIAction({
      userId,
      actionType: 'filter_assigned',
      sourceModule: 'RetrievalFilters',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Assigned filter ${filterId} to module ${moduleName}`,
      eventType: 'filter.assigned',
      targetType: 'module',
      targetId: moduleName,
      aiRelevant: true,
      contextType: 'filter',
      traitsAffected: [],
      aiTags: [],
      urgencyScore: 0
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'filter_assigned',
      sourceModule: 'RetrievalFilters',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to assign filter ${filterId} to module ${moduleName}`,
      eventType: 'filter.assigned',
      targetType: 'module',
      targetId: moduleName,
      aiRelevant: true,
      contextType: 'filter',
      traitsAffected: [],
      aiTags: [],
      urgencyScore: 0
    });
    throw error;
  }
});

// Enhanced Vector Settings Functions
export const rescoreVectorChunk = onCall(async (request) => {
  const { chunkId, newScore, userId } = request.data;
  const start = Date.now();
  
  try {
    const chunkRef = db.collection('vectorChunks').doc(chunkId);
    const chunkDoc = await chunkRef.get();
    
    if (!chunkDoc.exists) {
      throw new Error('Vector chunk not found');
    }
    
    const oldScore = chunkDoc.data()?.score || 0;
    
    await chunkRef.update({
      score: newScore,
      lastRescored: admin.firestore.FieldValue.serverTimestamp(),
      rescoredBy: userId,
      previousScore: oldScore
    });
    
    await logAIAction({
      userId,
      actionType: 'vector_rescored',
      sourceModule: 'VectorSettings',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Rescored vector chunk ${chunkId}: ${oldScore} → ${newScore}`,
      eventType: 'vector.rescored',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return { success: true, oldScore, newScore };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'vector_rescored',
      sourceModule: 'VectorSettings',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to rescore vector chunk ${chunkId}`,
      eventType: 'vector.rescored',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const archiveVectorChunk = onCall(async (request) => {
  const { chunkId, userId } = request.data;
  const start = Date.now();
  
  try {
    const chunkRef = db.collection('vectorChunks').doc(chunkId);
    const chunkDoc = await chunkRef.get();
    
    if (!chunkDoc.exists) {
      throw new Error('Vector chunk not found');
    }
    
    const chunkData = chunkDoc.data();
    
    // Move to archived collection
    await db.collection('archivedVectorChunks').doc(chunkId).set({
      ...chunkData,
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      archivedBy: userId,
      originalId: chunkId
    });
    
    // Delete from active collection
    await chunkRef.delete();
    
    await logAIAction({
      userId,
      actionType: 'vector_archived',
      sourceModule: 'VectorSettings',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Archived vector chunk ${chunkId}`,
      eventType: 'vector.archived',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'vector_archived',
      sourceModule: 'VectorSettings',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to archive vector chunk ${chunkId}`,
      eventType: 'vector.archived',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const tagChunk = onCall(async (request) => {
  const { chunkId, tagList, userId } = request.data;
  const start = Date.now();
  
  try {
    const chunkRef = db.collection('vectorChunks').doc(chunkId);
    const chunkDoc = await chunkRef.get();
    
    if (!chunkDoc.exists) {
      throw new Error('Vector chunk not found');
    }
    
    const currentTags = chunkDoc.data()?.tags || [];
    const newTags = Array.from(new Set([...currentTags, ...tagList]));
    
    await chunkRef.update({
      tags: newTags,
      lastTagged: admin.firestore.FieldValue.serverTimestamp(),
      taggedBy: userId
    });
    
    await logAIAction({
      userId,
      actionType: 'vector_tagged',
      sourceModule: 'VectorSettings',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Tagged vector chunk ${chunkId} with: ${tagList.join(', ')}`,
      eventType: 'vector.tagged',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: tagList,
      urgencyScore: null
    });
    
    return { success: true, tags: newTags };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'vector_tagged',
      sourceModule: 'VectorSettings',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to tag vector chunk ${chunkId}`,
      eventType: 'vector.tagged',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'vector',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Advanced Analytics Functions
export const generateOrchestrationReport = onCall(async (request) => {
  const { timeRange, userId } = request.data;
  const start = Date.now();
  
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (timeRange * 60 * 60 * 1000)); // Convert hours to ms
    
    // Get logs for the time range
    const logsSnapshot = await db.collection('aiLogs')
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();
    
    const logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Analyze orchestration patterns
    const moduleUsage = logs.reduce((acc, log: any) => {
      const module = log.sourceModule || 'unknown';
      acc[module] = (acc[module] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const latencyByModule = logs.reduce((acc, log: any) => {
      const module = log.sourceModule || 'unknown';
      if (!acc[module]) acc[module] = [];
      if (log.latencyMs) acc[module].push(log.latencyMs);
      return acc;
    }, {} as Record<string, number[]>);
    
    const avgLatencyByModule = Object.entries(latencyByModule).reduce((acc, [module, latencies]) => {
      acc[module] = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;
      return acc;
    }, {} as Record<string, number>);
    
    const successRateByModule = logs.reduce((acc, log: any) => {
      const module = log.sourceModule || 'unknown';
      if (!acc[module]) acc[module] = { success: 0, total: 0 };
      acc[module].total++;
      if (log.success) acc[module].success++;
      return acc;
    }, {} as Record<string, { success: number; total: number }>);
    
    const successRates = Object.entries(successRateByModule).reduce((acc, [module, stats]) => {
      acc[module] = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
      return acc;
    }, {} as Record<string, number>);
    
    await logAIAction({
      userId,
      actionType: 'orchestration_report',
      sourceModule: 'AIAnalytics',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Generated orchestration report for ${timeRange}h`,
      eventType: 'analytics.report.generated',
      targetType: 'report',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'analytics',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return {
      timeRange,
      totalLogs: logs.length,
      moduleUsage,
      avgLatencyByModule,
      successRates,
      topModules: Object.entries(moduleUsage)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([module, count]) => ({ module, count }))
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'orchestration_report',
      sourceModule: 'AIAnalytics',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to generate orchestration report`,
      eventType: 'analytics.report.generated',
      targetType: 'report',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'analytics',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const analyzePromptFailurePatterns = onCall(async (request) => {
  const { timeRange, userId } = request.data;
  const start = Date.now();
  
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (timeRange * 60 * 60 * 1000));
    
    // Get failed logs
    const failedLogsSnapshot = await db.collection('aiLogs')
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .where('success', '==', false)
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();
    
    const failedLogs = failedLogsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Analyze failure patterns
    const errorTypes = failedLogs.reduce((acc, log) => {
      const errorType = (log as any).errorMessage?.split(':')[0] || 'Unknown';
      acc[errorType] = (acc[errorType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const moduleFailures = failedLogs.reduce((acc, log) => {
      const module = (log as any).sourceModule || 'unknown';
      acc[module] = (acc[module] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const timeBasedFailures = failedLogs.reduce((acc, log) => {
      const hour = new Date((log as any).timestamp?.toDate?.() || (log as any).timestamp).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    await logAIAction({
      userId,
      actionType: 'failure_analysis',
      sourceModule: 'AIAnalytics',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Analyzed ${failedLogs.length} failure patterns`,
      eventType: 'analytics.failures.analyzed',
      targetType: 'analysis',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'analytics',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return {
      totalFailures: failedLogs.length,
      errorTypes,
      moduleFailures,
      timeBasedFailures,
      topErrorTypes: Object.entries(errorTypes)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([errorType, count]) => ({ errorType, count }))
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'failure_analysis',
      sourceModule: 'AIAnalytics',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to analyze failure patterns`,
      eventType: 'analytics.failures.analyzed',
      targetType: 'analysis',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'analytics',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Integration Testing Framework Functions
export const simulateOrchestrationScenario = onCall(async (request) => {
  const { config, userId } = request.data;
  const start = Date.now();
  
  try {
    const {
      trigger,
      userContext,
      customerId
    } = config;
    
    // Simulate the orchestration flow
    const orchestrationResult: any = {
      scenarioId: `scenario_${Date.now()}`,
      trigger,
      userContext,
      customerId,
      modulesEngaged: [],
      contextUsed: [],
      finalPrompt: '',
      aiResponse: '',
      confidenceScore: 0,
      success: false,
      latencyMs: 0,
      timestamp: new Date()
    };
    
    // Simulate module engagement based on trigger
    if (trigger.includes('feedback')) {
      orchestrationResult.modulesEngaged.push('FeedbackEngine');
    }
    if (trigger.includes('moment')) {
      orchestrationResult.modulesEngaged.push('MomentsEngine');
    }
    if (trigger.includes('trait')) {
      orchestrationResult.modulesEngaged.push('TraitsEngine');
    }
    
    // Simulate context retrieval
    orchestrationResult.contextUsed = [
      { type: 'user_profile', content: 'Worker profile data' },
      { type: 'customer_context', content: 'Customer-specific rules' },
      { type: 'historical_data', content: 'Past interactions' }
    ];
    
    // Simulate prompt composition
    orchestrationResult.finalPrompt = `Based on the context and user profile, respond to: ${trigger}`;
    
    // Simulate AI response
    orchestrationResult.aiResponse = `Simulated response to: ${trigger}`;
    orchestrationResult.confidenceScore = 0.85;
    orchestrationResult.success = true;
    orchestrationResult.latencyMs = Date.now() - start;
    
    // Store scenario result
    await db.collection('testScenarios').doc(orchestrationResult.scenarioId).set({
      ...orchestrationResult,
      createdBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await logAIAction({
      userId,
      actionType: 'scenario_simulated',
      sourceModule: 'TestBench',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Simulated orchestration scenario: ${trigger}`,
      eventType: 'test.scenario.simulated',
      targetType: 'scenario',
      targetId: orchestrationResult.scenarioId,
      aiRelevant: true,
      contextType: 'test',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return orchestrationResult;
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'scenario_simulated',
      sourceModule: 'TestBench',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to simulate orchestration scenario`,
      eventType: 'test.scenario.simulated',
      targetType: 'scenario',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'test',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const validatePromptConsistency = onCall(async (request) => {
  const { promptId, userId } = request.data;
  const start = Date.now();
  
  try {
    // Get all logs for this prompt
    const logsSnapshot = await db.collection('aiLogs')
      .where('inputPrompt', '==', promptId)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();
    
    const logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    if (logs.length < 2) {
      return { consistent: true, message: 'Insufficient data for consistency check' };
    }
    
    // Check for consistency in responses
    const responses = logs.map((log: any) => log.aiResponse).filter(Boolean);
    const uniqueResponses = new Set(responses);
    const consistencyScore = uniqueResponses.size === 1 ? 1.0 : 1.0 / uniqueResponses.size;
    
    // Check for consistency in latency
    const latencies = logs.map((log: any) => log.latencyMs).filter(Boolean);
    const avgLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
    const latencyVariance = latencies.reduce((sum, l) => sum + Math.pow(l - avgLatency, 2), 0) / latencies.length;
    const latencyConsistency = Math.max(0, 1 - (latencyVariance / (avgLatency * avgLatency)));
    
    const overallConsistency = (consistencyScore + latencyConsistency) / 2;
    
    await logAIAction({
      userId,
      actionType: 'consistency_validated',
      sourceModule: 'TestBench',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Validated prompt consistency: ${overallConsistency.toFixed(2)}`,
      eventType: 'test.consistency.validated',
      targetType: 'prompt',
      targetId: promptId,
      aiRelevant: true,
      contextType: 'test',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return {
      consistent: overallConsistency > 0.8,
      consistencyScore: overallConsistency,
      responseConsistency: consistencyScore,
      latencyConsistency: latencyConsistency,
      uniqueResponses: uniqueResponses.size,
      avgLatency: Math.round(avgLatency),
      totalChecks: logs.length
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'consistency_validated',
      sourceModule: 'TestBench',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to validate prompt consistency`,
      eventType: 'test.consistency.validated',
      targetType: 'prompt',
      targetId: promptId,
      aiRelevant: true,
      contextType: 'test',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Resume Parser Functions
export { parseResume, getResumeParsingStatus, getUserParsedResumes };

// Phase 4: HRXOne Worker Onboarding Flow Functions
export const validateInviteToken = onCall(async (request) => {
  const { token } = request.data;
  const start = Date.now();
  
  try {
    if (!token) {
      throw new Error('Token is required');
    }
    
    // Get invite token from Firestore
    const tokenDoc = await db.collection('invites').doc(token).get();
    
    if (!tokenDoc.exists) {
      return {
        valid: false,
        error: 'Invalid invite token'
      };
    }
    
    const inviteData = tokenDoc.data();
    
    if (!inviteData) {
      return {
        valid: false,
        error: 'Invalid invite token'
      };
    }
    
    // Check if token is expired
    if (inviteData.expiresAt && inviteData.expiresAt.toDate() < new Date()) {
      return {
        valid: false,
        error: 'Invite token has expired'
      };
    }
    
    // Check if token has already been used
    if (inviteData.used) {
      return {
        valid: false,
        error: 'Invite token has already been used'
      };
    }
    
    // Get org details
    let orgDetails = null;
    if (inviteData.type === 'Customer') {
      const customerDoc = await db.collection('customers').doc(inviteData.orgId).get();
      if (customerDoc.exists) {
        orgDetails = {
          id: customerDoc.id,
          name: customerDoc.data()?.name || 'Unknown Customer',
          type: 'Customer'
        };
      }
    } else if (inviteData.type === 'Agency') {
      const agencyDoc = await db.collection('agencies').doc(inviteData.orgId).get();
      if (agencyDoc.exists) {
        orgDetails = {
          id: agencyDoc.id,
          name: agencyDoc.data()?.name || 'Unknown Agency',
          type: 'Agency'
        };
      }
    }
    
    await logAIAction({
      userId: 'system',
      actionType: 'invite_token_validated',
      sourceModule: 'OnboardingFlow',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Validated invite token for ${orgDetails?.name || 'unknown org'}`,
      eventType: 'onboarding.token-validated',
      targetType: 'invite',
      targetId: token,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return {
      valid: true,
      token: inviteData.token,
      type: inviteData.type,
      orgId: inviteData.orgId,
      role: inviteData.role,
      orgDetails,
      createdAt: inviteData.createdAt,
      expiresAt: inviteData.expiresAt
    };
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'invite_token_validated',
      sourceModule: 'OnboardingFlow',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Failed to validate invite token`,
      eventType: 'onboarding.token-validated',
      targetType: 'invite',
      targetId: token,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const markInviteTokenUsed = onCall(async (request) => {
  const { token, userId } = request.data;
  const start = Date.now();
  
  try {
    if (!token || !userId) {
      throw new Error('Token and userId are required');
    }
    
    // Mark token as used
    await db.collection('invites').doc(token).update({
      used: true,
      usedBy: userId,
      usedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await logAIAction({
      userId,
      actionType: 'invite_token_used',
      sourceModule: 'OnboardingFlow',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Marked invite token as used`,
      eventType: 'onboarding.token-used',
      targetType: 'invite',
      targetId: token,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'invite_token_used',
      sourceModule: 'OnboardingFlow',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Failed to mark invite token as used`,
      eventType: 'onboarding.token-used',
      targetType: 'invite',
      targetId: token,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const assignOrgToUser = onCall(async (request) => {
  const { userId, orgId, type, role, parentTenantId } = request.data;
  const start = Date.now();
  
  try {
    if (!userId || !orgId || !type || !role) {
      throw new Error('userId, orgId, type, and role are required');
    }
    
    // Determine security level based on role and type
    let securityLevel = 'Worker';
    if (role === 'Applicant') {
      securityLevel = 'Applicant_Worker';
    } else if (type === 'Customer') {
      securityLevel = 'Customer_Worker';
    } else if (type === 'Agency') {
      securityLevel = 'Agency_Worker';
    }
    
    // Update user profile with tenant assignment
    const userUpdate: any = {
      role,
      securityLevel,
      onboarded: true,
      onboardedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (type === 'Customer' && parentTenantId) {
      // Customer belongs to a parent tenant (agency)
      userUpdate.tenantIds = [parentTenantId];
      userUpdate.tenantId = parentTenantId;
    } else {
      // Direct tenant assignment
      userUpdate.tenantIds = [orgId];
      userUpdate.tenantId = orgId;
    }
    
    await db.collection('users').doc(userId).update(userUpdate);
    
    // Add user to tenant's workforce
    if (type === 'Customer' && parentTenantId) {
      // Add to parent tenant's workforce
      await db.collection('tenants').doc(parentTenantId).update({
        [`workforce.${userId}`]: {
          uid: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          role,
          status: 'active',
          customerId: orgId
        }
      });
    } else {
      // Add directly to tenant's workforce
      await db.collection('tenants').doc(orgId).update({
        [`workforce.${userId}`]: {
          uid: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          role,
          status: 'active'
        }
      });
    }
    
    await logAIAction({
      userId,
      actionType: 'org_assigned_to_user',
      sourceModule: 'OnboardingFlow',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Assigned user to ${type} ${orgId} with role ${role}`,
      eventType: 'onboarding.org-assigned',
      targetType: type.toLowerCase(),
      targetId: orgId,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return {
      success: true,
      orgId,
      type,
      role,
      securityLevel,
      tenantId: type === 'Customer' && parentTenantId ? parentTenantId : orgId
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'org_assigned_to_user',
      sourceModule: 'OnboardingFlow',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Failed to assign user to org`,
      eventType: 'onboarding.org-assigned',
      targetType: type?.toLowerCase(),
      targetId: orgId,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const createInviteToken = onCall(async (request) => {
  const { orgId, type, role, email, createdBy } = request.data;
  const start = Date.now();
  
  try {
    if (!orgId || !type || !role || !createdBy) {
      throw new Error('orgId, type, role, and createdBy are required');
    }
    
    // Generate unique token
    const token = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Set expiration (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Create invite token
    await db.collection('invites').doc(token).set({
      token,
      type,
      orgId,
      role,
      email: email || null,
      createdBy,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      used: false
    });
    
    await logAIAction({
      userId: createdBy,
      actionType: 'invite_token_created',
      sourceModule: 'OnboardingFlow',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Created invite token for ${type} ${orgId}`,
      eventType: 'onboarding.token-created',
      targetType: 'invite',
      targetId: token,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    return {
      success: true,
      token,
      inviteUrl: `https://app.hrxone.com/invite/${token}`,
      expiresAt
    };
  } catch (error: any) {
    await logAIAction({
      userId: createdBy,
      actionType: 'invite_token_created',
      sourceModule: 'OnboardingFlow',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Failed to create invite token`,
      eventType: 'onboarding.token-created',
      targetType: 'invite',
      // targetId intentionally omitted when not available
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Help & Guide System: Fetch Help Topics
export const getHelpTopics = onCall(async (request) => {
  try {
    let query: FirebaseFirestore.Query = db.collection('help_topics');
    if (request.data.status) {
      query = query.where('status', '==', request.data.status);
    }
    const snapshot = await query.limit(request.data.limit || 100).get();

    const topics = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      lastUpdated: doc.data().lastUpdated?.toDate?.() || null,
    }));

    return { topics };
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch help topics');
  }
});

// Helper: Jaccard similarity between two strings
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// Help & Guide System: Generate Help Drafts from Code
export const generateHelpDraftsFromCode = onCall(async (request) => {
  const { agencyId, customerId, userId, limit = 5 } = request.data;
  const start = Date.now();
  try {
    // Get existing help topics to avoid duplicates
    const existingTopics = await db.collection('help_topics').get();
    const existingTitles = new Set(existingTopics.docs.map(doc => doc.data().title?.toLowerCase()));
    const existingSummaries = existingTopics.docs.map(doc => doc.data().summary || '');
    
    // AI prompt for unique, actionable content
    // (If you use OpenAI or similar, pass this as system/user prompt)
    // "Write a help article for the HRX web app. Only describe features, buttons, and workflows that actually exist in the codebase. Be specific: mention button names, menu items, and step-by-step instructions. If a feature does not exist, do not mention it. Avoid repeating similar content, even with different titles. Focus on new features, advanced tips, or user questions that have not been addressed."

    // Generate help articles based on common HRX features and user needs
    const allHelpDrafts = [
      {
        title: "How to Create and Manage Job Orders",
        content: `# Creating and Managing Job Orders

## Overview
Job orders are the foundation of workforce management in HRX. They define the work that needs to be done, when it needs to be completed, and who can perform it.

## Creating a New Job Order

### Step 1: Access Job Orders
1. Navigate to your agency dashboard
2. Click on "Job Orders" in the left sidebar
3. Click the "Create New Job Order" button

### Step 2: Fill in Basic Information
- **Job Title**: Enter a clear, descriptive title
- **Customer**: Select the customer this job is for
- **Location**: Choose the worksite where the job will be performed
- **Start Date**: Set when the job begins
- **End Date**: Set when the job is expected to complete

### Step 3: Define Job Requirements
- **Skills Required**: List specific skills or certifications needed
- **Experience Level**: Specify minimum experience requirements
- **Physical Requirements**: Note any lifting, standing, or mobility needs
- **Background Check**: Indicate if background checks are required

### Step 4: Set Compensation
- **Pay Rate**: Enter hourly or project-based compensation
- **Overtime**: Specify overtime rates if applicable
- **Benefits**: Note any benefits included

### Step 5: Add Shifts
- Click "Add Shift" to define work schedules
- Set start and end times for each shift
- Specify the number of workers needed per shift

## Managing Existing Job Orders

### Viewing Job Orders
- Use the search and filter options to find specific orders
- Sort by date, status, or customer
- Click on any job order to view full details

### Editing Job Orders
- Click the edit icon next to any job order
- Make changes to any field
- Save your changes

### Status Management
- **Draft**: Job order is being created
- **Active**: Job order is open for worker applications
- **In Progress**: Workers have been assigned and work has begun
- **Completed**: All work has been finished
- **Cancelled**: Job order has been cancelled

## Best Practices
- Use clear, specific job titles
- Include all necessary requirements upfront
- Set realistic timelines
- Review and update job orders regularly
- Communicate changes to assigned workers promptly

## Troubleshooting
**Q: Can I edit a job order after workers have been assigned?**
A: Yes, but changes may affect existing assignments. Workers will be notified of any modifications.

**Q: How do I cancel a job order?**
A: Change the status to "Cancelled" and provide a reason. Assigned workers will be notified.

**Q: What if I need to extend a job order?**
A: Edit the end date and update any affected shifts. Workers will be notified of schedule changes.`,
        category: "Job Management",
        tags: ["job orders", "workforce management", "scheduling"],
        difficulty: "Beginner",
        estimatedReadTime: 5,
        relatedComponents: ["JobOrdersTab", "JobOrderDetails", "JobOrderShiftsTab"]
      },
      {
        title: "Worker Assignment and Scheduling Guide",
        content: `# Worker Assignment and Scheduling

## Overview
Effective worker assignment and scheduling is crucial for meeting job requirements and maintaining worker satisfaction. This guide covers the complete process from assignment to schedule management.

## Assigning Workers to Jobs

### Step 1: Review Available Workers
1. Navigate to the job order details
2. Click on "Assignments" tab
3. View the list of available workers who match the job requirements

### Step 2: Evaluate Worker Qualifications
- **Skills Match**: Check if worker has required skills
- **Experience**: Review worker's relevant experience
- **Availability**: Confirm worker can work the required shifts
- **Performance History**: Consider past performance ratings
- **Location**: Ensure worker can travel to the worksite

### Step 3: Make Assignments
- Select workers by checking the boxes next to their names
- Click "Assign Selected Workers"
- Confirm the assignment details

### Step 4: Notify Workers
- Workers will receive automatic notifications
- They can accept or decline the assignment
- Monitor acceptance status in the assignments tab

## Managing Schedules

### Creating Schedules
1. Go to the job order's "Shifts" tab
2. Click "Create Schedule"
3. Set shift times and dates
4. Assign specific workers to each shift
5. Save the schedule

### Adjusting Schedules
- **Add Shifts**: Create additional work periods
- **Modify Times**: Change start/end times as needed
- **Reassign Workers**: Move workers between shifts
- **Cancel Shifts**: Remove shifts when not needed

### Handling Conflicts
- **Double Booking**: Check for worker schedule conflicts
- **Overtime**: Monitor hours to avoid overtime violations
- **Availability Changes**: Workers can update their availability
- **Emergency Changes**: Handle last-minute schedule changes

## Communication Best Practices

### Pre-Shift Communication
- Send shift reminders 24 hours in advance
- Confirm worker availability
- Provide any special instructions or updates

### During Assignment
- Be available for questions
- Monitor worker check-ins
- Address any issues promptly

### Post-Shift Follow-up
- Collect feedback from workers
- Update performance ratings
- Address any concerns or complaints

## Troubleshooting Common Issues

### Worker No-Shows
1. Contact the worker immediately
2. Check if there's a backup worker available
3. Update the schedule if needed
4. Document the incident for future reference

### Schedule Conflicts
1. Review all worker assignments
2. Identify the source of the conflict
3. Reassign workers as needed
4. Update all affected schedules

### Performance Issues
1. Document specific concerns
2. Have a conversation with the worker
3. Provide additional training if needed
4. Consider reassignment for future jobs

## Advanced Features

### Automated Assignment
- Use AI-powered matching for large assignments
- Set up automatic assignment rules
- Configure preference-based matching

### Bulk Operations
- Assign multiple workers at once
- Create schedules for multiple shifts
- Send bulk communications

### Reporting and Analytics
- Track assignment success rates
- Monitor worker performance
- Analyze scheduling efficiency
- Generate assignment reports`,
        category: "Workforce Management",
        tags: ["assignments", "scheduling", "workers", "communication"],
        difficulty: "Intermediate",
        estimatedReadTime: 8,
        relatedComponents: ["UserAssignmentsTab", "JobOrderShiftsTab", "WorkforceTab"]
      },
      {
        title: "Customer Management and Communication",
        content: `# Customer Management and Communication

## Overview
Building and maintaining strong relationships with customers is essential for business success. This guide covers effective customer management strategies and communication best practices.

## Customer Onboarding

### Initial Contact
- **Discovery Call**: Understand customer needs and requirements
- **Requirements Assessment**: Identify specific workforce needs
- **Proposal Development**: Create customized service proposals
- **Contract Negotiation**: Finalize terms and conditions

### Account Setup
1. **Create Customer Profile**
   - Basic company information
   - Contact details for key personnel
   - Billing and payment information
   - Service level agreements

2. **Worksite Configuration**
   - Add all relevant work locations
   - Set up location-specific requirements
   - Configure safety protocols
   - Establish emergency contacts

3. **User Access Setup**
   - Create customer user accounts
   - Assign appropriate access levels
   - Provide training and onboarding
   - Set up communication preferences

## Ongoing Customer Management

### Regular Communication
- **Weekly Check-ins**: Regular status updates
- **Monthly Reviews**: Performance and satisfaction reviews
- **Quarterly Business Reviews**: Strategic planning sessions
- **Annual Contract Reviews**: Service level and pricing discussions

### Performance Monitoring
- **Service Level Metrics**: Track key performance indicators
- **Customer Satisfaction**: Regular feedback collection
- **Issue Resolution**: Monitor and address concerns promptly
- **Continuous Improvement**: Implement feedback and suggestions

### Relationship Building
- **Personal Touch**: Regular personal contact with key stakeholders
- **Value-Added Services**: Offer additional support and resources
- **Industry Expertise**: Share relevant industry insights
- **Networking Opportunities**: Connect customers with other clients

## Communication Strategies

### Proactive Communication
- **Regular Updates**: Keep customers informed of progress
- **Anticipate Needs**: Identify potential issues before they arise
- **Share Success Stories**: Highlight positive outcomes
- **Provide Insights**: Share relevant data and analytics

### Issue Management
- **Quick Response**: Acknowledge issues within 24 hours
- **Clear Communication**: Provide regular updates on resolution progress
- **Escalation Procedures**: Know when and how to escalate issues
- **Follow-up**: Ensure issues are fully resolved

### Feedback Collection
- **Regular Surveys**: Collect structured feedback
- **One-on-One Meetings**: Gather detailed insights
- **Focus Groups**: Conduct group feedback sessions
- **Anonymous Channels**: Provide confidential feedback options

## Customer Success Metrics

### Key Performance Indicators
- **Customer Satisfaction Score**: Overall satisfaction ratings
- **Net Promoter Score**: Likelihood to recommend services
- **Retention Rate**: Customer renewal rates
- **Revenue Growth**: Account expansion and growth
- **Response Time**: Speed of issue resolution

### Monitoring and Reporting
- **Dashboard Views**: Real-time performance monitoring
- **Regular Reports**: Monthly and quarterly performance reports
- **Trend Analysis**: Track performance over time
- **Benchmarking**: Compare against industry standards

## Best Practices

### Customer-Centric Approach
- **Understand Needs**: Deeply understand customer business objectives
- **Customize Solutions**: Tailor services to specific requirements
- **Exceed Expectations**: Go above and beyond basic service delivery
- **Build Trust**: Establish long-term, trusting relationships

### Technology Utilization
- **Self-Service Portals**: Provide easy access to information
- **Automated Reporting**: Regular, automated performance reports
- **Mobile Access**: Enable access from any device
- **Integration**: Connect with customer systems when possible

### Continuous Improvement
- **Regular Reviews**: Assess and improve service delivery
- **Training**: Keep team updated on best practices
- **Innovation**: Continuously look for ways to improve
- **Feedback Integration**: Act on customer feedback

## Troubleshooting

### Common Customer Issues
- **Service Quality**: Address quality concerns immediately
- **Communication Gaps**: Improve communication frequency and clarity
- **Billing Questions**: Provide clear, detailed billing information
- **Contract Disputes**: Work to resolve disputes amicably

### Escalation Procedures
- **Level 1**: Front-line customer service
- **Level 2**: Account manager involvement
- **Level 3**: Management escalation
- **Level 4**: Executive involvement`,
        category: "Customer Relations",
        tags: ["customers", "communication", "onboarding", "success"],
        difficulty: "Intermediate",
        estimatedReadTime: 10,
        relatedComponents: ["CustomerProfile", "CustomersTab", "AgencyContactsTab"]
      },
      {
        title: "AI-Powered Workforce Optimization",
        content: `# AI-Powered Workforce Optimization

## Overview
HRX's AI system helps optimize workforce management by analyzing patterns, predicting needs, and suggesting improvements. This guide explains how to leverage AI features for better workforce planning and management.

## Understanding AI Features

### Predictive Analytics
- **Demand Forecasting**: Predict future workforce needs
- **Worker Performance**: Analyze and predict worker success
- **Scheduling Optimization**: Suggest optimal shift assignments
- **Risk Assessment**: Identify potential issues before they occur

### Automated Matching
- **Skill-Based Matching**: Match workers to jobs based on skills
- **Experience Optimization**: Consider experience levels for assignments
- **Availability Matching**: Ensure workers are available for assigned shifts
- **Performance-Based Recommendations**: Use historical performance data

### Intelligent Scheduling
- **Conflict Detection**: Automatically identify scheduling conflicts
- **Overtime Prevention**: Help avoid overtime violations
- **Efficiency Optimization**: Suggest the most efficient schedules
- **Emergency Response**: Quickly adjust schedules for emergencies

## Using AI Recommendations

### Reviewing Suggestions
1. **Dashboard Alerts**: Check for AI-generated recommendations
2. **Review Logic**: Understand why suggestions were made
3. **Validate Recommendations**: Ensure suggestions align with business needs
4. **Apply Changes**: Implement approved recommendations

### Customizing AI Behavior
- **Adjust Parameters**: Modify AI sensitivity and preferences
- **Set Priorities**: Define what factors are most important
- **Exclude Factors**: Specify what should not be considered
- **Training Data**: Provide feedback to improve AI accuracy

### Monitoring AI Performance
- **Accuracy Tracking**: Monitor how well AI predictions perform
- **User Feedback**: Collect feedback on AI recommendations
- **Continuous Learning**: AI improves based on outcomes
- **Performance Reports**: Regular reports on AI effectiveness

## Best Practices for AI Integration

### Data Quality
- **Accurate Information**: Ensure all data is current and accurate
- **Complete Profiles**: Maintain comprehensive worker and job profiles
- **Regular Updates**: Keep information updated regularly
- **Data Validation**: Verify data quality and consistency

### Human Oversight
- **Review Recommendations**: Always review AI suggestions before implementing
- **Override When Needed**: Don't hesitate to override AI when necessary
- **Provide Feedback**: Give feedback to improve AI performance
- **Monitor Outcomes**: Track the results of AI recommendations

### Training and Adoption
- **User Training**: Train staff on AI features and capabilities
- **Gradual Implementation**: Start with simple features and expand
- **Success Stories**: Share examples of AI success
- **Continuous Learning**: Keep learning about new AI capabilities

## Advanced AI Features

### Machine Learning Insights
- **Pattern Recognition**: Identify patterns in workforce data
- **Trend Analysis**: Analyze trends over time
- **Anomaly Detection**: Identify unusual patterns or behaviors
- **Predictive Modeling**: Build models for future planning

### Natural Language Processing
- **Chat Support**: AI-powered customer and worker support
- **Document Analysis**: Analyze resumes and job descriptions
- **Sentiment Analysis**: Understand worker and customer satisfaction
- **Automated Responses**: Generate appropriate responses to common questions

### Optimization Algorithms
- **Resource Allocation**: Optimize resource distribution
- **Cost Optimization**: Minimize costs while maintaining quality
- **Efficiency Maximization**: Maximize productivity and efficiency
- **Risk Minimization**: Reduce risks and potential issues

## Troubleshooting AI Issues

### Common Problems
- **Inaccurate Predictions**: Review and adjust AI parameters
- **Missing Data**: Ensure all required data is available
- **System Errors**: Check for technical issues
- **User Confusion**: Provide additional training and support

### Getting Help
- **Documentation**: Review AI documentation and guides
- **Support Team**: Contact technical support for assistance
- **Community Forums**: Connect with other users
- **Training Resources**: Access training materials and videos

## Future AI Capabilities

### Upcoming Features
- **Advanced Analytics**: More sophisticated analysis capabilities
- **Integration**: Better integration with other systems
- **Mobile AI**: AI features available on mobile devices
- **Voice Interface**: Voice-activated AI features

### Continuous Improvement
- **Regular Updates**: New features and improvements
- **User Feedback**: Features based on user needs
- **Industry Best Practices**: Incorporation of industry standards
- **Technology Advances**: Latest AI technology integration`,
        category: "AI & Technology",
        tags: ["artificial intelligence", "optimization", "analytics", "automation"],
        difficulty: "Advanced",
        estimatedReadTime: 12,
        relatedComponents: ["AILaunchpad", "AIAnalytics", "AIContextDashboard"]
      },
      {
        title: "Mobile App Usage for Workers",
        content: `# Mobile App Usage for Workers

## Overview
The HRX mobile app allows workers to manage their assignments, check in/out, communicate with agencies, and access important information on the go. This guide covers all essential mobile app features.

## Getting Started

### Download and Installation
1. **Download the App**
   - iOS: Search "HRX" in the App Store
   - Android: Search "HRX" in Google Play Store
   - Scan QR code from agency invitation

2. **Account Setup**
   - Enter your email and password
   - Complete profile information
   - Upload required documents
   - Set up notifications

3. **Profile Completion**
   - Add profile photo
   - Update contact information
   - Add emergency contacts
   - Complete skills assessment

## Core Features

### Assignment Management
- **View Assignments**: See all current and upcoming assignments
- **Assignment Details**: Access full job information
- **Accept/Decline**: Respond to new assignment offers
- **Schedule View**: Calendar view of all shifts
- **Location Information**: Get directions to worksites

### Check-In/Check-Out
- **Geolocation Check-In**: Check in when arriving at worksite
- **Time Tracking**: Automatic time tracking during shifts
- **Break Management**: Log breaks and meal periods
- **Check-Out**: Check out when leaving worksite
- **Manual Override**: Manual time entry when needed

### Communication
- **In-App Messaging**: Direct messaging with agency staff
- **Push Notifications**: Real-time updates and alerts
- **Emergency Contacts**: Quick access to emergency numbers
- **Broadcast Messages**: Receive important announcements
- **Feedback Submission**: Submit questions and feedback

### Document Management
- **Document Upload**: Upload required documents
- **Document Viewing**: Access important documents
- **Expiration Tracking**: Get notified of expiring documents
- **Digital Signatures**: Sign documents electronically
- **Version History**: Track document updates

## Advanced Features

### Performance Tracking
- **Performance Ratings**: View your performance scores
- **Feedback Review**: Read feedback from supervisors
- **Improvement Areas**: Identify areas for improvement
- **Goal Setting**: Set and track personal goals
- **Progress Reports**: View progress over time

### Financial Management
- **Pay Stubs**: Access current and historical pay stubs
- **Earnings Tracking**: Monitor earnings and hours
- **Tax Documents**: Access tax-related documents
- **Direct Deposit**: Manage payment preferences
- **Expense Reporting**: Submit expense reports

### Safety and Compliance
- **Safety Guidelines**: Access safety information
- **Incident Reporting**: Report safety incidents
- **Training Materials**: Complete required training
- **Compliance Updates**: Stay updated on requirements
- **Emergency Procedures**: Access emergency protocols

## Best Practices

### Daily Usage
- **Regular Check-Ins**: Check the app daily for updates
- **Timely Responses**: Respond to messages and requests promptly
- **Accurate Time Tracking**: Ensure accurate check-in/out times
- **Document Updates**: Keep documents current
- **Communication**: Stay in touch with agency staff

### Troubleshooting
- **App Issues**: Restart app or reinstall if needed
- **Connection Problems**: Check internet connection
- **Login Issues**: Reset password if needed
- **Technical Support**: Contact support for technical issues
- **Emergency Situations**: Use emergency contacts for urgent issues

### Privacy and Security
- **Secure Login**: Use strong passwords
- **Logout**: Always logout when finished
- **Data Protection**: Don't share sensitive information
- **App Permissions**: Review and manage app permissions
- **Device Security**: Keep device secure and updated

## Tips for Success

### Maximizing Opportunities
- **Complete Profile**: Keep profile fully updated
- **Quick Responses**: Respond quickly to assignment offers
- **Flexible Availability**: Update availability regularly
- **Performance Focus**: Maintain high performance ratings
- **Professional Communication**: Communicate professionally

### Building Relationships
- **Regular Communication**: Stay in touch with agency staff
- **Feedback**: Provide constructive feedback
- **Reliability**: Be reliable and punctual
- **Professionalism**: Maintain professional behavior
- **Continuous Improvement**: Seek opportunities to improve

## Support and Resources

### Help Resources
- **In-App Help**: Access help within the app
- **Video Tutorials**: Watch instructional videos
- **FAQ Section**: Find answers to common questions
- **User Guide**: Comprehensive user guide
- **Training Materials**: Access training resources

### Contact Information
- **Agency Support**: Contact your agency for job-related issues
- **Technical Support**: Contact HRX for technical issues
- **Emergency Contacts**: Use emergency contacts for urgent situations
- **Feedback**: Submit feedback through the app
- **Suggestions**: Share suggestions for improvements`,
        category: "Mobile & Technology",
        tags: ["mobile app", "workers", "check-in", "communication"],
        difficulty: "Beginner",
        estimatedReadTime: 8,
        relatedComponents: ["CheckInNotification", "UserProfile", "UserAssignmentsTab"]
      },
      {
        title: "Time Tracking and Payroll Management",
        content: `# Time Tracking and Payroll Management

## Overview
Accurate time tracking is essential for proper payroll processing and compliance. This guide covers how to manage time tracking, handle payroll, and ensure workers are paid correctly.

## Time Tracking Methods

### Mobile App Check-In/Check-Out
- **Geolocation Verification**: Workers must be at the worksite to check in
- **Automatic Time Calculation**: System calculates hours worked automatically
- **Break Management**: Workers can log breaks and meal periods
- **Manual Override**: Supervisors can adjust times when needed

### Manual Time Entry
- **Supervisor Entry**: Supervisors can enter time for workers
- **Worker Self-Entry**: Workers can submit time corrections
- **Approval Process**: All manual entries require approval
- **Audit Trail**: All changes are logged for compliance

## Payroll Processing

### Hourly Workers
- **Regular Hours**: Standard hourly rate for normal work hours
- **Overtime Calculation**: Automatic overtime calculation (1.5x after 40 hours)
- **Holiday Pay**: Special rates for holiday work
- **Weekend Premiums**: Additional pay for weekend work

### Project-Based Workers
- **Fixed Rate Projects**: Set amount for completed projects
- **Milestone Payments**: Partial payments at project milestones
- **Performance Bonuses**: Additional compensation for exceptional work
- **Completion Bonuses**: Bonuses for early project completion

## Compliance and Reporting

### Time Card Management
- **Daily Review**: Supervisors review daily time cards
- **Weekly Approval**: Weekly time card approval process
- **Dispute Resolution**: Process for handling time disputes
- **Correction Procedures**: How to correct time card errors

### Payroll Reports
- **Weekly Payroll**: Weekly payroll processing and distribution
- **Tax Withholding**: Automatic tax calculations and withholding
- **Benefits Deductions**: Health insurance and other benefit deductions
- **Garnishments**: Court-ordered wage garnishments

### Compliance Requirements
- **FLSA Compliance**: Fair Labor Standards Act compliance
- **State Regulations**: State-specific labor law compliance
- **Record Keeping**: Required record retention periods
- **Audit Preparation**: Preparing for labor law audits

## Best Practices

### For Workers
- **Accurate Check-In/Out**: Always check in and out accurately
- **Report Issues**: Report any time tracking problems immediately
- **Keep Records**: Maintain personal records of hours worked
- **Review Pay Stubs**: Review pay stubs for accuracy

### For Supervisors
- **Monitor Time Cards**: Regularly review worker time cards
- **Address Discrepancies**: Promptly address any time discrepancies
- **Train Workers**: Ensure workers understand time tracking procedures
- **Maintain Compliance**: Stay updated on labor law requirements

### For Administrators
- **System Monitoring**: Monitor time tracking system performance
- **Policy Updates**: Keep time tracking policies current
- **Training Programs**: Provide regular training on time tracking
- **Audit Preparation**: Maintain records for potential audits

## Troubleshooting

### Common Issues
- **Check-In Failures**: What to do when check-in doesn't work
- **Time Discrepancies**: How to resolve time tracking discrepancies
- **Payroll Errors**: Correcting payroll calculation errors
- **System Outages**: Handling time tracking during system outages

### Support Resources
- **Help Desk**: Contact information for technical support
- **Policy Manual**: Complete time tracking policy manual
- **Training Videos**: Video tutorials for time tracking procedures
- **FAQ Section**: Frequently asked questions about time tracking`,
        category: "Payroll & Compliance",
        tags: ["time tracking", "payroll", "compliance", "check-in"],
        difficulty: "Intermediate",
        estimatedReadTime: 8,
        relatedComponents: ["CheckInNotification", "UserProfile", "PayrollTab"]
      },
      {
        title: "Safety and Incident Reporting",
        content: `# Safety and Incident Reporting

## Overview
Maintaining a safe work environment is everyone's responsibility. This guide covers safety protocols, incident reporting procedures, and how to respond to workplace emergencies.

## Safety Protocols

### Personal Protective Equipment (PPE)
- **Required Equipment**: What PPE is required for different jobs
- **Proper Use**: How to use PPE correctly
- **Maintenance**: How to maintain and care for PPE
- **Replacement**: When and how to replace damaged PPE

### Worksite Safety
- **Hazard Identification**: How to identify potential hazards
- **Safety Briefings**: Required safety briefings before work
- **Emergency Procedures**: What to do in case of emergency
- **Evacuation Plans**: Worksite evacuation procedures

### Equipment Safety
- **Equipment Inspection**: Pre-use equipment inspections
- **Safe Operation**: How to operate equipment safely
- **Maintenance Requirements**: Regular maintenance schedules
- **Malfunction Reporting**: How to report equipment problems

## Incident Reporting

### What to Report
- **Injuries**: Any work-related injuries, no matter how minor
- **Near Misses**: Incidents that could have caused injury
- **Property Damage**: Damage to equipment or property
- **Safety Violations**: Unsafe practices or conditions

### Reporting Process
1. **Immediate Response**: Ensure safety of all involved
2. **Notify Supervisor**: Contact supervisor immediately
3. **Document Incident**: Complete incident report form
4. **Investigation**: Participate in incident investigation
5. **Follow-up**: Attend follow-up meetings as required

### Incident Report Form
- **Date and Time**: When the incident occurred
- **Location**: Where the incident happened
- **People Involved**: Names of all people involved
- **Description**: Detailed description of what happened
- **Witnesses**: Names and contact information of witnesses
- **Injuries**: Description of any injuries sustained
- **Property Damage**: Description of any property damage

## Emergency Response

### Medical Emergencies
- **First Aid**: Basic first aid procedures
- **Emergency Contacts**: Emergency contact information
- **Medical Facilities**: Location of nearest medical facilities
- **Transportation**: How to arrange emergency transportation

### Fire Emergencies
- **Fire Prevention**: How to prevent fires
- **Fire Response**: What to do if a fire occurs
- **Evacuation**: Fire evacuation procedures
- **Fire Extinguishers**: How to use fire extinguishers

### Weather Emergencies
- **Severe Weather**: How to respond to severe weather
- **Shelter Locations**: Designated shelter locations
- **Communication**: How to stay informed during emergencies
- **Return to Work**: When it's safe to return to work

## Training and Certification

### Required Training
- **Safety Orientation**: Initial safety training for new workers
- **Annual Refresher**: Annual safety training updates
- **Specialized Training**: Training for specific hazards
- **Certification**: Required safety certifications

### Training Records
- **Completion Tracking**: How training completion is tracked
- **Certification Expiration**: Monitoring certification expiration
- **Recertification**: Process for renewing certifications
- **Documentation**: Maintaining training records

## Compliance Requirements

### OSHA Compliance
- **OSHA Standards**: Applicable OSHA safety standards
- **Record Keeping**: Required safety record keeping
- **Inspections**: Preparing for OSHA inspections
- **Violations**: How to address OSHA violations

### State Requirements
- **State Regulations**: State-specific safety requirements
- **Local Ordinances**: Local safety ordinances
- **Industry Standards**: Industry-specific safety standards
- **Best Practices**: Industry best practices

## Best Practices

### Daily Safety
- **Pre-Work Inspection**: Inspect work area before starting
- **Tool Safety**: Use tools and equipment safely
- **Communication**: Communicate safety concerns
- **Teamwork**: Work together to maintain safety

### Continuous Improvement
- **Safety Meetings**: Regular safety meetings
- **Feedback**: Provide feedback on safety procedures
- **Suggestions**: Submit safety improvement suggestions
- **Training**: Participate in safety training programs

## Resources

### Emergency Contacts
- **Emergency Services**: 911 for life-threatening emergencies
- **Safety Manager**: Contact information for safety manager
- **Supervisor**: Direct supervisor contact information
- **HR Department**: Human resources contact information

### Documentation
- **Safety Manual**: Complete safety manual
- **Training Materials**: Safety training materials
- **Forms**: Safety-related forms and checklists
- **Policies**: Safety policies and procedures`,
        category: "Safety & Compliance",
        tags: ["safety", "incidents", "emergencies", "compliance"],
        difficulty: "Beginner",
        estimatedReadTime: 10,
        relatedComponents: ["SafetyTab", "IncidentReporting", "EmergencyContacts"]
      },
      {
        title: "Performance Management and Feedback",
        content: `# Performance Management and Feedback

## Overview
Effective performance management helps workers succeed and organizations thrive. This guide covers how to give and receive feedback, set goals, and track performance improvements.

## Performance Metrics

### Key Performance Indicators (KPIs)
- **Attendance**: Regular attendance and punctuality
- **Quality**: Quality of work produced
- **Productivity**: Quantity of work completed
- **Safety**: Safety record and compliance
- **Teamwork**: Collaboration with colleagues
- **Initiative**: Proactive problem-solving

### Performance Ratings
- **Exceptional**: Consistently exceeds expectations
- **Exceeds**: Regularly exceeds expectations
- **Meets**: Consistently meets expectations
- **Needs Improvement**: Below expectations
- **Unsatisfactory**: Significantly below expectations

## Feedback Process

### Regular Check-ins
- **Weekly Check-ins**: Brief weekly performance discussions
- **Monthly Reviews**: More detailed monthly performance reviews
- **Quarterly Assessments**: Comprehensive quarterly assessments
- **Annual Evaluations**: Formal annual performance evaluations

### Feedback Guidelines
- **Be Specific**: Provide specific examples and observations
- **Be Timely**: Give feedback as close to the event as possible
- **Be Constructive**: Focus on improvement opportunities
- **Be Balanced**: Include both positive and negative feedback

### Receiving Feedback
- **Listen Actively**: Pay attention to feedback without interrupting
- **Ask Questions**: Clarify any points you don't understand
- **Take Notes**: Document feedback for future reference
- **Follow Up**: Take action on feedback received

## Goal Setting

### SMART Goals
- **Specific**: Clear and specific objectives
- **Measurable**: Quantifiable success criteria
- **Achievable**: Realistic and attainable goals
- **Relevant**: Aligned with organizational objectives
- **Time-bound**: Clear deadlines for completion

### Goal Categories
- **Performance Goals**: Goals related to job performance
- **Development Goals**: Goals for skill development
- **Career Goals**: Long-term career objectives
- **Team Goals**: Goals that benefit the team

### Goal Tracking
- **Progress Monitoring**: Regular progress check-ins
- **Milestone Tracking**: Tracking progress toward milestones
- **Adjustment Process**: How to adjust goals when needed
- **Celebration**: Recognizing goal achievement

## Performance Improvement

### Performance Plans
- **Development Plans**: Plans for improving performance
- **Action Items**: Specific actions to take
- **Timeline**: Timeline for improvement
- **Support Resources**: Resources available for support

### Coaching and Mentoring
- **One-on-One Coaching**: Individual coaching sessions
- **Mentoring Programs**: Formal mentoring relationships
- **Peer Support**: Support from colleagues
- **External Resources**: External training and development

### Training and Development
- **Skill Development**: Training for specific skills
- **Leadership Development**: Leadership training programs
- **Certification Programs**: Professional certification
- **Continuing Education**: Ongoing learning opportunities

## Recognition and Rewards

### Recognition Programs
- **Employee of the Month**: Monthly recognition programs
- **Performance Bonuses**: Financial rewards for performance
- **Public Recognition**: Public acknowledgment of achievements
- **Career Advancement**: Opportunities for promotion

### Informal Recognition
- **Thank You Notes**: Personal thank you messages
- **Team Celebrations**: Team celebrations for achievements
- **Positive Feedback**: Regular positive feedback
- **Peer Recognition**: Recognition from colleagues

## Performance Issues

### Addressing Performance Problems
- **Early Intervention**: Addressing issues early
- **Clear Communication**: Clear communication about expectations
- **Support and Resources**: Providing support and resources
- **Progressive Discipline**: Progressive discipline process

### Performance Improvement Plans (PIPs)
- **PIP Process**: How PIPs work
- **PIP Components**: Components of a PIP
- **PIP Timeline**: Timeline for PIP completion
- **PIP Outcomes**: Possible PIP outcomes

### Termination Process
- **Documentation**: Documenting performance issues
- **Due Process**: Following due process procedures
- **Exit Interviews**: Conducting exit interviews
- **Transition Support**: Supporting transition out of organization

## Best Practices

### For Workers
- **Self-Assessment**: Regular self-assessment of performance
- **Goal Setting**: Set and track personal goals
- **Skill Development**: Continuously develop skills
- **Feedback Seeking**: Actively seek feedback

### For Supervisors
- **Regular Feedback**: Provide regular, constructive feedback
- **Goal Setting**: Help workers set meaningful goals
- **Support and Resources**: Provide support and resources
- **Recognition**: Recognize and reward good performance

### For Organizations
- **Clear Expectations**: Set clear performance expectations
- **Fair Processes**: Ensure fair performance processes
- **Development Opportunities**: Provide development opportunities
- **Recognition Programs**: Implement recognition programs

## Technology and Tools

### Performance Management Systems
- **Goal Tracking**: Systems for tracking goals
- **Feedback Tools**: Tools for giving and receiving feedback
- **Performance Analytics**: Analytics for performance insights
- **Development Planning**: Tools for development planning

### Mobile Apps
- **Performance Tracking**: Mobile performance tracking
- **Feedback Submission**: Mobile feedback submission
- **Goal Monitoring**: Mobile goal monitoring
- **Training Access**: Mobile access to training materials`,
        category: "Performance Management",
        tags: ["performance", "feedback", "goals", "evaluation"],
        difficulty: "Intermediate",
        estimatedReadTime: 12,
        relatedComponents: ["PerformanceTab", "FeedbackEngine", "GoalSetting"]
      }
    ];

    console.log(`Found ${existingTopics.docs.length} existing help topics`);
    console.log('Existing titles:', Array.from(existingTitles));
    console.log(`Attempting to generate ${limit} new drafts from ${allHelpDrafts.length} predefined drafts`);

    // Filter out drafts with duplicate titles or high summary similarity
    let newDrafts = allHelpDrafts.filter(draft => {
      // Check for exact title match
      if (existingTitles.has(draft.title.toLowerCase())) {
        console.log(`Filtering out draft with existing title: ${draft.title}`);
        return false;
      }
      
      // Check for content similarity with a more lenient threshold
      const draftSummary = draft.content.replace(/^#+\s.*\n/gm, '').replace(/\n+/g, ' ').trim().slice(0, 200);
      const hasSimilarContent = existingSummaries.some(summary => {
        const similarity = jaccardSimilarity(draftSummary, summary);
        if (similarity > 0.8) { // Increased threshold from 0.7 to 0.8
          console.log(`Filtering out draft due to high similarity (${similarity.toFixed(2)}): ${draft.title}`);
          return true;
        }
        return false;
      });
      
      return !hasSimilarContent;
    }).slice(0, limit);

    // If not enough new drafts, generate unique versions of existing ones (with deduplication)
    if (newDrafts.length < limit) {
      console.log(`Only ${newDrafts.length} drafts passed filtering, generating versioned drafts...`);
      const now = Date.now();
      let attempts = 0;
      for (let i = 0; i < allHelpDrafts.length && newDrafts.length < limit && attempts < 20; i++, attempts++) {
        const baseDraft = allHelpDrafts[i % allHelpDrafts.length];
        const versionedTitle = `${baseDraft.title} (v${now}-${i + 1})`;
        const draftSummary = baseDraft.content.replace(/^#+\s.*\n/gm, '').replace(/\n+/g, ' ').trim().slice(0, 200);
        if (
          !existingTitles.has(versionedTitle.toLowerCase()) &&
          !existingSummaries.some(summary => jaccardSimilarity(draftSummary, summary) > 0.8) && // Updated threshold
          !newDrafts.some(d => d.title === versionedTitle)
        ) {
          newDrafts.push({ ...baseDraft, title: versionedTitle });
        }
      }
    }
    
    // Final fallback: if still no drafts, force create at least one
    if (newDrafts.length === 0) {
      console.log('No drafts generated after filtering, creating fallback draft...');
      const fallbackDraft = {
        ...allHelpDrafts[0],
        title: `${allHelpDrafts[0].title} (Generated ${new Date().toISOString()})`
      };
      newDrafts = [fallbackDraft];
    }

    // Save new drafts to Firestore
    const savedDrafts = [];
    for (const draft of newDrafts) {
      const body = draft.content;
      const summary = draft.content.replace(/^#+\s.*\n/gm, '').replace(/\n+/g, ' ').trim().slice(0, 200);
      const docRef = await db.collection('help_topics').add({
        ...draft,
        body,
        summary,
        status: 'draft',
        createdBy: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        usageCount: 0,
        thumbsUp: 0,
        thumbsDown: 0,
        viewedBy: [],
        agencyId: agencyId || null,
        customerId: customerId || null
      });
      savedDrafts.push({
        id: docRef.id,
        ...draft,
        body,
        summary
      });
    }

    await logAIAction({
      userId,
      actionType: 'help_drafts_generated',
      sourceModule: 'HelpManagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Generated ${savedDrafts.length} help article drafts`,
      eventType: 'help.drafts-generated',
      targetType: 'help_topics',
      targetId: savedDrafts.map(d => d.id).join(','),
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['content_generation', 'help_articles'],
      urgencyScore: null
    });

    return {
      success: true,
      draftsGenerated: savedDrafts.length,
      drafts: savedDrafts,
      message: `Successfully generated ${savedDrafts.length} help article drafts. You can now review, edit, and publish them.`
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'help_drafts_generated',
      sourceModule: 'HelpManagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: 'Failed to generate help drafts',
      eventType: 'help.drafts-generated',
      targetType: 'help_topics',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['content_generation', 'help_articles'],
      urgencyScore: null
    });
    throw new Error(error.message || 'Failed to generate help drafts');
  }
});

// Help Analytics Callable Function
export const getHelpAnalytics = onCall(async (request) => {
  try {
    // Get help topics for analytics
    const snapshot = await db.collection('help_topics').get();
    const topics = snapshot.docs.map(doc => doc.data());
    
    // Calculate analytics
    const totalUsage = topics.reduce((sum, topic) => sum + (topic.usageCount || 0), 0);
    const uniqueUsers = new Set(topics.flatMap(topic => topic.viewedBy || [])).size;
    
    const mostUsedComponents: Record<string, number> = {};
    topics.forEach(topic => {
      if (topic.relatedComponents) {
        topic.relatedComponents.forEach((component: string) => {
          mostUsedComponents[component] = (mostUsedComponents[component] || 0) + (topic.usageCount || 0);
        });
      }
    });
    
    const feedbackBreakdown = {
      thumbsUp: topics.reduce((sum, topic) => sum + (topic.thumbsUp || 0), 0),
      thumbsDown: topics.reduce((sum, topic) => sum + (topic.thumbsDown || 0), 0),
      confused: topics.reduce((sum, topic) => {
        const total = (topic.thumbsUp || 0) + (topic.thumbsDown || 0);
        return sum + (total > 0 ? Math.round((topic.thumbsDown / total) * 100) : 0);
      }, 0)
    };
    
    // Mock usage by day (last 30 days)
    const usageByDay: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      usageByDay[dateStr] = Math.floor(Math.random() * 50) + 10; // Mock data
    }
    
    const analytics = {
      totalUsage,
      uniqueUsers,
      mostUsedComponents,
      feedbackBreakdown,
      usageByDay
    };
    
    return { analytics };
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch help analytics');
  }
});

// JSI (Job Satisfaction Insights) Functions
export {
  generateJSIScore,
  flagJSIRisk,
  triggerJSIPrompts,
  getJSIAggregateStats,
  establishJSIBaseline,
  getJSITrendData,
  getJSIBaseline,
  detectJSIAnomalies,
  getJSIReportData,
  exportJSIData,
  getJSIAdvancedTrends,
  getJSIMessagingConfig,
  updateJSIMessagingConfig,
  addJSICustomTopic,
  generateJSIPrompt,
  getJSIBenchmarks,
  generateAutomatedJSIInsights,
  scheduleAutomatedJSIReports,
  getAutomatedJSIInsights
} from './jobSatisfactionInsights';

// Help & Guide System: Update Existing Help Articles with New Information
export const updateHelpArticlesWithNewInfo = onCall(async (request) => {
  const { userId } = request.data;
  const start = Date.now();
  try {
    // Define new info to inject (could be dynamic or AI-generated in the future)
    const newInfoMap: Record<string, string> = {
      'How to Create and Manage Job Orders': `\n\n**2024 Update:** You can now bulk import job orders via CSV. See the "Import" button on the Job Orders page.`,
      'Worker Assignment and Scheduling Guide': `\n\n**2024 Update:** The new "Smart Assignment" feature uses AI to recommend the best workers for each shift.`,
      'Customer Management and Communication': `\n\n**2024 Update:** Customer profiles now support custom fields and document uploads.`,
      'AI-Powered Workforce Optimization': `\n\n**2024 Update:** AI analytics now include predictive turnover risk and engagement scoring.`,
      'Mobile App Usage for Workers': `\n\n**2024 Update:** Workers can now submit time-off requests directly from the mobile app.`,
    };
    // Fetch all help topics
    const snapshot = await db.collection('help_topics').get();
    const updated = [];
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const updateText = newInfoMap[data.title];
      if (updateText && !data.content.includes(updateText)) {
        await db.collection('help_topics').doc(docSnap.id).update({
          content: data.content + updateText,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        updated.push({ id: docSnap.id, title: data.title });
      }
    }
    await logAIAction({
      userId,
      actionType: 'help_articles_updated',
      sourceModule: 'HelpManagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: `Updated ${updated.length} help articles with new information`,
      eventType: 'help.articles-updated',
      targetType: 'help_topics',
      targetId: updated.map(u => u.id).join(','),
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['content_update', 'help_articles'],
      urgencyScore: null
    });
    return {
      success: true,
      updatedCount: updated.length,
      updated,
      message: `Updated ${updated.length} articles with new information.`
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'help_articles_updated',
      sourceModule: 'HelpManagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v4',
      reason: 'Failed to update help articles',
      eventType: 'help.articles-updated',
      targetType: 'help_topics',
      // targetId intentionally omitted when not available
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['content_update', 'help_articles'],
      urgencyScore: null
    });
    throw new Error(error.message || 'Failed to update help articles');
  }
});

// Motivation Event Logging and AI Update
export const logMotivationEvent = onCall(async (request) => {
  const data = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  let logRef = null;

  try {
    // Compose log entry
    const logEntry = {
      userId: request.auth?.uid || data.workerId || 'unknown',
      workerId: data.workerId || request.auth?.uid || 'unknown',
      actionType: data.actionType || 'motivation_event',
      sourceModule: 'DailyMotivation',
      eventType: `motivation.${data.actionType}`,
      messageId: data.messageId,
      messageText: data.messageText || '',
      feedback: data.feedback || null,
      feedbackText: data.feedbackText || null,
      opened: data.opened || false,
      delivered: data.delivered || false,
      dismissed: data.dismissed || false,
      matchedReason: data.matchedReason || '',
      jobType: data.jobType || '',
      department: data.department || '',
      streakCount: data.streakCount || null,
      smartDeliveryScore: data.smartDeliveryScore || null,
      personalizationFactors: data.personalizationFactors || null,
      messageEffectiveness: data.messageEffectiveness || null,
      customerId: data.customerId || null,
      agencyId: data.agencyId || null,
      sentAt: data.sentAt || new Date().toISOString(),
      success: true,
      aiRelevant: true,
      contextType: 'motivation',
      reason: data.reason || null,
      versionTag: 'v1',
      latencyMs: Date.now() - start,
    };

    logRef = await admin.firestore().collection('ai_logs').add(logEntry);
    success = true;
    return { success: true, logId: logRef.id };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    // Also log via logAIAction for analytics/consistency
    await logAIAction({
      userId: request.auth?.uid || data.workerId || 'unknown',
      actionType: data.actionType || 'motivation_event',
      sourceModule: 'DailyMotivation',
      eventType: `motivation.${data.actionType}`,
      messageId: data.messageId,
      feedback: data.feedback || null,
      feedbackText: data.feedbackText || null,
      opened: data.opened || false,
      delivered: data.delivered || false,
      dismissed: data.dismissed || false,
      matchedReason: data.matchedReason || '',
      jobType: data.jobType || '',
      department: data.department || '',
      streakCount: data.streakCount || null,
      smartDeliveryScore: data.smartDeliveryScore || null,
      personalizationFactors: data.personalizationFactors || null,
      messageEffectiveness: data.messageEffectiveness || null,
      customerId: data.customerId || null,
      agencyId: data.agencyId || null,
      sentAt: data.sentAt || new Date().toISOString(),
      success,
      aiRelevant: true,
      contextType: 'motivation',
      reason: data.reason || errorMessage,
      versionTag: 'v1',
      latencyMs: Date.now() - start,
    });
  }
});

// Birthday Recognition Functions
export const getUpcomingBirthdays = onCall(async (request) => {
  const { customerId, agencyId, daysAhead = 30 } = request.data;
  const start = Date.now();
  try {
    type UserWithDOB = { id: string; dob?: any } & Record<string, any>;
    let usersQuery = db.collection('users').where('wantsBirthdayAcknowledgement', '==', true);
    if (customerId) usersQuery = usersQuery.where('customerId', '==', customerId);
    if (agencyId) usersQuery = usersQuery.where('agencyId', '==', agencyId);
    const usersSnapshot = await usersQuery.get();
    const users: UserWithDOB[] = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const today = new Date();
    const upcomingBirthdays = users.filter(user => {
      if (!user.dob) return false;
      const dob = user.dob.toDate ? user.dob.toDate() : new Date(user.dob);
      const birthdayThisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
      const birthdayNextYear = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
      const nextBirthday = birthdayThisYear < today ? birthdayNextYear : birthdayThisYear;
      const daysUntilBirthday = Math.ceil((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilBirthday <= daysAhead;
    });
    upcomingBirthdays.sort((a, b) => {
      const dobA = a.dob.toDate ? a.dob.toDate() : new Date(a.dob);
      const dobB = b.dob.toDate ? b.dob.toDate() : new Date(b.dob);
      const birthdayA = new Date(today.getFullYear(), dobA.getMonth(), dobA.getDate());
      const birthdayB = new Date(today.getFullYear(), dobB.getMonth(), dobB.getDate());
      if (birthdayA < today) birthdayA.setFullYear(today.getFullYear() + 1);
      if (birthdayB < today) birthdayB.setFullYear(today.getFullYear() + 1);
      return birthdayA.getTime() - birthdayB.getTime();
    });
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'get_upcoming_birthdays',
      sourceModule: 'BirthdayManager',
      customerId,
      agencyId,
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Fetched ${upcomingBirthdays.length} upcoming birthdays`,
      eventType: 'birthday.upcoming_fetched',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: false,
      contextType: 'birthday',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    return { birthdays: upcomingBirthdays };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'get_upcoming_birthdays',
      sourceModule: 'BirthdayManager',
      customerId,
      agencyId,
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to fetch upcoming birthdays: ${error.message}`,
      eventType: 'birthday.upcoming_fetched',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: false,
      contextType: 'birthday',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const sendBirthdayMessage = onCall(async (request) => {
  const { workerId, messageText, giftType, giftValue, customerId, agencyId } = request.data;
  const start = Date.now();
  try {
    const workerDoc = await db.collection('users').doc(workerId).get();
    if (!workerDoc.exists) throw new Error('Worker not found');
    const worker = workerDoc.data();
    const birthdayMessage = {
      id: `birthday_${Date.now()}`,
      workerId,
      workerName: worker?.firstName + ' ' + worker?.lastName,
      messageText,
      giftType,
      giftValue,
      sentBy: request.auth?.uid,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      customerId,
      agencyId,
      status: 'sent'
    };
    await db.collection('birthdayAudit').add(birthdayMessage);
    await db.collection('users').doc(workerId).update({ lastBirthdayAcknowledged: admin.firestore.FieldValue.serverTimestamp() });
    const notification = {
      id: `birthday_notif_${Date.now()}`,
      workerId,
      type: 'birthday_message',
      title: 'Happy Birthday! 🎉',
      message: messageText,
      giftType,
      giftValue,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false
    };
    await db.collection('notifications').add(notification);
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'send_birthday_message',
      sourceModule: 'BirthdayManager',
      customerId,
      agencyId,
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Sent birthday message to ${worker?.firstName} ${worker?.lastName}`,
      eventType: 'birthday.message_sent',
      targetType: 'worker',
      targetId: workerId,
      aiRelevant: false,
      contextType: 'birthday',
      traitsAffected: null,
      aiTags: ['birthday', giftType],
      urgencyScore: null
    });
    return { success: true, messageId: birthdayMessage.id };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'send_birthday_message',
      sourceModule: 'BirthdayManager',
      customerId,
      agencyId,
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to send birthday message: ${error.message}`,
      eventType: 'birthday.message_sent',
      targetType: 'worker',
      targetId: workerId,
      aiRelevant: false,
      contextType: 'birthday',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Motivation Library Functions
export const getMotivations = onCall(async (request) => {
  const { customerId, filters = {} } = request.data;
  const start = Date.now();
  try {
    let motivationsQuery = db.collection('motivations').where('isActive', '==', true);
    if (filters.toneTags && filters.toneTags.length > 0) {
      motivationsQuery = motivationsQuery.where('toneTags', 'array-contains-any', filters.toneTags);
    }
    if (filters.roleTags && filters.roleTags.length > 0) {
      motivationsQuery = motivationsQuery.where('roleTags', 'array-contains-any', filters.roleTags);
    }
    if (filters.source) {
      motivationsQuery = motivationsQuery.where('source', '==', filters.source);
    }
    const snapshot = await motivationsQuery.get();
    const motivations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toDate() }));
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'get_motivations',
      sourceModule: 'MotivationLibrary',
      customerId,
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Fetched ${motivations.length} motivations`,
      eventType: 'motivation.library_fetched',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: filters.toneTags || [],
      urgencyScore: null
    });
    return { motivations };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'get_motivations',
      sourceModule: 'MotivationLibrary',
      customerId,
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to fetch motivations: ${error.message}`,
      eventType: 'motivation.library_fetched',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

export const addMotivation = onCall(async (request) => {
  const { text, quote, author, toneTags, roleTags, source, customerId } = request.data;
  const start = Date.now();
  try {
    const motivation = {
      text,
      quote: quote || '',
      author: author || '',
      toneTags: toneTags || [],
      roleTags: roleTags || [],
      createdBy: request.auth?.uid,
      source: source || 'Manual',
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const docRef = await db.collection('motivations').add(motivation);
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'add_motivation',
      sourceModule: 'MotivationLibrary',
      customerId,
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Added new motivation: ${text.substring(0, 50)}...`,
      eventType: 'motivation.added',
      targetType: 'motivation',
      targetId: docRef.id,
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: toneTags || [],
      urgencyScore: null
    });
    return { success: true, motivationId: docRef.id };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'add_motivation',
      sourceModule: 'MotivationLibrary',
      customerId,
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to add motivation: ${error.message}`,
      eventType: 'motivation.added',
      targetType: 'motivation',
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Quotable.io API Integration for Motivation Library Seeding
export const seedMotivationMessagesFromAPI = onCall(async (request) => {
  const userId = request.auth?.uid || 'system';
  const start = Date.now();
  try {
    let totalAdded = 0;
    const addedQuotes: string[] = [];
    const skippedQuotes: string[] = [];

    // Check existing quotes to avoid duplicates
    const existingQuotesSnapshot = await db.collection('motivations')
      .where('source', '==', 'ZenQuotes.io')
      .get();
    const existingQuotes = new Set(existingQuotesSnapshot.docs.map(doc => doc.data().text));

    console.log(`Found ${existingQuotes.size} existing quotes from ZenQuotes.io`);

    // Fetch quotes from ZenQuotes API
    const response = await fetch('https://zenquotes.io/api/quotes');
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const quotes = Array.isArray(data) ? data : [];

    for (const quote of quotes) {
      if (existingQuotes.has(quote.q)) {
        skippedQuotes.push(quote.q);
        continue;
      }
      const motivationData = {
        text: quote.q,
        quote: quote.q,
        author: quote.a || 'Unknown',
        tags: [],
        toneTags: [],
        roleTags: [],
        createdBy: userId,
        source: 'ZenQuotes.io',
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        usageCount: 0,
        averageRating: 0,
        enabled: true
      };
      await db.collection('motivations').add(motivationData);
      addedQuotes.push(quote.q);
      totalAdded++;
      console.log(`✅ Added: "${quote.q.substring(0, 50)}..." — ${quote.a || 'Unknown'}`);
    }

    // Log the seeding operation
    await logAIAction({
      userId,
      actionType: 'seed_motivations_from_api',
      sourceModule: 'MotivationLibrary',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Seeded ${totalAdded} new quotes from ZenQuotes.io API`,
      eventType: 'motivation.library_seeded',
      targetType: 'system',
      targetId: 'zenquotes_seeding',
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      totalAdded,
      totalSkipped: skippedQuotes.length,
      addedQuotes: addedQuotes.slice(0, 10),
      skippedQuotes: skippedQuotes.slice(0, 10)
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'seed_motivations_from_api',
      sourceModule: 'MotivationLibrary',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to seed motivations from API: ${error.message}`,
      eventType: 'motivation.library_seeded',
      targetType: 'system',
      targetId: 'zenquotes_seeding',
      aiRelevant: true,
      contextType: 'motivation',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Background function to check for birthdays daily
export const checkBirthdays = onSchedule({
  schedule: '0 9 * * *', // Run at 9 AM daily
  timeZone: 'America/New_York'
}, async (event) => {
  const start = Date.now();
  try {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const usersSnapshot = await db.collection('users')
      .where('wantsBirthdayAcknowledgement', '==', true)
      .get();
    const usersWithBirthdaysToday = usersSnapshot.docs.filter(doc => {
      const user = doc.data();
      if (!user.dob) return false;
      const dob = user.dob.toDate ? user.dob.toDate() : new Date(user.dob);
      return dob.getMonth() + 1 === month && dob.getDate() === day;
    });
    await logAIAction({
      userId: 'system',
      actionType: 'birthday_check',
      sourceModule: 'BirthdayManager',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Found ${usersWithBirthdaysToday.length} birthdays today`,
      eventType: 'birthday.daily_check',
      targetType: 'system',
      targetId: 'daily_check',
      aiRelevant: false,
      contextType: 'birthday',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    console.log(`Birthday check completed: ${usersWithBirthdaysToday.length} birthdays found`);
  } catch (error: any) {
    await logAIAction({
      userId: 'system',
      actionType: 'birthday_check',
      sourceModule: 'BirthdayManager',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Birthday check failed: ${error.message}`,
      eventType: 'birthday.daily_check',
      targetType: 'system',
      targetId: 'daily_check',
      aiRelevant: false,
      contextType: 'birthday',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    console.error('Birthday check failed:', error);
  }
});

// Universal AI Settings Update Function
export const updateCustomerAISettings = onCall(async (request) => {
  const { customerId, settingsType, settings } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();
  let success = false;
  let errorMessage = '';

  if (!customerId || !settingsType || !settings) {
    throw new Error('customerId, settingsType, and settings are required');
  }

  try {
    // Update the appropriate AI settings document
    await db.collection('customers')
      .doc(customerId)
      .collection('aiSettings')
      .doc(settingsType)
      .set({ ...settings, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId }, { merge: true });
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId,
      actionType: 'ai_settings_update',
      sourceModule: 'AISettings',
      inputPrompt: JSON.stringify(settings),
      composedPrompt: `Updated ${settingsType} for customer ${customerId}`,
      aiResponse: success ? 'Settings updated' : errorMessage,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      customerId,
      contextType: 'ai_settings',
      reason: success
        ? `Updated AI settings: ${settingsType} (${Object.keys(settings).join(', ')})`
        : errorMessage,
      targetType: settingsType,
      targetId: customerId,
      aiRelevant: true
    });
  }
});

// Universal Agency AI Settings Update Function
export const updateAgencyAISettings = onCall(async (request) => {
  const { agencyId, settingsType, settings } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();
  let success = false;
  let errorMessage = '';

  if (!agencyId || !settingsType || !settings) {
    errorMessage = 'agencyId, settingsType, and settings are required';
    console.error('updateAgencyAISettings error:', errorMessage, { agencyId, settingsType, settings });
    // Throw with details for frontend
    throw new HttpsError('invalid-argument', errorMessage);
  }

  try {
    // Update the appropriate AI settings document
    await db.collection('agencies')
      .doc(agencyId)
      .collection('aiSettings')
      .doc(settingsType)
      .set({ ...settings, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId }, { merge: true });
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    console.error('updateAgencyAISettings Firestore error:', errorMessage, error);
    // Throw with details for frontend
    throw new HttpsError('internal', errorMessage, { agencyId, settingsType, settings });
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId,
      actionType: 'ai_settings_update',
      sourceModule: 'AISettings',
      inputPrompt: JSON.stringify(settings),
      composedPrompt: `Updated ${settingsType} for agency ${agencyId}`,
      aiResponse: success ? 'Settings updated' : errorMessage,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      agencyId,
      contextType: 'ai_settings',
      reason: success
        ? `Updated AI settings: ${settingsType} (${Object.keys(settings).join(', ')})`
        : errorMessage,
      targetType: settingsType,
      targetId: agencyId,
      aiRelevant: true
    });
  }
});

// Export the checkRecentAILogs function
export { checkRecentAILogs } from './checkRecentAILogs';

// Export AutoDevOps monitoring functions
export { 
  collectAutoDevOpsMetrics, 
  getRealTimeMetrics, 
  getPerformanceDashboard,
  getLatestAutoDevOpsMetrics,
  monitorBuildDeploymentErrors,
  monitorAIEngineProcessing,
  monitorLoggingErrors,
  monitorAIEngineProcessingWithSelfHealing,
  getLoggingErrorStats
} from './autoDevOpsMonitoring';

// Export AutoDevAssistant functions
export { 
  analyzeAndGenerateFixes, 
  generateAndDeployFix, 
  getAutoDevFixes 
} from './autoDevAssistant';

// Export HRX Modules functions
export {
  // Reset Mode
  activateResetMode,
  deactivateResetMode,
  submitResetModeCheckIn,
  getResetModeDashboard,
  detectResetModeTrigger,
  checkResetModeExpiration,
  
  // Mini-Learning Boosts
  deliverLearningBoost,
  markBoostViewed,
  completeLearningBoost,
  skipLearningBoost,
  getUserLearningDashboard,
  getAdminLearningDashboard,
  deliverWeeklyLearningBoosts,
  
  // Professional Growth
  createCareerGoal,
  updateCareerGoal,
  createCareerJournalEntry,
  updateSkillsInventory,
  getUserGrowthDashboard,
  getAdminGrowthDashboard,
  sendWeeklyGrowthPrompts,
  
  // Work-Life Balance
  submitBalanceCheckIn,
  submitWellbeingReflection,
  calculateBurnoutRiskIndex,
  getUserBalanceDashboard,
  getAdminBalanceDashboard,
  acknowledgeBalanceAlert,
  sendWeeklyBalanceCheckIns
} from './modules';

export const batchTagMotivationsWithAI = onCall(async (request) => {
  const userId = request.auth?.uid || '';
  // Only HRX users can run this
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists || userDoc.data()?.role !== 'HRX') {
    throw new HttpsError('permission-denied', 'Only HRX users can batch-tag motivations.');
  }

  const motivationsRef = db.collection('motivations');
  const snapshot = await motivationsRef.where('isActive', '==', true).get();
  let updated = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if ((data.traits && data.traits.length > 0) && (data.tags && data.tags.length > 0)) {
      skipped++;
      continue;
    }
    try {
      const { traits, tags } = await getTraitsAndTags(data.text || data.quote || '');
      await doc.ref.update({ traits, tags });
      updated++;
    } catch (err: any) {
      errors.push(`Doc ${doc.id}: ${err.message}`);
    }
  }

  return { updated, skipped, errors };
});

// Help & Guide System: Update Help Topic
export const updateHelpTopic = onCall(async (request) => {
  const { topicId, updates } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    await db.collection('help_topics').doc(topicId).update({
      ...updates,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    await logAIAction({
      userId,
      actionType: 'help_topic_updated',
      sourceModule: 'HelpManagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated help topic: ${topicId}`,
      eventType: 'help.topic-updated',
      targetType: 'help_topics',
      targetId: topicId,
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['help_topic', 'update'],
      urgencyScore: null
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'help_topic_updated',
      sourceModule: 'HelpManagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update help topic: ${topicId}`,
      eventType: 'help.topic-update-failed',
      targetType: 'help_topics',
      targetId: topicId,
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['help_topic', 'update'],
      urgencyScore: null
    });
    throw new Error(error.message || 'Failed to update help topic');
  }
});

// Help & Guide System: Delete Help Topic
export const deleteHelpTopic = onCall(async (request) => {
  const { topicId } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    await db.collection('help_topics').doc(topicId).delete();

    await logAIAction({
      userId,
      actionType: 'help_topic_deleted',
      sourceModule: 'HelpManagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Deleted help topic: ${topicId}`,
      eventType: 'help.topic-deleted',
      targetType: 'help_topics',
      targetId: topicId,
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['help_topic', 'delete'],
      urgencyScore: null
    });

    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'help_topic_deleted',
      sourceModule: 'HelpManagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to delete help topic: ${topicId}`,
      eventType: 'help.topic-delete-failed',
      targetType: 'help_topics',
      targetId: topicId,
      aiRelevant: true,
      contextType: 'help_management',
      traitsAffected: null,
      aiTags: ['help_topic', 'delete'],
      urgencyScore: null
    });
    throw new Error(error.message || 'Failed to delete help topic');
  }
});

// --- User Invitation System ---
const auth = admin.auth();

// Utility to remove undefined fields
function removeUndefined(obj: Record<string, any>) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

// Invite User (HRX, Agency, Customer) - 2nd Gen
export const inviteUserV2 = onCall(async (request) => {
  const start = Date.now();
  console.log('inviteUserV2 payload:', request.data);
  if (!request.data || !request.data.email) {
    throw new Error('Email is required');
  }
  const {
    email, displayName, firstName, lastName, jobTitle, department, phone,
    locationIds, securityLevel, role, agencyId, customerId, tenantId
  } = request.data;

  // 1. Create Auth user if not exists
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    userRecord = await auth.createUser({
      email,
      displayName: displayName || `${firstName} ${lastName}`,
      emailVerified: false,
      disabled: false,
    });
  }

  // 2. Generate password reset link for new users to set their password
  const actionCodeSettings = {
    url: 'https://app.hrxone.com/setup-password', // <-- New password setup page
    handleCodeInApp: true,
  };
  const link = await auth.generatePasswordResetLink(email, actionCodeSettings);

  // 3. Store user metadata in Firestore (filter out undefined fields)
  const tenantIdToUse = tenantId || agencyId;
  
  // Create the proper tenantIds map structure
  const tenantIdsMap = tenantIdToUse ? {
    [tenantIdToUse]: {
      role: role || 'Tenant',
      securityLevel: securityLevel || 'Worker',
      locationIds: locationIds || [],
      department: department || null,
      addedAt: admin.firestore.FieldValue.serverTimestamp()
    }
  } : {};
  
  const userData = removeUndefined({
    email,
    displayName: displayName || `${firstName} ${lastName}`,
    firstName,
    lastName,
    jobTitle,
    department,
    phone,
    locationIds,
    securityLevel,
    role,
    agencyId: agencyId || null,
    customerId: customerId || null,
    tenantId: tenantIdToUse || null,
    tenantIds: tenantIdsMap,
    inviteStatus: 'pending',
    inviteSentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('users').doc(userRecord.uid).set(userData, { merge: true });

  // 4. Get tenant branding and information
  let tenantData = null;
  let brandingData = null;
  let invitedByUser = null;
  
  try {
    // Get tenant information - try tenantId first, then agencyId
    const tenantIdToUse = tenantId || agencyId;
    if (tenantIdToUse) {
      const tenantDoc = await db.collection('tenants').doc(tenantIdToUse).get();
      if (tenantDoc.exists) {
        tenantData = tenantDoc.data();
      }
    }
    
    // Get branding settings
    if (tenantIdToUse) {
      const brandingDoc = await db.collection('tenants').doc(tenantIdToUse).collection('branding').doc('settings').get();
      if (brandingDoc.exists) {
        brandingData = brandingDoc.data();
      }
    }
    
    // Get invited by user information
    if (request.auth?.uid) {
      const userDoc = await db.collection('users').doc(request.auth.uid).get();
      if (userDoc.exists) {
        invitedByUser = userDoc.data();
      }
    }
  } catch (error) {
    console.error('Error fetching tenant/branding data:', error);
  }
  
  // 5. Prepare dynamic template data
  const templateData = {
    tenant_name: tenantData?.name || 'Your Organization',
    tenant_type: tenantData?.type || 'Organization',
    tenant_logo: tenantData?.avatar || brandingData?.logo || null,
    tenant_initials: tenantData?.name ? tenantData.name.substring(0, 2).toUpperCase() : 'CO',
    tenant_accent_color: brandingData?.accentColor || '#0057B8',
    tenant_website: brandingData?.websiteUrl || tenantData?.contact?.website || null,
    tenant_hr_email: brandingData?.hrEmail || tenantData?.contact?.email || null,
    tenant_sender_name: brandingData?.senderName || 'HRX Notifications',
    tenant_legal_footer: brandingData?.legalFooter || null,
    worker_first_name: firstName || '',
    worker_last_name: lastName || '',
    worker_job_title: jobTitle || null,
    worker_department: department || null,
    worker_security_level: securityLevel || null,
    invited_by_name: invitedByUser ? `${invitedByUser.firstName || ''} ${invitedByUser.lastName || ''}`.trim() || invitedByUser.displayName || 'Administrator' : 'Administrator',
    invitation_link: link,
    expiration_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  };
  
  // 6. Send invite email via SendGrid with dynamic template
  let msg: any = {
    to: email,
    from: {
      email: 'no-reply@hrxone.com',
      name: templateData.tenant_sender_name
    },
    subject: `You're invited to join ${templateData.tenant_name} on HRX!`,
    templateId: 'd-36383cd72987421fa5335e9ea7db10d9', // Replace with your actual SendGrid template ID
    dynamicTemplateData: templateData
  };
  
  // Fallback to simple HTML if template ID is not set
  if (!msg.templateId || msg.templateId === 'd-your-sendgrid-template-id-here') {
    msg.html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: ${templateData.tenant_accent_color}; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">${templateData.tenant_name}</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">${templateData.tenant_type}</p>
        </div>
        <div style="padding: 30px; background-color: white; border: 1px solid #e0e0e0; border-top: none;">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">Hello ${templateData.worker_first_name}!</h2>
          <p style="color: #555; line-height: 1.6; margin-bottom: 30px;">
            You've been invited to join <strong>${templateData.tenant_name}</strong> on the HRX platform. 
            This invitation gives you access to your work assignments, schedules, and team communications.
          </p>
          <div style="background-color: #f8f9fa; border-left: 4px solid ${templateData.tenant_accent_color}; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <h3 style="color: #2c3e50; margin-bottom: 15px;">Your Invitation Details</h3>
            <p><strong>Name:</strong> ${templateData.worker_first_name} ${templateData.worker_last_name}</p>
            ${templateData.worker_job_title ? `<p><strong>Position:</strong> ${templateData.worker_job_title}</p>` : ''}
            ${templateData.worker_department ? `<p><strong>Department:</strong> ${templateData.worker_department}</p>` : ''}
            ${templateData.worker_security_level ? `<p><strong>Access Level:</strong> ${templateData.worker_security_level}</p>` : ''}
            <p><strong>Invited By:</strong> ${templateData.invited_by_name}</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${templateData.invitation_link}" style="background-color: ${templateData.tenant_accent_color}; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Accept Invitation & Set Up Account
            </a>
          </div>
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 6px; margin: 20px 0; font-size: 14px;">
            <strong>⏰ Important:</strong> This invitation expires on ${templateData.expiration_date}. 
            Please complete your account setup before then.
          </div>
          ${templateData.tenant_website ? `<p style="text-align: center; margin: 20px 0; font-size: 14px; color: #666;">
            Learn more about ${templateData.tenant_name} at 
            <a href="${templateData.tenant_website}" style="color: ${templateData.tenant_accent_color};">${templateData.tenant_website}</a>
          </p>` : ''}
        </div>
        <div style="background-color: #2c3e50; color: white; padding: 30px; text-align: center; border-radius: 0 0 8px 8px;">
          <p style="margin-bottom: 15px;">Powered by <strong>HRX</strong> - The Future of Workforce Management</p>
          <div style="margin-bottom: 20px;">
            ${templateData.tenant_hr_email ? `<a href="mailto:${templateData.tenant_hr_email}" style="color: rgba(255,255,255,0.8); text-decoration: none; margin: 0 10px;">Contact HR</a>` : ''}
            <a href="https://app.hrxone.com/support" style="color: rgba(255,255,255,0.8); text-decoration: none; margin: 0 10px;">Support</a>
            <a href="https://app.hrxone.com/privacy" style="color: rgba(255,255,255,0.8); text-decoration: none; margin: 0 10px;">Privacy Policy</a>
          </div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.5;">
            ${templateData.tenant_legal_footer || `This email was sent by ${templateData.tenant_sender_name} on behalf of ${templateData.tenant_name}. 
            If you did not expect this invitation, please ignore this email or contact your administrator.`}
          </div>
        </div>
      </div>
    `;
    msg.text = `Hello ${templateData.worker_first_name}!

You've been invited to join ${templateData.tenant_name} on the HRX platform.

Your Invitation Details:
- Name: ${templateData.worker_first_name} ${templateData.worker_last_name}
${templateData.worker_job_title ? `- Position: ${templateData.worker_job_title}` : ''}
${templateData.worker_department ? `- Department: ${templateData.worker_department}` : ''}
${templateData.worker_security_level ? `- Access Level: ${templateData.worker_security_level}` : ''}
- Invited By: ${templateData.invited_by_name}

Accept your invitation: ${templateData.invitation_link}

This invitation expires on ${templateData.expiration_date}.

${templateData.tenant_website ? `Learn more about ${templateData.tenant_name}: ${templateData.tenant_website}` : ''}

Powered by HRX - The Future of Workforce Management

${templateData.tenant_legal_footer || `This email was sent by ${templateData.tenant_sender_name} on behalf of ${templateData.tenant_name}. If you did not expect this invitation, please ignore this email.`}`;
  }
  
  // 6. Send invite email via SendGrid with dynamic template
  try {
    console.log('Sending email to:', email);
    console.log('SendGrid API Key configured:', !!SENDGRID_API_KEY);
    console.log('Template ID:', msg.templateId);
    console.log('Template data keys:', Object.keys(templateData));
    
    await sgMail.send(msg);
    console.log('Email sent successfully to:', email);
  } catch (emailError: any) {
    console.error('Failed to send email:', emailError);
    console.error('Email error details:', {
      message: emailError.message,
      code: emailError.code,
      response: emailError.response?.body
    });
    
    // Log the AI action for email failure
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'invite_email_failed',
      sourceModule: 'InviteUserV2',
      success: false,
      errorMessage: emailError.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to send invite email to ${email}`,
      eventType: 'invite.email-failed',
      targetType: 'user',

      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    // Don't throw error, just log it and continue
    // The user is still created and can be invited manually
  }

  // 7. Return success and the link (for dev/testing)
  return { success: true, link };
});

// Resend Invite - 2nd Gen
export const resendInviteV2 = onCall(async (request) => {
  const { email } = request.data;
  const userRecord = await auth.getUserByEmail(email);
  const actionCodeSettings = {
    url: 'https://app.hrxone.com/setup-password',
    handleCodeInApp: true,
  };
  const link = await auth.generatePasswordResetLink(email, actionCodeSettings);

  // Filter out undefined fields for update
  const updateData = removeUndefined({
    inviteStatus: 'pending',
    inviteSentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('users').doc(userRecord.uid).update(updateData);

  // Get user data for template
  const userData = userRecord.toJSON() as any;
  
  // Get tenant branding and information
  let tenantData = null;
  let brandingData = null;
  let invitedByUser = null;
  
  try {
    // Get tenant information from user's tenantId
    if (userData.tenantId) {
      const tenantDoc = await db.collection('tenants').doc(userData.tenantId).get();
      if (tenantDoc.exists) {
        tenantData = tenantDoc.data();
      }
    }
    
    // Get branding settings
    if (userData.tenantId) {
      const brandingDoc = await db.collection('tenants').doc(userData.tenantId).collection('branding').doc('settings').get();
      if (brandingDoc.exists) {
        brandingData = brandingDoc.data();
      }
    }
    
    // Get invited by user information
    if (request.auth?.uid) {
      const userDoc = await db.collection('users').doc(request.auth.uid).get();
      if (userDoc.exists) {
        invitedByUser = userDoc.data();
      }
    }
  } catch (error) {
    console.error('Error fetching tenant/branding data for resend:', error);
  }
  
  // Prepare dynamic template data
  const templateData = {
    tenant_name: tenantData?.name || 'Your Organization',
    tenant_type: tenantData?.type || 'Organization',
    tenant_logo: tenantData?.avatar || brandingData?.logo || null,
    tenant_initials: tenantData?.name ? tenantData.name.substring(0, 2).toUpperCase() : 'CO',
    tenant_accent_color: brandingData?.accentColor || '#0057B8',
    tenant_website: brandingData?.websiteUrl || tenantData?.contact?.website || null,
    tenant_hr_email: brandingData?.hrEmail || tenantData?.contact?.email || null,
    tenant_sender_name: brandingData?.senderName || 'HRX Notifications',
    tenant_legal_footer: brandingData?.legalFooter || null,
    worker_first_name: userData.firstName || userData.displayName?.split(' ')[0] || '',
    worker_last_name: userData.lastName || userData.displayName?.split(' ').slice(1).join(' ') || '',
    worker_job_title: userData.jobTitle || null,
    worker_department: userData.department || null,
    worker_security_level: userData.securityLevel || null,
    invited_by_name: invitedByUser ? `${invitedByUser.firstName || ''} ${invitedByUser.lastName || ''}`.trim() || invitedByUser.displayName || 'Administrator' : 'Administrator',
    invitation_link: link,
    expiration_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  };
  
  // Send resend email via SendGrid with dynamic template
  let msg: any = {
    to: email,
    from: {
      email: 'no-reply@hrxone.com',
      name: templateData.tenant_sender_name
    },
    subject: `Reminder: You're invited to join ${templateData.tenant_name} on HRX!`,
    templateId: 'd-36383cd72987421fa5335e9ea7db10d9', // Replace with your actual SendGrid template ID
    dynamicTemplateData: templateData
  };
  
  // Fallback to simple HTML if template ID is not set
  if (!msg.templateId || msg.templateId === 'd-your-sendgrid-template-id-here') {
    msg.html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: ${templateData.tenant_accent_color}; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">${templateData.tenant_name}</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">${templateData.tenant_type}</p>
        </div>
        <div style="padding: 30px; background-color: white; border: 1px solid #e0e0e0; border-top: none;">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">Hello ${templateData.worker_first_name}!</h2>
          <p style="color: #555; line-height: 1.6; margin-bottom: 30px;">
            This is a reminder that you've been invited to join <strong>${templateData.tenant_name}</strong> on the HRX platform. 
            If you haven't already, please complete your account setup to access your work assignments and team communications.
          </p>
          <div style="background-color: #f8f9fa; border-left: 4px solid ${templateData.tenant_accent_color}; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <h3 style="color: #2c3e50; margin-bottom: 15px;">Your Invitation Details</h3>
            <p><strong>Name:</strong> ${templateData.worker_first_name} ${templateData.worker_last_name}</p>
            ${templateData.worker_job_title ? `<p><strong>Position:</strong> ${templateData.worker_job_title}</p>` : ''}
            ${templateData.worker_department ? `<p><strong>Department:</strong> ${templateData.worker_department}</p>` : ''}
            ${templateData.worker_security_level ? `<p><strong>Access Level:</strong> ${templateData.worker_security_level}</p>` : ''}
            <p><strong>Invited By:</strong> ${templateData.invited_by_name}</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${templateData.invitation_link}" style="background-color: ${templateData.tenant_accent_color}; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Complete Account Setup
            </a>
          </div>
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 6px; margin: 20px 0; font-size: 14px;">
            <strong>⏰ Important:</strong> This invitation expires on ${templateData.expiration_date}. 
            Please complete your account setup before then.
          </div>
          ${templateData.tenant_website ? `<p style="text-align: center; margin: 20px 0; font-size: 14px; color: #666;">
            Learn more about ${templateData.tenant_name} at 
            <a href="${templateData.tenant_website}" style="color: ${templateData.tenant_accent_color};">${templateData.tenant_website}</a>
          </p>` : ''}
        </div>
        <div style="background-color: #2c3e50; color: white; padding: 30px; text-align: center; border-radius: 0 0 8px 8px;">
          <p style="margin-bottom: 15px;">Powered by <strong>HRX</strong> - The Future of Workforce Management</p>
          <div style="margin-bottom: 20px;">
            ${templateData.tenant_hr_email ? `<a href="mailto:${templateData.tenant_hr_email}" style="color: rgba(255,255,255,0.8); text-decoration: none; margin: 0 10px;">Contact HR</a>` : ''}
            <a href="https://app.hrxone.com/support" style="color: rgba(255,255,255,0.8); text-decoration: none; margin: 0 10px;">Support</a>
            <a href="https://app.hrxone.com/privacy" style="color: rgba(255,255,255,0.8); text-decoration: none; margin: 0 10px;">Privacy Policy</a>
          </div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.5;">
            ${templateData.tenant_legal_footer || `This email was sent by ${templateData.tenant_sender_name} on behalf of ${templateData.tenant_name}. 
            If you did not expect this invitation, please ignore this email or contact your administrator.`}
          </div>
        </div>
      </div>
    `;
    msg.text = `Hello ${templateData.worker_first_name}!

This is a reminder that you've been invited to join ${templateData.tenant_name} on the HRX platform.

Your Invitation Details:
- Name: ${templateData.worker_first_name} ${templateData.worker_last_name}
${templateData.worker_job_title ? `- Position: ${templateData.worker_job_title}` : ''}
${templateData.worker_department ? `- Department: ${templateData.worker_department}` : ''}
${templateData.worker_security_level ? `- Access Level: ${templateData.worker_security_level}` : ''}
- Invited By: ${templateData.invited_by_name}

Complete your account setup: ${templateData.invitation_link}

This invitation expires on ${templateData.expiration_date}.

${templateData.tenant_website ? `Learn more about ${templateData.tenant_name}: ${templateData.tenant_website}` : ''}

Powered by HRX - The Future of Workforce Management

${templateData.tenant_legal_footer || `This email was sent by ${templateData.tenant_sender_name} on behalf of ${templateData.tenant_name}. If you did not expect this invitation, please ignore this email.`}`;
  }
  
  await sgMail.send(msg);

  return { success: true, link };
});

// Revoke Invite - 2nd Gen
export const revokeInviteV2 = onCall(async (request) => {
  const { email } = request.data;
  const start = Date.now();
  
  try {
    if (!email) {
      throw new Error('Email is required');
    }

    // Get user record by email
    const userRecord = await auth.getUserByEmail(email);
    
    // Update user document to mark invite as revoked
    const updateData = removeUndefined({
      inviteStatus: 'revoked',
      inviteRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    await db.collection('users').doc(userRecord.uid).update(updateData);

    // Log the AI action for successful revocation
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'invite_revoked',
      sourceModule: 'RevokeInviteV2',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Revoked invite for ${email}`,
      eventType: 'invite.revoked',
      targetType: 'user',
      targetId: userRecord.uid,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true };
  } catch (error: any) {
    // Log the AI action for failed revocation
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'invite_revoked',
      sourceModule: 'RevokeInviteV2',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to revoke invite for ${email}`,
      eventType: 'invite.revoked',
      targetType: 'user',
      targetId: email,
      aiRelevant: false,
      contextType: 'onboarding',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
    throw error;
  }
});

export const activateCampaignTemplate = onCall(async (request) => {
  const { templateCampaignId, tenantId, creatorUserId, createdBy } = request.data;
  if (!templateCampaignId || !tenantId || !creatorUserId || !createdBy) {
    throw new Error('Missing required fields');
  }
  // const db = admin.firestore(); // Remove this line if db is already defined at the top
  const templateRef = db.collection('campaigns').doc(templateCampaignId);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) throw new Error('Template campaign not found');
  const template = templateSnap.data();
  if (!template || !template.template || template.createdBy !== 'HRX') {
    throw new Error('Not a valid HRX template');
  }
  // Prepare new campaign data
  const newCampaign: any = {
    ...template,
    tenantId,
    creatorUserId,
    createdBy, // 'Agency' or 'Customer'
    template: false,
    sourceCampaignId: templateCampaignId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'draft',
  };
  // Remove fields that shouldn't be copied
  delete newCampaign.id;
  delete newCampaign.analytics;
  // Create new campaign
  const newRef = await db.collection('campaigns').add(newCampaign);
  return { campaignId: newRef.id };
});

// User Firestore triggers are imported from firestoreTriggers.ts
export { 
  firestoreLogUserCreated, 
  firestoreLogUserUpdated, 
  firestoreLogUserDeleted,
  testUserUpdate,
  firestoreLogTenantCreated,
  firestoreLogTenantUpdated,
  firestoreLogTenantDeleted,
  firestoreLogAssignmentCreated,
  firestoreLogAssignmentUpdated,
  firestoreLogAssignmentDeleted,
  firestoreLogConversationCreated,
  firestoreLogConversationUpdated,
  firestoreLogConversationDeleted,
  firestoreLogJobOrderCreated,
  firestoreLogJobOrderUpdated,
  firestoreLogJobOrderDeleted,
  firestoreLogCampaignCreated,
  firestoreLogCampaignUpdated,
  firestoreLogCampaignDeleted,
  firestoreLogMotivationCreated,
  firestoreLogMotivationUpdated,
  firestoreLogMotivationDeleted,
  firestoreLogMessageCreated,
  firestoreLogMessageUpdated,
  firestoreLogMessageDeleted,
  firestoreLogShiftCreated,
  firestoreLogShiftUpdated,
  firestoreLogShiftDeleted,
  firestoreLogUserGroupCreated,
  firestoreLogUserGroupUpdated,
  firestoreLogUserGroupDeleted,
  firestoreLogLocationCreated,
  firestoreLogLocationUpdated,
  firestoreLogLocationDeleted,
  firestoreLogNotificationCreated,
  firestoreLogNotificationUpdated,
  firestoreLogNotificationDeleted,
  firestoreLogSettingCreated,
  firestoreLogSettingUpdated,
  firestoreLogSettingDeleted,
  firestoreLogAILogCreated,
  firestoreLogAILogUpdated,
  firestoreLogAILogDeleted,
  firestoreLogTaskCreated,
  firestoreLogTaskUpdated,
  firestoreLogTenantContactCreated,
  firestoreLogTenantContactUpdated,
  firestoreLogTenantContactDeleted,
  firestoreLogGlobalAISettingsCreated,
  firestoreLogGlobalAISettingsUpdated,
  firestoreLogGlobalAISettingsDeleted,
  firestoreLogTenantAISettingsCreated,
  firestoreLogTenantAISettingsUpdated,
  firestoreLogTenantAISettingsDeleted,
  firestoreAutoAssignFlexWorker,
  firestoreHandleFlexWorkerUpdate,
  firestoreLogDepartmentCreated,
  firestoreLogDepartmentUpdated,
  firestoreLogDepartmentDeleted
} from './firestoreTriggers';

// --- Agency Firestore Triggers ---

// Firestore trigger: Log agency creation
export const logAgencyCreated = onDocumentCreated('agencies/{agencyId}', async (event) => {
  console.log('logAgencyCreated minimal trigger fired for agencyId:', event.params.agencyId);
  return { success: true };
});

// Firestore trigger: Log agency update
export const logAgencyUpdated = onDocumentUpdated('agencies/{agencyId}', async (event) => {
  console.log('logAgencyUpdated minimal trigger fired for agencyId:', event.params.agencyId);
  return { success: true };
});

// Firestore trigger: Log agency contact creation
export const logAgencyContactCreated = onDocumentCreated('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  console.log('logAgencyContactCreated minimal trigger fired for agencyId:', event.params.agencyId, 'contactId:', event.params.contactId);
  return { success: true };
});

// Firestore trigger: Log agency contact update
export const logAgencyContactUpdated = onDocumentUpdated('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  console.log('logAgencyContactUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'contactId:', event.params.contactId);
  return { success: true };
});

// Firestore trigger: Log agency contact deletion
export const logAgencyContactDeleted = onDocumentDeleted('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  console.log('logAgencyContactDeleted minimal trigger fired for agencyId:', event.params.agencyId, 'contactId:', event.params.contactId);
  return { success: true };
});

// Firestore trigger: Log agency location creation
export const logAgencyLocationCreated = onDocumentCreated('agencies/{agencyId}/locations/{locationId}', async (event) => {
  console.log('logAgencyLocationCreated minimal trigger fired for agencyId:', event.params.agencyId, 'locationId:', event.params.locationId);
  return { success: true };
});

// Firestore trigger: Log agency location update
export const logAgencyLocationUpdated = onDocumentUpdated('agencies/{agencyId}/locations/{locationId}', async (event) => {
  console.log('logAgencyLocationUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'locationId:', event.params.locationId);
  return { success: true };
});

// Firestore trigger: Log agency location deletion
export const logAgencyLocationDeleted = onDocumentDeleted('agencies/{agencyId}/locations/{locationId}', async (event) => {
  console.log('logAgencyLocationDeleted minimal trigger fired for agencyId:', event.params.agencyId, 'locationId:', event.params.locationId);
  return { success: true };
});

// Firestore trigger: Log agency AI settings update
export const logAgencyAISettingsUpdated = onDocumentUpdated('agencies/{agencyId}/aiSettings/{settingName}', async (event) => {
  console.log('logAgencyAISettingsUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'settingName:', event.params.settingName);
  return { success: true };
});

// Firestore trigger: Log agency user group creation
export const logAgencyUserGroupCreated = onDocumentCreated('agencies/{agencyId}/userGroups/{groupId}', async (event) => {
  console.log('logAgencyUserGroupCreated minimal trigger fired for agencyId:', event.params.agencyId, 'groupId:', event.params.groupId);
  return { success: true };
});

// Firestore trigger: Log agency user group update
export const logAgencyUserGroupUpdated = onDocumentUpdated('agencies/{agencyId}/userGroups/{groupId}', async (event) => {
  console.log('logAgencyUserGroupUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'groupId:', event.params.groupId);
  return { success: true };
});

// Firestore trigger: Log agency user group deletion
export const logAgencyUserGroupDeleted = onDocumentDeleted('agencies/{agencyId}/userGroups/{groupId}', async (event) => {
  console.log('logAgencyUserGroupDeleted minimal trigger fired for agencyId:', event.params.agencyId, 'groupId:', event.params.groupId);
  return { success: true };
});

// Firestore trigger: Log agency settings update
export const logAgencySettingsUpdated = onDocumentUpdated('agencies/{agencyId}/settings/{settingsId}', async (event) => {
  console.log('logAgencySettingsUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'settingsId:', event.params.settingsId);
  return { success: true };
});

// Firestore trigger: Log agency job order creation
export const logAgencyJobOrderCreated = onDocumentCreated('agencies/{agencyId}/jobOrders/{jobOrderId}', async (event) => {
  console.log('logAgencyJobOrderCreated minimal trigger fired for agencyId:', event.params.agencyId, 'jobOrderId:', event.params.jobOrderId);
  return { success: true };
});

// Firestore trigger: Log agency job order update
export const logAgencyJobOrderUpdated = onDocumentUpdated('agencies/{agencyId}/jobOrders/{jobOrderId}', async (event) => {
  console.log('logAgencyJobOrderUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'jobOrderId:', event.params.jobOrderId);
  return { success: true };
});

// Firestore trigger: Log agency job order deletion
export const logAgencyJobOrderDeleted = onDocumentDeleted('agencies/{agencyId}/jobOrders/{jobOrderId}', async (event) => {
  console.log('logAgencyJobOrderDeleted minimal trigger fired for agencyId:', event.params.agencyId, 'jobOrderId:', event.params.jobOrderId);
  return { success: true };
});

// Firestore trigger: Log agency job order shift creation
export const logAgencyJobOrderShiftCreated = onDocumentCreated('agencies/{agencyId}/jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  console.log('logAgencyJobOrderShiftCreated minimal trigger fired for agencyId:', event.params.agencyId, 'jobOrderId:', event.params.jobOrderId, 'shiftId:', event.params.shiftId);
  return { success: true };
});

// Firestore trigger: Log agency job order shift update
export const logAgencyJobOrderShiftUpdated = onDocumentUpdated('agencies/{agencyId}/jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  console.log('logAgencyJobOrderShiftUpdated minimal trigger fired for agencyId:', event.params.agencyId, 'jobOrderId:', event.params.jobOrderId, 'shiftId:', event.params.shiftId);
  return { success: true };
});

// Firestore trigger: Log agency job order shift deletion
export const logAgencyJobOrderShiftDeleted = onDocumentDeleted('agencies/{agencyId}/jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  console.log('logAgencyJobOrderShiftDeleted minimal trigger fired for agencyId:', event.params.agencyId, 'jobOrderId:', event.params.jobOrderId, 'shiftId:', event.params.shiftId);
  return { success: true };
});

// --- Customer Firestore Triggers ---

// Firestore trigger: Log customer creation
export const logCustomerCreated = onDocumentCreated('customers/{customerId}', async (event) => {
  console.log('logCustomerCreated minimal trigger fired for customerId:', event.params.customerId);
  return { success: true };
});

// Firestore trigger: Log customer update
export const logCustomerUpdated = onDocumentUpdated('customers/{customerId}', async (event) => {
  console.log('logCustomerUpdated minimal trigger fired for customerId:', event.params.customerId);
  return { success: true };
});

// Firestore trigger: Log customer deletion
export const logCustomerDeleted = onDocumentDeleted('customers/{customerId}', async (event) => {
  console.log('logCustomerDeleted minimal trigger fired for customerId:', event.params.customerId);
  return { success: true };
});

// Firestore trigger: Log customer location creation
export const logCustomerLocationCreated = onDocumentCreated('customers/{customerId}/locations/{locationId}', async (event) => {
  console.log('logCustomerLocationCreated minimal trigger fired for customerId:', event.params.customerId, 'locationId:', event.params.locationId);
  return { success: true };
});

// Firestore trigger: Log customer location update
export const logCustomerLocationUpdated = onDocumentUpdated('customers/{customerId}/locations/{locationId}', async (event) => {
  console.log('logCustomerLocationUpdated minimal trigger fired for customerId:', event.params.customerId, 'locationId:', event.params.locationId);
  return { success: true };
});

// Firestore trigger: Log customer location deletion
export const logCustomerLocationDeleted = onDocumentDeleted('customers/{customerId}/locations/{locationId}', async (event) => {
  console.log('logCustomerLocationDeleted minimal trigger fired for customerId:', event.params.customerId, 'locationId:', event.params.locationId);
  return { success: true };
});

// Firestore trigger: Log customer department creation
export const logCustomerDepartmentCreated = onDocumentCreated('customers/{customerId}/departments/{departmentId}', async (event) => {
  console.log('logCustomerDepartmentCreated minimal trigger fired for customerId:', event.params.customerId, 'departmentId:', event.params.departmentId);
  return { success: true };
});

// Firestore trigger: Log customer department update
export const logCustomerDepartmentUpdated = onDocumentUpdated('customers/{customerId}/departments/{departmentId}', async (event) => {
  console.log('logCustomerDepartmentUpdated minimal trigger fired for customerId:', event.params.customerId, 'departmentId:', event.params.departmentId);
  return { success: true };
});

// Firestore trigger: Log customer department deletion
export const logCustomerDepartmentDeleted = onDocumentDeleted('customers/{customerId}/departments/{departmentId}', async (event) => {
  console.log('logCustomerDepartmentDeleted minimal trigger fired for customerId:', event.params.customerId, 'departmentId:', event.params.departmentId);
  return { success: true };
});

// Firestore trigger: Log customer AI settings update
export const logCustomerAISettingsUpdated = onDocumentUpdated('customers/{customerId}/aiSettings/{settingName}', async (event) => {
  console.log('logCustomerAISettingsUpdated minimal trigger fired for customerId:', event.params.customerId, 'settingName:', event.params.settingName);
  return { success: true };
});

// Firestore trigger: Log customer AI training creation
export const logCustomerAITrainingCreated = onDocumentCreated('customers/{customerId}/aiTraining/{trainingId}', async (event) => {
  console.log('logCustomerAITrainingCreated minimal trigger fired for customerId:', event.params.customerId, 'trainingId:', event.params.trainingId);
  return { success: true };
});

// Firestore trigger: Log customer AI training update
export const logCustomerAITrainingUpdated = onDocumentUpdated('customers/{customerId}/aiTraining/{trainingId}', async (event) => {
  console.log('logCustomerAITrainingUpdated minimal trigger fired for customerId:', event.params.customerId, 'trainingId:', event.params.trainingId);
  return { success: true };
});

// Firestore trigger: Log customer AI training deletion
export const logCustomerAITrainingDeleted = onDocumentDeleted('customers/{customerId}/aiTraining/{trainingId}', async (event) => {
  console.log('logCustomerAITrainingDeleted minimal trigger fired for customerId:', event.params.customerId, 'trainingId:', event.params.trainingId);
  return { success: true };
});

// --- Assignment Firestore Triggers ---

// Firestore trigger: Log assignment creation
export const logAssignmentCreated = onDocumentCreated('assignments/{assignmentId}', async (event) => {
  console.log('logAssignmentCreated minimal trigger fired for assignmentId:', event.params.assignmentId);
  return { success: true };
});

// Firestore trigger: Log assignment update
export const logAssignmentUpdated = onDocumentUpdated('assignments/{assignmentId}', async (event) => {
  console.log('logAssignmentUpdated minimal trigger fired for assignmentId:', event.params.assignmentId);
  return { success: true };
});

// Firestore trigger: Log assignment deletion
export const logAssignmentDeleted = onDocumentDeleted('assignments/{assignmentId}', async (event) => {
  console.log('logAssignmentDeleted minimal trigger fired for assignmentId:', event.params.assignmentId);
  return { success: true };
});

// ... existing code ...

// Scheduled function to run tests daily at 2 AM
export const scheduledTriggerTests = onSchedule('0 2 * * *', async (event) => {
  try {
    console.log('Running scheduled Firestore trigger tests...');
    const summary = await runFirestoreTriggerTests();
    
    // Log the results
    await logAIAction({
      userId: 'system',
      actionType: 'scheduled_trigger_tests_completed',
      sourceModule: 'ScheduledTests',
      success: summary.failedTests === 0,
      eventType: 'tests.scheduled.completed',
      targetType: 'test_suite',
      targetId: 'firestore_triggers',
      aiRelevant: false,
      contextType: 'testing',
      traitsAffected: null,
      aiTags: ['testing', 'scheduled', 'firestore_triggers'],
      urgencyScore: summary.failedTests > 0 ? 7 : 2,
      reason: `Scheduled trigger tests completed: ${summary.passedTests}/${summary.totalTests} passed`,
      versionTag: 'v1',
      latencyMs: summary.duration
    });
    
    console.log(`Scheduled tests completed: ${summary.passedTests}/${summary.totalTests} passed`);
    
    // If there are failures, send email notification
    if (summary.failedTests > 0) {
      console.warn(`⚠️ ${summary.failedTests} tests failed in scheduled run`);
      
      // Send email notification about failures
      try {
        const failedTests = summary.results.filter((r: TestResult) => !r.success);
        const emailContent = `
          <h2>🚨 Firestore Trigger Test Failures Detected</h2>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p><strong>Failed Tests:</strong> ${summary.failedTests}/${summary.totalTests}</p>
          
          <h3>Failed Test Details:</h3>
          <ul>
            ${failedTests.map((test: TestResult) => `
              <li><strong>${test.triggerName}</strong>: ${test.error || ''}</li>
            `).join('')}
          </ul>
          
          <p><strong>Action Required:</strong> Please check the Firebase Function logs and fix the failing triggers.</p>
          <p><strong>View Logs:</strong> <code>firebase functions:log --only scheduledTriggerTests</code></p>
        `;

        const msg = {
          to: process.env.ADMIN_EMAIL || 'admin@hrxone.com', // Set this in Firebase environment
          from: 'noreply@hrxone.com',
          subject: `🚨 Firestore Trigger Tests Failed: ${summary.failedTests}/${summary.totalTests}`,
          html: emailContent
        };

        await sgMail.send(msg);
        console.log('📧 Email notification sent for test failures');
      } catch (emailError: any) {
        console.error('Failed to send email notification:', emailError.message);
      }
    }
    
  } catch (error: any) {
    console.error('Error in scheduled trigger tests:', error);
    
    // Log the error
    await logAIAction({
      userId: 'system',
      actionType: 'scheduled_trigger_tests_failed',
      sourceModule: 'ScheduledTests',
      success: false,
      errorMessage: error.message,
      latencyMs: 0,
      versionTag: 'v1',
      reason: `Scheduled trigger tests failed: ${error.message}`,
      eventType: 'tests.scheduled.failed',
      targetType: 'test_suite',
      targetId: 'firestore_triggers',
      aiRelevant: false,
      contextType: 'testing',
      traitsAffected: null,
      aiTags: ['testing', 'scheduled', 'firestore_triggers', 'error'],
      urgencyScore: 8
    });

    // Send email notification for complete failure
    try {
      const emailContent = `
        <h2>💥 Firestore Trigger Tests Completely Failed</h2>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><strong>Error:</strong> ${error.message}</p>
        
        <p><strong>Action Required:</strong> The test suite itself failed to run. Please check the Firebase Function logs immediately.</p>
        <p><strong>View Logs:</strong> <code>firebase functions:log --only scheduledTriggerTests</code></p>
      `;

      const msg = {
        to: process.env.ADMIN_EMAIL || 'admin@hrxone.com',
        from: 'noreply@hrxone.com',
        subject: '💥 Firestore Trigger Tests Completely Failed',
        html: emailContent
      };

      await sgMail.send(msg);
      console.log('📧 Email notification sent for complete test failure');
    } catch (emailError: any) {
      console.error('Failed to send email notification:', emailError.message);
    }
  }
});

// ===== MOBILE APP CHAT SYSTEM - PHASE 1 =====

// Translation Service with OpenAI Integration
export const translateContent = onCall(async (request) => {
  const { content, targetLanguage, sourceLanguage = 'en' } = request.data;
  const start = Date.now();
  
  try {
    if (!content || !targetLanguage) {
      throw new Error('Content and targetLanguage are required');
    }
    
    // Validate language codes
    const supportedLanguages = ['en', 'es'];
    if (!supportedLanguages.includes(targetLanguage)) {
      throw new Error(`Unsupported target language: ${targetLanguage}`);
    }
    
    // Don't translate if source and target are the same
    if (sourceLanguage === targetLanguage) {
      return { 
        translatedContent: content,
        confidence: 1.0,
        cached: true
      };
    }
    
    // Use OpenAI for translation
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are a professional translator specializing in HR and workplace communication. Translate the following text to ${targetLanguage === 'es' ? 'Spanish' : 'English'}. Maintain the original tone, context, and professional style. Return only the translated text without any explanations or additional formatting.`
        },
        {
          role: "user",
          content: content
        }
      ],
      temperature: 0.3,
      max_completion_tokens: 1000
    });
    
    const translatedContent = completion.choices[0].message.content?.trim() || content;
    
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'content_translation',
      sourceModule: 'TranslationService',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Translated content from ${sourceLanguage} to ${targetLanguage}`,
      eventType: 'translation.completed',
      targetType: 'content',
      targetId: 'translation',
      aiRelevant: true,
      contextType: 'translation',
      traitsAffected: null,
      aiTags: ['translation', sourceLanguage, targetLanguage],
      urgencyScore: 3
    });
    
    return { 
      translatedContent,
      confidence: 0.95,
      cached: false,
      sourceLanguage,
      targetLanguage
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'content_translation',
      sourceModule: 'TranslationService',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to translate content: ${error.message}`,
      eventType: 'translation.failed',
      targetType: 'content',
      targetId: 'translation',
      aiRelevant: true,
      contextType: 'translation',
      traitsAffected: null,
      aiTags: ['translation', 'error'],
      urgencyScore: 5
    });
    
    throw new Error(`Translation failed: ${error.message}`);
  }
});

// Enhanced User Login Tracking with Hello Message Settings
export const updateUserLoginInfo = onCall(async (request) => {
  const { userId, loginData } = request.data;
  const start = Date.now();
  
  try {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    const currentTime = admin.firestore.FieldValue.serverTimestamp();
    
    // Update login information
    const updateData: any = {
      lastLoginAt: currentTime,
      loginCount: (userData?.loginCount || 0) + 1,
      updatedAt: currentTime
    };
    
    // Initialize hello message settings if not exists
    if (!userData?.helloMessageSettings) {
      updateData.helloMessageSettings = {
        enabled: true,
        frequency: 'always',
        lastHelloSent: null
      };
    }
    
    // Initialize preferred language if not exists
    if (!userData?.preferredLanguage) {
      updateData.preferredLanguage = 'en';
    }
    
    // Add device info if provided
    if (loginData?.deviceInfo) {
      updateData.lastDeviceInfo = loginData.deviceInfo;
    }
    
    await userRef.update(updateData);
    
    await logAIAction({
      userId,
      actionType: 'user_login_updated',
      sourceModule: 'LoginTracking',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated login info for user ${userId}`,
      eventType: 'user.login-updated',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'user',
      traitsAffected: null,
      aiTags: ['login', 'tracking'],
      urgencyScore: 4
    });
    
    return { 
      success: true, 
      loginCount: updateData.loginCount,
      helloMessageSettings: updateData.helloMessageSettings
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'user_login_updated',
      sourceModule: 'LoginTracking',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update login info: ${error.message}`,
      eventType: 'user.login-update-failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'user',
      traitsAffected: null,
      aiTags: ['login', 'error'],
      urgencyScore: 5
    });
    
    throw error;
  }
});

// Hello Message Configuration Management
export const getHelloMessageSettings = onCall(async (request) => {
  const start = Date.now();
  
  try {
    const settingsDoc = await db.collection('appAiSettings').doc('helloMessages').get();
    
    if (!settingsDoc.exists) {
      // Create default settings
      const defaultSettings = {
        templates: {
          en: [
            "Hi {firstName}. How's work going so far today?",
            "Good morning {firstName}! Ready for another great day?",
            "Hey {firstName}, how are you feeling about your shift today?",
            "Welcome back {firstName}! How's everything going?",
            "Hi {firstName}! Any questions or concerns I can help with today?"
          ],
          es: [
            "¡Hola {firstName}! ¿Cómo va el trabajo hoy?",
            "¡Buenos días {firstName}! ¿Listo para otro gran día?",
            "Hola {firstName}, ¿cómo te sientes con tu turno hoy?",
            "¡Bienvenido de vuelta {firstName}! ¿Cómo va todo?",
            "¡Hola {firstName}! ¿Alguna pregunta o inquietud en la que pueda ayudarte hoy?"
          ]
        },
        triggers: {
          onLogin: true,
          dailyCheckin: true,
          weeklyCheckin: false
        },
        timing: {
          loginDelayMinutes: 1,
          dailyCheckinHour: 9,
          weeklyCheckinDay: 1 // Monday
        },
        enabled: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('appAiSettings').doc('helloMessages').set(defaultSettings);
      
      await logAIAction({
        userId: request.auth?.uid || 'system',
        actionType: 'hello_settings_created',
        sourceModule: 'HelloMessageConfig',
        success: true,
        latencyMs: Date.now() - start,
        versionTag: 'v1',
        reason: 'Created default hello message settings'
      });
      
      return defaultSettings;
    }
    
    const settings = settingsDoc.data();
    
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'hello_settings_retrieved',
      sourceModule: 'HelloMessageConfig',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Retrieved hello message settings'
    });
    
    return settings;
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'hello_settings_retrieved',
      sourceModule: 'HelloMessageConfig',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to retrieve hello settings: ${error.message}`
    });
    
    throw error;
  }
});

export const updateHelloMessageSettings = onCall(async (request) => {
  const { settings } = request.data;
  const start = Date.now();
  
  try {
    if (!settings) {
      throw new Error('Settings object is required');
    }
    
    const updateData = {
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth?.uid || 'system'
    };
    
    await db.collection('appAiSettings').doc('helloMessages').update(updateData);
    
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'hello_settings_updated',
      sourceModule: 'HelloMessageConfig',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Updated hello message settings',
      eventType: 'settings.hello-updated',
      targetType: 'settings',
      targetId: 'helloMessages',
      aiRelevant: true,
      contextType: 'settings',
      traitsAffected: null,
      aiTags: ['settings', 'hello-messages'],
      urgencyScore: 4
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'hello_settings_updated',
      sourceModule: 'HelloMessageConfig',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update hello settings: ${error.message}`
    });
    
    throw error;
  }
});

// Mobile API Endpoints for Chat Data Retrieval
export const getMobileChatData = onCall(async (request) => {
  const { userId, language = 'en' } = request.data;
  const start = Date.now();
  
  try {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get user data
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    const userLanguage = userData?.preferredLanguage || language;
    
    // Get primary conversation
    const primaryConversationQuery = db.collection('conversations')
      .where('workerId', '==', userId)
      .where('type', '==', 'primary')
      .orderBy('updatedAt', 'desc')
      .limit(1);
    
    const primaryConversationSnapshot = await primaryConversationQuery.get();
    const primaryChat = primaryConversationSnapshot.docs[0]?.data() || null;
    
    // Get unread broadcast conversations
    const broadcastConversationsQuery = db.collection('broadcast_conversations')
      .where('workerId', '==', userId)
      .where('status', '==', 'unread')
      .orderBy('createdAt', 'desc')
      .limit(10);
    
    const broadcastConversationsSnapshot = await broadcastConversationsQuery.get();
    const broadcasts = broadcastConversationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));
    
    // Get user's hello message settings
    const helloSettings = userData?.helloMessageSettings || {
      enabled: true,
      frequency: 'always',
      lastHelloSent: null
    };
    
    await logAIAction({
      userId,
      actionType: 'mobile_chat_data_retrieved',
      sourceModule: 'MobileAPI',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Retrieved mobile chat data for user ${userId}`,
      eventType: 'mobile.chat-data-retrieved',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'chat', 'data-retrieval'],
      urgencyScore: 3
    });
    
    return {
      success: true,
      primaryChat,
      broadcastCount: broadcasts.length,
      broadcasts,
      userLanguage,
      helloSettings,
      lastLoginAt: userData?.lastLoginAt?.toDate(),
      loginCount: userData?.loginCount || 0
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'mobile_chat_data_retrieved',
      sourceModule: 'MobileAPI',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to retrieve mobile chat data: ${error.message}`
    });
    
    throw error;
  }
});

// Helper function to get or create primary conversation
async function getOrCreatePrimaryConversation(userId: string) {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  
  // Try to find existing primary conversation
  const existingConversationQuery = db.collection('conversations')
    .where('workerId', '==', userId)
    .where('type', '==', 'primary')
    .limit(1);
  
  const existingConversationSnapshot = await existingConversationQuery.get();
  
  if (!existingConversationSnapshot.empty) {
    return existingConversationSnapshot.docs[0].ref;
  }
  
  // Create new primary conversation
  const newConversation = {
    workerId: userId,
    customerId: userData?.customerId || null,
    agencyId: userData?.agencyId || null,
    type: 'primary',
    status: 'active',
    messages: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
  };
  
  const conversationRef = await db.collection('conversations').add(newConversation);
  return conversationRef;
}

// Send Hello Message Function
export const sendHelloMessage = onCall(async (request) => {
  const { userId, language = 'en' } = request.data;
  const start = Date.now();
  
  try {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get user data
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    const userLanguage = userData?.preferredLanguage || language;
    
    // Get hello message settings
    const helloSettingsDoc = await db.collection('appAiSettings').doc('helloMessages').get();
    const helloSettings = helloSettingsDoc.exists ? helloSettingsDoc.data() : null;
    
    if (!helloSettings?.enabled) {
      return { success: true, message: 'Hello messages are disabled' };
    }
    
    // Select random template
    const templates = helloSettings?.templates?.[userLanguage] || helloSettings?.templates?.en;
    if (!templates || templates.length === 0) {
      throw new Error('No hello message templates found');
    }
    
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    // Replace placeholders
    const message = template.replace('{firstName}', userData?.firstName || 'there');
    
    // Create hello message
    const helloMessage = {
      id: Date.now().toString(),
      sender: 'ai',
      content: {
        [userLanguage]: message
      },
      originalLanguage: userLanguage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'hello',
      metadata: {
        confidence: 1.0,
        sentiment: 0.8,
        escalated: false
      }
    };
    
    // Add to primary conversation
    const conversationRef = await getOrCreatePrimaryConversation(userId);
    await conversationRef.update({
      messages: admin.firestore.FieldValue.arrayUnion(helloMessage),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update user's hello message tracking
    await db.collection('users').doc(userId).update({
      'helloMessageSettings.lastHelloSent': admin.firestore.FieldValue.serverTimestamp()
    });
    
    await logAIAction({
      userId,
      actionType: 'hello_message_sent',
      sourceModule: 'HelloMessageService',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Sent hello message to user ${userId}`,
      eventType: 'hello.message-sent',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'hello',
      traitsAffected: null,
      aiTags: ['hello', 'message', 'ai'],
      urgencyScore: 4
    });
    
    return { 
      success: true, 
      messageId: helloMessage.id,
      message: helloMessage.content[userLanguage]
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'hello_message_sent',
      sourceModule: 'HelloMessageService',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to send hello message: ${error.message}`
    });
    
    throw error;
  }
});

// Mobile App Error Monitoring Functions
export { logMobileAppError, monitorMobileAppErrors, getMobileErrorStats };

// Manage customer associations with tenants
export const manageTenantCustomers = onCall(async (request) => {
  const { action, tenantId, customerId, customerData } = request.data;
  const userId = request.auth?.uid || 'system';
  const start = Date.now();
  
  try {
    switch (action) {
      case 'add':
        // Add customer to tenant's customers array
        await db.collection('tenants').doc(tenantId).update({
          customers: admin.firestore.FieldValue.arrayUnion(customerId)
        });
        
        // Create customer document in tenant's customers subcollection
        await db.collection('tenants').doc(tenantId).collection('customers').doc(customerId).set({
          ...customerData,
          tenantId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: userId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        break;
        
      case 'remove':
        // Remove customer from tenant's customers array
        await db.collection('tenants').doc(tenantId).update({
          customers: admin.firestore.FieldValue.arrayRemove(customerId)
        });
        
        // Delete customer document from tenant's customers subcollection
        await db.collection('tenants').doc(tenantId).collection('customers').doc(customerId).delete();
        break;
        
      case 'update':
        // Update customer document in tenant's customers subcollection
        await db.collection('tenants').doc(tenantId).collection('customers').doc(customerId).update({
          ...customerData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: userId
        });
        break;
        
      case 'list':
        // Get all customers for a tenant
        const tenantDoc = await db.collection('tenants').doc(tenantId).get();
        const tenantData = tenantDoc.data();
        const customerIds = tenantData?.customers || [];
        
        const customers = [];
        for (const cid of customerIds) {
          const customerDoc = await db.collection('tenants').doc(tenantId).collection('customers').doc(cid).get();
          if (customerDoc.exists) {
            customers.push({ id: cid, ...customerDoc.data() });
          }
        }
        return { customers };
        
      default:
        throw new Error('Invalid action');
    }
    
    await logAIAction({
      userId,
      actionType: 'tenant_customers_managed',
      sourceModule: 'TenantManagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `${action} customer ${customerId} for tenant ${tenantId}`,
      eventType: 'tenant.customers.managed',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: false,
      contextType: 'tenant',
      traitsAffected: null,
      aiTags: ['tenant', 'customers', action],
      urgencyScore: 3
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'tenant_customers_managed',
      sourceModule: 'TenantManagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to ${action} customer ${customerId} for tenant ${tenantId}: ${error.message}`
    });
    throw error;
  }
});

// Tenant slug validation function
export const validateTenantSlug = onCall(async (request) => {
  const { slug, excludeTenantId } = request.data;
  
  try {
    if (!slug) {
      throw new Error('Slug is required');
    }
    
    // Validate slug format
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slug)) {
      throw new Error('Slug can only contain lowercase letters, numbers, and hyphens');
    }
    
    if (slug.length < 3 || slug.length > 50) {
      throw new Error('Slug must be between 3 and 50 characters');
    }
    
    if (slug.startsWith('-') || slug.endsWith('-')) {
      throw new Error('Slug cannot start or end with a hyphen');
    }
    
    // Check uniqueness
    const query = db.collection('tenants').where('slug', '==', slug);
    const snapshot = await query.get();
    
    if (!snapshot.empty) {
      const existingTenant = snapshot.docs[0];
      if (excludeTenantId && existingTenant.id === excludeTenantId) {
        // This is the same tenant, so the slug is valid
        return { isValid: true, available: true };
      } else {
        return { isValid: true, available: false, message: 'This slug is already taken' };
      }
    }
    
    return { isValid: true, available: true };
  } catch (error: any) {
    throw new HttpsError('invalid-argument', error.message || 'Failed to validate slug');
  }
});

// Generate slug from tenant name
export const generateTenantSlug = onCall(async (request) => {
  const { name } = request.data;
  
  try {
    if (!name) {
      throw new Error('Name is required');
    }
    
    // Generate base slug
    let slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim()
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    
    // If slug is empty after processing, use a fallback
    if (!slug) {
      slug = 'tenant-' + Date.now();
    }
    
    // Check if slug is available, if not, append a number
    let finalSlug = slug;
    let counter = 1;
    
    while (true) {
      const query = db.collection('tenants').where('slug', '==', finalSlug);
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        break; // Slug is available
      }
      
      finalSlug = `${slug}-${counter}`;
      counter++;
      
      // Prevent infinite loop
      if (counter > 100) {
        finalSlug = `${slug}-${Date.now()}`;
        break;
      }
    }
    
    return { slug: finalSlug };
  } catch (error: any) {
    throw new HttpsError('invalid-argument', error.message || 'Failed to generate slug');
  }
});

// Update user's primary tenant preference
export const updateUserPrimaryTenant = onCall(async (request) => {
  const { userId, primaryTenantId } = request.data;
  
  try {
    if (!userId || !primaryTenantId) {
      throw new Error('userId and primaryTenantId are required');
    }
    
    // Verify the user exists and has access to the specified tenant
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      throw new Error('User not found');
    }
    
    const userData = userSnap.data();
    const userTenantIds = userData?.tenantIds || [];
    
    if (!userTenantIds.includes(primaryTenantId)) {
      throw new Error('User does not have access to the specified tenant');
    }
    
    // Update the user's primary tenant
    await userRef.update({
      tenantId: primaryTenantId,
      primaryTenantUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true, message: 'Primary tenant updated successfully' };
  } catch (error: any) {
    console.error('Error updating primary tenant:', error);
    throw new Error(error.message || 'Failed to update primary tenant');
  }
});

// ===== AI CAMPAIGNS AUTOMATION =====

// Execute scheduled campaigns
export const executeScheduledCampaigns = onCall(async (request) => {
  const { campaignId, workerIds } = request.data;
  const start = Date.now();
  
  try {
    if (!campaignId) {
      throw new Error('Campaign ID is required');
    }

    // Get campaign data
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists) {
      throw new Error('Campaign not found');
    }
    
    const campaign = campaignDoc.data()!;
    
    // Get workers to target
    let targetWorkers: any[] = [];
    if (workerIds && workerIds.length > 0) {
      // Specific workers provided
      const workerDocs = await Promise.all(
        workerIds.map((id: string) => db.collection('users').doc(id).get())
      );
      targetWorkers = workerDocs
        .filter(doc => doc.exists)
        .map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      // Get all eligible workers based on campaign targeting
      const workersSnapshot = await db.collection('users')
        .where('isActive', '==', true)
        .get();
      
      targetWorkers = workersSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((worker: any) => {
          // Apply security level filtering first
          const securityLevel = worker.securityLevel || '5';
          
          // Skip suspended and dismissed workers
          if (securityLevel === '2' || securityLevel === '1') {
            return false;
          }
          
          // Skip applicants for campaigns (unless specifically targeted)
          if (securityLevel === '3' && !campaign.targetAudience.userIds.includes(worker.id)) {
            return false;
          }
          
          // Apply organizational targeting filters
          if (campaign.targetAudience.regionIds.length > 0 && 
              !campaign.targetAudience.regionIds.includes(worker.regionId || '')) {
            return false;
          }
          if (campaign.targetAudience.divisionIds.length > 0 && 
              !campaign.targetAudience.divisionIds.includes(worker.divisionId || '')) {
            return false;
          }
          if (campaign.targetAudience.departmentIds.length > 0 && 
              !campaign.targetAudience.departmentIds.includes(worker.departmentId || '')) {
            return false;
          }
          if (campaign.targetAudience.locationIds.length > 0 && 
              !campaign.targetAudience.locationIds.includes(worker.locationId || '')) {
            return false;
          }
          return true;
        });
    }

    let successCount = 0;
    let errorCount = 0;
    const results = [];

    // Execute campaign for each worker
    for (const worker of targetWorkers) {
      try {
        const result = await executeCampaignForWorker(campaign, worker);
        results.push({ workerId: worker.id, success: true, result });
        successCount++;
      } catch (error: any) {
        console.error(`Failed to execute campaign for worker ${worker.id}:`, error);
        results.push({ workerId: worker.id, success: false, error: error.message });
        errorCount++;
      }
    }

    // Update campaign analytics
    await updateCampaignAnalytics(campaignId, {
      totalRecipients: targetWorkers.length,
      responsesReceived: 0, // Will be updated when responses come in
      avgEngagementScore: 0,
      traitChanges: {}
    });

    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'campaign_executed',
      sourceModule: 'CampaignsEngine',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Campaign "${campaign.title}" executed for ${successCount} workers`,
      eventType: 'campaign.executed',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'execution'],
      urgencyScore: 7
    });

    return {
      success: true,
      totalWorkers: targetWorkers.length,
      successCount,
      errorCount,
      results
    };

  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'campaign_executed',
      sourceModule: 'CampaignsEngine',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Campaign execution failed: ${error.message}`,
      eventType: 'campaign.executed',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'execution', 'error'],
      urgencyScore: 8
    });
    throw error;
  }
});

async function executeCampaignForWorker(campaign: any, worker: any): Promise<any> {
  // Create campaign message based on campaign type and tone
  const message = generateCampaignMessage(campaign, worker);
  
  // Create notification for the worker
  const notificationData = {
    userId: worker.id,
    type: 'campaign_message',
    title: campaign.title,
    message: message,
    data: {
      campaignId: campaign.id,
      category: campaign.category,
      tone: campaign.tone,
      followUpStrategy: campaign.followUpStrategy,
      aiBehavior: campaign.aiBehavior
    },
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const notificationRef = await db.collection('notifications').add(notificationData);

  // Create campaign interaction record
  const interactionData = {
    campaignId: campaign.id,
    workerId: worker.id,
    notificationId: notificationRef.id,
    status: 'sent',
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    message: message,
    campaignData: {
      title: campaign.title,
      category: campaign.category,
      tone: campaign.tone,
      objective: campaign.objective
    },
    workerData: {
      name: worker.name,
      email: worker.email,
      regionId: worker.regionId,
      divisionId: worker.divisionId,
      departmentId: worker.departmentId,
      locationId: worker.locationId
    }
  };

  await db.collection('campaignInteractions').add(interactionData);

  return {
    notificationId: notificationRef.id,
    message: message
  };
}

function generateCampaignMessage(campaign: any, worker: any): string {
  const { category, tone, objective } = campaign;
  
  // Base messages by category and tone
  const messageTemplates: Record<string, Record<string, string>> = {
    morale: {
      motivational: `Hi ${worker.name}! We wanted to check in and let you know how much we value your contributions to our team. ${objective}`,
      empathetic: `Hello ${worker.name}, we hope you're doing well. We'd love to hear how things are going and how we can better support you.`,
      coaching: `Hi ${worker.name}! We see great potential in your work and wanted to share some thoughts on ${objective}`
    },
    feedback: {
      survey: `Hi ${worker.name}! We'd love to get your feedback on ${objective}. Your input helps us improve.`,
      'feedback-seeking': `Hello ${worker.name}, we're looking for your thoughts on ${objective}. Your perspective is valuable to us.`,
      neutral: `Hi ${worker.name}, we're conducting a quick survey about ${objective}. Would you mind sharing your thoughts?`
    },
    sales: {
      motivational: `Hi ${worker.name}! Let's crush our sales goals together! ${objective}`,
      directive: `Hello ${worker.name}, we need to focus on ${objective} to meet our targets.`,
      coaching: `Hi ${worker.name}! Let's work on improving our sales performance. ${objective}`
    },
    policy: {
      survey: `Hi ${worker.name}! We're reviewing our policies and would love your feedback on ${objective}.`,
      'feedback-seeking': `Hello ${worker.name}, we're considering changes to ${objective} and want your input.`,
      neutral: `Hi ${worker.name}, we're updating our policies and would appreciate your thoughts on ${objective}.`
    },
    support: {
      empathetic: `Hi ${worker.name}, we want to make sure you have all the support you need. ${objective}`,
      coaching: `Hello ${worker.name}, let's work together to address ${objective} and find solutions.`,
      'feedback-seeking': `Hi ${worker.name}, we're looking to improve our support systems. ${objective}`
    },
    wellness: {
      empathetic: `Hi ${worker.name}, your well-being is important to us. ${objective}`,
      motivational: `Hello ${worker.name}! Let's focus on maintaining a healthy work-life balance. ${objective}`,
      coaching: `Hi ${worker.name}, we want to support your wellness journey. ${objective}`
    }
  };

  const template = messageTemplates[category]?.[tone] || 
    `Hi ${worker.name}! ${objective}`;

  return template;
}

async function updateCampaignAnalytics(campaignId: string, analytics: any): Promise<void> {
  await db.collection('campaigns').doc(campaignId).update({
    analytics: analytics,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Scheduled function to execute pending campaigns
export const executePendingCampaigns = onSchedule({
  schedule: '0 */2 * * *', // Every 2 hours
  timeZone: 'America/New_York'
}, async (event) => {
  const start = Date.now();
  
  try {
    const now = new Date();
    
    // Find pending scheduled campaigns
    const pendingCampaignsSnapshot = await db.collection('scheduledCampaigns')
      .where('status', '==', 'pending')
      .where('scheduledFor', '<=', admin.firestore.Timestamp.fromDate(now))
      .get();

    let executedCount = 0;
    let errorCount = 0;

    for (const doc of pendingCampaignsSnapshot.docs) {
      try {
        const scheduledCampaign = doc.data();
        
        // Execute the campaign directly
        const campaignDoc = await db.collection('campaigns').doc(scheduledCampaign.campaignId).get();
        if (campaignDoc.exists) {
          const campaign = campaignDoc.data()!;
          const workerDoc = await db.collection('users').doc(scheduledCampaign.workerId).get();
          if (workerDoc.exists) {
            const worker = workerDoc.data()!;
            await executeCampaignForWorker(campaign, worker);
          }
        }

        // Update scheduled campaign status
        await doc.ref.update({
          status: 'sent',
          executedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        executedCount++;
      } catch (error) {
        console.error(`Failed to execute scheduled campaign ${doc.id}:`, error);
        
        // Mark as retry if appropriate
        await doc.ref.update({
          status: 'retry',
          retryCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        errorCount++;
      }
    }

    console.log(`Campaign execution completed: ${executedCount} executed, ${errorCount} errors`);

    await logAIAction({
      userId: 'system',
      actionType: 'scheduled_campaigns_executed',
      sourceModule: 'CampaignsEngine',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Scheduled campaigns executed: ${executedCount} successful, ${errorCount} failed`,
      eventType: 'campaign.scheduled_execution',
      targetType: 'system',
      targetId: 'scheduled_execution',
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'automation', 'scheduled'],
      urgencyScore: 5
    });

  } catch (error: any) {
    console.error('Scheduled campaign execution failed:', error);
    
    await logAIAction({
      userId: 'system',
      actionType: 'scheduled_campaigns_executed',
      sourceModule: 'CampaignsEngine',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Scheduled campaign execution failed: ${error.message}`,
      eventType: 'campaign.scheduled_execution',
      targetType: 'system',
      targetId: 'scheduled_execution',
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'automation', 'scheduled', 'error'],
      urgencyScore: 8
    });
    
    throw error;
  }
});

// Get campaign analytics and insights
export const getCampaignAnalytics = onCall(async (request) => {
  const { campaignId, timeRange = '30d' } = request.data;
  const start = Date.now();
  
  try {
    if (!campaignId) {
      throw new Error('Campaign ID is required');
    }

    // Get campaign data
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists) {
      throw new Error('Campaign not found');
    }
    
    const campaign = campaignDoc.data()!;

    // Calculate time range
    const now = new Date();
    const timeRangeMs = timeRange === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                       timeRange === '30d' ? 30 * 24 * 60 * 60 * 1000 :
                       timeRange === '90d' ? 90 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const startDate = new Date(now.getTime() - timeRangeMs);

    // Get campaign interactions
    const interactionsSnapshot = await db.collection('campaignInteractions')
      .where('campaignId', '==', campaignId)
      .where('sentAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .get();

    const interactions = interactionsSnapshot.docs.map(doc => doc.data());

    // Calculate analytics
    const analytics = {
      totalSent: interactions.length,
      totalRead: interactions.filter(i => i.status === 'read').length,
      totalReplied: interactions.filter(i => i.status === 'replied').length,
      readRate: interactions.length > 0 ? (interactions.filter(i => i.status === 'read').length / interactions.length) * 100 : 0,
      replyRate: interactions.length > 0 ? (interactions.filter(i => i.status === 'replied').length / interactions.length) * 100 : 0,
      avgEngagementScore: calculateEngagementScore(interactions),
      organizationalBreakdown: getOrganizationalBreakdown(interactions),
      responseTrends: getResponseTrends(interactions, timeRangeMs),
      traitImpact: await calculateTraitImpact(campaign, interactions)
    };

    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'campaign_analytics_retrieved',
      sourceModule: 'CampaignsEngine',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Analytics retrieved for campaign "${campaign.title}"`,
      eventType: 'campaign.analytics.retrieved',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'analytics'],
      urgencyScore: 4
    });

    return analytics;

  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'campaign_analytics_retrieved',
      sourceModule: 'CampaignsEngine',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to retrieve campaign analytics: ${error.message}`,
      eventType: 'campaign.analytics.failed',
      targetType: 'campaign',
      targetId: campaignId,
      aiRelevant: true,
      contextType: 'campaign',
      traitsAffected: null,
      aiTags: ['campaign', 'analytics', 'error'],
      urgencyScore: 6
    });
    throw error;
  }
});

function calculateEngagementScore(interactions: any[]): number {
  if (interactions.length === 0) return 0;
  
  const scores = interactions.map(interaction => {
    let score = 0;
    if (interaction.status === 'read') score += 1;
    if (interaction.status === 'replied') score += 2;
    if (interaction.responseTime && interaction.responseTime < 24 * 60 * 60 * 1000) score += 1; // Quick response
    return score;
  });
  
  return scores.reduce((sum, score) => sum + score, 0) / interactions.length;
}

function getOrganizationalBreakdown(interactions: any[]): any {
  const breakdown: Record<string, Record<string, number>> = {
    regions: {},
    divisions: {},
    departments: {},
    locations: {}
  };

  interactions.forEach(interaction => {
    const workerData = interaction.workerData;
    
    if (workerData.regionId) {
      breakdown.regions[workerData.regionId] = (breakdown.regions[workerData.regionId] || 0) + 1;
    }
    if (workerData.divisionId) {
      breakdown.divisions[workerData.divisionId] = (breakdown.divisions[workerData.divisionId] || 0) + 1;
    }
    if (workerData.departmentId) {
      breakdown.departments[workerData.departmentId] = (breakdown.departments[workerData.departmentId] || 0) + 1;
    }
    if (workerData.locationId) {
      breakdown.locations[workerData.locationId] = (breakdown.locations[workerData.locationId] || 0) + 1;
    }
  });

  return breakdown;
}

function getResponseTrends(interactions: any[], timeRangeMs: number): any {
  const days = Math.ceil(timeRangeMs / (24 * 60 * 60 * 1000));
  const trends = {
    sent: new Array(days).fill(0),
    read: new Array(days).fill(0),
    replied: new Array(days).fill(0)
  };

  const now = new Date();
  
  interactions.forEach(interaction => {
    const sentDate = interaction.sentAt.toDate ? interaction.sentAt.toDate() : new Date(interaction.sentAt);
    const daysAgo = Math.floor((now.getTime() - sentDate.getTime()) / (24 * 60 * 60 * 1000));
    
    if (daysAgo >= 0 && daysAgo < days) {
      trends.sent[daysAgo]++;
      if (interaction.status === 'read') trends.read[daysAgo]++;
      if (interaction.status === 'replied') trends.replied[daysAgo]++;
    }
  });

  return trends;
}

async function calculateTraitImpact(campaign: any, interactions: any[]): Promise<any> {
  // This would integrate with the traits engine to calculate how the campaign affected worker traits
  // For now, return a placeholder
  return {
    motivation: { change: 0.1, confidence: 0.8 },
    engagement: { change: 0.05, confidence: 0.7 },
    satisfaction: { change: 0.02, confidence: 0.6 }
  };
}

// Cloud function: Toggle HRX Flex for existing tenant
export const toggleHrxFlex = onCall({ maxInstances: 10 }, async (request) => {
  const { tenantId, enabled } = request.data;
  
  if (!tenantId || typeof enabled !== 'boolean') {
    throw new Error('Invalid parameters: tenantId and enabled (boolean) are required');
  }
  
  try {
    const tenantRef = db.collection('tenants').doc(tenantId);
    const tenantDoc = await tenantRef.get();
    
    if (!tenantDoc.exists) {
      throw new Error('Tenant not found');
    }
    
    let flexWorkerIds: string[] = [];
    
    if (enabled) {
      // Enable hrxFlex and create Flex division
      await tenantRef.update({
        hrxFlex: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Create the Flex division
      const flexDivisionRef = tenantRef.collection('divisions').doc('auto_flex');
      await flexDivisionRef.set({
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
      
      // Find existing Flex workers and assign them to the division
      // Note: Firestore doesn't support OR queries, so we need to query separately
      const flexWorkersBySecurityLevel = db.collection('users')
        .where('tenantId', '==', tenantId)
        .where('securityLevel', '==', 'Flex');
      
      const flexWorkersByEmploymentType = db.collection('users')
        .where('tenantId', '==', tenantId)
        .where('employmentType', '==', 'Flex');
      
      const [securityLevelSnap, employmentTypeSnap] = await Promise.all([
        flexWorkersBySecurityLevel.get(),
        flexWorkersByEmploymentType.get()
      ]);
      
      // Combine and deduplicate the results
      const allFlexWorkers = new Set<string>();
      securityLevelSnap.docs.forEach(doc => allFlexWorkers.add(doc.id));
      employmentTypeSnap.docs.forEach(doc => allFlexWorkers.add(doc.id));
      
      flexWorkerIds = Array.from(allFlexWorkers);
      
      if (flexWorkerIds.length > 0) {
        // Add existing Flex workers to the division
        await flexDivisionRef.update({
          memberIds: admin.firestore.FieldValue.arrayUnion(...flexWorkerIds),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        // Update divisionId for existing Flex workers
        const batch = db.batch();
        const allFlexWorkerDocs = [...securityLevelSnap.docs, ...employmentTypeSnap.docs];
        allFlexWorkerDocs.forEach((doc: any) => {
          batch.update(doc.ref, {
            divisionId: 'auto_flex',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
        
        console.log(`Assigned ${flexWorkerIds.length} existing Flex workers to division for tenant ${tenantId}`);
      }
      
      console.log(`HRX Flex enabled and Flex division created for tenant ${tenantId}`);
    } else {
      // Disable hrxFlex (but keep the division)
      await tenantRef.update({
        hrxFlex: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      console.log(`HRX Flex disabled for tenant ${tenantId}`);
    }
    
    return { 
      success: true, 
      message: `HRX Flex ${enabled ? 'enabled' : 'disabled'} successfully`,
      flexWorkersAssigned: flexWorkerIds.length
    };
  } catch (error: any) {
    console.error('toggleHrxFlex error:', error);
    throw new Error(`Failed to toggle HRX Flex: ${error.message}`);
  }
});

// ===== SECURITY LEVEL AI ENGAGEMENT SETTINGS =====

// Get tenant AI engagement settings
export const getTenantAIEngagementSettings = onCall(async (request) => {
  const { tenantId } = request.data;
  const start = Date.now();
  
  try {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    // Get settings from Firestore
    const settingsRef = db.collection('tenants').doc(tenantId).collection('aiSettings').doc('securityLevelEngagement');
    const settingsDoc = await settingsRef.get();
    
    let settings: Record<string, any> = {};
    if (settingsDoc.exists) {
      settings = settingsDoc.data() as Record<string, any>;
    } else {
      // Return default settings if none exist
      settings = {
        '7': { // Admin
          securityLevel: '7',
          enabled: true,
          engagementType: 'standard',
          modules: {
            aiChat: true,
            aiCampaigns: true,
            aiMoments: true,
            jobSatisfactionInsights: true,
            traitsEngine: true,
            feedbackEngine: true,
            motivationLibrary: true,
          },
          messaging: {
            tone: 'professional',
            frequency: 'low',
            topics: ['system_updates', 'admin_tasks', 'team_management'],
            restrictedTopics: ['job_applications', 'qualifications_update'],
          },
          behavior: {
            allowJobApplications: false,
            encourageQualifications: false,
            allowCareerGoals: false,
            allowProfileUpdates: true,
            allowFeedback: true,
          },
          targeting: {
            includeInCampaigns: true,
            includeInMoments: true,
            includeInAnalytics: true,
            includeInReports: true,
          },
        },
        '6': { // Manager
          securityLevel: '6',
          enabled: true,
          engagementType: 'standard',
          modules: {
            aiChat: true,
            aiCampaigns: true,
            aiMoments: true,
            jobSatisfactionInsights: true,
            traitsEngine: true,
            feedbackEngine: true,
            motivationLibrary: true,
          },
          messaging: {
            tone: 'professional',
            frequency: 'medium',
            topics: ['team_management', 'performance', 'leadership'],
            restrictedTopics: ['job_applications', 'qualifications_update'],
          },
          behavior: {
            allowJobApplications: false,
            encourageQualifications: false,
            allowCareerGoals: false,
            allowProfileUpdates: true,
            allowFeedback: true,
          },
          targeting: {
            includeInCampaigns: true,
            includeInMoments: true,
            includeInAnalytics: true,
            includeInReports: true,
          },
        },
        '5': { // Worker
          securityLevel: '5',
          enabled: true,
          engagementType: 'standard',
          modules: {
            aiChat: true,
            aiCampaigns: true,
            aiMoments: true,
            jobSatisfactionInsights: true,
            traitsEngine: true,
            feedbackEngine: true,
            motivationLibrary: true,
          },
          messaging: {
            tone: 'supportive',
            frequency: 'medium',
            topics: ['wellness', 'performance', 'teamwork', 'growth'],
            restrictedTopics: ['job_applications', 'qualifications_update'],
          },
          behavior: {
            allowJobApplications: false,
            encourageQualifications: false,
            allowCareerGoals: false,
            allowProfileUpdates: true,
            allowFeedback: true,
          },
          targeting: {
            includeInCampaigns: true,
            includeInMoments: true,
            includeInAnalytics: true,
            includeInReports: true,
          },
        },
        '4': { // Hired Staff
          securityLevel: '4',
          enabled: true,
          engagementType: 'hired_staff',
          modules: {
            aiChat: true,
            aiCampaigns: true,
            aiMoments: true,
            jobSatisfactionInsights: true,
            traitsEngine: true,
            feedbackEngine: true,
            motivationLibrary: true,
          },
          messaging: {
            tone: 'supportive',
            frequency: 'medium',
            topics: ['assignment_support', 'workplace_integration', 'performance', 'wellness'],
            restrictedTopics: ['job_applications', 'qualifications_update'],
          },
          behavior: {
            allowJobApplications: false,
            encourageQualifications: false,
            allowCareerGoals: false,
            allowProfileUpdates: true,
            allowFeedback: true,
          },
          targeting: {
            includeInCampaigns: true,
            includeInMoments: true,
            includeInAnalytics: true,
            includeInReports: true,
          },
        },
        '3': { // Applicant
          securityLevel: '3',
          enabled: true,
          engagementType: 'applicant',
          modules: {
            aiChat: true,
            aiCampaigns: false,
            aiMoments: true,
            jobSatisfactionInsights: false,
            traitsEngine: true,
            feedbackEngine: false,
            motivationLibrary: false,
          },
          messaging: {
            tone: 'supportive',
            frequency: 'high',
            topics: ['resume_completion', 'profile_completion', 'application_status', 'next_steps'],
            restrictedTopics: [],
          },
          behavior: {
            allowJobApplications: true,
            encourageQualifications: true,
            allowCareerGoals: true,
            allowProfileUpdates: true,
            allowFeedback: false,
          },
          targeting: {
            includeInCampaigns: false,
            includeInMoments: true,
            includeInAnalytics: false,
            includeInReports: false,
          },
        },
        '2': { // Suspended
          securityLevel: '2',
          enabled: false,
          engagementType: 'none',
          modules: {
            aiChat: false,
            aiCampaigns: false,
            aiMoments: false,
            jobSatisfactionInsights: false,
            traitsEngine: false,
            feedbackEngine: false,
            motivationLibrary: false,
          },
          messaging: {
            tone: 'none',
            frequency: 'none',
            topics: [],
            restrictedTopics: [],
          },
          behavior: {
            allowJobApplications: false,
            encourageQualifications: false,
            allowCareerGoals: false,
            allowProfileUpdates: false,
            allowFeedback: false,
          },
          targeting: {
            includeInCampaigns: false,
            includeInMoments: false,
            includeInAnalytics: false,
            includeInReports: false,
          },
        },
        '1': { // Dismissed
          securityLevel: '1',
          enabled: false,
          engagementType: 'none',
          modules: {
            aiChat: false,
            aiCampaigns: false,
            aiMoments: false,
            jobSatisfactionInsights: false,
            traitsEngine: false,
            feedbackEngine: false,
            motivationLibrary: false,
          },
          messaging: {
            tone: 'none',
            frequency: 'none',
            topics: [],
            restrictedTopics: [],
          },
          behavior: {
            allowJobApplications: false,
            encourageQualifications: false,
            allowCareerGoals: false,
            allowProfileUpdates: false,
            allowFeedback: false,
          },
          targeting: {
            includeInCampaigns: false,
            includeInMoments: false,
            includeInAnalytics: false,
            includeInReports: false,
          },
        },
      };
    }

    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'security_level_ai_engagement_settings_retrieved',
      sourceModule: 'SecurityLevelAIEngagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Retrieved AI engagement settings for tenant ${tenantId}`,
      eventType: 'settings.retrieved',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'settings',
      aiTags: ['security_level', 'ai_engagement', 'settings'],
      urgencyScore: 3
    });

    return { success: true, data: settings };

  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'security_level_ai_engagement_settings_retrieved',
      sourceModule: 'SecurityLevelAIEngagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to retrieve AI engagement settings for tenant ${tenantId}: ${error.message}`,
      eventType: 'settings.retrieved',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'settings',
      aiTags: ['security_level', 'ai_engagement', 'settings', 'error'],
      urgencyScore: 5
    });
    throw error;
  }
});

// Update tenant AI engagement settings
export const updateTenantAIEngagementSettings = onCall(async (request) => {
  const { tenantId, settings } = request.data;
  const start = Date.now();
  
  try {
    if (!tenantId || !settings) {
      throw new Error('tenantId and settings are required');
    }

    // Validate settings structure
    const requiredSecurityLevels = ['1', '2', '3', '4', '5', '6', '7'];
    for (const level of requiredSecurityLevels) {
      if (!settings[level]) {
        throw new Error(`Missing settings for security level ${level}`);
      }
    }

    // Save settings to Firestore
    const settingsRef = db.collection('tenants').doc(tenantId).collection('aiSettings').doc('securityLevelEngagement');
    await settingsRef.set({
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth?.uid || 'system'
    });

    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'security_level_ai_engagement_settings_updated',
      sourceModule: 'SecurityLevelAIEngagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Updated AI engagement settings for tenant ${tenantId}`,
      eventType: 'settings.updated',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'settings',
      aiTags: ['security_level', 'ai_engagement', 'settings'],
      urgencyScore: 7
    });

    return { success: true };

  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'security_level_ai_engagement_settings_updated',
      sourceModule: 'SecurityLevelAIEngagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update AI engagement settings for tenant ${tenantId}: ${error.message}`,
      eventType: 'settings.updated',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'settings',
      aiTags: ['security_level', 'ai_engagement', 'settings', 'error'],
      urgencyScore: 8
    });
    throw error;
  }
});

// Filter workers by security level for AI engagement
export const filterWorkersBySecurityLevel = onCall(async (request) => {
  const { tenantId, engagementType, securityLevels } = request.data;
  const start = Date.now();
  
  try {
    if (!tenantId || !engagementType) {
      throw new Error('tenantId and engagementType are required');
    }

    // Get all workers for the tenant
    const workersQuery = db.collection('users').where('tenantId', '==', tenantId);
    const workersSnapshot = await workersQuery.get();
    
    const workers = workersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get AI engagement settings
    const settingsRef = db.collection('tenants').doc(tenantId).collection('aiSettings').doc('securityLevelEngagement');
    const settingsDoc = await settingsRef.get();
    
    let settings: Record<string, any> = {};
    if (settingsDoc.exists) {
      settings = settingsDoc.data() as Record<string, any>;
    } else {
      // Use default settings if none exist
      settings = {};
    }

    // Filter workers based on security level and engagement type
    const filteredWorkers = workers.filter(worker => {
      const workerSecurityLevel = (worker as any).securityLevel || '5';
      
      // If specific security levels are requested, filter by those
      if (securityLevels && securityLevels.length > 0) {
        if (!securityLevels.includes(workerSecurityLevel)) {
          return false;
        }
      }

      // Get settings for this security level
      const levelSettings = settings?.[workerSecurityLevel];
      if (!levelSettings) {
        return false; // No settings for this level, exclude
      }

      // Check if AI engagement is enabled for this security level
      if (!levelSettings.enabled) {
        return false;
      }

      // Check if this engagement type is allowed
      switch (engagementType) {
        case 'campaigns':
          return levelSettings.targeting?.includeInCampaigns || false;
        case 'moments':
          return levelSettings.targeting?.includeInMoments || false;
        case 'analytics':
          return levelSettings.targeting?.includeInAnalytics || false;
        case 'reports':
          return levelSettings.targeting?.includeInReports || false;
        default:
          return false;
      }
    });

    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'workers_filtered_by_security_level',
      sourceModule: 'SecurityLevelAIEngagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Filtered ${filteredWorkers.length} workers for ${engagementType} engagement in tenant ${tenantId}`,
      eventType: 'workers.filtered',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'targeting',
      aiTags: ['security_level', 'worker_filtering', engagementType],
      urgencyScore: 4
    });

    return { 
      success: true, 
      data: {
        workers: filteredWorkers,
        totalWorkers: workers.length,
        filteredCount: filteredWorkers.length,
        engagementType
      }
    };

  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'workers_filtered_by_security_level',
      sourceModule: 'SecurityLevelAIEngagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to filter workers for ${engagementType} engagement in tenant ${tenantId}: ${error.message}`,
      eventType: 'workers.filtered',
      targetType: 'tenant',
      targetId: tenantId,
      aiRelevant: true,
      contextType: 'targeting',
      aiTags: ['security_level', 'worker_filtering', engagementType, 'error'],
      urgencyScore: 6
    });
    throw error;
  }
});

// Get AI engagement configuration for a specific worker
export const getWorkerAIEngagementConfig = onCall(async (request) => {
  const { tenantId, workerId } = request.data;
  const start = Date.now();
  
  try {
    if (!tenantId || !workerId) {
      throw new Error('tenantId and workerId are required');
    }

    // Get worker data
    const workerDoc = await db.collection('users').doc(workerId).get();
    if (!workerDoc.exists) {
      throw new Error('Worker not found');
    }

    const workerData = workerDoc.data();
    const securityLevel = workerData?.securityLevel || '5';

    // Get AI engagement settings
    const settingsRef = db.collection('tenants').doc(tenantId).collection('aiSettings').doc('securityLevelEngagement');
    const settingsDoc = await settingsRef.get();
    
    let settings;
    if (settingsDoc.exists) {
      settings = settingsDoc.data();
    } else {
      // Use default settings if none exist
      settings = {};
    }

    const levelSettings = settings?.[securityLevel] || {};

    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'worker_ai_engagement_config_retrieved',
      sourceModule: 'SecurityLevelAIEngagement',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Retrieved AI engagement config for worker ${workerId} (security level ${securityLevel})`,
      eventType: 'worker.config.retrieved',
      targetType: 'worker',
      targetId: workerId,
      aiRelevant: true,
      contextType: 'worker_config',
      aiTags: ['security_level', 'worker_config', 'ai_engagement'],
      urgencyScore: 3
    });

    return { 
      success: true, 
      data: {
        workerId,
        securityLevel,
        config: levelSettings,
        workerData: {
          name: workerData?.name,
          email: workerData?.email,
          securityLevel: workerData?.securityLevel,
          tenantId: workerData?.tenantId
        }
      }
    };

  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'worker_ai_engagement_config_retrieved',
      sourceModule: 'SecurityLevelAIEngagement',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to retrieve AI engagement config for worker ${workerId}: ${error.message}`,
      eventType: 'worker.config.retrieved',
      targetType: 'worker',
      targetId: workerId,
      aiRelevant: true,
      contextType: 'worker_config',
      aiTags: ['security_level', 'worker_config', 'ai_engagement', 'error'],
      urgencyScore: 5
    });
    throw error;
  }
});

// Import the fix function
import { fixWorkerTenantIds } from './fixWorkerTenantIds';

// Integration Functions
export {
  getSSOConfig, updateSSOConfig, testSSOConnection,
  getSCIMConfig, updateSCIMConfig, syncSCIMUsers,
  getHRISConfig, updateHRISConfig, syncHRISData,
  getSlackConfig, updateSlackConfig, testSlackConnection,
  getIntegrationLogs, manualSync, getIntegrationStatuses,
  fixWorkerTenantIds,
  getUsersByTenant
};

// Gmail Integration Functions
export {
  getGmailAuthUrl,
  handleGmailCallback,
  gmailOAuthCallback,
  syncGmailEmails,
  disconnectGmail,
  getGmailStatus,
  monitorGmailForContactEmails,
  testGmailEmailCapture,
  testGmailTokenValidity,
  scheduledGmailMonitoring,
  cleanupDuplicateEmailLogs,
  bulkImportGmailEmails
} from './gmailIntegration';

// Gmail Bulk Import System
export { initiateBulkGmailImport, getBulkImportStatus } from './gmailBulkImportSystem';

// Data Operations Functions
export { cleanupDuplicateEmails } from './cleanupDuplicateEmails';
export { clearAllEmails } from './clearAllEmails';

// Google Calendar Integration Functions
export {
  getCalendarAuthUrl,
  handleCalendarCallback,
  syncTaskToCalendar,
  updateGoogleSync,
  deleteGoogleSync,
  getCalendarStatus,
  disconnectCalendar,
  disconnectAllGoogleServices,
  clearExpiredTokens,
  enableCalendarSync,
  listCalendarEvents,
  createCalendarEvent
} from './googleCalendarIntegration';

// Calendar Integration Functions
export {
  syncCalendarEventsToCRM,
  createCalendarEventFromTask,
  getCalendarAvailability,
  testCalendarTokenValidity
} from './calendarIntegration';

// Gmail-Tasks Integration Functions
export {
  syncGmailAndCreateTasks,
  syncGmailCalendarAsTasks,
  sendEmailTaskViaGmail
} from './gmailTasksIntegration';

// News Functions
export { fetchCompanyNews };

// Location Functions
export { discoverCompanyLocations };

// URL Discovery Functions
export { discoverCompanyUrls };

// User Management Functions
export { getSalespeople };
export { getSalespeopleForTenant } from './getSalespeopleForTenant';
export { fixPendingUser } from './fixPendingUser';

// Job Scraping Functions
export { scrapeIndeedJobs };

// Company Data Functions
// getCompanyLocations removed - locations are subcollection, no function needed
// (deduped) associationsIntegrityReport export is declared above

// Location Association Functions
export { getLocationAssociations } from './getLocationAssociations';
export { updateLocationAssociation, updateLocationAssociationHttp } from './updateLocationAssociation';

// CRM Data Management Functions
export { linkContactsToCompanies, linkCRMEntities, triggerAINoteReview, triggerAINoteReviewHttp };

// Decision Maker Search Functions
export { findDecisionMakers, findDecisionMakersHttp };

// Company Enhancement Functions
export { enhanceCompanyWithSerp };
export { enhanceContactWithAI };

// News Feed Functions
export { fetchFollowedCompanyNews };

// Company Management Functions
export { removeDuplicateCompanies, findTenantIds };

// Contact Management Functions
export { removeContactsWithoutNames, removeDuplicateContacts, removePhoneNumberContacts, migrateContactSchema };

// Company Info Extraction Functions
export { extractCompanyInfoFromUrls };

// Association Management Functions
export { manageAssociations };
export { migrateAssociationsToObjects } from './migrateAssociationsToObjects';
export { fixContactAssociations, findContactInfo, updateCompanyPipelineTotals, onDealUpdated };

// AI Summary Functions
export { generateDealAISummary, triggerAISummaryUpdate };

// 🚀 DENORMALIZED ASSOCIATIONS FUNCTIONS
// Temporarily commented out due to TypeScript errors
// export { syncDenormalizedAssociations, bulkSyncAssociations };
// export { migrateToDenormalizedAssociations, cleanupOldAssociations };

// Similar Companies Functions
export { findSimilarCompanies } from './findSimilarCompanies';
export { addCompanyToCRM } from './addCompanyToCRM';

// AI Chat
export { startAIThread, chatWithAI, logAIUserMessage } from './aiChat';
export { chatWithGPT } from './gptGateway';
export { enhancedChatWithGPT } from './enhancedMainChat';
export { upsertCodeChunks, searchCodeChunks, upsertCodeChunksHttp } from './codeAware';
export { metricsIngest } from './telemetry/metrics';
export { app_ai_generateResponse } from './appAi';
// Apollo scaffolding will use utils; callables/triggers to be added next iteration
export { onCompanyCreatedApollo, onContactCreatedApollo, getFirmographics, getRecommendedContacts, apolloPing, apolloPingHttp } from './apolloIntegration';
// RE-ENABLED WITH FIXES
export { syncApolloHeadquartersLocation } from './apolloLocationSync';
export { fetchLinkedInAvatar } from './linkedInAvatarService';

// Active Salespeople (Company)
export { rebuildCompanyActiveSalespeople, rebuildAllCompanyActiveSalespeople, updateActiveSalespeopleOnDeal, updateActiveSalespeopleOnTask, normalizeCompanySizes, rebuildContactActiveSalespeople } from './activeSalespeople';

// Auto Activity Logger
export { 
  autoLogActivity,
  logContactActivity,
  logDealActivity,
  logCompanyActivity,
  logLocationActivity,
  logSalespersonActivity,
  logTaskActivity,
  logEmailActivity,
  logNoteActivity,
  logContactCreated,
  logContactUpdated,
  logContactEmailFound,
  logContactPhoneFound,
  logDealCreated,
  logDealUpdated,
  logDealStageChanged,
  logCompanyCreated,
  logCompanyUpdated,
  logCompanyEnhanced,
  logTaskCreated,
  logTaskCompleted,
  logTaskCancelled,
  logNoteAdded,
  logNoteUpdated,
  logAssociationAdded,
  logAssociationRemoved
} from './autoActivityLogger';

// Prospecting Functions
export { runProspecting, saveProspectingSearch, addProspectsToCRM, createCallList };

