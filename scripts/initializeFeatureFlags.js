/**
 * Script to initialize feature flags for a tenant
 * Usage: node scripts/initializeFeatureFlags.js <tenantId>
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function initializeFeatureFlags(tenantId) {
  try {
    console.log(`Initializing feature flags for tenant: ${tenantId}`);
    
    const configRef = db.collection('tenants').doc(tenantId).collection('settings').doc('config');
    
    // Check if config document already exists
    const configDoc = await configRef.get();
    
    if (configDoc.exists) {
      console.log('Config document already exists. Current flags:');
      const data = configDoc.data();
      console.log(JSON.stringify(data.flags || {}, null, 2));
      
      // Ask if user wants to update
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise((resolve) => {
        rl.question('Do you want to update the flags? (y/n): ', resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'y') {
        console.log('Operation cancelled.');
        return;
      }
    }
    
    // Set the feature flags
    const flags = {
      NEW_DATA_MODEL: false, // Start with false for safety
      // Add other feature flags here as needed
    };
    
    await configRef.set({
      flags,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log('✅ Feature flags initialized successfully!');
    console.log('Flags set:', JSON.stringify(flags, null, 2));
    console.log(`\nTo toggle the NEW_DATA_MODEL flag, update the document at:`);
    console.log(`tenants/${tenantId}/settings/config`);
    console.log(`\nOr use the FeatureFlagTest component in the UI.`);
    
  } catch (error) {
    console.error('❌ Error initializing feature flags:', error);
    process.exit(1);
  }
}

// Get tenant ID from command line arguments
const tenantId = process.argv[2];

if (!tenantId) {
  console.error('❌ Please provide a tenant ID as an argument');
  console.log('Usage: node scripts/initializeFeatureFlags.js <tenantId>');
  process.exit(1);
}

// Run the initialization
initializeFeatureFlags(tenantId)
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
