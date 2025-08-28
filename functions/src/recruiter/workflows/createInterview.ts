import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Interview creation schema
const CreateInterviewSchema = z.object({
  tenantId: z.string().min(1),
  candidateId: z.string().min(1),
  jobOrderId: z.string().min(1),
  type: z.enum(['phone', 'video', 'onsite']),
  scheduledAt: z.string().datetime(),
  duration: z.number().int().positive().default(30), // minutes
  location: z.string().optional(),
  videoUrl: z.string().optional(),
  interviewerIds: z.array(z.string()).min(1, 'At least one interviewer is required'),
  notes: z.string().optional(),
  scorecard: z.array(z.object({
    category: z.string(),
    criteria: z.array(z.object({
      name: z.string(),
      weight: z.number().min(0).max(100),
      description: z.string().optional(),
    })),
  })).default([]),
  createdBy: z.string().optional(),
});

/**
 * Creates a new interview
 */
export const createInterview = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const interviewData = CreateInterviewSchema.parse(request.data);

    console.log(`Creating interview for candidate ${interviewData.candidateId} in tenant ${interviewData.tenantId}`);

    // Verify candidate exists
    const candidateRef = db.collection('tenants').doc(interviewData.tenantId).collection('candidates').doc(interviewData.candidateId);
    const candidateDoc = await candidateRef.get();

    if (!candidateDoc.exists) {
      throw new Error(`Candidate ${interviewData.candidateId} not found`);
    }

    // Verify job order exists
    const jobOrderRef = db.collection('tenants').doc(interviewData.tenantId).collection('job_orders').doc(interviewData.jobOrderId);
    const jobOrderDoc = await jobOrderRef.get();

    if (!jobOrderDoc.exists) {
      throw new Error(`Job order ${interviewData.jobOrderId} not found`);
    }

    const now = Date.now();
    const userId = interviewData.createdBy || 'system';

    // Create interview data
    const newInterview = {
      ...interviewData,
      status: 'scheduled' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: [
        interviewData.type,
        'interview',
        'scheduled',
        interviewData.candidateId,
        interviewData.jobOrderId,
      ],
    };

    // Create the interview
    const interviewRef = db.collection('tenants').doc(interviewData.tenantId).collection('interviews').doc();
    await interviewRef.set(newInterview);

    const interviewId = interviewRef.id;

    // Update candidate status if needed
    const candidateData = candidateDoc.data();
    if (candidateData.status === 'applicant') {
      await candidateRef.update({
        status: 'interview',
        interviewStageAt: now,
        interviewStageBy: userId,
        updatedAt: now,
        updatedBy: userId,
      });
    }

    // Update related application status
    const applicationsQuery = db.collection('tenants').doc(interviewData.tenantId).collection('applications')
      .where('candidateId', '==', interviewData.candidateId)
      .where('jobOrderId', '==', interviewData.jobOrderId);
    
    const applicationsSnapshot = await applicationsQuery.get();
    if (!applicationsSnapshot.empty) {
      const applicationDoc = applicationsSnapshot.docs[0];
      await applicationDoc.ref.update({
        status: 'interview_scheduled',
        updatedAt: now,
        updatedBy: userId,
      });
    }

    // Create interview creation event
    const creationEvent = {
      type: 'interview.created',
      tenantId: interviewData.tenantId,
      entityType: 'interview',
      entityId: interviewId,
      source: 'recruiter',
      dedupeKey: `interview_creation:${interviewId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['interview', 'created', 'recruiter', interviewId],
      payload: {
        interviewData: newInterview,
        candidateId: interviewData.candidateId,
        jobOrderId: interviewData.jobOrderId,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(creationEvent);

    // Send interview invitations (placeholder)
    await sendInterviewInvitations(interviewData.tenantId, interviewId, newInterview);

    console.log(`Successfully created interview ${interviewId}`);

    return {
      success: true,
      action: 'created',
      interviewId,
      tenantId: interviewData.tenantId,
      data: {
        id: interviewId,
        ...newInterview,
      }
    };

  } catch (error) {
    console.error('Error creating interview:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Send interview invitations
 */
async function sendInterviewInvitations(tenantId: string, interviewId: string, interviewData: any) {
  // This would integrate with notification/email service
  // For now, just log the action
  console.log(`Sending interview invitations for interview ${interviewId}`);
  
  // Placeholder for notification integration
  // await sendNotifications({
  //   type: 'interview_invitation',
  //   recipients: interviewData.interviewerIds,
  //   data: { interviewId, interviewData }
  // });
}
