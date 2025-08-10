const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

async function testDealTasksDashboard() {
  try {
    console.log('🧪 Testing Deal Tasks Dashboard...');
    
    // Test parameters
    const tenantId = 'test-tenant'; // Replace with actual tenant ID
    const userId = 'test-user'; // Replace with actual user ID
    const dealId = 'test-deal'; // Replace with actual deal ID
    
    console.log('📋 Test Parameters:');
    console.log('  Tenant ID:', tenantId);
    console.log('  User ID:', userId);
    console.log('  Deal ID:', dealId);
    
    // Test 1: Check if tasks collection exists and has data
    console.log('\n🔍 Test 1: Checking tasks collection...');
    try {
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const tasksSnapshot = await getDocs(tasksRef);
      console.log('✅ Tasks collection accessible');
      console.log('📊 Found', tasksSnapshot.docs.length, 'tasks in collection');
      
      if (tasksSnapshot.docs.length > 0) {
        const sampleTask = tasksSnapshot.docs[0].data();
        console.log('📋 Sample task structure:', Object.keys(sampleTask));
      }
    } catch (error) {
      console.error('❌ Error accessing tasks collection:', error.message);
    }
    
    // Test 2: Test the getTaskDashboard function
    console.log('\n🔍 Test 2: Testing getTaskDashboard function...');
    try {
      const getTaskDashboardFunction = httpsCallable(functions, 'getTaskDashboard');
      const result = await getTaskDashboardFunction({
        userId,
        date: new Date().toISOString(),
        tenantId,
        filters: { dealId }
      });
      
      console.log('✅ getTaskDashboard function executed successfully');
      console.log('📊 Dashboard result structure:', Object.keys(result.data || {}));
      
      if (result.data) {
        console.log('📈 Today tasks:', result.data.today?.tasks?.length || 0);
        console.log('📈 This week tasks:', result.data.thisWeek?.tasks?.length || 0);
        console.log('📈 Completed tasks:', result.data.completed?.tasks?.length || 0);
      }
    } catch (error) {
      console.error('❌ Error calling getTaskDashboard:', error.message);
      console.error('❌ Error details:', error);
    }
    
    // Test 3: Test direct Firestore queries
    console.log('\n🔍 Test 3: Testing direct Firestore queries...');
    try {
      // Test the complex query that was failing
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const complexQuery = query(
        tasksRef,
        where('assignedTo', '==', userId),
        where('associations.deals', 'array-contains', dealId)
      );
      
      const complexSnapshot = await getDocs(complexQuery);
      console.log('✅ Complex query executed successfully');
      console.log('📊 Found', complexSnapshot.docs.length, 'tasks with complex filter');
      
    } catch (error) {
      console.error('❌ Error with complex query:', error.message);
      console.error('❌ This might indicate missing indexes');
    }
    
    console.log('\n✅ Deal Tasks Dashboard test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testDealTasksDashboard();
