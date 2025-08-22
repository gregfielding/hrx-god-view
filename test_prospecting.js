// Simple test script for Prospecting Hub functionality
// Run with: node test_prospecting.js

const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testProspectingFunctions() {
  console.log('🧪 Testing Prospecting Hub Functions...\n');

  try {
    // Test 1: Save a prospecting search
    console.log('1. Testing saveProspectingSearch...');
    const saveSearch = httpsCallable(functions, 'saveProspectingSearch');
    
    const saveResult = await saveSearch({
      name: 'Test Search',
      prompt: 'Find me 10 operations managers in Dallas',
      filters: {
        locations: ['Dallas'],
        industries: ['Manufacturing']
      },
      visibility: 'private',
      tenantId: 'test-tenant-id'
    });
    
    console.log('✅ Save search result:', saveResult.data);

    // Test 2: Run a prospecting search
    console.log('\n2. Testing runProspecting...');
    const runProspecting = httpsCallable(functions, 'runProspecting');
    
    const runResult = await runProspecting({
      prompt: 'Find me 5 operations managers in Dallas who might need temp workers',
      filters: {
        locations: ['Dallas'],
        minStaffingFit: 50
      },
      tenantId: 'test-tenant-id'
    });
    
    console.log('✅ Run prospecting result:', {
      resultCount: runResult.data.results?.length || 0,
      summary: runResult.data.summary
    });

    // Test 3: Add prospects to CRM
    if (runResult.data.results && runResult.data.results.length > 0) {
      console.log('\n3. Testing addProspectsToCRM...');
      const addToCRM = httpsCallable(functions, 'addProspectsToCRM');
      
      const addResult = await addToCRM({
        resultIds: [runResult.data.results[0].id],
        tenantId: 'test-tenant-id'
      });
      
      console.log('✅ Add to CRM result:', addResult.data);
    }

    // Test 4: Create call list
    if (runResult.data.results && runResult.data.results.length > 0) {
      console.log('\n4. Testing createCallList...');
      const createCallList = httpsCallable(functions, 'createCallList');
      
      const callResult = await createCallList({
        resultIds: [runResult.data.results[0].id],
        tenantId: 'test-tenant-id',
        assignTo: 'test-user-id'
      });
      
      console.log('✅ Create call list result:', callResult.data);
    }

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run the tests
testProspectingFunctions();
