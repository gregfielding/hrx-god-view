const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'hrx1-d3beb'
});

// List of orphaned functions to delete
const orphanedFunctions = [
  'comparePromptIntentsToOutcome',
  'evaluateTraitPredictionAccuracy',
  'firestoreLogAgencyAISettingsCreated',
  'firestoreLogAgencyAISettingsDeleted',
  'firestoreLogAgencyAISettingsUpdated',
  'firestoreLogAgencyContactCreated',
  'firestoreLogAgencyContactDeleted',
  'firestoreLogAgencyContactUpdated',
  'firestoreLogAgencyCreated',
  'firestoreLogAgencyDeleted',
  'firestoreLogAgencyUpdated',
  'firestoreLogCustomerAISettingsCreated',
  'firestoreLogCustomerAISettingsDeleted',
  'firestoreLogCustomerAISettingsUpdated',
  'firestoreLogCustomerCreated',
  'firestoreLogCustomerDeleted',
  'firestoreLogCustomerDepartmentCreated',
  'firestoreLogCustomerDepartmentDeleted',
  'firestoreLogCustomerDepartmentUpdated',
  'firestoreLogCustomerUpdated',
  'generateSelfImprovementReport',
  'logAgencyDeleted',
  'logCampaignCreated',
  'logCampaignDeleted',
  'logCampaignUpdated',
  'logConversationCreated',
  'logConversationDeleted',
  'logConversationUpdated',
  'logShiftCreated',
  'logShiftDeleted',
  'logShiftUpdated',
  'runTriggerTests',
  'scanLogsForLowConfidence',
  'suggestPromptRefinement',
  'trackAdminOverrides'
];

async function deleteOrphanedFunctions() {
  console.log('🚀 Starting cleanup of orphaned Firebase functions...\n');
  
  const functions = admin.functions();
  const region = 'us-central1';
  
  for (const functionName of orphanedFunctions) {
    try {
      console.log(`🗑️  Deleting function: ${functionName}...`);
      
      // Delete the function
      await functions.deleteFunction(`${functionName}`, region);
      
      console.log(`✅ Successfully deleted: ${functionName}`);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        console.log(`⚠️  Function not found (already deleted): ${functionName}`);
      } else {
        console.error(`❌ Error deleting ${functionName}:`, error.message);
      }
    }
  }
  
  console.log('\n🎉 Cleanup completed!');
  console.log('📝 Note: Some functions may take a few minutes to fully delete from the Firebase console.');
}

// Run the cleanup
deleteOrphanedFunctions()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }); 