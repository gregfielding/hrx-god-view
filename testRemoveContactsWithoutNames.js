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

async function testRemoveContactsWithoutNames() {
  try {
    console.log('🚀 Testing removeContactsWithoutNames function...');
    
    // First, run a dry run to see what would be deleted
    console.log('\n🔍 Running DRY RUN to analyze contacts without names...');
    const dryRunResult = await httpsCallable(functions, 'removeContactsWithoutNames')({
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
    
    if (summary.totalContactsWithoutNames === 0) {
      console.log('\n✅ No contacts without names found!');
      return;
    }
    
    console.log(`\n📋 Summary:`);
    console.log(`   Total Tenants: ${summary.totalTenants}`);
    console.log(`   Total Contacts Processed: ${summary.totalContactsProcessed}`);
    console.log(`   Contacts Without Names: ${summary.totalContactsWithoutNames}`);
    console.log(`   Dry Run Mode: ${summary.dryRun}`);
    
    console.log(`\n📋 Results by Tenant:`);
    results.forEach(result => {
      if (result.contactsWithoutNames > 0) {
        console.log(`   📋 ${result.tenantName} (${result.tenantId})`);
        console.log(`      Total Contacts: ${result.totalContacts}`);
        console.log(`      Contacts Without Names: ${result.contactsWithoutNames}`);
        console.log(`      Contacts to Delete: ${result.contactsToDelete.length}`);
        
        // Show some examples of contacts to be deleted
        if (result.contactsToDelete.length > 0) {
          console.log(`      Examples:`);
          result.contactsToDelete.slice(0, 3).forEach(contact => {
            console.log(`        - ID: ${contact.id}, Email: ${contact.email || 'No email'}, Phone: ${contact.phone || 'No phone'}`);
          });
          if (result.contactsToDelete.length > 3) {
            console.log(`        ... and ${result.contactsToDelete.length - 3} more`);
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
        
        const liveRunResult = await httpsCallable(functions, 'removeContactsWithoutNames')({
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
        console.log(`   Contacts Without Names: ${liveSummary.totalContactsWithoutNames}`);
        console.log(`   Contacts Actually Deleted: ${liveSummary.totalContactsDeleted}`);
        console.log(`   Dry Run Mode: ${liveSummary.dryRun}`);
        
        console.log(`\n📋 Deletion Results by Tenant:`);
        liveResults.forEach(result => {
          if (result.contactsDeleted > 0) {
            console.log(`   ✅ ${result.tenantName} (${result.tenantId})`);
            console.log(`      Contacts Deleted: ${result.contactsDeleted}`);
          }
        });
        
      } else {
        console.log('\n❌ Deletion cancelled by user.');
      }
    });
    
  } catch (error) {
    console.error('❌ Error testing removeContactsWithoutNames:', error);
  }
}

// Run the test
testRemoveContactsWithoutNames(); 