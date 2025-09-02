import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Candidate update schema
const UpdateCandidateSchema = z.object({
  tenantId: z.string().min(1),
  candidateId: z.string().min(1),
  updates: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    experience: z.number().int().min(0).optional(),
    skills: z.array(z.string()).optional(),
    certifications: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    availability: z.object({
      immediate: z.boolean().optional(),
      startDate: z.string().optional(),
      preferredShifts: z.array(z.string()).optional(),
      preferredDays: z.array(z.number().int().min(0).max(6)).optional(),
    }).optional(),
    location: z.object({
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
      willingToRelocate: z.boolean().optional(),
      maxCommuteMinutes: z.number().int().positive().optional(),
    }).optional(),
    compensation: z.object({
      desiredPayRate: z.number().positive().optional(),
      minimumPayRate: z.number().positive().optional(),
      benefits: z.array(z.string()).optional(),
    }).optional(),
    notes: z.string().optional(),
    recruiterOwnerId: z.string().min(1).optional(),
    status: z.enum(['applicant', 'active_employee', 'inactive']).optional(),
    companionUserId: z.string().optional(),
    notificationPrefs: z.object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      push: z.boolean().optional(),
    }).optional(),
  }).partial(),
  updatedBy: z.string().optional(),
});

/**
 * Updates candidate profile with validation
 */
