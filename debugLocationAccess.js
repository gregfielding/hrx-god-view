const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

// Initialize Firebase Client (for client-side simulation)
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function debugLocationAccess() {
  console.log('🔍 Debugging Location Access Issue...\n');

  // Test parameters from the URL
  const tenantId = 'p1FxjKpOq2kDjwqmYoSS'; // From URL
  const companyId = 'p1FxjKpOq2kDjwqmYoSS'; // From URL
  const locationId = 'nFVWtAknhsCxihFfER8Y'; // From URL

  console.log('📋 Test Parameters:');
  console.log(`  Tenant ID: ${tenantId}`);
  console.log(`  Company ID: ${companyId}`);
  console.log(`  Location ID: ${locationId}\n`);

  try {
    // 1. Test if tenant exists
    console.log('1️⃣ Testing tenant access...');
    try {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      console.log(`   Tenant exists: ${tenantDoc.exists()}`);
      if (tenantDoc.exists()) {
        console.log(`   Tenant name: ${tenantDoc.data()?.name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   ❌ Error accessing tenant: ${error.message}`);
    }

    // 2. Test if company exists
    console.log('\n2️⃣ Testing company access...');
    try {
      const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
      console.log(`   Company exists: ${companyDoc.exists()}`);
      if (companyDoc.exists()) {
        console.log(`   Company name: ${companyDoc.data()?.companyName || companyDoc.data()?.name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   ❌ Error accessing company: ${error.message}`);
    }

    // 3. Test if location exists
    console.log('\n3️⃣ Testing location access...');
    try {
      const locationDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId));
      console.log(`   Location exists: ${locationDoc.exists()}`);
      if (locationDoc.exists()) {
        console.log(`   Location name: ${locationDoc.data()?.name || 'N/A'}`);
        console.log(`   Location address: ${locationDoc.data()?.address || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   ❌ Error accessing location: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Error during debugging:', error);
  }
}

debugLocationAccess().then(() => {
  console.log('\n✅ Debug complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Debug failed:', error);
  process.exit(1);
}); 