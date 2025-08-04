const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxJjAo_dTMQjJdXgDkqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function analyzeContactSchema() {
  try {
    console.log('🔍 Analyzing current contact schema...');
    
    // Get a sample of contacts to analyze their current structure
    const result = await httpsCallable(functions, 'removeDuplicateContacts')({
      dryRun: true
    });
    
    if (!result.data.success) {
      console.error('❌ Function call failed:', result.data.error);
      return;
    }
    
    console.log('✅ Function call successful!');
    
    const { results } = result.data;
    
    // Define the expected schema fields
    const expectedCoreFields = [
      'fullName', 'firstName', 'lastName', 'email', 'phone', 'title', 
      'department', 'companyId', 'locationId', 'source', 'tags', 'status', 
      'priorityScore', 'lastContacted', 'createdBy'
    ];
    
    const expectedOptionalFields = [
      'relationshipNotes', 'contactCadence', 'nextAction', 'nextActionDueDate',
      'influencerType', 'buyingPower', 'approvalChainNotes', 'personalityType',
      'linkedDeals', 'linkedTasks'
    ];
    
    const expectedEnrichedFields = [
      'linkedinUrl', 'profilePhoto', 'location', 'companyName', 'education',
      'jobHistory', 'socialPresence', 'newsMentions', 'publicQuotes',
      'personalitySummary', 'inferredSeniority', 'inferredIndustry', 'commonConnections'
    ];
    
    const expectedMetadataFields = [
      'enriched', 'enrichedAt', 'createdAt', 'updatedAt'
    ];
    
    results.forEach(tenantResult => {
      if (tenantResult.totalContacts > 0) {
        console.log(`\n🏢 Tenant: ${tenantResult.tenantName} (${tenantResult.tenantId})`);
        console.log(`   Total Contacts: ${tenantResult.totalContacts}`);
        
        // Analyze a sample contact to see what fields are present
        if (tenantResult.duplicateGroupsDetails && tenantResult.duplicateGroupsDetails.length > 0) {
          const sampleContact = tenantResult.duplicateGroupsDetails[0].contactsToKeep[0];
          
          console.log('\n   📋 Sample Contact Analysis:');
          console.log(`      ID: ${sampleContact.id}`);
          console.log(`      Name: ${sampleContact.fullName || 'N/A'}`);
          
          // Check core fields
          console.log('\n   🟩 Core Fields:');
          expectedCoreFields.forEach(field => {
            const hasField = sampleContact.hasOwnProperty(field);
            const value = sampleContact[field];
            const status = hasField ? (value ? '✅' : '⚠️ (empty)' ) : '❌ (missing)';
            console.log(`      ${field}: ${status}`);
          });
          
          // Check optional fields
          console.log('\n   🟨 Optional Context Fields:');
          expectedOptionalFields.forEach(field => {
            const hasField = sampleContact.hasOwnProperty(field);
            const value = sampleContact[field];
            const status = hasField ? (value ? '✅' : '⚠️ (empty)' ) : '❌ (missing)';
            console.log(`      ${field}: ${status}`);
          });
          
          // Check enriched fields
          console.log('\n   🟦 Enriched Fields:');
          expectedEnrichedFields.forEach(field => {
            const hasField = sampleContact.hasOwnProperty(field);
            const value = sampleContact[field];
            const status = hasField ? (value ? '✅' : '⚠️ (empty)' ) : '❌ (missing)';
            console.log(`      ${field}: ${status}`);
          });
          
          // Check metadata fields
          console.log('\n   📊 Metadata Fields:');
          expectedMetadataFields.forEach(field => {
            const hasField = sampleContact.hasOwnProperty(field);
            const value = sampleContact[field];
            const status = hasField ? (value ? '✅' : '⚠️ (empty)' ) : '❌ (missing)';
            console.log(`      ${field}: ${status}`);
          });
          
          // Show all available fields
          console.log('\n   🔍 All Available Fields:');
          const allFields = Object.keys(sampleContact).sort();
          allFields.forEach(field => {
            console.log(`      ${field}: ${typeof sampleContact[field]} = ${JSON.stringify(sampleContact[field]).substring(0, 50)}`);
          });
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error analyzing contact schema:', error);
  }
}

// Run the analysis
analyzeContactSchema(); 