#!/bin/bash

echo "🚀 Starting cleanup of orphaned Firebase functions..."

# List of orphaned functions to delete
FUNCTIONS=(
  "comparePromptIntentsToOutcome"
  "evaluateTraitPredictionAccuracy"
  "firestoreLogAgencyAISettingsCreated"
  "firestoreLogAgencyAISettingsDeleted"
  "firestoreLogAgencyAISettingsUpdated"
  "firestoreLogAgencyContactCreated"
  "firestoreLogAgencyContactDeleted"
  "firestoreLogAgencyContactUpdated"
  "firestoreLogAgencyCreated"
  "firestoreLogAgencyDeleted"
  "firestoreLogAgencyUpdated"
  "firestoreLogCustomerAISettingsCreated"
  "firestoreLogCustomerAISettingsDeleted"
  "firestoreLogCustomerAISettingsUpdated"
  "firestoreLogCustomerCreated"
  "firestoreLogCustomerDeleted"
  "firestoreLogCustomerDepartmentCreated"
  "firestoreLogCustomerDepartmentDeleted"
  "firestoreLogCustomerDepartmentUpdated"
  "firestoreLogCustomerUpdated"
  "generateSelfImprovementReport"
  "logAgencyDeleted"
  "logCampaignCreated"
  "logCampaignDeleted"
  "logCampaignUpdated"
  "logConversationCreated"
  "logConversationDeleted"
  "logConversationUpdated"
  "logShiftCreated"
  "logShiftDeleted"
  "logShiftUpdated"
  "runTriggerTests"
  "scanLogsForLowConfidence"
  "suggestPromptRefinement"
  "trackAdminOverrides"
)

# Loop through each function and delete it
for func in "${FUNCTIONS[@]}"; do
  echo "🗑️  Deleting function: $func"
  
  # Use Firebase CLI to delete the function
  firebase functions:delete "$func" --region=us-central1 --force
  
  if [ $? -eq 0 ]; then
    echo "✅ Successfully deleted: $func"
  else
    echo "⚠️  Could not delete: $func (may already be deleted or not exist)"
  fi
  
  echo ""
done

echo "🎉 Cleanup completed!"
echo "📝 Note: Some functions may take a few minutes to fully delete from the Firebase console." 