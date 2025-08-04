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

async function testRemovePhoneNumberContacts() {
  try {
    console.log('🚀 Testing removePhoneNumberContacts function...');
    
    // First, run a dry run to see what would be deleted
    console.log('\n🔍 Running DRY RUN to analyze contacts with phone numbers in names...');
    const dryRunResult = await httpsCallable(functions, 'removePhoneNumberContacts')({
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
    
    if (summary.totalPhoneNumberContacts === 0) {
      console.log('\n✅ No contacts with phone numbers in names found!');
      return;
    }
    
    console.log(`\n📋 Summary:`);
    console.log(`   Total Tenants: ${summary.totalTenants}`);
    console.log(`   Total Contacts Processed: ${summary.totalContactsProcessed}`);
    console.log(`   Contacts with Phone Numbers in Names: ${summary.totalPhoneNumberContacts}`);
    console.log(`   Dry Run Mode: ${summary.dryRun}`);
    
    console.log(`\n📋 Results by Tenant:`);
    results.forEach(result => {
      if (result.phoneNumberContacts > 0) {
        console.log(`   📋 ${result.tenantName} (${result.tenantId})`);
        console.log(`      Total Contacts: ${result.totalContacts}`);
        console.log(`      Contacts with Phone Numbers in Names: ${result.phoneNumberContacts}`);
        console.log(`      Contacts to Delete: ${result.contactsToDelete.length}`);
        
        // Show some examples of contacts to be deleted
        if (result.contactsToDelete.length > 0) {
          console.log(`      Examples:`);
          result.contactsToDelete.slice(0, 5).forEach(contact => {
            const phoneField = contact.fullName && /^\d{10,}$/.test(contact.fullName.replace(/[^\d]/g, '')) ? 'fullName' :
                              contact.firstName && /^\d{10,}$/.test(contact.firstName.replace(/[^\d]/g, '')) ? 'firstName' : 'lastName';
            const phoneValue = contact[phoneField];
            console.log(`        - ID: ${contact.id}, ${phoneField}: "${phoneValue}", Email: ${contact.email || 'No email'}`);
          });
          if (result.contactsToDelete.length > 5) {
            console.log(`        ... and ${result.contactsToDelete.length - 5} more`);
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
        
        const liveRunResult = await httpsCallable(functions, 'removePhoneNumberContacts')({
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
        console.log(`   Contacts with Phone Numbers in Names: ${liveSummary.totalPhoneNumberContacts}`);
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
    console.error('❌ Error testing removePhoneNumberContacts:', error);
  }
}

// Run the test
testRemovePhoneNumberContacts(); 