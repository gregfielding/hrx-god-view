import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Job order creation schema
const CreateJobOrderSchema = z.object({
  tenantId: z.string().min(1),
  crmCompanyId: z.string().min(1, 'CRM Company ID is required'),
  crmDealId: z.string().optional(),
  worksiteId: z.string().optional(),
  title: z.string().min(1, 'Job title is required'),
  roleCategory: z.string().optional(),
  openings: z.number().int().positive(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  shifts: z.array(z.object({
    label: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    days: z.array(z.number().int().min(0).max(6)),
  })).min(1, 'At least one shift is required'),
  payRate: z.number().positive(),
  billRate: z.number().positive().optional(),
  markup: z.number().positive().optional(),
  otRules: z.object({
    enabled: z.boolean(),
    rate: z.number().positive(),
    threshold: z.number().int().positive(),
  }),
  backgroundCheck: z.object({
    required: z.boolean(),
    package: z.string().optional(),
  }),
  drugTest: z.object({
    required: z.boolean(),
    panel: z.string().optional(),
  }),
  language: z.array(z.string()).default([]),
  minExperience: z.number().int().min(0).optional(),
  certifications: z.array(z.string()).default([]),
  dressCode: z.string().optional(),
  notes: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  urgencyScore: z.number().int().min(0).max(100).default(50),
  targetFillDate: z.string().optional(),
  recruiterOwnerId: z.string().min(1, 'Recruiter owner is required'),
  teamIds: z.array(z.string()).default([]),
  autoPostToJobsBoard: z.boolean().default(false),
  submittalLimit: z.number().int().positive().default(5),
  internalOnly: z.boolean().default(false),
  allowOverfill: z.boolean().default(false),
  createdBy: z.string().optional(),
});

/**
 * Creates a new job order
 */
export const createJobOrder = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const jobOrderData = CreateJobOrderSchema.parse(request.data);

    console.log(`Creating job order for tenant ${jobOrderData.tenantId}`);

    const now = Date.now();
    const userId = jobOrderData.createdBy || 'system';

    // Validate business rules
    if (jobOrderData.billRate && jobOrderData.billRate <= jobOrderData.payRate) {
      throw new Error('Bill rate must be greater than pay rate');
    }

    // Verify CRM company exists
    const companyRef = db.collection('tenants').doc(jobOrderData.tenantId).collection('crm_companies').doc(jobOrderData.crmCompanyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
      throw new Error(`CRM company ${jobOrderData.crmCompanyId} not found`);
    }

    // Verify recruiter exists
    const recruiterRef = db.collection('tenants').doc(jobOrderData.tenantId).collection('users').doc(jobOrderData.recruiterOwnerId);
    const recruiterDoc = await recruiterRef.get();

    if (!recruiterDoc.exists) {
      throw new Error(`Recruiter ${jobOrderData.recruiterOwnerId} not found`);
    }

    // Create job order data
    const newJobOrder = {
      ...jobOrderData,
      remainingOpenings: jobOrderData.openings,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      status: 'open' as const,
      searchKeywords: [
        jobOrderData.title.toLowerCase(),
        jobOrderData.roleCategory?.toLowerCase(),
        jobOrderData.notes?.toLowerCase(),
        'job_order',
        'open',
      ].filter(Boolean),
      metrics: {
        submittals: 0,
        interviews: 0,
        offers: 0,
        placements: 0,
      },
    };

    // Create the job order
    const jobOrderRef = db.collection('tenants').doc(jobOrderData.tenantId).collection('job_orders').doc();
    await jobOrderRef.set(newJobOrder);

    const jobOrderId = jobOrderRef.id;

    // Update recruiter client with job order reference
    const recruiterClientRef = db.collection('tenants').doc(jobOrderData.tenantId).collection('recruiter_clients').doc(jobOrderData.crmCompanyId);
    const recruiterClientDoc = await recruiterClientRef.get();

    if (recruiterClientDoc.exists) {
      const recruiterClientData = recruiterClientDoc.data();
      if (recruiterClientData) {
        const jobOrderIds = recruiterClientData.jobOrderIds || [];
        if (!jobOrderIds.includes(jobOrderId)) {
          await recruiterClientRef.update({
            jobOrderIds: [...jobOrderIds, jobOrderId],
            updatedAt: now,
            updatedBy: userId,
          });
        }
      }
    }

    // Create job order creation event
    const creationEvent = {
      type: 'job_order.created',
      tenantId: jobOrderData.tenantId,
      entityType: 'job_order',
      entityId: jobOrderId,
      source: 'recruiter',
      dedupeKey: `job_order_creation:${jobOrderId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['job_order', 'created', 'recruiter', jobOrderId],
      payload: {
        jobOrderData: newJobOrder,
        crmCompanyId: jobOrderData.crmCompanyId,
        crmDealId: jobOrderData.crmDealId,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(creationEvent);

    // If auto-post to jobs board is enabled, create jobs board post
    if (jobOrderData.autoPostToJobsBoard) {
      await createJobsBoardPost(jobOrderData.tenantId, jobOrderId, newJobOrder, userId);
    }

    console.log(`Successfully created job order ${jobOrderId}`);

    return {
      success: true,
      action: 'created',
      jobOrderId,
      tenantId: jobOrderData.tenantId,
      data: {
        id: jobOrderId,
        ...newJobOrder,
      }
    };

  } catch (error) {
    console.error('Error creating job order:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Create jobs board post for job order
 */
async function createJobsBoardPost(tenantId: string, jobOrderId: string, jobOrderData: any, userId: string) {
  const now = Date.now();

  const jobsBoardPost = {
    tenantId,
    jobOrderId,
    mode: 'Companion' as const,
    talentPoolKey: `job_order_${jobOrderId}`,
    title: jobOrderData.title,
    description: jobOrderData.notes || `Join our team as a ${jobOrderData.title}`,
    requirements: [
      `Pay Rate: $${jobOrderData.payRate}/hr`,
      `Start Date: ${jobOrderData.startDate}`,
      ...(jobOrderData.language.length > 0 ? [`Languages: ${jobOrderData.language.join(', ')}`] : []),
      ...(jobOrderData.certifications.length > 0 ? [`Certifications: ${jobOrderData.certifications.join(', ')}`] : []),
    ],
    questions: [],
    status: 'active' as const,
    visibility: 'public' as const,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: [
      jobOrderData.title.toLowerCase(),
      'jobs_board',
      'active',
      'public',
    ],
  };

  const postRef = db.collection('tenants').doc(tenantId).collection('jobs_board_posts').doc();
  await postRef.set(jobsBoardPost);

  console.log(`Created jobs board post ${postRef.id} for job order ${jobOrderId}`);
}
