const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
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
const functions = getFunctions(app, 'us-central1');

async function testDealAssociations() {
  try {
    console.log('🚀 Testing deal association functions...\n');
    
    // Test Step 1: Associate deals with salespeople
    console.log('📋 Step 1: Associating deals with salespeople...');
    const associateDealsFunction = httpsCallable(functions, 'associateDealsWithSalespeople');
    const step1Result = await associateDealsFunction({});
    console.log('✅ Step 1 completed:', step1Result.data);
    
    // Test Step 2: Create explicit associations
    console.log('\n📋 Step 2: Creating explicit associations...');
    const createAssociationsFunction = httpsCallable(functions, 'createExplicitAssociations');
    const step2Result = await createAssociationsFunction({});
    console.log('✅ Step 2 completed:', step2Result.data);
    
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testDealAssociations()
  .then(() => {
    console.log('✅ Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test script failed:', error);
    process.exit(1);
  }); 