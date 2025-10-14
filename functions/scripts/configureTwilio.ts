#!/usr/bin/env ts-node

/**
 * Twilio Configuration Helper Script
 * Helps set up Firebase Functions config for Twilio integration
 */

import * as admin from 'firebase-admin';
import twilio from 'twilio';
import * as readline from 'readline';

// Initialize Firebase Admin (you may need to set GOOGLE_APPLICATION_CREDENTIALS)
if (!admin.apps.length) {
  admin.initializeApp();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function configureTwilio() {
  console.log('🔧 Twilio Configuration Helper');
  console.log('================================\n');

  try {
    // Get Twilio credentials
    console.log('Please provide your Twilio credentials:');
    const accountSid = await question('Account SID (starts with AC...): ');
    const authToken = await question('Auth Token: ');
    const verifyServiceSid = await question('Verify Service SID (starts with VA...): ');
    const messagingPhoneNumber = await question('Messaging Phone Number (E.164 format, e.g., +17025550147): ');

    // Validate inputs
    if (!accountSid.startsWith('AC')) {
      throw new Error('Account SID must start with "AC"');
    }

    if (!verifyServiceSid.startsWith('VA')) {
      throw new Error('Verify Service SID must start with "VA"');
    }

    if (!messagingPhoneNumber.startsWith('+')) {
      throw new Error('Phone number must be in E.164 format (e.g., +17025550147)');
    }

    // Test Twilio connection
    console.log('\n🧪 Testing Twilio connection...');
    const client = twilio(accountSid, authToken);
    
    try {
      // Test by fetching account info
      await client.api.accounts(accountSid).fetch();
      console.log('✅ Twilio connection successful');
    } catch (error: any) {
      throw new Error(`Twilio connection failed: ${error.message}`);
    }

    // Test Verify Service
    console.log('🧪 Testing Verify Service...');
    try {
      await client.verify.v2.services(verifyServiceSid).fetch();
      console.log('✅ Verify Service accessible');
    } catch (error: any) {
      throw new Error(`Verify Service test failed: ${error.message}`);
    }

    // Test phone number
    console.log('🧪 Testing phone number...');
    try {
      await client.incomingPhoneNumbers.list({ phoneNumber: messagingPhoneNumber });
      console.log('✅ Phone number accessible');
    } catch (error: any) {
      console.log('⚠️  Phone number test failed - ensure you own this number in Twilio');
    }

    // Confirm before setting config
    const confirm = await question('\n📝 Set these values in Firebase Functions config? (y/N): ');
    
    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      console.log('\n🔧 Setting Firebase Functions config...');
      
      // Note: This would require Firebase CLI to be installed and authenticated
      console.log('Run these commands to set the config:');
      console.log('');
      console.log('firebase functions:config:set \\');
      console.log(`  twilio.accountsid="${accountSid}" \\`);
      console.log(`  twilio.authtoken="${authToken}" \\`);
      console.log(`  twilio.verifyservicesid="${verifyServiceSid}" \\`);
      console.log(`  twilio.messagingphonenumber="${messagingPhoneNumber}"`);
      console.log('');
      console.log('firebase deploy --only functions');
      console.log('');
      
      console.log('✅ Configuration ready!');
      console.log('');
      console.log('📋 Next steps:');
      console.log('1. Run the Firebase config commands above');
      console.log('2. Deploy the functions: firebase deploy --only functions');
      console.log('3. Test phone verification in your app');
      console.log('4. Ensure A2P 10DLC is configured for production SMS');
    } else {
      console.log('❌ Configuration cancelled');
    }

  } catch (error: any) {
    console.error('❌ Configuration failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the configuration
if (require.main === module) {
  configureTwilio().catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { configureTwilio };
