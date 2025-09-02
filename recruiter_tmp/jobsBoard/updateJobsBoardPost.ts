import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Jobs board post update schema
const UpdateJobsBoardPostSchema = z.object({
  tenantId: z.string().min(1),
  postId: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  payRange: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
    period: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']),
  }).optional(),
  shifts: z.array(z.string()).optional(),
  benefits: z.string().optional(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  channels: z.array(z.enum(['Companion', 'PublicURL', 'QR', 'Indeed', 'LinkedIn'])).optional(),
  screeningQuestions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    type: z.enum(['text', 'yesno', 'multiselect', 'number', 'file']),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
  })).optional(),
  autoReplyTemplateId: z.string().optional(),
  requireResume: z.boolean().optional(),
  requireCerts: z.array(z.string()).optional(),
  applyLimit: z.number().int().positive().optional(),
  eeoDisclosure: z.boolean().optional(),
  equalPayDisclosure: z.boolean().optional(),
  privacyLink: z.string().optional(),
  applicationConsent: z.boolean().optional(),
  status: z.enum(['draft', 'posted', 'paused', 'closed']).optional(),
  updatedBy: z.string().optional(),
});

/**
 * Updates a jobs board post
 */
export const updateJobsBoardPost = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, postId, ...updateData } = UpdateJobsBoardPostSchema.parse(request.data);

    console.log(`Updating jobs board post ${postId} in tenant ${tenantId}`);

    // Verify the post exists
    const postRef = db.collection('tenants').doc(tenantId).collection('jobs_board_posts').doc(postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      throw new Error(`Jobs board post ${postId} not found`);
    }

    const existingData = postDoc.data();
    if (!existingData) {
      throw new Error(`No data found for jobs board post ${postId}`);
    }

    const now = Date.now();
    const userId = updateData.updatedBy || 'system';

    // Prepare update data
    const updateFields: any = {
      updatedAt: now,
      updatedBy: userId,
    };

    // Add updated fields
    Object.keys(updateData).forEach(key => {
      if (key !== 'updatedBy' && updateData[key] !== undefined) {
        updateFields[key] = updateData[key];
      }
    });

    // Update search keywords if content changed
    if (updateData.title || updateData.description || updateData.location || updateData.shifts) {
      const newSearchKeywords = [
        (updateData.title || existingData.title).toLowerCase(),
        (updateData.description || existingData.description).toLowerCase(),
        (updateData.location || existingData.location).toLowerCase(),
        (updateData.shifts || existingData.shifts).map((shift: string) => shift.toLowerCase()),
        'job',
        'position',
        'opportunity',
      ].flat().filter(Boolean);

      updateFields.searchKeywords = newSearchKeywords;
    }

    // Update the post
    await postRef.update(updateFields);

    // Handle status changes
    if (updateData.status && updateData.status !== existingData.status) {
      await handleStatusChange(tenantId, postId, existingData.status, updateData.status, userId);
    }

    // Create post update event
    const updateEvent = {
      type: 'jobs_board_post.updated',
      tenantId,
      entityType: 'jobs_board_post',
      entityId: postId,
      source: 'recruiter',
      dedupeKey: `jobs_board_post_update:${postId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['jobs_board_post', 'updated', 'recruiter', postId],
      payload: {
        previousData: existingData,
        updateData: updateFields,
        postId,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(updateEvent);

    console.log(`Successfully updated jobs board post ${postId}`);

    return {
      success: true,
      action: 'updated',
      postId,
      tenantId,
      data: { ...existingData, ...updateFields }
    };

  } catch (error) {
    console.error('Error updating jobs board post:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Handle status changes for jobs board posts
 */
async function handleStatusChange(tenantId: string, postId: string, previousStatus: string, newStatus: string, userId: string) {
  const now = Date.now();

  switch (newStatus) {
    case 'posted':
      // Update posted timestamp
      await db.collection('tenants').doc(tenantId).collection('jobs_board_posts').doc(postId).update({
        postedAt: now,
        postedBy: userId,
      });

      // Create posted event
      const postedEvent = {
        type: 'jobs_board_post.posted',
        tenantId,
        entityType: 'jobs_board_post',
        entityId: postId,
        source: 'recruiter',
        dedupeKey: `jobs_board_post_posted:${postId}:${now}`,
        createdBy: userId,
        updatedBy: userId,
        searchKeywords: ['jobs_board_post', 'posted', 'recruiter', postId],
        payload: {
          postId,
          postedAt: now,
        }
      };

      const { createEvent } = await import('../utils/events');
      await createEvent(postedEvent);
      break;

    case 'paused':
      // Update paused timestamp
      await db.collection('tenants').doc(tenantId).collection('jobs_board_posts').doc(postId).update({
        pausedAt: now,
        pausedBy: userId,
      });
      break;

    case 'closed':
      // Update closed timestamp
      await db.collection('tenants').doc(tenantId).collection('jobs_board_posts').doc(postId).update({
        closedAt: now,
        closedBy: userId,
      });
      break;
  }
}
