const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxJjAo_dTMQj5ooC2HCl6xX2XZDzSXZ68",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testHeadquartersDebug() {
  try {
    console.log('🔍 Testing headquarters location creation...');
    
    // You'll need to replace these with actual values from your company
    const tenantId = 'BCiP2bQ9CgVOCTfV6MhD'; // Replace with your tenant ID
    const companyId = 'KrmYgyP4WdsEzbtzc9MB'; // Replace with your company ID
    
    console.log('Testing with:', { tenantId, companyId });
    
    // Test the manual headquarters creation function in test mode
    const createHeadquartersLocation = httpsCallable(functions, 'createHeadquartersLocation');
    
    const result = await createHeadquartersLocation({
      tenantId,
      companyId,
      testMode: true
    });
    
    console.log('✅ Test result:', JSON.stringify(result.data, null, 2));
    
    // If test mode shows Apollo data exists, try creating the location
    if (result.data.success && result.data.headquartersData) {
      console.log('\n🔧 Apollo data found! Attempting to create headquarters location...');
      
      const createResult = await createHeadquartersLocation({
        tenantId,
        companyId,
        testMode: false
      });
      
      console.log('✅ Creation result:', JSON.stringify(createResult.data, null, 2));
    } else {
      console.log('\n❌ No Apollo headquarters data found. Check the company enrichment process.');
    }
    
  } catch (error) {
    console.error('❌ Error testing headquarters creation:', error);
  }
}

// Run the test
testHeadquartersDebug();
