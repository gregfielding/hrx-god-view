import { onCall } from 'firebase-functions/v2/https';
import { getFirestore, Query, DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Pipeline board filters schema
const PipelineBoardFiltersSchema = z.object({
  tenantId: z.string().min(1),
  jobOrderId: z.string().optional(),
  recruiterOwnerId: z.string().optional(),
  stages: z.array(z.string()).default(['applicant', 'screened', 'interview', 'offer', 'hired']),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * Retrieves candidates organized by pipeline stages for Kanban board
 */
export const getPipelineBoard = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const filters = PipelineBoardFiltersSchema.parse(request.data);

    console.log(`Retrieving pipeline board for tenant ${filters.tenantId} with stages:`, filters.stages);

    const pipelineData: { [stage: string]: any[] } = {};

    // Get candidates for each stage
    for (const stage of filters.stages) {
      // Build query for this stage
      let query: Query<DocumentData> = db.collection('tenants').doc(filters.tenantId).collection('candidates');

      // Apply stage filter
      query = query.where('status', '==', stage);

      // Apply additional filters
      if (filters.jobOrderId) {
        // Get applications for this job order and find candidates
        const applicationsQuery = db.collection('tenants').doc(filters.tenantId).collection('applications')
          .where('jobOrderId', '==', filters.jobOrderId);
        const applicationsSnapshot = await applicationsQuery.get();
        const candidateIds = applicationsSnapshot.docs.map(doc => doc.data().candidateId).filter(Boolean);
        
        if (candidateIds.length > 0) {
          query = query.where('__name__', 'in', candidateIds);
        } else {
          // No candidates for this job order, skip this stage
          pipelineData[stage] = [];
          continue;
        }
      }

      if (filters.recruiterOwnerId) {
        query = query.where('recruiterOwnerId', '==', filters.recruiterOwnerId);
      }

      // Apply sorting by score (descending) and creation date
      query = query.orderBy('score', 'desc').orderBy('createdAt', 'desc');

      // Apply pagination
      query = query.limit(filters.limit).offset(filters.offset);

      // Execute query
      const snapshot = await query.get();

      // Process results
      const candidates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as any[];

      // Enrich candidates with additional data
      const enrichedCandidates = await enrichCandidatesWithPipelineData(filters.tenantId, candidates, filters.jobOrderId);

      pipelineData[stage] = enrichedCandidates;
    }

    // Get pipeline metrics
    const metrics = await getPipelineMetrics(filters.tenantId, filters.jobOrderId, filters.recruiterOwnerId);

    console.log(`Retrieved pipeline board with ${Object.values(pipelineData).flat().length} total candidates`);

    return {
      success: true,
      pipeline: pipelineData,
      metrics,
      filters,
    };

  } catch (error) {
    console.error('Error retrieving pipeline board:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Enrich candidates with pipeline-specific data
 */
async function enrichCandidatesWithPipelineData(tenantId: string, candidates: any[], jobOrderId?: string): Promise<any[]> {
  const enrichedCandidates = [];

  for (const candidate of candidates) {
    const enriched = { ...candidate };

    // Get applications for this candidate
    const applicationsQuery = db.collection('tenants').doc(tenantId).collection('applications')
      .where('candidateId', '==', candidate.id);
    const applicationsSnapshot = await applicationsQuery.get();
    const applications = applicationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    enriched.applications = applications;

    // Get interviews for this candidate
    const interviewsQuery = db.collection('tenants').doc(tenantId).collection('interviews')
      .where('candidateId', '==', candidate.id);
    const interviewsSnapshot = await interviewsQuery.get();
    const interviews = interviewsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    enriched.interviews = interviews;

    // Get offers for this candidate
    const offersQuery = db.collection('tenants').doc(tenantId).collection('offers')
      .where('candidateId', '==', candidate.id);
    const offersSnapshot = await offersQuery.get();
    const offers = offersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    enriched.offers = offers;

    // Get placements for this candidate
    const placementsQuery = db.collection('tenants').doc(tenantId).collection('placements')
      .where('candidateId', '==', candidate.id);
    const placementsSnapshot = await placementsQuery.get();
    const placements = placementsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    enriched.placements = placements;

    // Filter by job order if specified
    if (jobOrderId) {
      enriched.applications = enriched.applications.filter((app: any) => app.jobOrderId === jobOrderId);
      enriched.interviews = enriched.interviews.filter((int: any) => int.jobOrderId === jobOrderId);
      enriched.offers = enriched.offers.filter((offer: any) => offer.jobOrderId === jobOrderId);
      enriched.placements = enriched.placements.filter((placement: any) => placement.jobOrderId === jobOrderId);
    }

    // Calculate pipeline metrics for this candidate
    enriched.pipelineMetrics = {
      totalApplications: enriched.applications.length,
      totalInterviews: enriched.interviews.length,
      totalOffers: enriched.offers.length,
      totalPlacements: enriched.placements.length,
      lastActivity: Math.max(
        enriched.applications.length > 0 ? Math.max(...enriched.applications.map((a: any) => a.updatedAt || 0)) : 0,
        enriched.interviews.length > 0 ? Math.max(...enriched.interviews.map((i: any) => i.updatedAt || 0)) : 0,
        enriched.offers.length > 0 ? Math.max(...enriched.offers.map((o: any) => o.updatedAt || 0)) : 0,
        enriched.placements.length > 0 ? Math.max(...enriched.placements.map((p: any) => p.updatedAt || 0)) : 0,
        candidate.updatedAt || 0
      ),
    };

    enrichedCandidates.push(enriched);
  }

  return enrichedCandidates;
}

/**
 * Get pipeline metrics
 */
async function getPipelineMetrics(tenantId: string, jobOrderId?: string, recruiterOwnerId?: string): Promise<any> {
  const metrics: any = {};

  // Get total candidates by status
  const candidatesQuery = db.collection('tenants').doc(tenantId).collection('candidates');
  const candidatesSnapshot = await candidatesQuery.get();
  const candidates = candidatesSnapshot.docs.map(doc => doc.data());

  const statusCounts: { [key: string]: number } = {};
  candidates.forEach(candidate => {
    if (recruiterOwnerId && candidate.recruiterOwnerId !== recruiterOwnerId) return;
    statusCounts[candidate.status] = (statusCounts[candidate.status] || 0) + 1;
  });

  metrics.candidatesByStatus = statusCounts;
  metrics.totalCandidates = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

  // Get applications metrics
  const applicationsQuery = db.collection('tenants').doc(tenantId).collection('applications');
  const applicationsSnapshot = await applicationsQuery.get();
  const applications = applicationsSnapshot.docs.map(doc => doc.data());

  const applicationStatusCounts: { [key: string]: number } = {};
  applications.forEach(application => {
    if (jobOrderId && application.jobOrderId !== jobOrderId) return;
    applicationStatusCounts[application.status] = (applicationStatusCounts[application.status] || 0) + 1;
  });

  metrics.applicationsByStatus = applicationStatusCounts;
  metrics.totalApplications = Object.values(applicationStatusCounts).reduce((sum, count) => sum + count, 0);

  // Get interviews metrics
  const interviewsQuery = db.collection('tenants').doc(tenantId).collection('interviews');
  const interviewsSnapshot = await interviewsQuery.get();
  const interviews = interviewsSnapshot.docs.map(doc => doc.data());

  const interviewStatusCounts: { [key: string]: number } = {};
  interviews.forEach(interview => {
    if (jobOrderId && interview.jobOrderId !== jobOrderId) return;
    interviewStatusCounts[interview.status] = (interviewStatusCounts[interview.status] || 0) + 1;
  });

  metrics.interviewsByStatus = interviewStatusCounts;
  metrics.totalInterviews = Object.values(interviewStatusCounts).reduce((sum, count) => sum + count, 0);

  // Get offers metrics
  const offersQuery = db.collection('tenants').doc(tenantId).collection('offers');
  const offersSnapshot = await offersQuery.get();
  const offers = offersSnapshot.docs.map(doc => doc.data());

  const offerStateCounts: { [key: string]: number } = {};
  offers.forEach(offer => {
    if (jobOrderId && offer.jobOrderId !== jobOrderId) return;
    offerStateCounts[offer.state] = (offerStateCounts[offer.state] || 0) + 1;
  });

  metrics.offersByState = offerStateCounts;
  metrics.totalOffers = Object.values(offerStateCounts).reduce((sum, count) => sum + count, 0);

  // Calculate conversion rates
  if (metrics.totalApplications > 0) {
    metrics.applicationToInterviewRate = (metrics.interviewsByStatus.scheduled || 0) / metrics.totalApplications;
    metrics.interviewToOfferRate = (metrics.offersByState.sent || 0) / metrics.totalInterviews;
    metrics.offerToHireRate = (metrics.offersByState.accepted || 0) / metrics.totalOffers;
  }

  return metrics;
}
