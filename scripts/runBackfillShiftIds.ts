/**
 * Admin script to run the shiftIds backfill directly
 * This uses Firebase Admin SDK with proper permissions
 * 
 * Usage:
 *   npx ts-node scripts/runBackfillShiftIds.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccount = require('../service-account-key.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'hrx1-d3beb'
    });
  } catch (err) {
    console.log('Using Application Default Credentials');
    admin.initializeApp({
      projectId: 'hrx1-d3beb'
    });
  }
}

const db = admin.firestore();

async function runBackfill() {
  console.log('🚀 Starting backfill of shiftId/shiftIds in application documents...\n');

  let totalUsersProcessed = 0;
  let totalApplicationsChecked = 0;
  let totalApplicationsUpdated = 0;
  const errors: Array<{ applicationId: string; error: string }> = [];

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
        const selectedShifts = (appData as any).selectedShifts || [];
        
        if (selectedShifts.length === 0) {
          continue; // No shifts, skip
        }

        // Parse applicationId to get tenantId and jobId
        const firstUnderscoreIndex = appId.indexOf('_');
        if (firstUnderscoreIndex === -1) {
          console.warn(`⚠️  Invalid applicationId format: ${appId}`);
          continue;
        }

        const tenantId = appId.substring(0, firstUnderscoreIndex);
        const jobId = appId.substring(firstUnderscoreIndex + 1);

        // Build the application document path
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
          const hasShiftId = applicationDocData?.shiftId !== undefined;
          const hasShiftIds = applicationDocData?.shiftIds !== undefined;

          if (hasShiftId || hasShiftIds) {
            console.log(`✓ Application ${applicationDocId} already has shift info, skipping`);
            continue;
          }

          // Prepare update data
          const updateData: any = {};
          
          if (selectedShifts.length === 1) {
            updateData.shiftId = selectedShifts[0];
            console.log(`📝 Updating ${applicationDocId} with shiftId: ${selectedShifts[0]}`);
          } else {
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

        } catch (error: any) {
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

  } catch (error: any) {
    console.error('❌ Fatal error during backfill:', error);
    throw error;
  }
}

// Run the backfill
runBackfill()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

