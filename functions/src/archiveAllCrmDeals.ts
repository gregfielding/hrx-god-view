import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ArchiveResult {
  success: boolean;
  tenantId: string;
  totalDeals: number;
  dealsArchived: number;
  dealsSkipped: number;
  errors: Array<{ dealId: string; error: string }>;
  message?: string;
}

/**
 * Archive all existing CRM deals for a tenant
 * 
 * This function sets archived: true on all deals in tenants/{tenantId}/crm_deals
 * to allow for a clean start in the CRM.
 * 
 * Usage:
 *   - Call from Firebase Console or via HTTP callable function
 *   - Requires tenantId parameter
 */
export const archiveAllCrmDeals = onCall({
  cors: true,
  maxInstances: 1,
  timeoutSeconds: 540, // 9 minutes for large datasets
  memory: '512MiB'
}, async (request): Promise<ArchiveResult> => {
  try {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { tenantId } = request.data || {};
    
    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }

    console.log(`🚀 Starting archive of all CRM deals for tenant: ${tenantId}\n`);

    let totalDeals = 0;
    let dealsArchived = 0;
    let dealsSkipped = 0;
    const errors: Array<{ dealId: string; error: string }> = [];

    // Get all deals for this tenant
    const dealsRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('crm_deals');
    
    const dealsSnapshot = await dealsRef.get();
    totalDeals = dealsSnapshot.size;
    console.log(`📊 Found ${totalDeals} deals to process\n`);

    if (totalDeals === 0) {
      return {
        success: true,
        tenantId,
        totalDeals: 0,
        dealsArchived: 0,
        dealsSkipped: 0,
        errors: [],
        message: 'No deals found to archive'
      };
    }

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

    for (const dealDoc of dealsSnapshot.docs) {
      const dealId = dealDoc.id;
      const dealData = dealDoc.data();

      try {
        // Skip if already archived
        if (dealData.archived === true) {
          dealsSkipped++;
          console.log(`⏭️  Deal ${dealId} already archived, skipping`);
          continue;
        }

        // Update deal with archived: true
        const dealRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('crm_deals')
          .doc(dealId);
        currentBatch.update(dealRef, {
          archived: true,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          archivedBy: request.auth.uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        batchCount++;
        dealsArchived++;

        // Commit batch if we've reached the limit
        if (batchCount >= BATCH_SIZE) {
          await commitBatch();
        }

        // Progress update every 50 deals
        if (dealsArchived % 50 === 0) {
          console.log(`\n📊 Progress: ${dealsArchived}/${totalDeals} deals archived\n`);
        }

      } catch (error: any) {
        const errorMsg = `❌ Error archiving deal ${dealId}: ${error.message}`;
        console.error(errorMsg);
        errors.push({
          dealId,
          error: error.message
        });
      }
    }

    // Commit any remaining batch operations
    await commitBatch();

    // Summary
    const result: ArchiveResult = {
      success: true,
      tenantId,
      totalDeals,
      dealsArchived,
      dealsSkipped,
      errors,
      message: `Archive complete: ${dealsArchived} deals archived, ${dealsSkipped} already archived, ${errors.length} errors`
    };

    console.log('\n' + '='.repeat(60));
    console.log('✅ ARCHIVE COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Total deals: ${totalDeals}`);
    console.log(`✅ Deals archived: ${dealsArchived}`);
    console.log(`⏭️  Deals skipped (already archived): ${dealsSkipped}`);
    console.log(`❌ Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((err, index) => {
        console.log(`  ${index + 1}. ${err.dealId}: ${err.error}`);
      });
    }

    return result;

  } catch (error: any) {
    console.error('❌ Fatal error during archive:', error);
    throw new HttpsError('internal', `Archive failed: ${error.message}`);
  }
});
