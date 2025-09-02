import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Pipeline stage update schema
const UpdatePipelineStageSchema = z.object({
  tenantId: z.string().min(1),
  candidateId: z.string().min(1),
  newStage: z.enum(['applicant', 'screened', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']),
  jobOrderId: z.string().optional(),
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
});

/**
 * Updates candidate pipeline stage with drag-and-drop functionality
 */
export const updatePipelineStage = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const { tenantId, candidateId, newStage, jobOrderId, notes, updatedBy } = UpdatePipelineStageSchema.parse(request.data);

    console.log(`Updating candidate ${candidateId} to stage ${newStage} in tenant ${tenantId}`);

    // Verify the candidate exists
    const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(candidateId);
    const candidateDoc = await candidateRef.get();

    if (!candidateDoc.exists) {
      throw new Error(`Candidate ${candidateId} not found`);
    }

    const existingData = candidateDoc.data();
    if (!existingData) {
      throw new Error(`No data found for candidate ${candidateId}`);
    }

    const now = Date.now();
    const userId = updatedBy || 'system';
    const previousStage = existingData.status;

    // Validate stage transition
    const validTransitions = getValidStageTransitions(previousStage);
    if (!validTransitions.includes(newStage)) {
      throw new Error(`Invalid stage transition from ${previousStage} to ${newStage}`);
    }

    // Update candidate status
    const updateData: any = {
      status: newStage,
      updatedAt: now,
      updatedBy: userId,
    };

    if (notes) {
      updateData.notes = notes;
    }

    // Add stage-specific data
    if (newStage === 'screened') {
      updateData.screenedAt = now;
      updateData.screenedBy = userId;
    } else if (newStage === 'interview') {
      updateData.interviewStageAt = now;
      updateData.interviewStageBy = userId;
    } else if (newStage === 'offer') {
      updateData.offerStageAt = now;
      updateData.offerStageBy = userId;
    } else if (newStage === 'hired') {
      updateData.hiredAt = now;
      updateData.hiredBy = userId;
    } else if (newStage === 'rejected') {
      updateData.rejectedAt = now;
      updateData.rejectedBy = userId;
    } else if (newStage === 'withdrawn') {
      updateData.withdrawnAt = now;
      updateData.withdrawnBy = userId;
    }

    // Update the candidate
    await candidateRef.update(updateData);

    // Update related applications if job order is specified
    if (jobOrderId) {
      await updateApplicationStatusForStage(tenantId, candidateId, jobOrderId, newStage, userId);
    }

    // Create stage update event
    const stageEvent = {
      type: 'candidate.stage_updated',
      tenantId,
      entityType: 'candidate',
      entityId: candidateId,
      source: 'recruiter',
      dedupeKey: `candidate_stage_update:${candidateId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['candidate', 'stage', 'update', 'recruiter', candidateId, newStage],
      payload: {
        previousStage,
        newStage,
        jobOrderId,
        notes,
        candidateData: { ...existingData, ...updateData },
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(stageEvent);

    // Handle stage-specific workflows
    await handleStageWorkflow(tenantId, candidateId, newStage, jobOrderId, userId);

    console.log(`Successfully updated candidate ${candidateId} to stage ${newStage}`);

    return {
      success: true,
      action: 'stage_updated',
      candidateId,
      tenantId,
      previousStage,
      newStage,
      data: { ...existingData, ...updateData }
    };

  } catch (error) {
    console.error('Error updating pipeline stage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Get valid stage transitions for current stage
 */
function getValidStageTransitions(currentStage: string): string[] {
  const transitions: { [key: string]: string[] } = {
    'applicant': ['screened', 'rejected', 'withdrawn'],
    'screened': ['interview', 'rejected', 'withdrawn'],
    'interview': ['offer', 'rejected', 'withdrawn'],
    'offer': ['hired', 'rejected', 'withdrawn'],
    'hired': [], // Terminal state
    'rejected': ['applicant'], // Can be reconsidered
    'withdrawn': ['applicant'], // Can reapply
  };

  return transitions[currentStage] || [];
}

/**
 * Update application status based on candidate stage
 */
async function updateApplicationStatusForStage(tenantId: string, candidateId: string, jobOrderId: string, newStage: string, userId: string) {
  const applicationsRef = db.collection('tenants').doc(tenantId).collection('applications');
  const applicationsQuery = applicationsRef
    .where('candidateId', '==', candidateId)
    .where('jobOrderId', '==', jobOrderId);
  
  const applicationsSnapshot = await applicationsQuery.get();

  if (!applicationsSnapshot.empty) {
    const applicationDoc = applicationsSnapshot.docs[0];
    const applicationData = applicationDoc.data();

    // Map candidate stage to application status
    const stageToStatusMap: { [key: string]: string } = {
      'screened': 'screened',
      'interview': 'advanced',
      'offer': 'advanced',
      'hired': 'hired',
      'rejected': 'rejected',
      'withdrawn': 'withdrawn',
    };

    const newStatus = stageToStatusMap[newStage];
    if (newStatus && newStatus !== applicationData.status) {
      await applicationDoc.ref.update({
        status: newStatus,
        updatedAt: Date.now(),
        updatedBy: userId,
      });

      console.log(`Updated application ${applicationDoc.id} status to ${newStatus}`);
    }
  }
}

/**
 * Handle stage-specific workflows
 */
async function handleStageWorkflow(tenantId: string, candidateId: string, newStage: string, jobOrderId: string, userId: string) {
  const now = Date.now();

  switch (newStage) {
    case 'interview':
      // Create interview record if job order exists
      if (jobOrderId) {
        await createInterviewFromStage(tenantId, candidateId, jobOrderId, userId);
      }
      break;

    case 'offer':
      // Create offer record if job order exists
      if (jobOrderId) {
        await createOfferFromStage(tenantId, candidateId, jobOrderId, userId);
      }
      break;

    case 'hired':
      // Create placement record if job order exists
      if (jobOrderId) {
        await createPlacementFromStage(tenantId, candidateId, jobOrderId, userId);
      }
      break;

    case 'rejected':
      // Send rejection notification
      await sendRejectionNotification(tenantId, candidateId, jobOrderId, userId);
      break;
  }
}

/**
 * Create interview record from stage update
 */
async function createInterviewFromStage(tenantId: string, candidateId: string, jobOrderId: string, userId: string) {
  const now = Date.now();

  // Check if interview already exists
  const existingInterviewQuery = db.collection('tenants').doc(tenantId).collection('interviews')
    .where('candidateId', '==', candidateId)
    .where('jobOrderId', '==', jobOrderId);
  
  const existingInterviewSnapshot = await existingInterviewQuery.get();

  if (existingInterviewSnapshot.empty) {
    const interviewData = {
      tenantId,
      jobOrderId,
      candidateId,
      type: 'phone' as const, // Default type
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['interview', 'pending', 'candidate', candidateId],
    };

    const interviewRef = db.collection('tenants').doc(tenantId).collection('interviews').doc();
    await interviewRef.set(interviewData);

    console.log(`Created interview ${interviewRef.id} from stage update for candidate ${candidateId}`);
  }
}

/**
 * Create offer record from stage update
 */
async function createOfferFromStage(tenantId: string, candidateId: string, jobOrderId: string, userId: string) {
  const now = Date.now();

  // Check if offer already exists
  const existingOfferQuery = db.collection('tenants').doc(tenantId).collection('offers')
    .where('candidateId', '==', candidateId)
    .where('jobOrderId', '==', jobOrderId);
  
  const existingOfferSnapshot = await existingOfferQuery.get();

  if (existingOfferSnapshot.empty) {
    // Get job order data for offer details
    const jobOrderRef = db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId);
    const jobOrderDoc = await jobOrderRef.get();

    if (jobOrderDoc.exists) {
      const jobOrderData = jobOrderDoc.data();

      const offerData = {
        tenantId,
        jobOrderId,
        candidateId,
        payRate: jobOrderData.payRate,
        startDate: new Date().toISOString().split('T')[0], // Today's date
        shift: 'TBD',
        employmentType: 'temp' as const,
        state: 'draft' as const,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
        contingencies: {
          backgroundCheck: true,
          drugTest: true,
          eVerify: true,
          other: [],
        },
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        searchKeywords: ['offer', 'draft', 'candidate', candidateId],
      };

      const offerRef = db.collection('tenants').doc(tenantId).collection('offers').doc();
      await offerRef.set(offerData);

      console.log(`Created offer ${offerRef.id} from stage update for candidate ${candidateId}`);
    }
  }
}

/**
 * Create placement record from stage update
 */
async function createPlacementFromStage(tenantId: string, candidateId: string, jobOrderId: string, userId: string) {
  const now = Date.now();

  // Check if placement already exists
  const existingPlacementQuery = db.collection('tenants').doc(tenantId).collection('placements')
    .where('candidateId', '==', candidateId)
    .where('jobOrderId', '==', jobOrderId);
  
  const existingPlacementSnapshot = await existingPlacementQuery.get();

  if (existingPlacementSnapshot.empty) {
    // Get job order data
    const jobOrderRef = db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId);
    const jobOrderDoc = await jobOrderRef.get();

    if (jobOrderDoc.exists) {
      const jobOrderData = jobOrderDoc.data();

      const placementData = {
        tenantId,
        jobOrderId,
        candidateId,
        clientId: jobOrderData.crmCompanyId,
        startDate: new Date().toISOString().split('T')[0], // Today's date
        status: 'active' as const,
        payRate: jobOrderData.payRate,
        billRate: jobOrderData.billRate,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        searchKeywords: ['placement', 'active', 'hired', candidateId],
      };

      const placementRef = db.collection('tenants').doc(tenantId).collection('placements').doc();
      await placementRef.set(placementData);

      // Update job order metrics
      await jobOrderRef.update({
        'metrics.placements': (jobOrderData.metrics?.placements || 0) + 1,
        'remainingOpenings': Math.max(0, (jobOrderData.remainingOpenings || 0) - 1),
        updatedAt: now,
        updatedBy: userId,
      });

      console.log(`Created placement ${placementRef.id} from stage update for candidate ${candidateId}`);
    }
  }
}

/**
 * Send rejection notification
 */
async function sendRejectionNotification(tenantId: string, candidateId: string, jobOrderId: string, userId: string) {
  // This would integrate with notification system
  // For now, just log the action
  console.log(`Sending rejection notification for candidate ${candidateId}`);

  // Create notification event
  const notificationEvent = {
    type: 'candidate.rejection_notification',
    tenantId,
    entityType: 'candidate',
    entityId: candidateId,
    source: 'recruiter',
    dedupeKey: `rejection_notification:${candidateId}:${Date.now()}`,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: ['candidate', 'rejection', 'notification', candidateId],
    payload: {
      candidateId,
      jobOrderId,
      notificationType: 'rejection',
    }
  };

  const { createEvent } = await import('../utils/events');
  await createEvent(notificationEvent);
}
