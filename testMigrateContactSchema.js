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

async function testMigrateContactSchema() {
  try {
    console.log('🚀 Testing migrateContactSchema function...');
    
    // First, run a dry run to see what would be migrated
    console.log('\n🔍 Running DRY RUN to analyze contact schema migration...');
    const dryRunResult = await httpsCallable(functions, 'migrateContactSchema')({
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
    
    if (summary.totalContactsMigrated === 0) {
      console.log('\n✅ No contacts need migration! All contacts already have the new schema fields.');
      return;
    }
    
    console.log(`\n📋 Summary:`);
    console.log(`   Total Tenants: ${summary.totalTenants}`);
    console.log(`   Total Contacts Processed: ${summary.totalContactsProcessed}`);
    console.log(`   Contacts to Migrate: ${summary.totalContactsMigrated}`);
    console.log(`   Contacts Already Up-to-Date: ${summary.totalContactsSkipped}`);
    console.log(`   Errors: ${summary.totalErrors}`);
    console.log(`   Dry Run Mode: ${summary.dryRun}`);
    
    console.log(`\n📋 Results by Tenant:`);
    results.forEach(result => {
      if (result.contactsMigrated > 0) {
        console.log(`   📋 ${result.tenantName} (${result.tenantId})`);
        console.log(`      Total Contacts: ${result.totalContacts}`);
        console.log(`      Contacts to Migrate: ${result.contactsMigrated}`);
        console.log(`      Contacts Already Up-to-Date: ${result.contactsSkipped}`);
        
        if (result.errors.length > 0) {
          console.log(`      Errors: ${result.errors.length}`);
          result.errors.slice(0, 3).forEach(error => {
            console.log(`        - ${error}`);
          });
          if (result.errors.length > 3) {
            console.log(`        ... and ${result.errors.length - 3} more errors`);
          }
        }
        console.log('');
      }
    });
    
    // Ask user if they want to proceed with actual migration
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\n❓ Do you want to proceed with actual migration? (yes/no): ', async (answer) => {
      rl.close();
      
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log('\n🔄 Proceeding with actual migration...');
        
        const liveRunResult = await httpsCallable(functions, 'migrateContactSchema')({
          dryRun: false
        });
        
        if (!liveRunResult.data.success) {
          console.error('❌ Live run failed:', liveRunResult.data.error);
          return;
        }
        
        console.log('✅ Live run completed successfully!');
        console.log('📊 Migration Results:');
        console.log(JSON.stringify(liveRunResult.data, null, 2));
        
        const { summary: liveSummary, results: liveResults } = liveRunResult.data;
        
        console.log(`\n📋 Final Summary:`);
        console.log(`   Total Tenants: ${liveSummary.totalTenants}`);
        console.log(`   Total Contacts Processed: ${liveSummary.totalContactsProcessed}`);
        console.log(`   Contacts Migrated: ${liveSummary.totalContactsMigrated}`);
        console.log(`   Contacts Already Up-to-Date: ${liveSummary.totalContactsSkipped}`);
        console.log(`   Errors: ${liveSummary.totalErrors}`);
        console.log(`   Dry Run Mode: ${liveSummary.dryRun}`);
        
        console.log(`\n📋 Migration Results by Tenant:`);
        liveResults.forEach(result => {
          if (result.contactsMigrated > 0) {
            console.log(`   ✅ ${result.tenantName} (${result.tenantId})`);
            console.log(`      Contacts Migrated: ${result.contactsMigrated}`);
            console.log(`      Contacts Skipped: ${result.contactsSkipped}`);
          }
        });
        
        console.log('\n🎉 Contact schema migration completed!');
        console.log('📋 New fields added to contacts:');
        console.log('   - priorityScore (calculated based on contact completeness and seniority)');
        console.log('   - influencerType (decision-maker, influencer, gatekeeper, stakeholder, contact)');
        console.log('   - buyingPower (high, medium, low)');
        console.log('   - inferredSeniority (exec, director, manager, ic)');
        console.log('   - contactCadence (default: monthly)');
        
      } else {
        console.log('\n❌ Migration cancelled by user.');
      }
    });
    
  } catch (error) {
    console.error('❌ Error testing migrateContactSchema:', error);
  }
}

// Run the test
testMigrateContactSchema(); 