const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs, query, where } = require('firebase/firestore');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

async function testFlexDivision() {
  console.log('🧪 Testing Flex Division Implementation...\n');

  try {
    // Test 1: Check if a tenant has hrxFlex enabled
    console.log('1. Checking tenant hrxFlex status...');
    const tenantId = 'your-tenant-id'; // Replace with actual tenant ID
    const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
    
    if (tenantDoc.exists()) {
      const tenantData = tenantDoc.data();
      console.log(`   ✅ Tenant found: ${tenantData.name}`);
      console.log(`   📊 hrxFlex enabled: ${tenantData.hrxFlex || false}`);
    } else {
      console.log('   ❌ Tenant not found');
      return;
    }

    // Test 2: Check if Flex division exists
    console.log('\n2. Checking Flex division...');
    const flexDivisionDoc = await getDoc(doc(db, 'tenants', tenantId, 'divisions', 'auto_flex'));
    
    if (flexDivisionDoc.exists()) {
      const flexData = flexDivisionDoc.data();
      console.log(`   ✅ Flex division exists: ${flexData.name}`);
      console.log(`   🏷️  System managed: ${flexData.isSystem || false}`);
      console.log(`   📋 Auto-assign rules: ${JSON.stringify(flexData.autoAssignRules)}`);
      console.log(`   👥 Member count: ${flexData.memberIds?.length || 0}`);
    } else {
      console.log('   ❌ Flex division not found');
    }

    // Test 3: Check for Flex workers
    console.log('\n3. Checking Flex workers...');
    const flexWorkersQuery = query(
      collection(db, 'users'),
      where('tenantId', '==', tenantId),
      where('securityLevel', '==', 'Flex')
    );
    
    const flexWorkersSnap = await getDocs(flexWorkersQuery);
    console.log(`   👥 Found ${flexWorkersSnap.size} Flex workers`);
    
    flexWorkersSnap.forEach(doc => {
      const worker = doc.data();
      console.log(`      - ${worker.firstName} ${worker.lastName} (${worker.email})`);
      console.log(`        Division ID: ${worker.divisionId || 'None'}`);
    });

    // Test 4: Test toggleHrxFlex function (if you want to enable/disable)
    console.log('\n4. Testing toggleHrxFlex function...');
    const toggleHrxFlex = httpsCallable(functions, 'toggleHrxFlex');
    
    // Uncomment the following lines to test enabling/disabling
    /*
    try {
      const result = await toggleHrxFlex({ 
        tenantId: tenantId, 
        enabled: true // or false to disable
      });
      console.log('   ✅ toggleHrxFlex result:', result.data);
    } catch (error) {
      console.log('   ❌ toggleHrxFlex error:', error.message);
    }
    */

    console.log('\n🎉 Flex Division test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testFlexDivision(); 