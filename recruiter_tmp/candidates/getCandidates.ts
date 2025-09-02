import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, Query, DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Candidate filters schema
const CandidateFiltersSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(['applicant', 'active_employee', 'inactive']).optional(),
  jobOrderId: z.string().optional(),
  recruiterOwnerId: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'firstName', 'lastName', 'score']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Retrieves candidates with filtering and pagination
 */
export const getCandidates = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const filters = CandidateFiltersSchema.parse(request.data);

    console.log(`Retrieving candidates for tenant ${filters.tenantId} with filters:`, filters);

    // Build query
    let query: Query<DocumentData> = db.collection('tenants').doc(filters.tenantId).collection('candidates');

    // Apply filters
    if (filters.status) {
      query = query.where('status', '==', filters.status);
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
    const candidates = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    // Apply search filter if provided
    let filteredCandidates = candidates;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredCandidates = candidates.filter(candidate => {
        const searchableText = [
          candidate.firstName,
          candidate.lastName,
          candidate.email,
          candidate.phone,
          candidate.title,
          candidate.notes,
          ...(candidate.searchKeywords || []),
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchLower);
      });
    }

    // Filter by job order if specified
    if (filters.jobOrderId) {
      // Get applications for this job order
      const applicationsRef = db.collection('tenants').doc(filters.tenantId).collection('applications');
      const applicationsSnapshot = await applicationsRef
        .where('jobOrderId', '==', filters.jobOrderId)
        .get();

      const candidateIds = applicationsSnapshot.docs.map(doc => doc.data().candidateId);
      filteredCandidates = filteredCandidates.filter(candidate => 
        candidateIds.includes(candidate.id)
      );
    }

    // Get total count for pagination
    const totalQuery = db.collection('tenants').doc(filters.tenantId).collection('candidates');
    const totalSnapshot = await totalQuery.count().get();
    const total = totalSnapshot.data().count;

    console.log(`Retrieved ${filteredCandidates.length} candidates out of ${total} total`);

    return {
      success: true,
      candidates: filteredCandidates,
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: filters.offset + filteredCandidates.length < total,
      },
      filters,
    };

  } catch (error) {
    console.error('Error retrieving candidates:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
