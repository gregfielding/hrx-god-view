// Test script for debugging Gmail email capture functionality
const { getFunctions, httpsCallable } = require('firebase/functions');
const { initializeApp } = require('firebase/app');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testGmailEmailCapture() {
  try {
    console.log('🧪 Testing Gmail Email Capture...');
    
    // Test the Gmail email capture function
    const testGmailEmailCaptureFn = httpsCallable(functions, 'testGmailEmailCapture');
    
    const result = await testGmailEmailCaptureFn({
      userId: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2', // Your user ID
      tenantId: 'BC1PZBQ9qGCVCTV6MND' // Your tenant ID
    });
    
    console.log('✅ Test Results:', result.data);
    
    if (result.data.success) {
      console.log(`📧 Found ${result.data.totalMessagesFound} sent messages`);
      console.log(`👥 Found ${result.data.testResults.reduce((sum, r) => sum + (r.contactsFound || 0), 0)} contacts`);
      
      // Show detailed results
      result.data.testResults.forEach((testResult, index) => {
        console.log(`\n📨 Message ${index + 1}:`);
        console.log(`   Subject: ${testResult.subject}`);
        console.log(`   Date: ${testResult.date}`);
        console.log(`   Recipients: ${testResult.recipients.join(', ')}`);
        console.log(`   Contacts Found: ${testResult.contactsFound}`);
        
        if (testResult.contacts && testResult.contacts.length > 0) {
          console.log(`   Contact Details:`);
          testResult.contacts.forEach(contact => {
            console.log(`     - ${contact.name} (${contact.email})`);
          });
        }
      });
      
      // Show all contacts in tenant
      console.log('\n🔍 All contacts in tenant:');
      result.data.allContacts.forEach(contact => {
        console.log(`   - ${contact.name} (${contact.email})`);
      });
    } else {
      console.error('❌ Test failed:', result.data.message);
    }
    
  } catch (error) {
    console.error('❌ Error testing Gmail email capture:', error);
  }
}

async function monitorGmailForContactEmails() {
  try {
    console.log('\n🔄 Monitoring Gmail for Contact Emails...');
    
    // Test the monitoring function
    const monitorGmailForContactEmailsFn = httpsCallable(functions, 'monitorGmailForContactEmails');
    
    const result = await monitorGmailForContactEmailsFn({
      userId: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2', // Your user ID
      tenantId: 'BC1PZBQ9qGCVCTV6MND', // Your tenant ID
      maxResults: 10
    });
    
    console.log('✅ Monitoring Results:', result.data);
    
    if (result.data.success) {
      console.log(`📧 Processed ${result.data.processedCount} emails`);
      console.log(`📝 Created ${result.data.activityLogsCreated} activity logs`);
    } else {
      console.error('❌ Monitoring failed:', result.data.message);
    }
    
  } catch (error) {
    console.error('❌ Error monitoring Gmail:', error);
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Starting Gmail Email Capture Debug Tests...\n');
  
  await testGmailEmailCapture();
  await monitorGmailForContactEmails();
  
  console.log('\n✅ Debug tests completed!');
}

runTests().catch(console.error);
