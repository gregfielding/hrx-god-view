import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface BackfillResult {
  success: boolean;
  totalUsersProcessed: number;
  totalApplicationsChecked: number;
  totalApplicationsUpdated: number;
  errors: Array<{ applicationId: string; error: string }>;
  message?: string;
}

/**
 * Backfill function to add shiftId/shiftIds to existing application documents
 * 
 * This function reads shift information from users' applicationData map
 * and writes it to the corresponding application documents in Firestore.
 * 
 * Usage:
 *   - Call from Firebase Console or via HTTP callable function
 *   - No parameters required - processes all users
 */
export const backfillShiftIdsInApplications = onCall({
  cors: true,
  maxInstances: 1,
  timeoutSeconds: 540, // 9 minutes for large datasets
  memory: '512MiB'
}, async (request): Promise<BackfillResult> => {
  try {
    // Allow admin bypass for one-time backfill (remove after use)
    const { adminKey } = request.data || {};
    const expectedAdminKey = process.env.ADMIN_BACKFILL_KEY || 'temporary-backfill-key-2025';
    
    // Check if user is authenticated OR has admin key
    if (!request.auth && adminKey !== expectedAdminKey) {
      throw new HttpsError('unauthenticated', 'Authentication required or valid admin key');
    }
    
    console.log('🚀 Starting backfill of shiftId/shiftIds in application documents...\n');

    let totalUsersProcessed = 0;
    let totalApplicationsChecked = 0;
    let totalApplicationsUpdated = 0;
    const errors: Array<{ applicationId: string; error: string }> = [];

    // Get all users
    const usersSnapshot = await db.collection('users').get();
    console.log(`📊 Found ${usersSnapshot.size} users to process\n`);

    let currentBatch = db.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500; // Firestore batch limit

    const commitBatch = async () => {
      if (batchCount > 0) {
        await currentBatch.commit();
        console.log(`✅ Committed batch of ${batchCount} updates`);
        batchCount = 0;
        currentBatch = db.batch(); // Create new batch after commit
      }
    };

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
          const hasShiftId = applicationDocData?.shiftId !== undefined;
          const hasShiftIds = applicationDocData?.shiftIds !== undefined;

          if (hasShiftId || hasShiftIds) {
            console.log(`✓ Application ${applicationDocId} already has shift info, skipping`);
            continue;
          }

          // Prepare update data
          const updateData: any = {};
          
          if (selectedShifts.length === 1) {
            // Single shift - use shiftId
            updateData.shiftId = selectedShifts[0];
            console.log(`📝 Updating ${applicationDocId} with shiftId: ${selectedShifts[0]}`);
          } else {
            // Multiple shifts - use shiftIds array
            updateData.shiftIds = selectedShifts;
            console.log(`📝 Updating ${applicationDocId} with shiftIds: [${selectedShifts.join(', ')}]`);
          }

          // Add to batch
          currentBatch.update(applicationRef, {
            ...updateData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          batchCount++;
          totalApplicationsUpdated++;

          // Commit batch if we've reached the limit
          if (batchCount >= BATCH_SIZE) {
            await commitBatch();
          }

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

    // Commit any remaining batch operations
    await commitBatch();

    // Summary
    const result: BackfillResult = {
      success: true,
      totalUsersProcessed,
      totalApplicationsChecked,
      totalApplicationsUpdated,
      errors,
      message: `Backfill complete: ${totalApplicationsUpdated} applications updated, ${errors.length} errors`
    };

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

    return result;

  } catch (error: any) {
    console.error('❌ Fatal error during backfill:', error);
    throw new HttpsError('internal', `Backfill failed: ${error.message}`);
  }
});

