import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Job order update schema
const UpdateJobOrderSchema = z.object({
  tenantId: z.string().min(1),
  jobOrderId: z.string().min(1),
  updates: z.object({
    title: z.string().min(1).optional(),
    roleCategory: z.string().optional(),
    openings: z.number().int().positive().optional(),
    remainingOpenings: z.number().int().min(0).optional(),
    startDate: z.string().min(1).optional(),
    endDate: z.string().optional(),
    shifts: z.array(z.object({
      label: z.string().min(1),
      start: z.string().min(1),
      end: z.string().min(1),
      days: z.array(z.number().int().min(0).max(6)),
    })).min(1).optional(),
    payRate: z.number().positive().optional(),
    billRate: z.number().positive().optional(),
    markup: z.number().positive().optional(),
    otRules: z.object({
      enabled: z.boolean(),
      rate: z.number().positive(),
      threshold: z.number().int().positive(),
    }).optional(),
    backgroundCheck: z.object({
      required: z.boolean(),
      package: z.string().optional(),
    }).optional(),
    drugTest: z.object({
      required: z.boolean(),
      panel: z.string().optional(),
    }).optional(),
    language: z.array(z.string()).optional(),
    minExperience: z.number().int().min(0).optional(),
    certifications: z.array(z.string()).optional(),
    dressCode: z.string().optional(),
    notes: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    urgencyScore: z.number().int().min(0).max(100).optional(),
    targetFillDate: z.string().optional(),
    recruiterOwnerId: z.string().min(1).optional(),
    teamIds: z.array(z.string()).optional(),
    autoPostToJobsBoard: z.boolean().optional(),
    submittalLimit: z.number().int().positive().optional(),
    internalOnly: z.boolean().optional(),
    allowOverfill: z.boolean().optional(),
    status: z.enum(['draft', 'open', 'interviewing', 'offer', 'partially_filled', 'filled', 'closed', 'canceled']).optional(),
  }).partial(),
  updatedBy: z.string().optional(),
});

/**
 * Updates job order with validation
 */
export const updateJobOrder = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, jobOrderId, updates, updatedBy } = UpdateJobOrderSchema.parse(request.data);

    console.log(`Updating job order ${jobOrderId} in tenant ${tenantId}`);

    // Verify the job order exists
    const jobOrderRef = db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId);
    const jobOrderDoc = await jobOrderRef.get();

    if (!jobOrderDoc.exists) {
      throw new Error(`Job order ${jobOrderId} not found`);
    }

    const existingData = jobOrderDoc.data();
    if (!existingData) {
      throw new Error(`No data found for job order ${jobOrderId}`);
    }

    const now = Date.now();
    const userId = updatedBy || 'system';

    // Validate business rules
    if (updates.openings !== undefined && updates.remainingOpenings !== undefined) {
      if (updates.remainingOpenings > updates.openings) {
        throw new Error('Remaining openings cannot exceed total openings');
      }
    }

    if (updates.remainingOpenings !== undefined) {
      const totalOpenings = updates.openings || existingData.openings;
      if (updates.remainingOpenings > totalOpenings) {
        throw new Error('Remaining openings cannot exceed total openings');
      }
    }

    if (updates.billRate !== undefined && updates.payRate !== undefined) {
      if (updates.billRate <= updates.payRate) {
        throw new Error('Bill rate must be greater than pay rate');
      }
    }

    // Merge updates with existing data
    const updatedData: any = {
      ...existingData,
      ...updates,
      updatedAt: now,
      updatedBy: userId,
    };

    // Update search keywords if title or role category changed
    if (updates.title || updates.roleCategory) {
      const newKeywords = [
        updates.title?.toLowerCase() || existingData.title?.toLowerCase(),
        updates.roleCategory?.toLowerCase() || existingData.roleCategory?.toLowerCase(),
        updates.notes?.toLowerCase() || existingData.notes?.toLowerCase(),
        ...(existingData.searchKeywords || []),
      ].filter(Boolean) as string[];
      
      updatedData.searchKeywords = newKeywords;
    }

    // Update the job order
    await jobOrderRef.update(updatedData);

    // Create an event to notify other systems of the update
    const updateEvent = {
      type: 'job_order.updated',
      tenantId,
      entityType: 'job_order',
      entityId: jobOrderId,
      source: 'recruiter',
      dedupeKey: `job_order_update:${jobOrderId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['job_order', 'update', 'recruiter', jobOrderId],
      payload: {
        updatedFields: Object.keys(updates),
        previousData: existingData,
        newData: updatedData,
        crmCompanyId: existingData.crmCompanyId,
        crmDealId: existingData.crmDealId,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(updateEvent);

    // If status changed to filled or closed, update related entities
    if (updates.status && ['filled', 'closed'].includes(updates.status)) {
      await handleJobOrderCompletion(tenantId, jobOrderId, updates.status, userId);
    }

    console.log(`Successfully updated job order ${jobOrderId}`);

    return {
      success: true,
      action: 'updated',
      jobOrderId,
      tenantId,
      updatedFields: Object.keys(updates),
      data: updatedData
    };

  } catch (error) {
    console.error('Error updating job order:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Handle job order completion logic
 */
async function handleJobOrderCompletion(tenantId: string, jobOrderId: string, status: string, userId: string) {
  const now = Date.now();

  // Update related applications to reflect job order status
  const applicationsRef = db.collection('tenants').doc(tenantId).collection('applications');
  const applicationsSnapshot = await applicationsRef
    .where('jobOrderId', '==', jobOrderId)
    .where('status', 'in', ['new', 'screened', 'interviewing'])
    .get();

  const batch = db.batch();
  applicationsSnapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      status: status === 'filled' ? 'position_filled' : 'position_closed',
      updatedAt: now,
      updatedBy: userId,
    });
  });

  if (applicationsSnapshot.docs.length > 0) {
    await batch.commit();
    console.log(`Updated ${applicationsSnapshot.docs.length} applications for completed job order ${jobOrderId}`);
  }

  // Create completion event
  const completionEvent = {
    type: 'job_order.completed',
    tenantId,
    entityType: 'job_order',
    entityId: jobOrderId,
    source: 'recruiter',
    dedupeKey: `job_order_completion:${jobOrderId}:${now}`,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: ['job_order', 'completed', status, jobOrderId],
    payload: {
      status,
      applicationsUpdated: applicationsSnapshot.docs.length,
    }
  };

  const { createEvent } = await import('../utils/events');
  await createEvent(completionEvent);
}
