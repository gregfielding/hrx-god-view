import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, Query, DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Application filters schema
const ApplicationFiltersSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(['new', 'screened', 'rejected', 'advanced', 'hired', 'withdrawn', 'duplicate']).optional(),
  jobOrderId: z.string().optional(),
  candidateId: z.string().optional(),
  postId: z.string().optional(),
  source: z.enum(['QR', 'URL', 'referral', 'Companion', 'Indeed', 'LinkedIn']).optional(),
  recruiterOwnerId: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'aiScore', 'source']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Retrieves applications with filtering and pagination
 */
export const getApplications = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const filters = ApplicationFiltersSchema.parse(request.data);

    console.log(`Retrieving applications for tenant ${filters.tenantId} with filters:`, filters);

    // Build query
    let query: Query<DocumentData> = db.collection('tenants').doc(filters.tenantId).collection('applications');

    // Apply filters
    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    if (filters.jobOrderId) {
      query = query.where('jobOrderId', '==', filters.jobOrderId);
    }

    if (filters.candidateId) {
      query = query.where('candidateId', '==', filters.candidateId);
    }

    if (filters.postId) {
      query = query.where('postId', '==', filters.postId);
    }

    if (filters.source) {
      query = query.where('source', '==', filters.source);
    }

    if (filters.recruiterOwnerId) {
      query = query.where('recruiterOwnerId', '==', filters.recruiterOwnerId);
    }

    // Apply sorting
    query = query.orderBy(filters.sortBy, filters.sortOrder);

    // Apply pagination
    query = query.limit(filters.limit).offset(filters.offset);

    // Execute query
    const snapshot = await query.get();

    // Process results
    const applications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    // Apply search filter if provided
    let filteredApplications = applications;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredApplications = applications.filter(application => {
        const searchableText = [
          application.externalApplicant?.name,
          application.externalApplicant?.email,
          application.externalApplicant?.phone,
          application.answers?.map((a: any) => a.answer).join(' '),
          ...(application.searchKeywords || []),
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchLower);
      });
    }

    // Get total count for pagination
    const totalQuery = db.collection('tenants').doc(filters.tenantId).collection('applications');
    const totalSnapshot = await totalQuery.count().get();
    const total = totalSnapshot.data().count;

    console.log(`Retrieved ${filteredApplications.length} applications out of ${total} total`);

    return {
      success: true,
      applications: filteredApplications,
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: filters.offset + filteredApplications.length < total,
      },
      filters,
    };

  } catch (error) {
    console.error('Error retrieving applications:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
