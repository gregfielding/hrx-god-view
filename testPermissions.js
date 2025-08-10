// Test script to verify Firestore permissions
// Run this in the browser console on the Deal Details page

async function testPermissions() {
  console.log('🔍 Testing Firestore Permissions');
  
  try {
    const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
    const dealId = '1xEcA2JdEdr20kjBSnKa';
    
    // Use the existing Firebase instances from the app
    const { doc, getDoc } = window.firebase.firestore;
    const db = window.firebase.firestore();
    
    console.log('📊 Testing access to different collections...');
    
    // Test 1: Access to deals
    console.log('📊 Test 1: Accessing deal document...');
    try {
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealDoc = await getDoc(dealRef);
      console.log('✅ Deal access successful:', dealDoc.exists());
      if (dealDoc.exists()) {
        console.log('📊 Deal data keys:', Object.keys(dealDoc.data()));
      }
    } catch (error) {
      console.error('❌ Deal access failed:', error.message);
    }
    
    // Test 2: Access to contacts
    console.log('📊 Test 2: Accessing contact documents...');
    try {
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', '91dVd6VmsG9FeictRMr3');
      const contactDoc = await getDoc(contactRef);
      console.log('✅ Contact access successful:', contactDoc.exists());
      if (contactDoc.exists()) {
        console.log('📊 Contact data:', contactDoc.data());
      }
    } catch (error) {
      console.error('❌ Contact access failed:', error.message);
    }
    
    // Test 3: Access to companies
    console.log('📊 Test 3: Accessing company documents...');
    try {
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', 'p1FxjKpOq2kDjwqmYoSS');
      const companyDoc = await getDoc(companyRef);
      console.log('✅ Company access successful:', companyDoc.exists());
      if (companyDoc.exists()) {
        console.log('📊 Company data keys:', Object.keys(companyDoc.data()));
      }
    } catch (error) {
      console.error('❌ Company access failed:', error.message);
    }
    
    // Test 4: Access to global users
    console.log('📊 Test 4: Accessing global user documents...');
    try {
      const userRef = doc(db, 'users', 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2');
      const userDoc = await getDoc(userRef);
      console.log('✅ Global user access successful:', userDoc.exists());
      if (userDoc.exists()) {
        console.log('📊 User data keys:', Object.keys(userDoc.data()));
      }
    } catch (error) {
      console.error('❌ Global user access failed:', error.message);
    }
    
    // Test 5: Access to tenant users
    console.log('📊 Test 5: Accessing tenant user documents...');
    try {
      const tenantUserRef = doc(db, 'tenants', tenantId, 'users', 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2');
      const tenantUserDoc = await getDoc(tenantUserRef);
      console.log('✅ Tenant user access successful:', tenantUserDoc.exists());
      if (tenantUserDoc.exists()) {
        console.log('📊 Tenant user data keys:', Object.keys(tenantUserDoc.data()));
      }
    } catch (error) {
      console.error('❌ Tenant user access failed:', error.message);
    }
    
    console.log('\n✅ Permission test completed!');
    
  } catch (error) {
    console.error('❌ Error during permission test:', error);
  }
}

// Run the test
console.log('🔍 Starting Permission Test...');
testPermissions();

// Make it available globally
window.testPermissions = testPermissions; 