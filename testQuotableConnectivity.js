// Test script for Quotable.io API connectivity and cloud function testing
const { getFunctions, httpsCallable } = require('firebase/functions');
const { initializeApp } = require('firebase/app');

// Firebase config (you'll need to replace with your actual config)
const firebaseConfig = {
  apiKey: "AIzaSyBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

async function testQuotableAPI() {
  try {
    console.log('🔍 Testing Quotable.io API connectivity...');
    
    // Test direct API call
    const response = await fetch('https://api.quotable.io/quotes?limit=3');
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`✅ Direct API call successful! Fetched ${data.results.length} quotes`);
    
    // Display sample quotes
    data.results.forEach((quote, index) => {
      console.log(`\n${index + 1}. "${quote.content}"`);
      console.log(`   — ${quote.author || 'Unknown'}`);
      console.log(`   Tags: ${quote.tags.join(', ')}`);
    });
    
    return true;
  } catch (error) {
    console.error('❌ Direct API test failed:', error.message);
    return false;
  }
}

async function testCloudFunction() {
  try {
    console.log('\n🚀 Testing Cloud Function...');
    
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const functions = getFunctions(app);
    
    // Test the cloud function
    const seedMotivations = httpsCallable(functions, 'seedMotivationMessagesFromAPI');
    
    console.log('Calling seedMotivationMessagesFromAPI with test parameters...');
    const result = await seedMotivations({
      page: 1,
      limit: 5,
      maxQuotes: 10
    });
    
    console.log('✅ Cloud function call successful!');
    console.log('Result:', JSON.stringify(result.data, null, 2));
    
    return true;
  } catch (error) {
    console.error('❌ Cloud function test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Starting Quotable.io Integration Tests\n');
  
  // Test 1: Direct API connectivity
  const apiTest = await testQuotableAPI();
  
  // Test 2: Cloud function (if API test passed)
  if (apiTest) {
    await testCloudFunction();
  } else {
    console.log('\n⚠️  Skipping cloud function test due to API connectivity issues');
  }
  
  console.log('\n🎉 Test suite completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testQuotableAPI, testCloudFunction }; 