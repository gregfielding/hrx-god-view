const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBvOkJqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testRemoveDuplicateCompanies() {
  try {
    console.log('🚀 Testing removeDuplicateCompanies function...');
    
    // First, find available tenant IDs
    console.log('\n🔍 Finding available tenant IDs...');
    const findTenantIds = httpsCallable(functions, 'findTenantIds');
    const tenantResult = await findTenantIds({});
    
    if (!tenantResult.data.success) {
      console.error('❌ Failed to find tenant IDs:', tenantResult.data.error);
      return;
    }
    
    const { tenants, duplicateAnalysis } = tenantResult.data;
    
    if (tenants.length === 0) {
      console.log('❌ No tenants found in the system');
      return;
    }
    
    console.log(`✅ Found ${tenants.length} tenant(s):`);
    tenants.forEach(tenant => {
      console.log(`   📋 ${tenant.name} (${tenant.id}) - ${tenant.companyCount} companies, ${tenant.duplicateGroups} duplicate groups`);
    });
    
    // Find tenants with duplicates
    const tenantsWithDuplicates = tenants.filter(tenant => tenant.duplicateGroups > 0);
    
    if (tenantsWithDuplicates.length === 0) {
      console.log('\n✅ No tenants with duplicate companies found!');
      return;
    }
    
    console.log(`\n🎯 Found ${tenantsWithDuplicates.length} tenant(s) with duplicate companies:`);
    tenantsWithDuplicates.forEach(tenant => {
      console.log(`   📋 ${tenant.name} (${tenant.id}) - ${tenant.duplicateGroups} duplicate groups, ${tenant.duplicateCompanies} companies to delete`);
    });
    
    // Use the first tenant with duplicates for testing
    const testTenantId = tenantsWithDuplicates[0].id;
    console.log(`\n📋 Using tenant ID: ${testTenantId} (${tenantsWithDuplicates[0].name})`);
    
    // First, run a dry run to see what would be deleted
    console.log('\n🔍 Running DRY RUN to analyze duplicates...');
    const dryRunResult = await httpsCallable(functions, 'removeDuplicateCompanies')({
      tenantId: testTenantId,
      dryRun: true
    });
    
    console.log('✅ Dry run completed successfully!');
    console.log('📊 Analysis Results:');
    console.log(JSON.stringify(dryRunResult.data, null, 2));
    
    // Ask user if they want to proceed with actual deletion
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise((resolve) => {
      rl.question('\n❓ Do you want to proceed with actual deletion? (yes/no): ', resolve);
    });
    
    rl.close();
    
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
      console.log('\n🗑️  Proceeding with actual deletion...');
      
      const actualResult = await httpsCallable(functions, 'removeDuplicateCompanies')({
        tenantId: testTenantId,
        dryRun: false
      });
      
      console.log('✅ Actual deletion completed successfully!');
      console.log('📊 Deletion Results:');
      console.log(JSON.stringify(actualResult.data, null, 2));
    } else {
      console.log('❌ Deletion cancelled by user.');
    }
    
  } catch (error) {
    console.error('❌ Error testing removeDuplicateCompanies:', error);
    if (error.code === 'functions/unavailable') {
      console.error('💡 Make sure the function is deployed and accessible');
    }
  }
}

// Run the test
testRemoveDuplicateCompanies(); 