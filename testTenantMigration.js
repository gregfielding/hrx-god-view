const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs, query, where } = require('firebase/firestore');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testTenantMigration() {
  console.log('🧪 Testing Tenant Migration...\n');

  try {
    // Test 1: Check if tenants collection exists and has data
    console.log('1. Testing tenants collection...');
    const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
    console.log(`   Found ${tenantsSnapshot.size} tenants`);
    
    if (tenantsSnapshot.size > 0) {
      const firstTenant = tenantsSnapshot.docs[0];
      console.log(`   Sample tenant: ${firstTenant.data().name} (${firstTenant.id})`);
      
      // Check if tenant has customers array
      const tenantData = firstTenant.data();
      if (tenantData.customers && Array.isArray(tenantData.customers)) {
        console.log(`   ✅ Tenant has customers array with ${tenantData.customers.length} customers`);
      } else {
        console.log('   ⚠️  Tenant does not have customers array');
      }
    }

    // Test 2: Check if users have tenantIds
    console.log('\n2. Testing user tenantIds...');
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let usersWithTenantIds = 0;
    let usersWithAgencyId = 0;
    let usersWithCustomerId = 0;
    
    usersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.tenantIds && Array.isArray(data.tenantIds)) {
        usersWithTenantIds++;
      }
      if (data.agencyId) {
        usersWithAgencyId++;
      }
      if (data.customerId) {
        usersWithCustomerId++;
      }
    });
    
    console.log(`   Users with tenantIds: ${usersWithTenantIds}`);
    console.log(`   Users with agencyId (legacy): ${usersWithAgencyId}`);
    console.log(`   Users with customerId (legacy): ${usersWithCustomerId}`);

    // Test 3: Check if jobOrders have tenantId
    console.log('\n3. Testing jobOrders tenantId...');
    const jobOrdersSnapshot = await getDocs(collection(db, 'jobOrders'));
    let jobOrdersWithTenantId = 0;
    let jobOrdersWithAgencyId = 0;
    
    jobOrdersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.tenantId) {
        jobOrdersWithTenantId++;
      }
      if (data.agencyId) {
        jobOrdersWithAgencyId++;
      }
    });
    
    console.log(`   Job orders with tenantId: ${jobOrdersWithTenantId}`);
    console.log(`   Job orders with agencyId (legacy): ${jobOrdersWithAgencyId}`);

    // Test 4: Check if assignments have tenantId
    console.log('\n4. Testing assignments tenantId...');
    const assignmentsSnapshot = await getDocs(collection(db, 'assignments'));
    let assignmentsWithTenantId = 0;
    let assignmentsWithAgencyId = 0;
    
    assignmentsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.tenantId) {
        assignmentsWithTenantId++;
      }
      if (data.agencyId) {
        assignmentsWithAgencyId++;
      }
    });
    
    console.log(`   Assignments with tenantId: ${assignmentsWithTenantId}`);
    console.log(`   Assignments with agencyId (legacy): ${assignmentsWithAgencyId}`);

    // Test 5: Check if customers have tenantId
    console.log('\n5. Testing customers tenantId...');
    const customersSnapshot = await getDocs(collection(db, 'customers'));
    let customersWithTenantId = 0;
    let customersWithAgencyId = 0;
    
    customersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.tenantId) {
        customersWithTenantId++;
      }
      if (data.agencyId) {
        customersWithAgencyId++;
      }
    });
    
    console.log(`   Customers with tenantId: ${customersWithTenantId}`);
    console.log(`   Customers with agencyId (legacy): ${customersWithAgencyId}`);

    // Test 6: Check Firestore rules
    console.log('\n6. Testing Firestore rules...');
    console.log('   ⚠️  Manual verification needed - check firestore.rules file');
    console.log('   Expected: tenants collection with proper security rules');

    console.log('\n✅ Tenant migration test completed!');
    console.log('\n📋 Summary:');
    console.log(`   - Tenants: ${tenantsSnapshot.size}`);
    console.log(`   - Users migrated: ${usersWithTenantIds}/${usersSnapshot.size}`);
    console.log(`   - Job orders migrated: ${jobOrdersWithTenantId}/${jobOrdersSnapshot.size}`);
    console.log(`   - Assignments migrated: ${assignmentsWithTenantId}/${assignmentsSnapshot.size}`);
    console.log(`   - Customers migrated: ${customersWithTenantId}/${customersSnapshot.size}`);

  } catch (error) {
    console.error('❌ Error testing tenant migration:', error);
  }
}

// Run the test
testTenantMigration(); 