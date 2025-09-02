import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, doc } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Schema for updating placement status
const UpdatePlacementStatusSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  placementId: z.string().min(1, 'Placement ID is required'),
  status: z.enum(['completed', 'terminated']),
  endDate: z.string().optional(), // ISO date string
  terminationReason: z.string().optional(),
  performanceRating: z.number().min(1).max(5).optional(),
  notes: z.string().optional(),
  updatedBy: z.string().min(1, 'Updated by user ID is required'),
});

export const updatePlacementStatus = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    const { data } = request;
    const { 
      tenantId, 
      placementId, 
      status, 
      endDate, 
      terminationReason, 
      performanceRating, 
      notes, 
      updatedBy 
    } = UpdatePlacementStatusSchema.parse(data);

    // Get the placement
    const placementRef = doc(db, 'tenants', tenantId, 'recruiter_placements', placementId);
    const placementDoc = await placementRef.get();
    
    if (!placementDoc.exists) {
      throw new Error('Placement not found');
    }

    const placementData = placementDoc.data();
    if (!placementData) {
      throw new Error('Placement data not found');
    }

    // Check if placement is already in a final state
    if (['completed', 'terminated'].includes(placementData.status)) {
      throw new Error(`Placement is already ${placementData.status}`);
    }

    // Update the placement
    const updateData: any = {
      status,
      updatedAt: Date.now(),
      updatedBy,
    };

    // Set status-specific fields
    if (status === 'completed') {
      updateData.endDate = endDate ? new Date(endDate).getTime() : Date.now();
      updateData.performanceRating = performanceRating || null;
      updateData.notes = notes || null;
    } else if (status === 'terminated') {
      updateData.endDate = endDate ? new Date(endDate).getTime() : Date.now();
      updateData.terminationReason = terminationReason || null;
      updateData.notes = notes || null;
    }

    await placementRef.update(updateData);

    // Update candidate status based on placement status
    const candidateRef = doc(db, 'tenants', tenantId, 'recruiter_candidates', placementData.candidateId);
    
    if (status === 'completed') {
      await candidateRef.update({
        status: 'completed',
        updatedAt: Date.now(),
      });
    } else if (status === 'terminated') {
      await candidateRef.update({
        status: 'terminated',
        updatedAt: Date.now(),
      });
    }

    // Update application status if exists
    if (placementData.applicationId) {
      const applicationRef = doc(db, 'tenants', tenantId, 'recruiter_applications', placementData.applicationId);
      
      if (status === 'completed') {
        await applicationRef.update({
          status: 'completed',
          updatedAt: Date.now(),
        });
      } else if (status === 'terminated') {
        await applicationRef.update({
          status: 'terminated',
          updatedAt: Date.now(),
        });
      }
    }

    // Create event for placement status update
    const eventData = {
      type: 'placement_status_updated',
      entityType: 'placement',
      entityId: placementId,
      tenantId,
      timestamp: Date.now(),
      payload: {
        placementId,
        previousStatus: placementData.status,
        newStatus: status,
        candidateId: placementData.candidateId,
        jobOrderId: placementData.jobOrderId,
        endDate: updateData.endDate,
        terminationReason,
        performanceRating,
        notes,
        updatedBy,
      }
    };

    // Call the createEvent function (you'll need to implement this)
    // await createEvent(eventData);

    return {
      success: true,
      data: {
        placement: { ...placementData, ...updateData },
        message: `Placement ${status} successfully`
      }
    };

  } catch (error) {
    console.error('Error updating placement status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});
