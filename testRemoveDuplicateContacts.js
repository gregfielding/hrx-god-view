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

async function testRemoveDuplicateContacts() {
  try {
    console.log('🚀 Testing removeDuplicateContacts function...');
    
    // First, run a dry run to see what would be deleted
    console.log('\n🔍 Running DRY RUN to analyze duplicate contacts...');
    const dryRunResult = await httpsCallable(functions, 'removeDuplicateContacts')({
      dryRun: true
    });
    
    if (!dryRunResult.data.success) {
      console.error('❌ Dry run failed:', dryRunResult.data.error);
      return;
    }
    
    console.log('✅ Dry run completed successfully!');
    console.log('📊 Analysis Results:');
    console.log(JSON.stringify(dryRunResult.data, null, 2));
    
    const { summary, results } = dryRunResult.data;
    
    if (summary.totalContactsToDelete === 0) {
      console.log('\n✅ No duplicate contacts found!');
      return;
    }
    
    console.log(`\n📋 Summary:`);
    console.log(`   Total Tenants: ${summary.totalTenants}`);
    console.log(`   Total Contacts Processed: ${summary.totalContactsProcessed}`);
    console.log(`   Duplicate Groups: ${summary.totalDuplicateGroups}`);
    console.log(`   Contacts to Delete: ${summary.totalContactsToDelete}`);
    console.log(`   Contacts to Keep: ${summary.totalContactsToKeep}`);
    console.log(`   Dry Run Mode: ${summary.dryRun}`);
    
    console.log(`\n📋 Results by Tenant:`);
    results.forEach(result => {
      if (result.contactsToDelete > 0) {
        console.log(`   📋 ${result.tenantName} (${result.tenantId})`);
        console.log(`      Total Contacts: ${result.totalContacts}`);
        console.log(`      Duplicate Groups: ${result.duplicateGroups}`);
        console.log(`      Contacts to Delete: ${result.contactsToDelete}`);
        console.log(`      Contacts to Keep: ${result.contactsToKeep}`);
        
        // Show some examples of duplicate groups
        if (result.duplicateGroupsDetails.length > 0) {
          console.log(`      Duplicate Groups Examples:`);
          result.duplicateGroupsDetails.slice(0, 3).forEach((group, index) => {
            console.log(`        Group ${index + 1}: "${group.normalizedName}"`);
            console.log(`          - Keeping: ${group.contactsToKeep[0].fullName || `${group.contactsToKeep[0].firstName || ''} ${group.contactsToKeep[0].lastName || ''}`.trim()} (Score: ${group.contactsToKeep[0].completenessScore || 'N/A'})`);
            console.log(`          - Deleting: ${group.contactsToDelete.length} duplicates`);
            group.contactsToDelete.slice(0, 2).forEach(contact => {
              console.log(`            * ${contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()} (Score: ${contact.completenessScore || 'N/A'})`);
            });
            if (group.contactsToDelete.length > 2) {
              console.log(`            * ... and ${group.contactsToDelete.length - 2} more`);
            }
          });
          if (result.duplicateGroupsDetails.length > 3) {
            console.log(`        ... and ${result.duplicateGroupsDetails.length - 3} more groups`);
          }
        }
        console.log('');
      }
    });
    
    // Ask user if they want to proceed with actual deletion
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\n❓ Do you want to proceed with actual deletion? (yes/no): ', async (answer) => {
      rl.close();
      
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log('\n🗑️  Proceeding with actual deletion...');
        
        const liveRunResult = await httpsCallable(functions, 'removeDuplicateContacts')({
          dryRun: false
        });
        
        if (!liveRunResult.data.success) {
          console.error('❌ Live run failed:', liveRunResult.data.error);
          return;
        }
        
        console.log('✅ Live run completed successfully!');
        console.log('📊 Deletion Results:');
        console.log(JSON.stringify(liveRunResult.data, null, 2));
        
        const { summary: liveSummary, results: liveResults } = liveRunResult.data;
        
        console.log(`\n📋 Final Summary:`);
        console.log(`   Total Tenants: ${liveSummary.totalTenants}`);
        console.log(`   Total Contacts Processed: ${liveSummary.totalContactsProcessed}`);
        console.log(`   Duplicate Groups: ${liveSummary.totalDuplicateGroups}`);
        console.log(`   Contacts to Delete: ${liveSummary.totalContactsToDelete}`);
        console.log(`   Contacts Actually Deleted: ${liveSummary.totalContactsToDelete}`);
        console.log(`   Contacts to Keep: ${liveSummary.totalContactsToKeep}`);
        console.log(`   Dry Run Mode: ${liveSummary.dryRun}`);
        
        console.log(`\n📋 Deletion Results by Tenant:`);
        liveResults.forEach(result => {
          if (result.contactsToDelete > 0) {
            console.log(`   ✅ ${result.tenantName} (${result.tenantId})`);
            console.log(`      Duplicate Groups: ${result.duplicateGroups}`);
            console.log(`      Contacts Deleted: ${result.contactsToDelete}`);
          }
        });
        
      } else {
        console.log('\n❌ Deletion cancelled by user.');
      }
    });
    
  } catch (error) {
    console.error('❌ Error testing removeDuplicateContacts:', error);
  }
}

// Run the test
testRemoveDuplicateContacts(); 