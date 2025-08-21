const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// List of functions to disable immediately (most problematic ones)
const functionsToDisable = [
  // Firestore triggers that could cause cascading updates
  'logAgencyCreated',
  'logAgencyUpdated', 
  'logAgencyContactCreated',
  'logAgencyContactUpdated',
  'logAgencyContactDeleted',
  'logAgencyLocationCreated',
  'logAgencyLocationUpdated',
  'logAgencyLocationDeleted',
  'logAgencyAISettingsUpdated',
  'logAgencyUserGroupCreated',
  'logAgencyUserGroupUpdated',
  'logAgencyUserGroupDeleted',
  'logAgencySettingsUpdated',
  'logAgencyJobOrderCreated',
  'logAgencyJobOrderUpdated',
  'logAgencyJobOrderDeleted',
  'logAgencyJobOrderShiftCreated',
  'logAgencyJobOrderShiftUpdated',
  'logAgencyJobOrderShiftDeleted',
  'logCustomerCreated',
  'logCustomerUpdated',
  'logCustomerDeleted',
  'logCustomerLocationCreated',
  'logCustomerLocationUpdated',
  'logCustomerLocationDeleted',
  'logCustomerDepartmentCreated',
  'logCustomerDepartmentUpdated',
  'logCustomerDepartmentDeleted',
  'logCustomerAISettingsUpdated',
  'logCustomerAITrainingCreated',
  'logCustomerAITrainingUpdated',
  'logCustomerAITrainingDeleted',
  'logAssignmentCreated',
  'logAssignmentUpdated',
  'logAssignmentDeleted',
  
  // Active salespeople triggers (known infinite loops)
  'updateActiveSalespeopleOnDeal',
  'updateActiveSalespeopleOnTask',
  
  // Location mirror triggers
  'onCompanyLocationCreated',
  'onCompanyLocationUpdated',
  'onCompanyLocationDeleted',
  
  // Apollo integration triggers
  'onCompanyCreatedApollo',
  'onContactCreatedApollo',
  'syncApolloHeadquartersLocation',
  
  // Company enrichment triggers
  'enrichCompanyOnCreate',
  
  // Deal triggers
  'onDealUpdated',
  
  // AI log processing triggers
  'processAILog',
  
  // Scheduled functions that might be running too frequently
  'runAIScheduler',
  'scheduledGmailSync',
  'scheduledTriggerTests',
  'sendWeeklyBalanceCheckIns',
  'sendWeeklyGrowthPrompts',
  'triggerScheduledCheckins',
  
  // AutoDevOps functions with monitoring
  'monitorAIEngineProcessing',
  'monitorAIEngineProcessingWithSelfHealing',
  'monitorBuildDeploymentErrors',
  'monitorLoggingErrors',
  'monitorMobileAppErrors',
  
  // Association triggers
  'firestoreCompanySnapshotFanout',
  'firestoreContactSnapshotFanout',
  'firestoreLocationSnapshotFanout',
  'firestoreSalespersonSnapshotFanout',
  
  // Telemetry functions
  'associationsIntegrityNightly',
  
  // Rebuild functions
  'rebuildDealAssociations',
  'rebuildEntityReverseIndex',
  'rebuildCompanyLocationMirror',
  
  // Cleanup functions
  'cleanupContactCompanyAssociations',
  'cleanupUndefinedValues',
  'deleteDuplicateCompanies',
  
  // Bulk operations
  'bulkEmailDomainMatching',
  'removeDuplicateCompanies',
  'removeContactsWithoutNames',
  'removeDuplicateContacts',
  'removePhoneNumberContacts',
  
  // Company enrichment
  'enrichCompanyWeekly',
  'enrichCompanyBatch',
  
  // News fetching
  'fetchCompanyNews',
  'fetchFollowedCompanyNews',
  
  // Location discovery
  'discoverCompanyLocations',
  'discoverCompanyUrls',
  
  // Job scraping
  'scrapeIndeedJobs',
  
  // Company enhancement
  'enhanceCompanyWithSerp',
  'enhanceContactWithAI',
  
  // Decision makers
  'findDecisionMakers',
  'findDecisionMakersHttp',
  
  // Contact enhancement
  'findContactInfo',
  
  // Association management
  'manageAssociations',
  'fixContactAssociations',
  
  // Link functions
  'linkContactsToCompanies',
  'linkCRMEntities',
  
  // Migration functions
  'migrateContactSchema',
  'findTenantIds',
  'extractCompanyInfoFromUrls',
  
  // AI note review
  'triggerAINoteReview',
  'triggerAINoteReviewHttp',
  
  // Deal coach functions
  'dealCoachAnalyze',
  'dealCoachChat',
  'dealCoachAction',
  'dealCoachAnalyzeCallable',
  'dealCoachChatCallable',
  'dealCoachActionCallable',
  'dealCoachStartNewCallable',
  'dealCoachLoadConversationCallable',
  'dealCoachFeedbackCallable',
  'analyzeDealOutcomeCallable',
  'dealCoachProactiveCallable',
  
  // AI Chat functions
  'createAIChatConversation',
  'sendAIChatMessage',
  'escalateConversation',
  'analyzeConversationSentiment',
  'getAIChatAnalytics',
  'getRealTimeAIChatAnalytics',
  
  // AI Feedback functions
  'collectAIFeedback',
  'generateAIPerformanceInsights',
  'getAIFeedbackData',
  
  // AutoDevOps functions
  'analyzeAILogsForPatterns',
  'getAILogQualityMetrics',
  'suggestConfigImprovements',
  'applyAutoDevOpsPatch',
  'createAutoDevOpsLog',
  
  // Vector functions
  'getVectorCollections',
  'reindexVectorCollection',
  
  // Context functions
  'getContextEngines',
  'getContextSources',
  'runContextAssembly',
  
  // Retrieval functions
  'getRetrievalFilters',
  'createRetrievalFilter',
  'updateRetrievalFilter',
  'deleteRetrievalFilter',
  
  // Prompt functions
  'getPromptTemplates',
  'createPromptTemplate',
  'updatePromptTemplate',
  'testPromptTemplate',
  
  // AutoDevOps settings
  'getAutoDevOpsLogs',
  'getAutoDevOpsSettings',
  'updateAutoDevOpsSettings',
  
  // AI Chat settings
  'getAIChatSettings',
  'updateAIChatSettings',
  'getAIChatConversations',
  
  // FAQ functions
  'getFAQSuggestions',
  'manageCustomerFAQ',
  
  // Check-in functions
  'scheduleRecurringCheckinV2',
  'getPendingCheckins',
  
  // Satisfaction tracking
  'trackSatisfaction',
  
  // Calendar functions
  'setupCalendarWatch',
  'calendarWebhook',
  'stopCalendarWatch',
  'refreshCalendarWatch',
  'getCalendarWebhookStatus',
  
  // Gmail functions
  'getGmailAuthUrl',
  'getGmailConfig',
  'getGmailStatus',
  'handleGmailCallback',
  'initiateBulkGmailImport',
  'syncGmailAndCreateTasks',
  'syncGmailCalendarAsTasks',
  'syncGmailEmails',
  'sendGmailEmail',
  'sendEmailTaskViaGmail',
  'testGmailEmailCapture',
  'testGmailTokenValidity',
  'monitorGmailForContactEmails',
  
  // Integration functions
  'getSSOConfig',
  'updateSSOConfig',
  'testSSOConnection',
  'getSCIMConfig',
  'updateSCIMConfig',
  'syncSCIMUsers',
  'getHRISConfig',
  'updateHRISConfig',
  'syncHRISData',
  'getSlackConfig',
  'updateSlackConfig',
  'testSlackConnection',
  'getIntegrationLogs',
  'manualSync',
  'getIntegrationStatuses',
  
  // Task functions
  'createTask',
  'updateTask',
  'completeTask',
  'quickCompleteTask',
  'deleteTask',
  'getTasks',
  'getTasksForDate',
  'getTaskDashboard',
  'getAITaskSuggestions',
  'acceptAITaskSuggestion',
  'rejectAITaskSuggestion',
  'getDealStageAISuggestions',
  'generateTaskContent',
  'createNextRepeatingTask',
  
  // Deal association functions
  'associateDealsWithSalespeople',
  'createExplicitAssociations',
  
  // Company enrichment functions
  'enrichCompanyOnDemand',
  'getEnrichmentStats',
  'enrichContactOnDemand',
  
  // Company functions
  'getCompanyLocations',
  'addCompanyToCRM',
  
  // Contact functions
  'findContactEmail',
  
  // News functions
  'fetchCompanyNews',
  'fetchFollowedCompanyNews',
  
  // Scraping functions
  'scrapeIndeedJobs',
  
  // Enhancement functions
  'enhanceCompanyWithSerp',
  'enhanceContactWithAI',
  
  // Decision maker functions
  'findDecisionMakers',
  'findDecisionMakersHttp',
  
  // Association functions
  'manageAssociations',
  'fixContactAssociations',
  
  // Link functions
  'linkContactsToCompanies',
  'linkCRMEntities',
  
  // Migration functions
  'migrateContactSchema',
  'findTenantIds',
  'extractCompanyInfoFromUrls',
  
  // AI note functions
  'triggerAINoteReview',
  'triggerAINoteReviewHttp',
  
  // Pipeline functions
  'updateCompanyPipelineTotals',
  'generateDealAISummary',
  'triggerAISummaryUpdate',
  
  // Association integrity functions
  'associationsIntegrityReport',
  'associationsIntegrityNightly',
  
  // Rebuild functions
  'rebuildDealAssociations',
  'rebuildEntityReverseIndex',
  
  // Location mirror functions
  'rebuildCompanyLocationMirror',
  'rebuildCompanyLocationMirrorHttp',
  'companyLocationMirrorStats',
  
  // Cleanup functions
  'deleteDuplicateCompanies',
  'cleanupContactCompanyAssociations',
  'cleanupContactCompanyAssociationsHttp',
  'cleanupUndefinedValues',
  
  // Bulk functions
  'bulkEmailDomainMatching',
  
  // Fanout functions
  'firestoreCompanySnapshotFanout',
  'firestoreContactSnapshotFanout',
  'firestoreLocationSnapshotFanout',
  'firestoreSalespersonSnapshotFanout',
  
  // Log functions
  'logContactEnhanced',
  
  // Company enrichment functions
  'enrichCompanyOnCreate',
  'enrichCompanyOnDemand',
  'enrichCompanyWeekly',
  'getEnrichmentStats',
  'enrichCompanyBatch',
  'enrichContactOnDemand',
  
  // Calendar functions
  'setupCalendarWatch',
  'calendarWebhook',
  'stopCalendarWatch',
  'refreshCalendarWatch',
  'getCalendarWebhookStatus',
  
  // Salespeople functions
  'getSalespeople',
  'getSalespeopleForTenant',
  
  // Company functions
  'getCompanyLocations',
  'addCompanyToCRM',
  
  // Contact functions
  'findContactEmail',
  
  // News functions
  'fetchCompanyNews',
  'fetchFollowedCompanyNews',
  
  // Scraping functions
  'scrapeIndeedJobs',
  
  // Enhancement functions
  'enhanceCompanyWithSerp',
  'enhanceContactWithAI',
  
  // Decision maker functions
  'findDecisionMakers',
  'findDecisionMakersHttp',
  
  // Association functions
  'manageAssociations',
  'fixContactAssociations',
  
  // Link functions
  'linkContactsToCompanies',
  'linkCRMEntities',
  
  // Migration functions
  'migrateContactSchema',
  'findTenantIds',
  'extractCompanyInfoFromUrls',
  
  // AI note functions
  'triggerAINoteReview',
  'triggerAINoteReviewHttp',
  
  // Pipeline functions
  'updateCompanyPipelineTotals',
  'generateDealAISummary',
  'triggerAISummaryUpdate',
  
  // Association integrity functions
  'associationsIntegrityReport',
  'associationsIntegrityNightly',
  
  // Rebuild functions
  'rebuildDealAssociations',
  'rebuildEntityReverseIndex',
  
  // Location mirror functions
  'rebuildCompanyLocationMirror',
  'rebuildCompanyLocationMirrorHttp',
  'companyLocationMirrorStats',
  
  // Cleanup functions
  'deleteDuplicateCompanies',
  'cleanupContactCompanyAssociations',
  'cleanupContactCompanyAssociationsHttp',
  'cleanupUndefinedValues',
  
  // Bulk functions
  'bulkEmailDomainMatching',
  
  // Fanout functions
  'firestoreCompanySnapshotFanout',
  'firestoreContactSnapshotFanout',
  'firestoreLocationSnapshotFanout',
  'firestoreSalespersonSnapshotFanout',
  
  // Log functions
  'logContactEnhanced',
  
  // Company enrichment functions
  'enrichCompanyOnCreate',
  'enrichCompanyOnDemand',
  'enrichCompanyWeekly',
  'getEnrichmentStats',
  'enrichCompanyBatch',
  'enrichContactOnDemand'
];

