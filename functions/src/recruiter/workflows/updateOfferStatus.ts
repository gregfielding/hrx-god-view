import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Schema for updating offer status
const UpdateOfferStatusSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  offerId: z.string().min(1, 'Offer ID is required'),
  status: z.enum(['accepted', 'rejected', 'expired', 'withdrawn']),
  responseNotes: z.string().optional(),
  acceptedBy: z.string().optional(), // User ID who accepted/rejected
});

export const updateOfferStatus = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    const { data } = request;
    const { tenantId, offerId, status, responseNotes, acceptedBy } = UpdateOfferStatusSchema.parse(data);

    // Get the offer
    const offerRef = doc(db, 'tenants', tenantId, 'recruiter_offers', offerId);
    const offerDoc = await offerRef.get();
    
    if (!offerDoc.exists) {
      throw new Error('Offer not found');
    }

    const offerData = offerDoc.data();
    if (!offerData) {
      throw new Error('Offer data not found');
    }

    // Check if offer is already in a final state
    if (['accepted', 'rejected', 'expired', 'withdrawn'].includes(offerData.status)) {
      throw new Error(`Offer is already ${offerData.status}`);
    }

    // Check if offer has expired
    if (offerData.expiresAt && Date.now() > offerData.expiresAt && status !== 'expired') {
      throw new Error('Offer has expired');
    }

    // Update the offer
    const updateData: any = {
      status,
      updatedAt: Date.now(),
      respondedAt: Date.now(),
      responseNotes: responseNotes || null,
    };

    // Set status-specific timestamps
    if (status === 'accepted') {
      updateData.acceptedAt = Date.now();
      updateData.acceptedBy = acceptedBy || null;
    } else if (status === 'rejected') {
      updateData.rejectedAt = Date.now();
      updateData.rejectedBy = acceptedBy || null;
    }

    await offerRef.update(updateData);

    // Update candidate status based on offer response
    const candidateRef = doc(db, 'tenants', tenantId, 'recruiter_candidates', offerData.candidateId);
    
    if (status === 'accepted') {
      await candidateRef.update({
        status: 'hired',
        updatedAt: Date.now(),
      });
    } else if (status === 'rejected') {
      await candidateRef.update({
        status: 'rejected',
        updatedAt: Date.now(),
      });
    } else if (status === 'expired' || status === 'withdrawn') {
      await candidateRef.update({
        status: 'active',
        updatedAt: Date.now(),
      });
    }

    // Update application status if exists
    if (offerData.applicationId) {
      const applicationRef = doc(db, 'tenants', tenantId, 'recruiter_applications', offerData.applicationId);
      
      if (status === 'accepted') {
        await applicationRef.update({
          status: 'hired',
          updatedAt: Date.now(),
        });
      } else if (status === 'rejected') {
        await applicationRef.update({
          status: 'rejected',
          updatedAt: Date.now(),
        });
      } else if (status === 'expired' || status === 'withdrawn') {
        await applicationRef.update({
          status: 'active',
          updatedAt: Date.now(),
        });
      }
    }

    // Create placement if offer is accepted
    let placementId = null;
    if (status === 'accepted') {
      placementId = await createPlacement(tenantId, offerData);
    }

    // Create event for offer status update
    const eventData = {
      type: 'offer_status_updated',
      entityType: 'offer',
      entityId: offerId,
      tenantId,
      timestamp: Date.now(),
      payload: {
        offerId,
        previousStatus: offerData.status,
        newStatus: status,
        candidateId: offerData.candidateId,
        jobOrderId: offerData.jobOrderId,
        placementId,
        responseNotes,
        acceptedBy,
      }
    };

    // Call the createEvent function (you'll need to implement this)
    // await createEvent(eventData);

    return {
      success: true,
      data: {
        offer: { ...offerData, ...updateData },
        placementId,
        message: `Offer ${status} successfully`
      }
    };

  } catch (error) {
    console.error('Error updating offer status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});

// Helper function to create placement
async function createPlacement(tenantId: string, offerData: any) {
  const placementId = `placement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const placementRef = doc(db, 'tenants', tenantId, 'recruiter_placements', placementId);

  const newPlacement = {
    id: placementId,
    tenantId,
    candidateId: offerData.candidateId,
    jobOrderId: offerData.jobOrderId,
    applicationId: offerData.applicationId,
    offerId: offerData.id,
    recruiterId: offerData.recruiterId,
    status: 'active' as const,
    startDate: offerData.offerDetails.startDate ? new Date(offerData.offerDetails.startDate).getTime() : null,
    payRate: offerData.offerDetails.payRate,
    payPeriod: offerData.offerDetails.payPeriod,
    billRate: offerData.offerDetails.billRate,
    billPeriod: offerData.offerDetails.billPeriod,
    position: offerData.offerDetails.position,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // Placement tracking
    endDate: null,
    terminationReason: null,
    performanceRating: null,
    notes: null,
  };

  await placementRef.set(newPlacement);

  // Update the offer with placement ID
  const offerRef = doc(db, 'tenants', tenantId, 'recruiter_offers', offerData.id);
  await offerRef.update({
    placementId,
  });

  return placementId;
}