export const updateCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, candidateId, updates, updatedBy } = UpdateCandidateSchema.parse(request.data);

    console.log(`Updating candidate ${candidateId} in tenant ${tenantId}`);

    // Verify the candidate exists
    const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(candidateId);
    const candidateDoc = await candidateRef.get();

    if (!candidateDoc.exists) {
      throw new Error(`Candidate ${candidateId} not found`);
    }

    const existingData = candidateDoc.data();
    if (!existingData) {
      throw new Error(`No data found for candidate ${candidateId}`);
    }

    const now = Date.now();
    const userId = updatedBy || 'system';

    // Check for email conflicts if email is being updated
    if (updates.email && updates.email !== existingData.email) {
      const existingCandidateRef = db.collection('tenants').doc(tenantId).collection('candidates');
      const existingCandidateSnapshot = await existingCandidateRef
        .where('email', '==', updates.email)
        .get();

      if (!existingCandidateSnapshot.empty) {
        throw new Error(`Candidate with email ${updates.email} already exists`);
      }
    }

    // Verify recruiter exists if recruiterOwnerId is being updated
    if (updates.recruiterOwnerId) {
      const recruiterRef = db.collection('tenants').doc(tenantId).collection('users').doc(updates.recruiterOwnerId);
      const recruiterDoc = await recruiterRef.get();

      if (!recruiterDoc.exists) {
        throw new Error(`Recruiter ${updates.recruiterOwnerId} not found`);
      }
    }

    // Merge updates with existing data
    const updatedData: any = {
      ...existingData,
      ...updates,
      updatedAt: now,
      updatedBy: userId,
    };

    // Recalculate score if relevant fields changed
    const scoreRelevantFields = [
      'firstName', 'lastName', 'email', 'phone', 'title', 'experience',
      'skills', 'certifications', 'languages', 'availability', 'compensation'
    ];
    
    const hasScoreRelevantChanges = scoreRelevantFields.some(field => 
      updates[field as keyof typeof updates] !== undefined
    );

    if (hasScoreRelevantChanges) {
      const candidateDataForScoring = { ...existingData, ...updates };
      updatedData.score = calculateCandidateScore(candidateDataForScoring);
    }

    // Update search keywords if relevant fields changed
    const searchRelevantFields = [
      'firstName', 'lastName', 'email', 'title', 'skills', 'certifications'
    ];
    
    const hasSearchRelevantChanges = searchRelevantFields.some(field => 
      updates[field as keyof typeof updates] !== undefined
    );

    if (hasSearchRelevantChanges) {
      const newKeywords = [
        updates.firstName?.toLowerCase() || existingData.firstName?.toLowerCase(),
        updates.lastName?.toLowerCase() || existingData.lastName?.toLowerCase(),
        updates.email?.toLowerCase() || existingData.email?.toLowerCase(),
        updates.title?.toLowerCase() || existingData.title?.toLowerCase(),
        ...(updates.skills || existingData.skills || []).map(skill => skill.toLowerCase()),
        ...(updates.certifications || existingData.certifications || []).map(cert => cert.toLowerCase()),
        'candidate',
        existingData.status || 'applicant',
      ].filter(Boolean) as string[];
      
      updatedData.searchKeywords = newKeywords;
    }

    // Update the candidate
    await candidateRef.update(updatedData);

    // Create an event to notify other systems of the update
    const updateEvent = {
      type: 'candidate.updated',
      tenantId,
      entityType: 'candidate',
      entityId: candidateId,
      source: 'recruiter',
      dedupeKey: `candidate_update:${candidateId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['candidate', 'update', 'recruiter', candidateId],
      payload: {
        updatedFields: Object.keys(updates),
        previousData: existingData,
        newData: updatedData,
        recruiterOwnerId: updatedData.recruiterOwnerId,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(updateEvent);

    // If status changed to active_employee, update related applications
    if (updates.status === 'active_employee') {
      await handleCandidateHired(tenantId, candidateId, userId);
    }

    console.log(`Successfully updated candidate ${candidateId}`);

    return {
      success: true,
      action: 'updated',
      candidateId,
      tenantId,
      updatedFields: Object.keys(updates),
      data: updatedData
    };

  } catch (error) {
    console.error('Error updating candidate:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Handle candidate hired logic
 */
async function handleCandidateHired(tenantId: string, candidateId: string, userId: string) {
  const now = Date.now();

  // Update related applications to reflect candidate status
  const applicationsRef = db.collection('tenants').doc(tenantId).collection('applications');
  const applicationsSnapshot = await applicationsRef
    .where('candidateId', '==', candidateId)
    .where('status', 'in', ['new', 'screened', 'interviewing', 'offer'])
    .get();

  const batch = db.batch();
  applicationsSnapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      status: 'hired',
      updatedAt: now,
      updatedBy: userId,
    });
  });

  if (applicationsSnapshot.docs.length > 0) {
    await batch.commit();
    console.log(`Updated ${applicationsSnapshot.docs.length} applications for hired candidate ${candidateId}`);
  }

  // Create hired event
  const hiredEvent = {
    type: 'candidate.hired',
    tenantId,
    entityType: 'candidate',
    entityId: candidateId,
    source: 'recruiter',
    dedupeKey: `candidate_hired:${candidateId}:${now}`,
    createdBy: userId,
    updatedBy: userId,
    searchKeywords: ['candidate', 'hired', 'recruiter', candidateId],
    payload: {
      applicationsUpdated: applicationsSnapshot.docs.length,
    }
  };

  const { createEvent } = await import('../utils/events');
  await createEvent(hiredEvent);
}

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
  if (candidateData.skills && candidateData.skills.length > 0) score += 5;

  // Certifications and languages (20 points)
  if (candidateData.certifications && candidateData.certifications.length > 0) score += 10;
  if (candidateData.languages && candidateData.languages.length > 0) score += 10;

  // Availability and location (15 points)
  if (candidateData.availability) {
    if (candidateData.availability.immediate) score += 5;
    if (candidateData.availability.startDate) score += 5;
    if (candidateData.availability.preferredShifts && candidateData.availability.preferredShifts.length > 0) score += 5;
  }

  // Compensation preferences (10 points)
  if (candidateData.compensation) {
    if (candidateData.compensation.desiredPayRate) score += 5;
    if (candidateData.compensation.minimumPayRate) score += 5;
  }

  return Math.min(score, maxScore);
}
