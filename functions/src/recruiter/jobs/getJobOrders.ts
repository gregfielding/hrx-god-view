import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, Query, DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Job order filters schema
const JobOrderFiltersSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(['draft', 'open', 'interviewing', 'offer', 'partially_filled', 'filled', 'closed', 'canceled']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  recruiterOwnerId: z.string().optional(),
  crmCompanyId: z.string().optional(),
  worksiteId: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'priority', 'urgencyScore']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Retrieves job orders with filtering and pagination
 */
export const getJobOrders = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const filters = JobOrderFiltersSchema.parse(request.data);

    console.log(`Retrieving job orders for tenant ${filters.tenantId} with filters:`, filters);

    // Build query
    let query: Query<DocumentData> = db.collection('tenants').doc(filters.tenantId).collection('job_orders');

    // Apply filters
    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    if (filters.priority) {
      query = query.where('priority', '==', filters.priority);
    }

    if (filters.recruiterOwnerId) {
      query = query.where('recruiterOwnerId', '==', filters.recruiterOwnerId);
    }

    if (filters.crmCompanyId) {
      query = query.where('crmCompanyId', '==', filters.crmCompanyId);
    }

    if (filters.worksiteId) {
      query = query.where('worksiteId', '==', filters.worksiteId);
    }

    // Apply sorting
    query = query.orderBy(filters.sortBy, filters.sortOrder);

    // Apply pagination
    query = query.limit(filters.limit).offset(filters.offset);

    // Execute query
    const snapshot = await query.get();

    // Process results
    const jobOrders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    // Apply search filter if provided
    let filteredJobOrders = jobOrders;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredJobOrders = jobOrders.filter(jobOrder => {
        const searchableText = [
          jobOrder.title,
          jobOrder.roleCategory,
          jobOrder.notes,
          ...(jobOrder.searchKeywords || []),
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchLower);
      });
    }

    // Get total count for pagination
    const totalQuery = db.collection('tenants').doc(filters.tenantId).collection('job_orders');
    const totalSnapshot = await totalQuery.count().get();
    const total = totalSnapshot.data().count;

    console.log(`Retrieved ${filteredJobOrders.length} job orders out of ${total} total`);

    return {
      success: true,
      jobOrders: filteredJobOrders,
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: filters.offset + filteredJobOrders.length < total,
      },
      filters,
    };

  } catch (error) {
    console.error('Error retrieving job orders:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
