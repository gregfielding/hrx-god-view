import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Candidate creation schema
const CreateCandidateSchema = z.object({
  tenantId: z.string().min(1),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional(),
  title: z.string().optional(),
  experience: z.number().int().min(0).optional(),
  skills: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  availability: z.object({
    immediate: z.boolean().default(false),
    startDate: z.string().optional(),
    preferredShifts: z.array(z.string()).default([]),
    preferredDays: z.array(z.number().int().min(0).max(6)).default([]),
  }).optional(),
  location: z.object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    willingToRelocate: z.boolean().default(false),
    maxCommuteMinutes: z.number().int().positive().optional(),
  }).optional(),
  compensation: z.object({
    desiredPayRate: z.number().positive().optional(),
    minimumPayRate: z.number().positive().optional(),
    benefits: z.array(z.string()).default([]),
  }).optional(),
  notes: z.string().optional(),
  recruiterOwnerId: z.string().min(1, 'Recruiter owner is required'),
  source: z.enum(['manual', 'jobs_board', 'referral', 'import', 'companion']).default('manual'),
  companionUserId: z.string().optional(), // Link to Companion user if exists
  notificationPrefs: z.object({
    email: z.boolean().default(true),
    sms: z.boolean().default(true),
    push: z.boolean().default(true),
  }).optional(),
  createdBy: z.string().optional(),
});

/**
 * Creates a new candidate profile
 */
export const createCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const candidateData = CreateCandidateSchema.parse(request.data);

    console.log(`Creating candidate for tenant ${candidateData.tenantId}`);

    const now = Date.now();
    const userId = candidateData.createdBy || 'system';

    // Verify recruiter exists
    const recruiterRef = db.collection('tenants').doc(candidateData.tenantId).collection('users').doc(candidateData.recruiterOwnerId);
    const recruiterDoc = await recruiterRef.get();

    if (!recruiterDoc.exists) {
      throw new Error(`Recruiter ${candidateData.recruiterOwnerId} not found`);
    }

    // Check for duplicate email
    const existingCandidateRef = db.collection('tenants').doc(candidateData.tenantId).collection('candidates');
    const existingCandidateSnapshot = await existingCandidateRef
      .where('email', '==', candidateData.email)
      .get();

    if (!existingCandidateSnapshot.empty) {
      throw new Error(`Candidate with email ${candidateData.email} already exists`);
    }

    // Calculate initial score based on profile completeness
    const score = calculateCandidateScore(candidateData);

    // Create candidate data
    const newCandidate = {
      ...candidateData,
      status: 'applicant' as const,
      score,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      // Companion integration fields
      companionUserId: candidateData.companionUserId || null,
      notificationPrefs: candidateData.notificationPrefs || {
        email: true,
        sms: true,
        push: true,
      },
      // Compliance status tracking
      complianceStatus: {
        i9Status: 'pending' as const,
        bgcStatus: 'pending' as const,
        drugStatus: 'pending' as const,
      },
      searchKeywords: [
        candidateData.firstName.toLowerCase(),
        candidateData.lastName.toLowerCase(),
        candidateData.email.toLowerCase(),
        candidateData.title?.toLowerCase(),
        ...candidateData.skills.map(skill => skill.toLowerCase()),
        ...candidateData.certifications.map(cert => cert.toLowerCase()),
        'candidate',
        'applicant',
      ].filter(Boolean),
    };

    // Create the candidate
    const candidateRef = db.collection('tenants').doc(candidateData.tenantId).collection('candidates').doc();
    await candidateRef.set(newCandidate);

    const candidateId = candidateRef.id;

    // Create candidate creation event
    const creationEvent = {
      type: 'candidate.created',
      tenantId: candidateData.tenantId,
      entityType: 'candidate',
      entityId: candidateId,
      source: 'recruiter',
      dedupeKey: `candidate_creation:${candidateId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['candidate', 'created', 'recruiter', candidateId],
      payload: {
        candidateData: newCandidate,
        recruiterOwnerId: candidateData.recruiterOwnerId,
        companionUserId: candidateData.companionUserId,
        source: candidateData.source,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(creationEvent);

    console.log(`Successfully created candidate ${candidateId}`);

    return {
      success: true,
      action: 'created',
      candidateId,
      tenantId: candidateData.tenantId,
      data: {
        id: candidateId,
        ...newCandidate,
      }
    };

  } catch (error) {
    console.error('Error creating candidate:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Calculate candidate score based on profile completeness
 */
function calculateCandidateScore(candidateData: any): number {
  let score = 0;
  const maxScore = 100;

  // Basic information (30 points)
  if (candidateData.firstName) score += 5;
  if (candidateData.lastName) score += 5;
  if (candidateData.email) score += 10;
  if (candidateData.phone) score += 10;

  // Professional information (25 points)
  if (candidateData.title) score += 10;
  if (candidateData.experience !== undefined) score += 10;
  if (candidateData.skills.length > 0) score += 5;

  // Certifications and languages (20 points)
  if (candidateData.certifications.length > 0) score += 10;
  if (candidateData.languages.length > 0) score += 10;

  // Availability and location (15 points)
  if (candidateData.availability) {
    if (candidateData.availability.immediate) score += 5;
    if (candidateData.availability.startDate) score += 5;
    if (candidateData.availability.preferredShifts.length > 0) score += 5;
  }

  // Compensation preferences (10 points)
  if (candidateData.compensation) {
    if (candidateData.compensation.desiredPayRate) score += 5;
    if (candidateData.compensation.minimumPayRate) score += 5;
  }

  return Math.min(score, maxScore);
}