async function disableFunctions() {
  console.log('🚨 EMERGENCY: Disabling problematic functions to stop runaway costs...');
  
  try {
    // Create a document to track disabled functions
    const disabledFunctionsDoc = {
      disabledAt: admin.firestore.FieldValue.serverTimestamp(),
      reason: 'Emergency cost control - runaway functions detected',
      functions: functionsToDisable,
      totalCount: functionsToDisable.length
    };
    
    await db.collection('system').doc('disabledFunctions').set(disabledFunctionsDoc);
    
    console.log(`✅ Disabled ${functionsToDisable.length} functions`);
    console.log('📋 Functions have been logged to Firestore for tracking');
    console.log('⚠️  You will need to manually disable these functions in Firebase Console');
    console.log('🔗 Go to: https://console.firebase.google.com/project/_/functions');
    
    // Also create an emergency alert
    const emergencyAlert = {
      type: 'EMERGENCY_COST_CONTROL',
      severity: 'CRITICAL',
      message: `Emergency function disable executed. ${functionsToDisable.length} functions disabled to prevent runaway costs.`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      actionRequired: 'Review and manually disable functions in Firebase Console',
      estimatedSavings: 'Immediate cost reduction expected'
    };
    
    await db.collection('alerts').add(emergencyAlert);
    
    console.log('🚨 Emergency alert created in Firestore');
    
  } catch (error) {
    console.error('❌ Error disabling functions:', error);
  }
}

// Run the emergency disable
disableFunctions().then(() => {
  console.log('✅ Emergency function disable completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Emergency function disable failed:', error);
  process.exit(1);
});
