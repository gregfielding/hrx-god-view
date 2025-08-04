const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Initialize Firebase Client
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
const auth = getAuth(app);

async function testUserPermissions() {
  console.log('🔍 Testing User Permissions...\n');

  // Test parameters from the URL
  const tenantId = 'p1FxjKpOq2kDjwqmYoSS';
  const companyId = 'p1FxjKpOq2kDjwqmYoSS';
  const locationId = 'nFVWtAknhsCxihFfER8Y';

  try {
    // 1. Check if user is authenticated
    console.log('1️⃣ Checking authentication...');
    const currentUser = auth.currentUser;
    console.log(`   Current user: ${currentUser ? currentUser.email : 'Not authenticated'}`);
    
    if (!currentUser) {
      console.log('   ❌ No authenticated user found');
      console.log('   💡 Try signing in with your credentials');
      return;
    }

    console.log(`   ✅ User authenticated: ${currentUser.email}`);
    console.log(`   User ID: ${currentUser.uid}`);

    // 2. Check user's tenant assignment
    console.log('\n2️⃣ Checking user tenant assignment...');
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        console.log(`   User tenantId: ${userData.tenantId || 'N/A'}`);
        console.log(`   User tenantIds:`, userData.tenantIds || 'N/A');
        console.log(`   User crm_sales flag: ${userData.crm_sales || false}`);
        console.log(`   User security level: ${userData.securityLevel || 'N/A'}`);
        
        if (userData.tenantId === tenantId) {
          console.log('   ✅ User is assigned to the correct tenant');
        } else {
          console.log('   ❌ User is not assigned to the correct tenant');
        }
      } else {
        console.log('   ❌ User document not found');
      }
    } catch (error) {
      console.log(`   ❌ Error accessing user document: ${error.message}`);
    }

    // 3. Test access to tenant document
    console.log('\n3️⃣ Testing tenant access...');
    try {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      console.log(`   Tenant exists: ${tenantDoc.exists()}`);
      if (tenantDoc.exists()) {
        console.log(`   Tenant name: ${tenantDoc.data()?.name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   ❌ Error accessing tenant: ${error.message}`);
    }

    // 4. Test access to company document
    console.log('\n4️⃣ Testing company access...');
    try {
      const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
      console.log(`   Company exists: ${companyDoc.exists()}`);
      if (companyDoc.exists()) {
        console.log(`   Company name: ${companyDoc.data()?.companyName || companyDoc.data()?.name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   ❌ Error accessing company: ${error.message}`);
    }

    // 5. Test access to location document
    console.log('\n5️⃣ Testing location access...');
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
    console.error('❌ Error during testing:', error);
  }
}

// If you want to test with a specific user, uncomment and modify this:
/*
async function signInAndTest() {
  try {
    console.log('🔐 Signing in...');
    const userCredential = await signInWithEmailAndPassword(auth, 'your-email@example.com', 'your-password');
    console.log('✅ Signed in successfully');
    await testUserPermissions();
  } catch (error) {
    console.error('❌ Sign in failed:', error.message);
  }
}

signInAndTest();
*/

testUserPermissions().then(() => {
  console.log('\n✅ Test complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
}); 