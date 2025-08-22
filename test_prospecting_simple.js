// Simple test to verify prospecting functions are accessible
// This tests the basic connectivity without requiring authentication

const https = require('https');

const PROJECT_ID = 'hrx1-d3beb';
const REGION = 'us-central1';

function testFunction(functionName) {
  return new Promise((resolve, reject) => {
    const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`;
    
    console.log(`Testing ${functionName} at: ${url}`);
    
    const req = https.get(url, (res) => {
      console.log(`✅ ${functionName}: Status ${res.statusCode}`);
      console.log(`   Headers:`, res.headers);
      resolve({ status: res.statusCode, headers: res.headers });
    });
    
    req.on('error', (error) => {
      console.log(`❌ ${functionName}: ${error.message}`);
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      console.log(`⏰ ${functionName}: Timeout`);
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function runTests() {
  console.log('🧪 Testing Prospecting Functions Connectivity...\n');
  
  const functions = [
    'runProspecting',
    'saveProspectingSearch',
    'addProspectsToCRM',
    'createCallList'
  ];
  
  for (const func of functions) {
    try {
      await testFunction(func);
    } catch (error) {
      console.error(`Failed to test ${func}:`, error.message);
    }
    console.log(''); // Empty line for readability
  }
  
  console.log('🎯 Connectivity test completed!');
}

runTests();
