import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Application status update schema
const UpdateApplicationStatusSchema = z.object({
  tenantId: z.string().min(1),
  applicationId: z.string().min(1),
  status: z.enum(['new', 'screened', 'rejected', 'advanced', 'hired', 'withdrawn', 'duplicate']),
  notes: z.string().optional(),
  recruiterId: z.string().optional(),
  updatedBy: z.string().optional(),
});

/**
 * Updates application status with workflow
 */
export const updateApplicationStatus = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, applicationId, status, notes, recruiterId, updatedBy } = UpdateApplicationStatusSchema.parse(request.data);

    console.log(`Updating application ${applicationId} status to ${status} in tenant ${tenantId}`);

    // Verify the application exists
    const applicationRef = db.collection('tenants').doc(tenantId).collection('applications').doc(applicationId);
    const applicationDoc = await applicationRef.get();

    if (!applicationDoc.exists) {
      throw new Error(`Application ${applicationId} not found`);
    }

    const existingData = applicationDoc.data();
    if (!existingData) {
      throw new Error(`No data found for application ${applicationId}`);
    }

    const now = Date.now();
    const userId = updatedBy || 'system';

    // Validate status transition
    const validTransitions = getValidStatusTransitions(existingData.status);
    if (!validTransitions.includes(status)) {
      throw new Error(`Invalid status transition from ${existingData.status} to ${status}`);
    }

    // Update application data
    const updateData: any = {
      status,
      updatedAt: now,
      updatedBy: userId,
    };

    if (notes) {
      updateData.notes = notes;
    }

    if (recruiterId) {
      updateData.recruiterId = recruiterId;
    }

    // Add status-specific data
    if (status === 'screened') {
      updateData.screenedAt = now;
      updateData.screenedBy = userId;
    } else if (status === 'rejected') {
      updateData.rejectedAt = now;
      updateData.rejectedBy = userId;
    } else if (status === 'advanced') {
      updateData.advancedAt = now;
      updateData.advancedBy = userId;
    } else if (status === 'hired') {
      updateData.hiredAt = now;
      updateData.hiredBy = userId;
    } else if (status === 'withdrawn') {
      updateData.withdrawnAt = now;
      updateData.withdrawnBy = userId;
    }

    // Update the application
    await applicationRef.update(updateData);

    // Create status update event
    const statusEvent = {
      type: 'application.status_updated',
      tenantId,
      entityType: 'application',
      entityId: applicationId,
      source: 'recruiter',
      dedupeKey: `application_status_update:${applicationId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['application', 'status', 'update', 'recruiter', applicationId, status],
      payload: {
        previousStatus: existingData.status,
        newStatus: status,
        notes,
        recruiterId,
        applicationData: { ...existingData, ...updateData },
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(statusEvent);

    // Handle status-specific workflows
    await handleStatusWorkflow(tenantId, applicationId, status, existingData, userId);

    console.log(`Successfully updated application ${applicationId} status to ${status}`);

    return {
      success: true,
      action: 'status_updated',
      applicationId,
      tenantId,
      previousStatus: existingData.status,
      newStatus: status,
      data: { ...existingData, ...updateData }
    };

  } catch (error) {
    console.error('Error updating application status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Get valid status transitions for current status
 */
function getValidStatusTransitions(currentStatus: string): string[] {
  const transitions: { [key: string]: string[] } = {
    'new': ['screened', 'rejected', 'withdrawn', 'duplicate'],
    'screened': ['advanced', 'rejected', 'withdrawn'],
    'advanced': ['hired', 'rejected', 'withdrawn'],
    'rejected': ['new'], // Can be reconsidered
    'hired': [], // Terminal state
    'withdrawn': ['new'], // Can reapply
    'duplicate': [], // Terminal state
  };

  return transitions[currentStatus] || [];
}

/**
 * Handle status-specific workflows
 */
async function handleStatusWorkflow(tenantId: string, applicationId: string, status: string, applicationData: any, userId: string) {
  const now = Date.now();

  switch (status) {
    case 'screened':
      // Update candidate status if exists
      if (applicationData.candidateId) {
        const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(applicationData.candidateId);
        await candidateRef.update({
          status: 'screened',
          updatedAt: now,
          updatedBy: userId,
        });
      }
      break;

    case 'advanced':
      // Create interview record if job order exists
      if (applicationData.jobOrderId) {
        await createInterviewFromApplication(tenantId, applicationId, applicationData, userId);
      }
      break;

    case 'hired':
      // Create placement record
      if (applicationData.jobOrderId && applicationData.candidateId) {
        await createPlacementFromApplication(tenantId, applicationId, applicationData, userId);
      }
      break;

    case 'rejected':
      // Send rejection notification
      await sendRejectionNotification(tenantId, applicationId, applicationData, userId);
      break;

    case 'withdrawn':
      // Update candidate status
      if (applicationData.candidateId) {
        const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(applicationData.candidateId);
        await candidateRef.update({
          status: 'withdrawn',
          updatedAt: now,
          updatedBy: userId,
        });
      }
      break;
  }
}

/**
 * Create interview record from application
 */
async function createInterviewFromApplication(tenantId: string, applicationId: string, applicationData: any, userId: string) {
  const now = Date.now();

  const interviewData = {
    tenantId,
    jobOrderId: applicationData.jobOrderId,
    candidateId: applicationData.candidateId,
    applicationId,
    type: 'phone' as const, // Default type
    status: 'pending' as const,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: ['interview', 'pending', 'application', applicationId],
  };

  const interviewRef = db.collection('tenants').doc(tenantId).collection('interviews').doc();
  await interviewRef.set(interviewData);

  console.log(`Created interview ${interviewRef.id} from application ${applicationId}`);
}

/**
 * Create placement record from application
 */
async function createPlacementFromApplication(tenantId: string, applicationId: string, applicationData: any, userId: string) {
  const now = Date.now();

  // Get job order data
  const jobOrderRef = db.collection('tenants').doc(tenantId).collection('job_orders').doc(applicationData.jobOrderId);
  const jobOrderDoc = await jobOrderRef.get();

  if (!jobOrderDoc.exists) {
    console.error(`Job order ${applicationData.jobOrderId} not found for placement creation`);
    return;
  }

  const jobOrderData = jobOrderDoc.data();

  const placementData = {
    tenantId,
    jobOrderId: applicationData.jobOrderId,
    candidateId: applicationData.candidateId,
    applicationId,
    clientId: jobOrderData.crmCompanyId,
    startDate: new Date().toISOString().split('T')[0], // Today's date
    status: 'active' as const,
    payRate: jobOrderData.payRate,
    billRate: jobOrderData.billRate,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: ['placement', 'active', 'hired', applicationId],
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

  console.log(`Created placement ${placementRef.id} from application ${applicationId}`);
}

/**
 * Send rejection notification
 */
async function sendRejectionNotification(tenantId: string, applicationId: string, applicationData: any, userId: string) {
  // This would integrate with notification system
  // For now, just log the action
  console.log(`Sending rejection notification for application ${applicationId}`);

  // Create notification event
  const notificationEvent = {
    type: 'application.rejection_notification',
    tenantId,
    entityType: 'application',
    entityId: applicationId,
    source: 'recruiter',
    dedupeKey: `rejection_notification:${applicationId}:${Date.now()}`,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: ['application', 'rejection', 'notification', applicationId],
    payload: {
      applicationData,
      notificationType: 'rejection',
    }
  };

  const { createEvent } = await import('../utils/events');
  await createEvent(notificationEvent);
}
