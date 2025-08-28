import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Schema for creating an offer
const CreateOfferSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  candidateId: z.string().min(1, 'Candidate ID is required'),
  jobOrderId: z.string().min(1, 'Job Order ID is required'),
  applicationId: z.string().optional(), // Optional if direct offer
  offerDetails: z.object({
    position: z.string().min(1, 'Position is required'),
    startDate: z.string().optional(), // ISO date string
    payRate: z.number().positive('Pay rate must be positive'),
    payPeriod: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']),
    billRate: z.number().positive('Bill rate must be positive'),
    billPeriod: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']),
    benefits: z.array(z.string()).optional(),
    notes: z.string().optional(),
    terms: z.string().optional(),
  }),
  recruiterId: z.string().min(1, 'Recruiter ID is required'),
  expirationDate: z.string().optional(), // ISO date string, defaults to 7 days
});

export const createOffer = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    const { data } = request;
    const { tenantId, candidateId, jobOrderId, applicationId, offerDetails, recruiterId, expirationDate } = CreateOfferSchema.parse(data);

    // Verify candidate exists
    const candidateRef = doc(db, 'tenants', tenantId, 'recruiter_candidates', candidateId);
    const candidateDoc = await candidateRef.get();
    if (!candidateDoc.exists) {
      throw new Error('Candidate not found');
    }

    // Verify job order exists
    const jobOrderRef = doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jobOrderId);
    const jobOrderDoc = await jobOrderRef.get();
    if (!jobOrderDoc.exists) {
      throw new Error('Job order not found');
    }

    // Verify application exists if provided
    if (applicationId) {
      const applicationRef = doc(db, 'tenants', tenantId, 'recruiter_applications', applicationId);
      const applicationDoc = await applicationRef.get();
      if (!applicationDoc.exists) {
        throw new Error('Application not found');
      }
    }

    // Calculate expiration date (default 7 days)
    const expiresAt = expirationDate ? new Date(expirationDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Create the offer
    const offerId = `offer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const offerRef = doc(db, 'tenants', tenantId, 'recruiter_offers', offerId);

    const newOffer = {
      id: offerId,
      tenantId,
      candidateId,
      jobOrderId,
      applicationId: applicationId || null,
      recruiterId,
      status: 'pending' as const,
      offerDetails,
      expiresAt: expiresAt.getTime(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // Timestamps for different stages
      sentAt: null,
      respondedAt: null,
      acceptedAt: null,
      rejectedAt: null,
      // Response details
      response: null,
      responseNotes: null,
      // Placement tracking
      placementId: null,
    };

    await offerRef.set(newOffer);

    // Update candidate status to 'offer_pending'
    await candidateRef.update({
      status: 'offer_pending',
      updatedAt: Date.now(),
    });

    // Update application status if exists
    if (applicationId) {
      const applicationRef = doc(db, 'tenants', tenantId, 'recruiter_applications', applicationId);
      await applicationRef.update({
        status: 'offer_pending',
        updatedAt: Date.now(),
      });
    }

    // Create event for offer creation
    const eventData = {
      type: 'offer_created',
      entityType: 'offer',
      entityId: offerId,
      tenantId,
      timestamp: Date.now(),
      payload: {
        offerData: newOffer,
        candidateId,
        jobOrderId,
        recruiterId,
      }
    };

    // Call the createEvent function (you'll need to implement this)
    // await createEvent(eventData);

    return {
      success: true,
      data: {
        offer: newOffer,
        message: 'Offer created successfully'
      }
    };

  } catch (error) {
    console.error('Error creating offer:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});
