import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Application creation schema
const CreateApplicationSchema = z.object({
  tenantId: z.string().min(1),
  mode: z.enum(['jobOrder', 'evergreen']),
  jobOrderId: z.string().optional(), // Required for jobOrder mode
  postId: z.string().min(1, 'Post ID is required'),
  candidateId: z.string().optional(), // For existing candidates
  externalApplicant: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    resumeUrl: z.string().optional(),
  }).optional(), // For external applicants
  resumeUrl: z.string().optional(),
  workAuth: z.enum(['citizen', 'permanent_resident', 'work_visa', 'other']),
  answers: z.array(z.object({
    questionId: z.string(),
    answer: z.string(),
  })).default([]),
  source: z.enum(['QR', 'URL', 'referral', 'Companion', 'Indeed', 'LinkedIn']),
  utm: z.object({
    source: z.string().optional(),
    medium: z.string().optional(),
    campaign: z.string().optional(),
    term: z.string().optional(),
    content: z.string().optional(),
  }).optional(),
  referralCode: z.string().optional(),
  createdBy: z.string().optional(),
});

/**
 * Creates a new application
 */
export const createApplication = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const applicationData = CreateApplicationSchema.parse(request.data);

    console.log(`Creating application for tenant ${applicationData.tenantId}`);

    const now = Date.now();
    const userId = applicationData.createdBy || 'system';

    // Validate mode-specific requirements
    if (applicationData.mode === 'jobOrder' && !applicationData.jobOrderId) {
      throw new Error('Job order ID is required for jobOrder mode');
    }

    if (!applicationData.candidateId && !applicationData.externalApplicant) {
      throw new Error('Either candidateId or externalApplicant is required');
    }

    // Verify post exists
    const postRef = db.collection('tenants').doc(applicationData.tenantId).collection('jobs_board_posts').doc(applicationData.postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      throw new Error(`Jobs board post ${applicationData.postId} not found`);
    }

    const postData = postDoc.data();

    // Verify job order exists if specified
    if (applicationData.jobOrderId) {
      const jobOrderRef = db.collection('tenants').doc(applicationData.tenantId).collection('job_orders').doc(applicationData.jobOrderId);
      const jobOrderDoc = await jobOrderRef.get();

      if (!jobOrderDoc.exists) {
        throw new Error(`Job order ${applicationData.jobOrderId} not found`);
      }
    }

    // Check for duplicate applications
    const existingApplicationRef = db.collection('tenants').doc(applicationData.tenantId).collection('applications');
    let existingQuery = existingApplicationRef.where('postId', '==', applicationData.postId);

    if (applicationData.candidateId) {
      existingQuery = existingQuery.where('candidateId', '==', applicationData.candidateId);
    } else if (applicationData.externalApplicant) {
      existingQuery = existingQuery.where('externalApplicant.email', '==', applicationData.externalApplicant.email);
    }

    const existingSnapshot = await existingQuery.get();

    if (!existingSnapshot.empty) {
      throw new Error('Application already exists for this candidate/post combination');
    }

    // Perform AI analysis if candidate exists
    let aiScore: number | undefined;
    let aiRecommendations: string[] | undefined;
    let duplicateCheck: any | undefined;

    if (applicationData.candidateId) {
      // Get candidate data for AI analysis
      const candidateRef = db.collection('tenants').doc(applicationData.tenantId).collection('candidates').doc(applicationData.candidateId);
      const candidateDoc = await candidateRef.get();

      if (candidateDoc.exists) {
        const candidateData = candidateDoc.data();
        
        // Calculate AI score
        aiScore = calculateApplicationScore(applicationData, candidateData, postData);
        
        // Generate AI recommendations
        aiRecommendations = generateAIRecommendations(applicationData, candidateData, postData);
        
        // Check for duplicates
        duplicateCheck = await checkForDuplicates(applicationData.tenantId, candidateData);
      }
    }

    // Create application data
    const newApplication = {
      ...applicationData,
      status: 'new' as const,
      aiScore,
      aiRecommendations,
      duplicateCheck,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: [
        applicationData.externalApplicant?.name?.toLowerCase(),
        applicationData.externalApplicant?.email?.toLowerCase(),
        applicationData.externalApplicant?.phone?.toLowerCase(),
        applicationData.answers?.map((a: any) => a.answer.toLowerCase()).join(' '),
        applicationData.source.toLowerCase(),
        'application',
        'new',
      ].filter(Boolean),
    };

    // Create the application
    const applicationRef = db.collection('tenants').doc(applicationData.tenantId).collection('applications').doc();
    await applicationRef.set(newApplication);

    const applicationId = applicationRef.id;

    // Update post metrics
    await postRef.update({
      'metrics.applications': (postData?.metrics?.applications || 0) + 1,
      updatedAt: now,
      updatedBy: userId,
    });

    // Create application creation event
    const creationEvent = {
      type: 'application.created',
      tenantId: applicationData.tenantId,
      entityType: 'application',
      entityId: applicationId,
      source: 'recruiter',
      dedupeKey: `application_creation:${applicationId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['application', 'created', 'recruiter', applicationId],
      payload: {
        applicationData: newApplication,
        postId: applicationData.postId,
        jobOrderId: applicationData.jobOrderId,
        candidateId: applicationData.candidateId,
        source: applicationData.source,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(creationEvent);

    // If external applicant, create candidate profile
    if (applicationData.externalApplicant && !applicationData.candidateId) {
      await createCandidateFromApplication(applicationData.tenantId, applicationId, applicationData, userId);
    }

    console.log(`Successfully created application ${applicationId}`);

    return {
      success: true,
      action: 'created',
      applicationId,
      tenantId: applicationData.tenantId,
      data: {
        id: applicationId,
        ...newApplication,
      }
    };

  } catch (error) {
    console.error('Error creating application:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Calculate application score based on candidate and job requirements
 */
function calculateApplicationScore(application: any, candidate: any, post: any): number {
  let score = 0;
  const maxScore = 100;

  // Basic application completeness (20 points)
  if (application.resumeUrl) score += 10;
  if (application.answers.length > 0) score += 10;

  // Work authorization (15 points)
  if (application.workAuth === 'citizen') score += 15;
  else if (application.workAuth === 'permanent_resident') score += 10;
  else if (application.workAuth === 'work_visa') score += 5;

  // Source quality (10 points)
  if (application.source === 'Companion') score += 10;
  else if (application.source === 'referral') score += 8;
  else if (application.source === 'URL') score += 6;
  else score += 4;

  // Candidate profile completeness (25 points)
  if (candidate) {
    if (candidate.score) score += Math.min(candidate.score * 0.25, 25);
  }

  // Answer quality (30 points)
  const answerScore = Math.min(application.answers.length * 3, 30);
  score += answerScore;

  return Math.min(score, maxScore);
}

/**
 * Generate AI recommendations for the application
 */
function generateAIRecommendations(application: any, candidate: any, post: any): string[] {
  const recommendations: string[] = [];

  if (!application.resumeUrl) {
    recommendations.push('Request resume from candidate');
  }

  if (application.answers.length < 3) {
    recommendations.push('Follow up for additional information');
  }

  if (candidate && candidate.score < 50) {
    recommendations.push('Consider additional screening questions');
  }

  if (application.workAuth !== 'citizen') {
    recommendations.push('Verify work authorization documents');
  }

  return recommendations;
}

/**
 * Check for duplicate candidates
 */
async function checkForDuplicates(tenantId: string, candidateData: any): Promise<any> {
  const candidatesRef = db.collection('tenants').doc(tenantId).collection('candidates');
  
  // Check by email
  const emailQuery = await candidatesRef
    .where('email', '==', candidateData.email)
    .get();

  if (!emailQuery.empty) {
    const duplicate = emailQuery.docs[0];
    return {
      isDuplicate: true,
      duplicateCandidateId: duplicate.id,
      confidence: 0.9,
      reason: 'Email match',
    };
  }

  // Check by phone
  if (candidateData.phone) {
    const phoneQuery = await candidatesRef
      .where('phone', '==', candidateData.phone)
      .get();

    if (!phoneQuery.empty) {
      const duplicate = phoneQuery.docs[0];
      return {
        isDuplicate: true,
        duplicateCandidateId: duplicate.id,
        confidence: 0.8,
        reason: 'Phone match',
      };
    }
  }

  return {
    isDuplicate: false,
    confidence: 0.1,
  };
}

/**
 * Create candidate profile from external application
 */
async function createCandidateFromApplication(tenantId: string, applicationId: string, applicationData: any, userId: string) {
  const now = Date.now();

  const candidateData = {
    tenantId,
    firstName: applicationData.externalApplicant.name.split(' ')[0],
    lastName: applicationData.externalApplicant.name.split(' ').slice(1).join(' '),
    email: applicationData.externalApplicant.email,
    phone: applicationData.externalApplicant.phone,
    resumeUrl: applicationData.externalApplicant.resumeUrl,
    workAuth: applicationData.workAuth,
    source: 'jobs_board' as const,
    recruiterOwnerId: 'system', // Will be assigned by recruiter
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    status: 'applicant' as const,
    score: 0, // Will be calculated
    searchKeywords: [
      applicationData.externalApplicant.name.toLowerCase(),
      applicationData.externalApplicant.email.toLowerCase(),
      'candidate',
      'applicant',
    ],
  };

  const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc();
  await candidateRef.set(candidateData);

  // Update application with candidate ID
  const applicationRef = db.collection('tenants').doc(tenantId).collection('applications').doc(applicationId);
  await applicationRef.update({
    candidateId: candidateRef.id,
    updatedAt: now,
    updatedBy: userId,
  });

  console.log(`Created candidate ${candidateRef.id} from application ${applicationId}`);
}
