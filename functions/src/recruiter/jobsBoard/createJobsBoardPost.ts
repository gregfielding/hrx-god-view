import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Jobs board post creation schema
const CreateJobsBoardPostSchema = z.object({
  tenantId: z.string().min(1),
  mode: z.enum(['linked', 'evergreen']),
  jobOrderId: z.string().optional(), // Required for linked mode
  talentPoolKey: z.string().optional(), // For evergreen mode
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  payRange: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
    period: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']),
  }).optional(),
  shifts: z.array(z.string()).default([]),
  benefits: z.string().optional(),
  visibility: z.enum(['public', 'private', 'internal']).default('public'),
  channels: z.array(z.enum(['Companion', 'PublicURL', 'QR', 'Indeed', 'LinkedIn'])).default(['Companion']),
  screeningQuestions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    type: z.enum(['text', 'yesno', 'multiselect', 'number', 'file']),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
  })).default([]),
  autoReplyTemplateId: z.string().optional(),
  requireResume: z.boolean().default(true),
  requireCerts: z.array(z.string()).default([]),
  applyLimit: z.number().int().positive().default(1),
  eeoDisclosure: z.boolean().default(true),
  equalPayDisclosure: z.boolean().optional(),
  privacyLink: z.string().optional(),
  applicationConsent: z.boolean().default(true),
  createdBy: z.string().optional(),
});

/**
 * Creates a new jobs board post
 */
export const createJobsBoardPost = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const postData = CreateJobsBoardPostSchema.parse(request.data);

    console.log(`Creating jobs board post for tenant ${postData.tenantId}`);

    const now = Date.now();
    const userId = postData.createdBy || 'system';

    // Validate mode-specific requirements
    if (postData.mode === 'linked' && !postData.jobOrderId) {
      throw new Error('Job order ID is required for linked mode');
    }

    if (postData.mode === 'evergreen' && !postData.talentPoolKey) {
      throw new Error('Talent pool key is required for evergreen mode');
    }

    // Verify job order exists if specified
    if (postData.jobOrderId) {
      const jobOrderRef = db.collection('tenants').doc(postData.tenantId).collection('job_orders').doc(postData.jobOrderId);
      const jobOrderDoc = await jobOrderRef.get();

      if (!jobOrderDoc.exists) {
        throw new Error(`Job order ${postData.jobOrderId} not found`);
      }

      const jobOrderData = jobOrderDoc.data();

      // Auto-fill some fields from job order if not provided
      if (!postData.payRange && jobOrderData.payRate) {
        postData.payRange = {
          min: jobOrderData.payRate,
          max: jobOrderData.payRate * 1.2, // 20% range
          period: 'hourly',
        };
      }

      if (!postData.shifts && jobOrderData.shifts) {
        postData.shifts = jobOrderData.shifts.map((shift: any) => shift.label);
      }
    }

    // Create post data
    const newPost = {
      ...postData,
      status: 'draft' as const,
      metrics: {
        views: 0,
        applications: 0,
        conversionRate: 0,
        sourceBreakdown: {},
      },
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: [
        postData.title.toLowerCase(),
        postData.description.toLowerCase(),
        postData.location.toLowerCase(),
        postData.shifts.map(shift => shift.toLowerCase()),
        'job',
        'position',
        'opportunity',
      ].flat().filter(Boolean),
    };

    // Create the post
    const postRef = db.collection('tenants').doc(postData.tenantId).collection('jobs_board_posts').doc();
    await postRef.set(newPost);

    const postId = postRef.id;

    // Update job order with post reference if linked
    if (postData.jobOrderId) {
      const jobOrderRef = db.collection('tenants').doc(postData.tenantId).collection('job_orders').doc(postData.jobOrderId);
      await jobOrderRef.update({
        jobsBoardPostId: postId,
        updatedAt: now,
        updatedBy: userId,
      });
    }

    // Create post creation event
    const creationEvent = {
      type: 'jobs_board_post.created',
      tenantId: postData.tenantId,
      entityType: 'jobs_board_post',
      entityId: postId,
      source: 'recruiter',
      dedupeKey: `jobs_board_post_creation:${postId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['jobs_board_post', 'created', 'recruiter', postId],
      payload: {
        postData: newPost,
        jobOrderId: postData.jobOrderId,
        mode: postData.mode,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(creationEvent);

    console.log(`Successfully created jobs board post ${postId}`);

    return {
      success: true,
      action: 'created',
      postId,
      tenantId: postData.tenantId,
      data: {
        id: postId,
        ...newPost,
      }
    };

  } catch (error) {
    console.error('Error creating jobs board post:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
