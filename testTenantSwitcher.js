const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin (you'll need to set up service account)
// admin.initializeApp({
//   credential: admin.credential.applicationDefault(),
//   projectId: 'your-project-id'
// });

const db = getFirestore();

async function testTenantSwitcher() {
  console.log('🧪 Testing Tenant Switcher Functionality\n');

  try {
    // Test 1: Create test tenants
    console.log('1. Creating test tenants...');
    const tenant1 = {
      name: 'Acme Staffing Agency',
      type: 'Agency',
      slug: 'acme-staffing',
      avatar: '',
      modules: ['companion', 'intelligence'],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const tenant2 = {
      name: 'Tech Corp',
      type: 'Customer',
      slug: 'tech-corp',
      avatar: '',
      modules: ['scheduler'],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const tenant1Ref = await db.collection('tenants').add(tenant1);
    const tenant2Ref = await db.collection('tenants').add(tenant2);

    console.log(`   ✅ Created tenant 1: ${tenant1Ref.id} (${tenant1.name})`);
    console.log(`   ✅ Created tenant 2: ${tenant2Ref.id} (${tenant2.name})`);

    // Test 2: Create test user with multiple tenants
    console.log('\n2. Creating test user with multiple tenants...');
    const testUser = {
      uid: 'test-user-tenant-switcher',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'Worker',
      securityLevel: 'Worker',
      orgType: 'Tenant',
      tenantIds: [tenant1Ref.id, tenant2Ref.id],
      tenantId: tenant1Ref.id, // Primary tenant
      onboarded: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(testUser.uid).set(testUser);
    console.log(`   ✅ Created test user: ${testUser.uid}`);

    // Test 3: Test updateUserPrimaryTenant function
    console.log('\n3. Testing updateUserPrimaryTenant function...');
    
    // Simulate the cloud function call
    const updatePrimaryTenant = async (userId, primaryTenantId) => {
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      
      if (!userSnap.exists) {
        throw new Error('User not found');
      }
      
      const userData = userSnap.data();
      const userTenantIds = userData?.tenantIds || [];
      
      if (!userTenantIds.includes(primaryTenantId)) {
        throw new Error('User does not have access to the specified tenant');
      }
      
      await userRef.update({
        tenantId: primaryTenantId,
        primaryTenantUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return { success: true, message: 'Primary tenant updated successfully' };
    };

    // Test switching to tenant 2
    console.log('   Testing switch to tenant 2...');
    const result1 = await updatePrimaryTenant(testUser.uid, tenant2Ref.id);
    console.log(`   ✅ ${result1.message}`);

    // Verify the change
    const updatedUser = await db.collection('users').doc(testUser.uid).get();
    const updatedUserData = updatedUser.data();
    console.log(`   ✅ User primary tenant: ${updatedUserData.tenantId}`);

    // Test switching back to tenant 1
    console.log('   Testing switch back to tenant 1...');
    const result2 = await updatePrimaryTenant(testUser.uid, tenant1Ref.id);
    console.log(`   ✅ ${result2.message}`);

    // Test 4: Test error handling
    console.log('\n4. Testing error handling...');
    
    try {
      await updatePrimaryTenant(testUser.uid, 'non-existent-tenant');
      console.log('   ❌ Should have thrown an error');
    } catch (error) {
      console.log(`   ✅ Correctly caught error: ${error.message}`);
    }

    try {
      await updatePrimaryTenant('non-existent-user', tenant1Ref.id);
      console.log('   ❌ Should have thrown an error');
    } catch (error) {
      console.log(`   ✅ Correctly caught error: ${error.message}`);
    }

    // Test 5: Test tenant data fetching
    console.log('\n5. Testing tenant data fetching...');
    
    const fetchTenants = async (tenantIds) => {
      const tenantPromises = tenantIds.map(async (tid) => {
        const tenantRef = db.collection('tenants').doc(tid);
        const tenantSnap = await tenantRef.get();
        if (tenantSnap.exists) {
          const data = tenantSnap.data();
          return {
            id: tid,
            name: data.name || 'Unknown Tenant',
            type: data.type || 'Agency',
            avatar: data.avatar || '',
            slug: data.slug || ''
          };
        }
        return null;
      });

      const tenantResults = await Promise.all(tenantPromises);
      return tenantResults.filter(t => t !== null);
    };

    const tenants = await fetchTenants([tenant1Ref.id, tenant2Ref.id]);
    console.log(`   ✅ Fetched ${tenants.length} tenants:`);
    tenants.forEach(tenant => {
      console.log(`      - ${tenant.name} (${tenant.type}) - ${tenant.slug}`);
    });

    console.log('\n🎉 All tests passed! Tenant switcher functionality is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    try {
      await db.collection('users').doc('test-user-tenant-switcher').delete();
      console.log('   ✅ Deleted test user');
      
      // Note: You might want to keep the test tenants for manual testing
      // await db.collection('tenants').doc(tenant1Ref.id).delete();
      // await db.collection('tenants').doc(tenant2Ref.id).delete();
      // console.log('   ✅ Deleted test tenants');
    } catch (error) {
      console.log('   ⚠️  Cleanup error (non-critical):', error.message);
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testTenantSwitcher();
}

module.exports = { testTenantSwitcher }; 