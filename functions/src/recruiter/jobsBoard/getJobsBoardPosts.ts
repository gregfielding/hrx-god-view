import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, Query, DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Jobs board posts filters schema
const JobsBoardPostsFiltersSchema = z.object({
  tenantId: z.string().min(1),
  mode: z.enum(['linked', 'evergreen']).optional(),
  status: z.enum(['draft', 'posted', 'paused', 'closed']).optional(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  jobOrderId: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'metrics.views', 'metrics.applications']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Retrieves jobs board posts with filtering and pagination
 */
export const getJobsBoardPosts = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const filters = JobsBoardPostsFiltersSchema.parse(request.data);

    console.log(`Retrieving jobs board posts for tenant ${filters.tenantId} with filters:`, filters);

    // Build query
    let query: Query<DocumentData> = db.collection('tenants').doc(filters.tenantId).collection('jobs_board_posts');

    // Apply filters
    if (filters.mode) {
      query = query.where('mode', '==', filters.mode);
    }

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    if (filters.visibility) {
      query = query.where('visibility', '==', filters.visibility);
    }

    if (filters.jobOrderId) {
      query = query.where('jobOrderId', '==', filters.jobOrderId);
    }

    // Apply sorting
    if (filters.sortBy.startsWith('metrics.')) {
      // For metrics sorting, we need to handle differently
      query = query.orderBy(filters.sortBy, filters.sortOrder);
    } else {
      query = query.orderBy(filters.sortBy, filters.sortOrder);
    }

    // Apply pagination
    query = query.limit(filters.limit).offset(filters.offset);

    // Execute query
    const snapshot = await query.get();

    // Process results
    const posts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    // Apply search filter if provided
    let filteredPosts = posts;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredPosts = posts.filter(post => {
        const searchableText = [
          post.title,
          post.description,
          post.location,
          post.payRange?.min?.toString(),
          post.payRange?.max?.toString(),
          post.shifts?.join(' '),
          post.benefits,
          ...(post.searchKeywords || []),
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchLower);
      });
    }

    // Get total count for pagination
    const totalQuery = db.collection('tenants').doc(filters.tenantId).collection('jobs_board_posts');
    const totalSnapshot = await totalQuery.count().get();
    const total = totalSnapshot.data().count;

    console.log(`Retrieved ${filteredPosts.length} jobs board posts out of ${total} total`);

    return {
      success: true,
      posts: filteredPosts,
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: filters.offset + filteredPosts.length < total,
      },
      filters,
    };

  } catch (error) {
    console.error('Error retrieving jobs board posts:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
