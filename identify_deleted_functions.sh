#!/bin/bash

echo "🔍 IDENTIFYING DELETED FUNCTIONS THAT NEED SAFE REWRITING..."
echo "📋 This will compare local functions vs deployed functions"

# Get deployed functions (simplified approach)
echo "📊 Getting deployed functions..."
firebase functions:list | grep -E "callable|http|firestore|scheduler" | awk '{print $1}' | sed 's/│//g' | sed 's/^[[:space:]]*//g' | sed 's/[[:space:]]*$//g' | sort > deployed_functions.txt

# Get local functions from our search results
echo "📊 Getting local functions..."
cat > local_functions.txt << 'EOF'
# Callable Functions
deleteDuplicateCompanies
linkCRMEntities
findContactInfo
discoverCompanyLocations
addCompanyToCRM
getSalespeople
createRetrievalFilter
getCustomerFilters
updateRetrievalFilter
deleteRetrievalFilter
applyFiltersToChunks
testFilterEffectiveness
getFilterAnalytics
fetchCompanyNews
fixContactCompanyAssociations
logContactEnhanced
cleanupDuplicateEmails
bulkEmailDomainMatching
cleanupContactCompanyAssociations
getSSOConfig
updateSSOConfig
testSSOConnection
getSCIMConfig
updateSCIMConfig
syncSCIMUsers
getHRISConfig
updateHRISConfig
syncHRISData
getSlackConfig
updateSlackConfig
testSlackConnection
getIntegrationLogs
manualSync
getIntegrationStatuses
syncGmailAndCreateTasks
syncGmailCalendarAsTasks
sendEmailTaskViaGmail
triggerAINoteReview
enrichContactOnDemand
logAIActionCallable
analyzeAITraining
generateJobDescription
getVectorCollections
reindexVectorCollection
getContextEngines
getContextSources
runContextAssembly
getRetrievalFilters
createRetrievalFilter
updateRetrievalFilter
deleteRetrievalFilter
getPromptTemplates
createPromptTemplate
updatePromptTemplate
testPromptTemplate
getAutoDevOpsLogs
getAutoDevOpsSettings
updateAutoDevOpsSettings
applyAutoDevOpsPatch
createAutoDevOpsLog
analyzeAILogsForPatterns
getAILogQualityMetrics
suggestConfigImprovements
getAIChatSettings
updateAIChatSettings
getAIChatConversations
createAIChatConversation
sendAIChatMessage
escalateConversation
getAIChatAnalytics
getRealTimeAIChatAnalytics
getFAQSuggestions
scheduleRecurringCheckinV2
getPendingCheckins
analyzeConversationSentiment
getRealTimeAIChatAnalytics
manageCustomerFAQ
trackSatisfaction
collectAIFeedback
generateAIPerformanceInsights
getAIFeedbackData
getAILearningTasks
getFeedbackAnalytics
applyAILearning
scheduleContinuousLearning
getImprovementSuggestions
updateImprovementStatus
createBroadcast
sendBroadcast
replyToBroadcast
markBroadcastRead
getBroadcastAnalytics
evaluatePromptWithFilters
assignFilterToModule
rescoreVectorChunk
archiveVectorChunk
tagChunk
generateOrchestrationReport
analyzePromptFailurePatterns
simulateOrchestrationScenario
validatePromptConsistency
validateInviteToken
markInviteTokenUsed
assignOrgToUser
createInviteToken
getHelpTopics
generateHelpDraftsFromCode
getHelpAnalytics
updateHelpArticlesWithNewInfo
logMotivationEvent
getUpcomingBirthdays
sendBirthdayMessage
getMotivations
addMotivation
seedMotivationMessagesFromAPI
updateCustomerAISettings
updateAgencyAISettings
batchTagMotivationsWithAI
manageAssociations
enrichCompanyOnDemand
getEnrichmentStats
enrichCompanyBatch
rebuildCompanyActiveSalespeople
rebuildContactActiveSalespeople
rebuildAllCompanyActiveSalespeople
normalizeCompanySizes
getFirmographics
getFirmographicsByDomain
getRecommendedContacts
apolloPing
upsertCodeChunks
searchCodeChunks
startAIThread
logAIUserMessage
rebuildCompanyLocationMirror
dealCoachStartNewCallable
dealCoachLoadConversationCallable
dealCoachAnalyzeCallable
dealCoachChatCallable
dealCoachActionCallable
dealCoachFeedbackCallable
analyzeDealOutcomeCallable
dealCoachProactiveCallable
createTask
updateTask
completeTask
quickCompleteTask
deleteTask
getTasks
getTasksForDate
getTaskDashboard
getAITaskSuggestions
getUnifiedAISuggestions
acceptAITaskSuggestion
rejectAITaskSuggestion
getDealStageAISuggestions
generateTaskContent
createNextRepeatingTask
enhanceContactWithAI
getCalendarAuthUrl
syncTaskToCalendar
updateGoogleSync
deleteGoogleSync
getCalendarStatus
listCalendarEvents
createCalendarEvent
disconnectCalendar
disconnectAllGoogleServices
enableCalendarSync
clearExpiredTokens
createCalendarEventFromTask
syncCalendarEventsToCRM
getCalendarAvailability
testCalendarTokenValidity

