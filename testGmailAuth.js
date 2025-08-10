const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
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
const functions = getFunctions(app);

async function testGmailAuth() {
  try {
    console.log('🧪 Testing Gmail Authentication...');
    
    const authenticateGmailFn = httpsCallable(functions, 'authenticateGmail');
    
    const result = await authenticateGmailFn({ 
      tenantId: 'hrx1-d3beb' // Use the project ID as tenant ID for testing
    });
    
    console.log('✅ Gmail Auth Result:', result.data);
    
    if (result.data.error) {
      console.log('❌ Gmail Auth Error:', result.data.message);
      if (result.data.setupInstructions) {
        console.log('📋 Setup Instructions:');
        result.data.setupInstructions.forEach((instruction, index) => {
          console.log(`   ${index + 1}. ${instruction}`);
        });
      }
    } else if (result.data.authUrl) {
      console.log('🔗 Auth URL received successfully');
      console.log('   URL:', result.data.authUrl);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('   Error code:', error.code);
    console.error('   Error message:', error.message);
  }
}

testGmailAuth(); 