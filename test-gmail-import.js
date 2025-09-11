// Simple test script to trigger Gmail email import
// This will import emails from the last 24 hours

const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase
const app = initializeApp({
  apiKey: "AIzaSyBvQvQvQvQvQvQvQvQvQvQvQvQvQvQvQvQ",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456789"
});

const functions = getFunctions(app, 'us-central1');

async function testGmailImport() {
  try {
    console.log('🔄 Testing Gmail email import...');
    
    // Test the backfillGmailEmails function (last 24 hours)
    const backfillGmailEmails = httpsCallable(functions, 'backfillGmailEmails');
    
    const result = await backfillGmailEmails({ 
      hours: 24 
    });
    
    console.log('✅ Gmail import result:', result.data);
    
  } catch (error) {
    console.error('❌ Error testing Gmail import:', error);
  }
}

// Run the test
testGmailImport();