# Firestore Triggers
syncApolloHeadquartersLocation
enrichCompanyOnCreate
processAILog
onCompanyLocationCreated
onCompanyLocationUpdated
onCompanyLocationDeleted
onCompanyCreatedApollo
onContactCreatedApollo
firestoreLogUserCreated
firestoreLogUserUpdated
firestoreLogUserDeleted
firestoreLogAgencyCreated
firestoreLogAgencyUpdated
firestoreLogAgencyDeleted
firestoreLogCustomerCreated
firestoreLogCustomerUpdated
firestoreLogCustomerDeleted
firestoreLogAssignmentCreated
firestoreLogAssignmentUpdated
firestoreLogAssignmentDeleted
firestoreLogConversationCreated
firestoreLogConversationUpdated
firestoreLogConversationDeleted
firestoreLogJobOrderCreated
firestoreLogJobOrderUpdated
firestoreLogJobOrderDeleted
firestoreLogCampaignCreated
firestoreLogCampaignUpdated
firestoreLogCampaignDeleted
firestoreLogMotivationCreated
firestoreLogMotivationUpdated
firestoreLogMotivationDeleted
firestoreLogMessageCreated
firestoreLogMessageUpdated
firestoreLogMessageDeleted
firestoreLogShiftCreated
firestoreLogShiftUpdated
firestoreLogShiftDeleted
firestoreLogUserGroupCreated
firestoreLogUserGroupUpdated
firestoreLogUserGroupDeleted
firestoreLogLocationCreated
firestoreLogLocationUpdated
firestoreLogLocationDeleted
firestoreLogNotificationCreated
firestoreLogNotificationUpdated
firestoreLogNotificationDeleted
firestoreLogSettingCreated
firestoreLogSettingUpdated
firestoreLogSettingDeleted
firestoreLogTaskCreated
firestoreLogTaskUpdated
firestoreLogAILogCreated
firestoreLogAILogUpdated
firestoreLogAILogDeleted
firestoreLogAgencyContactCreated
firestoreLogAgencyContactUpdated
firestoreLogAgencyContactDeleted
firestoreLogGlobalAISettingsCreated
firestoreLogGlobalAISettingsUpdated
firestoreLogGlobalAISettingsDeleted
firestoreLogCustomerAISettingsCreated
firestoreLogCustomerAISettingsUpdated
firestoreLogCustomerAISettingsDeleted
firestoreLogAgencyAISettingsCreated
firestoreLogAgencyAISettingsUpdated
firestoreLogAgencyAISettingsDeleted
firestoreLogDepartmentCreated
firestoreLogDepartmentUpdated
firestoreLogDepartmentDeleted
firestoreLogCustomerDepartmentCreated
firestoreLogCustomerDepartmentUpdated
firestoreLogCustomerDepartmentDeleted
testUserUpdate
firestoreLogTenantCreated
firestoreLogTenantUpdated
firestoreLogTenantDeleted
firestoreLogTenantContactCreated
firestoreLogTenantContactUpdated
firestoreLogTenantContactDeleted
firestoreLogTenantAISettingsCreated
firestoreLogTenantAISettingsUpdated
firestoreLogTenantAISettingsDeleted
firestoreAutoAssignFlexWorker
firestoreHandleFlexWorkerUpdate
firestoreCompanySnapshotFanout
firestoreContactSnapshotFanout
firestoreLocationSnapshotFanout
firestoreSalespersonSnapshotFanout
logAgencyCreated
logAgencyUpdated
logAgencyContactCreated
logAgencyContactUpdated
logAgencyContactDeleted
logAgencyLocationCreated
logAgencyLocationUpdated
logAgencyLocationDeleted
logAgencyAISettingsUpdated
logAgencyUserGroupCreated
logAgencyUserGroupUpdated
updateActiveSalespeopleOnDeal
updateActiveSalespeopleOnTask
EOF

