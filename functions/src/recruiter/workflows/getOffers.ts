import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, collection, query, where, orderBy, limit, startAfter, getDocs, Query, DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Schema for getting offers
const GetOffersSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  status: z.enum(['pending', 'accepted', 'rejected', 'expired', 'withdrawn']).optional(),
  candidateId: z.string().optional(),
  jobOrderId: z.string().optional(),
  recruiterId: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  sortBy: z.enum(['createdAt', 'expiresAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
});

export const getOffers = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    const { data } = request;
    const { 
      tenantId, 
      status, 
      candidateId, 
      jobOrderId, 
      recruiterId, 
      limit: limitCount, 
      offset, 
      sortBy, 
      sortOrder,
      search 
    } = GetOffersSchema.parse(data);

    // Build query
    let q: Query<DocumentData> = collection(db, 'tenants', tenantId, 'recruiter_offers');

    // Add filters
    const filters = [];
    
    if (status) {
      filters.push(where('status', '==', status));
    }
    
    if (candidateId) {
      filters.push(where('candidateId', '==', candidateId));
    }
    
    if (jobOrderId) {
      filters.push(where('jobOrderId', '==', jobOrderId));
    }
    
    if (recruiterId) {
      filters.push(where('recruiterId', '==', recruiterId));
    }

    // Apply filters
    if (filters.length > 0) {
      q = query(q, ...filters);
    }

    // Add sorting
    q = query(q, orderBy(sortBy, sortOrder));

    // Get total count for pagination
    const totalQuery = query(q);
    const totalSnapshot = await getDocs(totalQuery);
    const total = totalSnapshot.size;

    // Add pagination
    if (offset > 0) {
      const offsetQuery = query(q, limit(offset));
      const offsetSnapshot = await getDocs(offsetQuery);
      const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
      if (lastDoc) {
        q = query(q, startAfter(lastDoc), limit(limitCount));
      } else {
        q = query(q, limit(limitCount));
      }
    } else {
      q = query(q, limit(limitCount));
    }

    // Execute query
    const snapshot = await getDocs(q);
    const offers: any[] = [];

    // Process results
    for (const doc of snapshot.docs) {
      const offerData = doc.data();
      
      // Apply search filter if provided
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          offerData.offerDetails?.position?.toLowerCase().includes(searchLower) ||
          offerData.offerDetails?.notes?.toLowerCase().includes(searchLower) ||
          offerData.responseNotes?.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) {
          continue;
        }
      }

      offers.push({
        id: doc.id,
        ...offerData,
      });
    }

    // Calculate pagination info
    const hasMore = offset + offers.length < total;
    const nextOffset = hasMore ? offset + offers.length : null;

    return {
      success: true,
      data: {
        offers,
        pagination: {
          total,
          limit: limitCount,
          offset,
          hasMore,
          nextOffset,
        }
      }
    };

  } catch (error) {
    console.error('Error getting offers:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});
