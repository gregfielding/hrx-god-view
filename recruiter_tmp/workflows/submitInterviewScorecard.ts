import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Interview scorecard submission schema
const SubmitInterviewScorecardSchema = z.object({
  tenantId: z.string().min(1),
  interviewId: z.string().min(1),
  interviewerId: z.string().min(1),
  scores: z.array(z.object({
    category: z.string(),
    criteria: z.array(z.object({
      name: z.string(),
      score: z.number().min(0).max(100),
      weight: z.number().min(0).max(100),
      notes: z.string().optional(),
    })),
  })),
  overallScore: z.number().min(0).max(100),
  recommendation: z.enum(['strong_yes', 'yes', 'maybe', 'no', 'strong_no']),
  notes: z.string().optional(),
  submittedBy: z.string().optional(),
});

/**
 * Submits interview scorecard
 */
export const submitInterviewScorecard = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const scorecardData = SubmitInterviewScorecardSchema.parse(request.data);

    console.log(`Submitting scorecard for interview ${scorecardData.interviewId} in tenant ${scorecardData.tenantId}`);

    // Verify interview exists
    const interviewRef = db.collection('tenants').doc(scorecardData.tenantId).collection('interviews').doc(scorecardData.interviewId);
    const interviewDoc = await interviewRef.get();

    if (!interviewDoc.exists) {
      throw new Error(`Interview ${scorecardData.interviewId} not found`);
    }

    const interviewData = interviewDoc.data();
    if (!interviewData) {
      throw new Error(`No data found for interview ${scorecardData.interviewId}`);
    }

    // Verify interviewer is authorized
    if (!interviewData.interviewerIds.includes(scorecardData.interviewerId)) {
      throw new Error('Interviewer not authorized for this interview');
    }

    const now = Date.now();
    const userId = scorecardData.submittedBy || 'system';

    // Create scorecard data
    const scorecard = {
      ...scorecardData,
      submittedAt: now,
      submittedBy: userId,
    };

    // Update interview with scorecard
    const updateData: any = {
      updatedAt: now,
      updatedBy: userId,
    };

    // Add scorecard to existing scorecards or create new array
    if (interviewData.scorecards) {
      updateData.scorecards = [...interviewData.scorecards, scorecard];
    } else {
      updateData.scorecards = [scorecard];
    }

    // Calculate overall interview score
    const allScorecards = updateData.scorecards;
    const totalScore = allScorecards.reduce((sum: number, sc: any) => sum + sc.overallScore, 0);
    const averageScore = totalScore / allScorecards.length;

    updateData.overallScore = Math.round(averageScore);

    // Determine interview status based on recommendations
    const recommendations = allScorecards.map((sc: any) => sc.recommendation);
    const strongYesCount = recommendations.filter((r: string) => r === 'strong_yes').length;
    const yesCount = recommendations.filter((r: string) => r === 'yes').length;
    const noCount = recommendations.filter((r: string) => r === 'no' || r === 'strong_no').length;

    let newStatus = interviewData.status;
    if (noCount > 0 && noCount >= yesCount) {
      newStatus = 'rejected';
    } else if (strongYesCount > 0 || yesCount > 0) {
      newStatus = 'passed';
    }

    updateData.status = newStatus;

    // Update the interview
    await interviewRef.update(updateData);

    // Update candidate status based on interview result
    if (newStatus === 'passed') {
      await updateCandidateForPassedInterview(scorecardData.tenantId, interviewData.candidateId, interviewData.jobOrderId, userId);
    } else if (newStatus === 'rejected') {
      await updateCandidateForRejectedInterview(scorecardData.tenantId, interviewData.candidateId, interviewData.jobOrderId, userId);
    }

    // Create scorecard submission event
    const scorecardEvent = {
      type: 'interview.scorecard_submitted',
      tenantId: scorecardData.tenantId,
      entityType: 'interview',
      entityId: scorecardData.interviewId,
      source: 'recruiter',
      dedupeKey: `interview_scorecard_submission:${scorecardData.interviewId}:${scorecardData.interviewerId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['interview', 'scorecard', 'submitted', 'recruiter', scorecardData.interviewId],
      payload: {
        interviewId: scorecardData.interviewId,
        interviewerId: scorecardData.interviewerId,
        scorecard,
        overallScore: updateData.overallScore,
        status: newStatus,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(scorecardEvent);

    console.log(`Successfully submitted scorecard for interview ${scorecardData.interviewId}`);

    return {
      success: true,
      action: 'scorecard_submitted',
      interviewId: scorecardData.interviewId,
      tenantId: scorecardData.tenantId,
      overallScore: updateData.overallScore,
      status: newStatus,
      data: {
        scorecard,
        interviewData: { ...interviewData, ...updateData },
      }
    };

  } catch (error) {
    console.error('Error submitting interview scorecard:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Update candidate for passed interview
 */
async function updateCandidateForPassedInterview(tenantId: string, candidateId: string, jobOrderId: string, userId: string) {
  const now = Date.now();

  // Update candidate status
  const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(candidateId);
  await candidateRef.update({
    status: 'offer',
    offerStageAt: now,
    offerStageBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });

  // Update application status
  const applicationsQuery = db.collection('tenants').doc(tenantId).collection('applications')
    .where('candidateId', '==', candidateId)
    .where('jobOrderId', '==', jobOrderId);
  
  const applicationsSnapshot = await applicationsQuery.get();
  if (!applicationsSnapshot.empty) {
    const applicationDoc = applicationsSnapshot.docs[0];
    await applicationDoc.ref.update({
      status: 'interview_passed',
      updatedAt: now,
      updatedBy: userId,
    });
  }

  console.log(`Updated candidate ${candidateId} to offer stage after passed interview`);
}

/**
 * Update candidate for rejected interview
 */
async function updateCandidateForRejectedInterview(tenantId: string, candidateId: string, jobOrderId: string, userId: string) {
  const now = Date.now();

  // Update candidate status
  const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(candidateId);
  await candidateRef.update({
    status: 'rejected',
    rejectedAt: now,
    rejectedBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });

  // Update application status
  const applicationsQuery = db.collection('tenants').doc(tenantId).collection('applications')
    .where('candidateId', '==', candidateId)
    .where('jobOrderId', '==', jobOrderId);
  
  const applicationsSnapshot = await applicationsQuery.get();
  if (!applicationsSnapshot.empty) {
    const applicationDoc = applicationsSnapshot.docs[0];
    await applicationDoc.ref.update({
      status: 'interview_rejected',
      updatedAt: now,
      updatedBy: userId,
    });
  }

  console.log(`Updated candidate ${candidateId} to rejected after failed interview`);
}
