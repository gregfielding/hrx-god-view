import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Public application schema
const ApplyToPostSchema = z.object({
  tenantId: z.string().min(1),
  postId: z.string().min(1),
  applicant: z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Valid email is required'),
    phone: z.string().optional(),
    resumeUrl: z.string().optional(),
  }),
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
  consents: z.array(z.string()).default([]),
});

/**
 * Handles public job applications
 */
export const applyToPost = onCall({
  cors: true,
  maxInstances: 20
}, async (request) => {
  try {
    // Validate input
    const applicationData = ApplyToPostSchema.parse(request.data);

    console.log(`Processing application to post ${applicationData.postId} in tenant ${applicationData.tenantId}`);

    // Verify the post exists and is public
    const postRef = db.collection('tenants').doc(applicationData.tenantId).collection('jobs_board_posts').doc(applicationData.postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      throw new Error(`Jobs board post ${applicationData.postId} not found`);
    }

    const postData = postDoc.data();
    if (!postData) {
      throw new Error(`No data found for jobs board post ${applicationData.postId}`);
    }

    // Check if post is public and active
    if (postData.visibility !== 'public') {
      throw new Error('This job posting is not publicly accessible');
    }

    if (postData.status !== 'posted') {
      throw new Error('This job posting is not currently accepting applications');
    }

    // Check application limit
    const existingApplicationsQuery = db.collection('tenants').doc(applicationData.tenantId).collection('applications')
      .where('postId', '==', applicationData.postId)
      .where('externalApplicant.email', '==', applicationData.applicant.email);
    
    const existingApplicationsSnapshot = await existingApplicationsQuery.get();

    if (!existingApplicationsSnapshot.empty) {
      throw new Error('You have already applied to this position');
    }

    // Check total applications limit
    const totalApplicationsQuery = db.collection('tenants').doc(applicationData.tenantId).collection('applications')
      .where('postId', '==', applicationData.postId);
    
    const totalApplicationsSnapshot = await totalApplicationsQuery.get();
    const totalApplications = totalApplicationsSnapshot.size;

    if (postData.applyLimit && totalApplications >= postData.applyLimit) {
      throw new Error('This position has reached its application limit');
    }

    const now = Date.now();

    // Create application data
    const newApplication = {
      tenantId: applicationData.tenantId,
      mode: postData.mode,
      jobOrderId: postData.jobOrderId,
      postId: applicationData.postId,
      externalApplicant: applicationData.applicant,
      workAuth: applicationData.workAuth,
      answers: applicationData.answers,
      source: applicationData.source,
      utm: applicationData.utm,
      referralCode: applicationData.referralCode,
      consents: applicationData.consents,
      status: 'new' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: 'public',
      updatedBy: 'public',
      searchKeywords: [
        applicationData.applicant.name.toLowerCase(),
        applicationData.applicant.email.toLowerCase(),
        applicationData.applicant.phone?.toLowerCase(),
        applicationData.answers.map((a: any) => a.answer.toLowerCase()).join(' '),
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
      'metrics.applications': (postData.metrics?.applications || 0) + 1,
      'metrics.conversionRate': ((postData.metrics?.applications || 0) + 1) / Math.max(postData.metrics?.views || 1, 1),
      updatedAt: now,
      updatedBy: 'public',
    });

    // Create application creation event
    const creationEvent = {
      type: 'application.created',
      tenantId: applicationData.tenantId,
      entityType: 'application',
      entityId: applicationId,
      source: 'public',
      dedupeKey: `public_application_creation:${applicationId}:${now}`,
      createdBy: 'public',
      updatedBy: 'public',
      searchKeywords: ['application', 'created', 'public', applicationId],
      payload: {
        applicationData: newApplication,
        postId: applicationData.postId,
        jobOrderId: postData.jobOrderId,
        source: applicationData.source,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(creationEvent);

    // Create candidate profile from application
    await createCandidateFromApplication(applicationData.tenantId, applicationId, newApplication);

    // Send confirmation email (placeholder)
    await sendApplicationConfirmation(applicationData.applicant.email, postData.title);

    console.log(`Successfully processed application ${applicationId} to post ${applicationData.postId}`);

    return {
      success: true,
      action: 'applied',
      applicationId,
      tenantId: applicationData.tenantId,
      postId: applicationData.postId,
      message: 'Your application has been submitted successfully. We will contact you soon.',
    };

  } catch (error) {
    console.error('Error processing application:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Create candidate profile from public application
 */
async function createCandidateFromApplication(tenantId: string, applicationId: string, applicationData: any) {
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
    createdBy: 'public',
    updatedBy: 'public',
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
    updatedBy: 'public',
  });

  console.log(`Created candidate ${candidateRef.id} from public application ${applicationId}`);
}

/**
 * Send application confirmation email
 */
async function sendApplicationConfirmation(email: string, jobTitle: string) {
  // This would integrate with email service
  // For now, just log the action
  console.log(`Sending application confirmation email to ${email} for job: ${jobTitle}`);
  
  // Placeholder for email integration
  // await sendEmail({
  //   to: email,
  //   subject: 'Application Received',
  //   template: 'application-confirmation',
  //   data: { jobTitle }
  // });
}