# Clean up the local functions list
grep -v "^#" local_functions.txt | grep -v "^$" | sort > local_functions_clean.txt

echo "📊 Comparing functions..."

# Find functions that exist locally but not deployed (deleted functions)
echo "🚨 DELETED FUNCTIONS THAT NEED SAFE REWRITING:" > deleted_functions_report.txt
echo "================================================" >> deleted_functions_report.txt
comm -23 local_functions_clean.txt deployed_functions.txt >> deleted_functions_report.txt

# Find functions that exist deployed but not locally (orphaned)
echo "" >> deleted_functions_report.txt
echo "🔍 ORPHANED FUNCTIONS (deployed but not in local code):" >> deleted_functions_report.txt
echo "=======================================================" >> deleted_functions_report.txt
comm -13 local_functions_clean.txt deployed_functions.txt >> deleted_functions_report.txt

# Count totals
local_count=$(wc -l < local_functions_clean.txt)
deployed_count=$(wc -l < deployed_functions.txt)
deleted_count=$(comm -23 local_functions_clean.txt deployed_functions.txt | wc -l)
orphaned_count=$(comm -13 local_functions_clean.txt deployed_functions.txt | wc -l)

echo "" >> deleted_functions_report.txt
echo "📊 SUMMARY:" >> deleted_functions_report.txt
echo "===========" >> deleted_functions_report.txt
echo "Local functions: $local_count" >> deleted_functions_report.txt
echo "Deployed functions: $deployed_count" >> deleted_functions_report.txt
echo "Deleted functions (need rewriting): $deleted_count" >> deleted_functions_report.txt
echo "Orphaned functions: $orphaned_count" >> deleted_functions_report.txt

# Display the report
cat deleted_functions_report.txt

echo ""
echo "📋 PRIORITY FUNCTIONS TO REWRITE (based on previous high usage):"
echo "================================================================"

# High-priority functions that were causing runaway costs
HIGH_PRIORITY=(
  "firestoreCompanySnapshotFanout"
  "updateActiveSalespeopleOnDeal"
  "onCompanyLocationUpdated"
  "onDealUpdated"
  "firestorelogAILogCreated"
  "syncApolloHeadquartersLocation"
  "getCompanyLocations"
  "getSalespeopleForTenant"
  "dealCoachAnalyzeCallable"
  "getCalendarStatus"
  "listCalendarEvents"
  "getGmailStatus"
)

echo "🔥 HIGH PRIORITY (caused runaway costs):"
for func in "${HIGH_PRIORITY[@]}"; do
  if grep -q "^$func$" deleted_functions_report.txt; then
    echo "  ✅ $func - NEEDS SAFE REWRITING"
  else
    echo "  ❌ $func - Already deployed or not found"
  fi
done

echo ""
echo "📄 Full report saved to: deleted_functions_report.txt"
echo "🎯 Focus on rewriting the HIGH PRIORITY functions first"
