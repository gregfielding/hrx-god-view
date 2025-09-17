#!/usr/bin/env ts-node

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!projectId || !serviceAccountPath) {
  console.error('Missing required environment variables:');
  console.error('FIREBASE_PROJECT_ID:', projectId ? '✓' : '✗');
  console.error('FIREBASE_SERVICE_ACCOUNT_PATH:', serviceAccountPath ? '✓' : '✗');
  process.exit(1);
}

// Initialize Firebase Admin
const serviceAccount = require(serviceAccountPath);
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: projectId
});

const auth = getAuth(app);

async function setUserClaims() {
  const userId = 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2'; // Your user ID from the logs
  const tenantId = 'BCiP2bQ9CgVOCTfV6MhD'; // Your tenant ID from the logs
  
  try {
    console.log(`Setting claims for user ${userId}...`);
    
    // Set custom claims
    const claims = {
      hrx: true, // This makes you an HRX user
      roles: {
        [tenantId]: {
          role: 'HRX',
          securityLevel: '7'
        }
      },
      ver: 1
    };
    
    console.log('Setting claims:', JSON.stringify(claims, null, 2));
    
    await auth.setCustomUserClaims(userId, claims);
    
    console.log('✅ Claims set successfully!');
    console.log('You may need to refresh your browser or log out and back in for the changes to take effect.');
    
  } catch (error) {
    console.error('❌ Error setting claims:', error);
  }
}

setUserClaims().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
