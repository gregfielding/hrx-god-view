const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, limit } = require('firebase/firestore');

// Firebase config for HRX God View
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testKPISystem(tenantId) {
  console.log(`🧪 Testing KPI System for tenant: ${tenantId}`);
  
  try {
    // Test 1: Check KPI Definitions
    console.log('\n1. Testing KPI Definitions...');
    const kpiDefinitionsQuery = query(
      collection(db, 'tenants', tenantId, 'kpi_definitions'),
      limit(5)
    );
    const kpiDefinitionsSnapshot = await getDocs(kpiDefinitionsQuery);
    
    if (kpiDefinitionsSnapshot.empty) {
      console.log('❌ No KPI definitions found');
    } else {
      console.log(`✅ Found ${kpiDefinitionsSnapshot.size} KPI definitions`);
      kpiDefinitionsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.name} (${data.category}, ${data.type})`);
      });
    }
    
    // Test 2: Check KPI Assignments
    console.log('\n2. Testing KPI Assignments...');
    const kpiAssignmentsQuery = query(
      collection(db, 'tenants', tenantId, 'kpi_assignments'),
      limit(5)
    );
    const kpiAssignmentsSnapshot = await getDocs(kpiAssignmentsQuery);
    
    if (kpiAssignmentsSnapshot.empty) {
      console.log('❌ No KPI assignments found');
    } else {
      console.log(`✅ Found ${kpiAssignmentsSnapshot.size} KPI assignments`);
      kpiAssignmentsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.salespersonName} assigned to KPI ${data.kpiId}`);
      });
    }
    
    // Test 3: Check KPI Tracking
    console.log('\n3. Testing KPI Tracking...');
    const kpiTrackingQuery = query(
      collection(db, 'tenants', tenantId, 'kpi_tracking'),
      limit(5)
    );
    const kpiTrackingSnapshot = await getDocs(kpiTrackingQuery);
    
    if (kpiTrackingSnapshot.empty) {
      console.log('❌ No KPI tracking records found');
    } else {
      console.log(`✅ Found ${kpiTrackingSnapshot.size} KPI tracking records`);
      kpiTrackingSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.currentValue}/${data.targetValue} (${data.percentageComplete}%)`);
      });
    }
    
    // Test 4: Check KPI Activities
    console.log('\n4. Testing KPI Activities...');
    const kpiActivitiesQuery = query(
      collection(db, 'tenants', tenantId, 'kpi_activities'),
      limit(5)
    );
    const kpiActivitiesSnapshot = await getDocs(kpiActivitiesQuery);
    
    if (kpiActivitiesSnapshot.empty) {
      console.log('❌ No KPI activities found');
    } else {
      console.log(`✅ Found ${kpiActivitiesSnapshot.size} KPI activities`);
      kpiActivitiesSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.activityType}: ${data.description}`);
      });
    }
    
    // Test 5: Check AI Task Suggestions
    console.log('\n5. Testing AI Task Suggestions...');
    const kpiSuggestionsQuery = query(
      collection(db, 'tenants', tenantId, 'kpi_task_suggestions'),
      limit(5)
    );
    const kpiSuggestionsSnapshot = await getDocs(kpiSuggestionsQuery);
    
    if (kpiSuggestionsSnapshot.empty) {
      console.log('❌ No AI task suggestions found');
    } else {
      console.log(`✅ Found ${kpiSuggestionsSnapshot.size} AI task suggestions`);
      kpiSuggestionsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.title} (${data.type}, ${data.priority})`);
      });
    }
    
    // Test 6: Check Salespeople
    console.log('\n6. Testing Salespeople...');
    const salespeopleQuery = query(
      collection(db, 'tenants', tenantId, 'crm_contacts'),
      where('role', '==', 'salesperson'),
      limit(5)
    );
    const salespeopleSnapshot = await getDocs(salespeopleQuery);
    
    if (salespeopleSnapshot.empty) {
      console.log('❌ No salespeople found');
    } else {
      console.log(`✅ Found ${salespeopleSnapshot.size} salespeople`);
      salespeopleSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.fullName || `${data.firstName} ${data.lastName}`}`);
      });
    }
    
    console.log('\n🎉 KPI System Test Completed!');
    
  } catch (error) {
    console.error('❌ Error testing KPI system:', error);
    throw error;
  }
}

// Function to get all tenants
async function getAllTenants() {
  const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
  const tenants = [];
  
  tenantsSnapshot.forEach(doc => {
    tenants.push({
      id: doc.id,
      ...doc.data()
    });
  });
  
  return tenants;
}

// Main execution function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node testKPISystem.js <tenantId>');
    console.log('Or: node testKPISystem.js --all (to test all tenants)');
    return;
  }
  
  if (args[0] === '--all') {
    console.log('Testing KPI system for all tenants...');
    const tenants = await getAllTenants();
    
    for (const tenant of tenants) {
      console.log(`\n=== Testing tenant: ${tenant.name || tenant.id} ===`);
      try {
        await testKPISystem(tenant.id);
      } catch (error) {
        console.error(`Failed to test KPI system for tenant ${tenant.id}:`, error);
      }
    }
  } else {
    const tenantId = args[0];
    await testKPISystem(tenantId);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testKPISystem }; 