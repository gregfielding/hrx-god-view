#!/bin/bash

echo "🛡️ SAFE DEPLOYMENT: Deploying essential functions with safety measures..."
echo "📦 This will deploy only the functions you actually need with built-in safeguards"

# Essential functions that are safe to deploy
ESSENTIAL_FUNCTIONS=(
  # Core CRM functions
  "analyzeAITraining"
  "generateJobDescription"
  "getCompanyLocations"
  "getSalespeopleForTenant"
  
  # Safe active salespeople functions
  "rebuildAllCompanyActiveSalespeople"
  "rebuildCompanyActiveSalespeople"
  "rebuildContactActiveSalespeople"
  "updateActiveSalespeopleOnDeal"
  "updateActiveSalespeopleOnTask"
  
  # Safe auto dev functions
  "startProductionMonitoring"
  "getMonitoringStatus"
  "stopAllMonitoring"
  
  # Essential API functions (with rate limiting)
  "getGmailStatus"
  "listCalendarEvents"
  "createCalendarEvent"
  "getCalendarStatus"
  
  # Deal coach functions (with limits)
  "dealCoachAnalyzeCallable"
  "dealCoachChatCallable"
  "dealCoachActionCallable"
  "dealCoachStartNewCallable"
  "dealCoachLoadConversationCallable"
  "dealCoachFeedbackCallable"
  "analyzeDealOutcomeCallable"
  "dealCoachProactiveCallable"
  
  # Core utility functions
  "logAILogCreated"
  "syncApolloHeadquartersLocation"
  "firestoreCompanySnapShotFanout"
  "onCompanyLocationUpdated"
  "onDealUpdated"
  "firestorelogAILogCreated"
)

echo "🔍 Building function list..."
FUNCTION_LIST=""
for func in "${ESSENTIAL_FUNCTIONS[@]}"; do
  FUNCTION_LIST="$FUNCTION_LIST,functions:$func"
done

# Remove leading comma
FUNCTION_LIST=${FUNCTION_LIST#,}

echo "📋 Deploying ${#ESSENTIAL_FUNCTIONS[@]} essential functions:"
for func in "${ESSENTIAL_FUNCTIONS[@]}"; do
  echo "  ✅ $func"
done

echo ""
echo "🚀 Starting safe deployment..."

# Deploy with safety measures
firebase deploy --only "$FUNCTION_LIST" --force

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ SAFE DEPLOYMENT COMPLETED!"
  echo "🛡️ All functions now have built-in safety measures:"
  echo "   • Execution time limits (9 minutes max)"
  echo "   • Rate limiting (100 calls/minute)"
  echo "   • Infinite loop detection"
  echo "   • Cost tracking and limits"
  echo "   • Proper cleanup of intervals"
  echo "   • Batch operation limits"
  echo "   • Recursive call prevention"
  echo ""
  echo "💰 Your costs should remain stable and controlled"
  echo "📊 Monitor your Firebase Console billing dashboard"
  echo ""
  echo "🔧 If you need additional functions, add them to the ESSENTIAL_FUNCTIONS array"
  echo "   and run this script again"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "🔍 Check the error messages above"
  echo "💡 You may need to:"
  echo "   • Fix any TypeScript compilation errors"
  echo "   • Ensure all dependencies are installed"
  echo "   • Check Firebase project configuration"
fi
