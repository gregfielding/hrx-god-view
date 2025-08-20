// Test script for Gmail email capture functionality
// This script will help test the Gmail integration

const { getFunctions, httpsCallable } = require('firebase/functions');
const { initializeApp } = require('firebase/app');

// Firebase config (you'll need to replace with your actual config)
const firebaseConfig = {
  // Add your Firebase config here
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
      userId: 'YOUR_USER_ID', // Replace with actual user ID
      tenantId: 'YOUR_TENANT_ID' // Replace with actual tenant ID
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
    } else {
      console.error('❌ Test failed:', result.data.message);
    }
    
  } catch (error) {
    console.error('❌ Error testing Gmail email capture:', error);
  }
}

async function monitorGmailForContactEmails() {
  try {
    console.log('🔄 Monitoring Gmail for Contact Emails...');
    
    // Test the monitoring function
    const monitorGmailForContactEmailsFn = httpsCallable(functions, 'monitorGmailForContactEmails');
    
    const result = await monitorGmailForContactEmailsFn({
      userId: 'YOUR_USER_ID', // Replace with actual user ID
      tenantId: 'YOUR_TENANT_ID', // Replace with actual tenant ID
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
  console.log('🚀 Starting Gmail Email Capture Tests...\n');
  
  await testGmailEmailCapture();
  console.log('\n' + '='.repeat(50) + '\n');
  await monitorGmailForContactEmails();
  
  console.log('\n✅ Tests completed!');
}

// Instructions for use
console.log(`
📧 Gmail Email Capture Test Script
=====================================

To use this script:

1. Replace 'YOUR_USER_ID' with your actual Firebase user ID
2. Replace 'YOUR_TENANT_ID' with your actual tenant ID
3. Add your Firebase config to the firebaseConfig object
4. Run: node test-gmail-capture.js

This script will:
- Test the Gmail connection and email capture functionality
- Show you which emails were found and which contacts were identified
- Test the actual monitoring function that creates activity logs

Make sure you have:
- Gmail connected to your account
- At least one contact in your CRM with an email address
- Sent some emails to that contact recently

`);

// Uncomment the line below to run the tests
// runTests();
