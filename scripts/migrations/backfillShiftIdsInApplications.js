/**
 * Backfill Script: Add shiftId/shiftIds to Application Documents
 * 
 * This script updates existing application documents to include shiftId/shiftIds
 * by reading from users' applicationData map and writing to the application document.
 * 
 * Usage:
 *   node scripts/migrations/backfillShiftIdsInApplications.js
 * 
 * This will:
 * 1. Query all users with applicationData
 * 2. For each application in applicationData that has selectedShifts
 * 3. Update the corresponding application document with shiftId/shiftIds
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Try to find service account key or use application default credentials
let credential;
const possibleKeyPaths = [
  path.join(__dirname, '..', '..', 'service-account-key.json'),
  path.join(__dirname, '..', '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', '..', 'firebase-adminsdk.json'),
  process.env.GOOGLE_APPLICATION_CREDENTIALS
].filter(Boolean);

for (const keyPath of possibleKeyPaths) {
  if (keyPath && fs.existsSync(keyPath)) {
    console.log(`🔑 Using service account key: ${keyPath}`);
    const serviceAccount = require(keyPath);
    credential = admin.credential.cert(serviceAccount);
    break;
  }
}

if (!credential) {
  console.log('🔑 Using application default credentials');
  credential = admin.credential.applicationDefault();
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential,
    projectId: 'hrx1-d3beb' // Specify project ID
  });
} catch (e) {
  if (e.code === 'app/duplicate-app') {
    console.log('ℹ️  Admin SDK already initialized');
  } else {
    throw e;
  }
}

const db = admin.firestore();

async function backfillShiftIdsInApplications() {
  console.log('🚀 Starting backfill of shiftId/shiftIds in application documents...\n');

  let totalUsersProcessed = 0;
  let totalApplicationsChecked = 0;
  let totalApplicationsUpdated = 0;
  let errors = [];

  try {
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    console.log(`📊 Found ${usersSnapshot.size} users to process\n`);

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      
      // Check if user has applicationData
      const applicationData = userData.applicationData || {};
      const applicationIds = userData.applicationIds || [];

      if (Object.keys(applicationData).length === 0) {
        continue;
      }

      totalUsersProcessed++;

      // Process each application in applicationData
      for (const [appId, appData] of Object.entries(applicationData)) {
        totalApplicationsChecked++;

        // Check if this application has shift information
        const selectedShifts = appData.selectedShifts || [];
        
        if (selectedShifts.length === 0) {
          continue; // No shifts, skip
        }

        // Parse applicationId to get tenantId and jobId
        // Format: {tenantId}_{jobId}
        const firstUnderscoreIndex = appId.indexOf('_');
        if (firstUnderscoreIndex === -1) {
          console.warn(`⚠️  Invalid applicationId format: ${appId}`);
          continue;
        }

        const tenantId = appId.substring(0, firstUnderscoreIndex);
        const jobId = appId.substring(firstUnderscoreIndex + 1);

        // Build the application document path
        // Path: tenants/{tenantId}/applications/{userId}_{jobId}
        const applicationDocId = `${userId}_${jobId}`;
        const applicationRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('applications')
          .doc(applicationDocId);

        try {
          // Check if application document exists
          const applicationDoc = await applicationRef.get();
          
          if (!applicationDoc.exists) {
            console.warn(`⚠️  Application document not found: ${applicationDocId} (from ${appId})`);
            continue;
          }

          const applicationDocData = applicationDoc.data();
          
          // Check if shiftId/shiftIds already exist
          const hasShiftId = applicationDocData.shiftId !== undefined;
          const hasShiftIds = applicationDocData.shiftIds !== undefined;

          if (hasShiftId || hasShiftIds) {
            console.log(`✓ Application ${applicationDocId} already has shift info, skipping`);
            continue;
          }

          // Prepare update data
          const updateData = {};
          
          if (selectedShifts.length === 1) {
            // Single shift - use shiftId
            updateData.shiftId = selectedShifts[0];
            console.log(`📝 Updating ${applicationDocId} with shiftId: ${selectedShifts[0]}`);
          } else {
            // Multiple shifts - use shiftIds array
            updateData.shiftIds = selectedShifts;
            console.log(`📝 Updating ${applicationDocId} with shiftIds: [${selectedShifts.join(', ')}]`);
          }

          // Update the application document
          await applicationRef.update({
            ...updateData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          totalApplicationsUpdated++;
          console.log(`✅ Updated application ${applicationDocId}\n`);

        } catch (error) {
          const errorMsg = `❌ Error updating application ${applicationDocId}: ${error.message}`;
          console.error(errorMsg);
          errors.push({
            applicationId: applicationDocId,
            error: error.message
          });
        }
      }

      // Progress update every 10 users
      if (totalUsersProcessed % 10 === 0) {
        console.log(`\n📊 Progress: ${totalUsersProcessed} users processed, ${totalApplicationsUpdated} applications updated\n`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Users processed: ${totalUsersProcessed}`);
    console.log(`📊 Applications checked: ${totalApplicationsChecked}`);
    console.log(`✅ Applications updated: ${totalApplicationsUpdated}`);
    console.log(`❌ Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((err, index) => {
        console.log(`  ${index + 1}. ${err.applicationId}: ${err.error}`);
      });
    }

    console.log('\n');

  } catch (error) {
    console.error('❌ Fatal error during backfill:', error);
    process.exit(1);
  }
}

// Run the backfill
backfillShiftIdsInApplications()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

