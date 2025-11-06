import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const db = admin.firestore();

/**
 * Backfill location details (city, state, zipCode, coordinates) 
 * for job postings that have worksiteId but missing worksiteAddress data
 * 
 * Usage: Call this function manually from Firebase Console or client
 */
export const backfillJobPostingLocations = onCall(async (request) => {
  // Require authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated to run backfill');
  }

  // Optional: Restrict to admin users only
  // You can add additional security checks here

  const { tenantId, dryRun = true } = request.data;

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
  }

  try {
    console.log(`Starting location backfill for tenant ${tenantId} (dryRun: ${dryRun})`);

    // Get all job postings for this tenant
    const postingsRef = db.collection('tenants').doc(tenantId).collection('job_postings');
    const postingsSnapshot = await postingsRef.get();

    if (postingsSnapshot.empty) {
      return {
        success: true,
        message: 'No job postings found',
        updated: 0,
        skipped: 0,
      };
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const updates: any[] = [];

    for (const postingDoc of postingsSnapshot.docs) {
      const posting = postingDoc.data();
      const postingId = postingDoc.id;

      // Check if worksiteAddress is missing city/state
      const needsUpdate = 
        posting.worksiteId && 
        (!posting.worksiteAddress?.city || !posting.worksiteAddress?.state);

      if (!needsUpdate) {
        skippedCount++;
        console.log(`⏭️  Skipping ${postingId}: Already has city/state`);
        continue;
      }

      // Fetch location document
      try {
        const locationRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('locations')
          .doc(posting.worksiteId);
        
        const locationSnap = await locationRef.get();

        if (!locationSnap.exists) {
          console.warn(`⚠️  Location ${posting.worksiteId} not found for posting ${postingId}`);
          skippedCount++;
          continue;
        }

        const locationData = locationSnap.data() as any;
        
        // Build address object from location data
        const worksiteAddress = {
          street: locationData.address?.street || locationData.street || '',
          city: locationData.address?.city || locationData.city || '',
          state: locationData.address?.state || locationData.state || '',
          zipCode: locationData.address?.zipCode || locationData.zipCode || '',
          coordinates: locationData.address?.coordinates || locationData.coordinates || locationData.coords || undefined,
        };

        // Verify we got city and state
        if (!worksiteAddress.city || !worksiteAddress.state) {
          console.warn(`⚠️  Location ${posting.worksiteId} has no city/state for posting ${postingId}`);
          skippedCount++;
          continue;
        }

        const updateData = {
          worksiteAddress,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        updates.push({
          postingId,
          worksiteName: posting.worksiteName,
          newAddress: worksiteAddress,
        });

        if (!dryRun) {
          await postingDoc.ref.update(updateData);
          console.log(`✅ Updated ${postingId}: ${worksiteAddress.city}, ${worksiteAddress.state}`);
        } else {
          console.log(`[DRY RUN] Would update ${postingId}: ${worksiteAddress.city}, ${worksiteAddress.state}`);
        }

        updatedCount++;
      } catch (err: any) {
        console.error(`❌ Error processing ${postingId}:`, err.message);
        skippedCount++;
      }
    }

    const result = {
      success: true,
      dryRun,
      tenantId,
      total: postingsSnapshot.size,
      updated: updatedCount,
      skipped: skippedCount,
      updates: dryRun ? updates : undefined,
      message: dryRun 
        ? `DRY RUN: Would update ${updatedCount} postings, skip ${skippedCount}`
        : `Updated ${updatedCount} postings, skipped ${skippedCount}`,
    };

    console.log('Backfill complete:', result);
    return result;
  } catch (error: any) {
    console.error('Error in backfill:', error);
    throw new HttpsError('internal', error.message);
  }
});

