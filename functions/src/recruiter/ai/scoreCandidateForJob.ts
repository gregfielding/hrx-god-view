import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Candidate-job scoring schema
const ScoreCandidateForJobSchema = z.object({
  tenantId: z.string().min(1),
  candidateId: z.string().min(1),
  jobOrderId: z.string().min(1),
  updatedBy: z.string().optional(),
});

/**
 * Scores candidate against job requirements using AI
 */
export const scoreCandidateForJob = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const { tenantId, candidateId, jobOrderId, updatedBy } = ScoreCandidateForJobSchema.parse(request.data);

    console.log(`Scoring candidate ${candidateId} for job ${jobOrderId} in tenant ${tenantId}`);

    // Get candidate data
    const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(candidateId);
    const candidateDoc = await candidateRef.get();

    if (!candidateDoc.exists) {
      throw new Error(`Candidate ${candidateId} not found`);
    }

    const candidateData = candidateDoc.data();

    // Get job order data
    const jobOrderRef = db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId);
    const jobOrderDoc = await jobOrderRef.get();

    if (!jobOrderDoc.exists) {
      throw new Error(`Job order ${jobOrderId} not found`);
    }

    const jobOrderData = jobOrderDoc.data();

    // Calculate AI score
    const scoreResult = await calculateCandidateJobScore(candidateData, jobOrderData);

    // Store the score
    const now = Date.now();
    const userId = updatedBy || 'system';

    const scoreData = {
      tenantId,
      candidateId,
      jobOrderId,
      overallScore: scoreResult.overallScore,
      breakdown: scoreResult.breakdown,
      recommendations: scoreResult.recommendations,
      riskFactors: scoreResult.riskFactors,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['ai_score', 'candidate', 'job', candidateId, jobOrderId],
    };

    // Store in ai_scores collection
    const scoreRef = db.collection('tenants').doc(tenantId).collection('ai_scores').doc();
    await scoreRef.set(scoreData);

    // Update candidate with latest score
    await candidateRef.update({
      lastJobScore: scoreResult.overallScore,
      lastJobScoreDate: now,
      lastJobScoreJobId: jobOrderId,
      updatedAt: now,
      updatedBy: userId,
    });

    // Create scoring event
    const scoringEvent = {
      type: 'candidate.job_scored',
      tenantId,
      entityType: 'candidate',
      entityId: candidateId,
      source: 'recruiter',
      dedupeKey: `candidate_job_scoring:${candidateId}:${jobOrderId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['candidate', 'job', 'scored', 'ai', candidateId, jobOrderId],
      payload: {
        candidateId,
        jobOrderId,
        scoreResult,
        scoreData,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(scoringEvent);

    console.log(`Successfully scored candidate ${candidateId} for job ${jobOrderId} with score ${scoreResult.overallScore}`);

    return {
      success: true,
      action: 'candidate_scored',
      candidateId,
      jobOrderId,
      tenantId,
      scoreResult,
      scoreId: scoreRef.id,
    };

  } catch (error) {
    console.error('Error scoring candidate for job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Calculate comprehensive candidate-job score
 */
async function calculateCandidateJobScore(candidate: any, jobOrder: any): Promise<any> {
  const breakdown: any = {};
  let overallScore = 0;

  // 1. Skills Match (35% weight)
  const skillsScore = calculateSkillsMatch(candidate, jobOrder);
  breakdown.skillsMatch = skillsScore;
  overallScore += skillsScore * 0.35;

  // 2. Experience Level (20% weight)
  const experienceScore = calculateExperienceMatch(candidate, jobOrder);
  breakdown.experience = experienceScore;
  overallScore += experienceScore * 0.20;

  // 3. Location/Distance (15% weight)
  const locationScore = calculateLocationMatch(candidate, jobOrder);
  breakdown.location = locationScore;
  overallScore += locationScore * 0.15;

  // 4. Availability (10% weight)
  const availabilityScore = calculateAvailabilityMatch(candidate, jobOrder);
  breakdown.availability = availabilityScore;
  overallScore += availabilityScore * 0.10;

  // 5. Compensation Fit (10% weight)
  const compensationScore = calculateCompensationMatch(candidate, jobOrder);
  breakdown.compensation = compensationScore;
  overallScore += compensationScore * 0.10;

  // 6. Work Authorization (5% weight)
  const authScore = calculateWorkAuthMatch(candidate, jobOrder);
  breakdown.workAuth = authScore;
  overallScore += authScore * 0.05;

  // 7. Reliability Score (5% weight)
  const reliabilityScore = calculateReliabilityScore(candidate);
  breakdown.reliability = reliabilityScore;
  overallScore += reliabilityScore * 0.05;

  // Generate recommendations
  const recommendations = generateRecommendations(breakdown, candidate, jobOrder);

  // Identify risk factors
  const riskFactors = identifyRiskFactors(breakdown, candidate, jobOrder);

  return {
    overallScore: Math.round(overallScore),
    breakdown,
    recommendations,
    riskFactors,
  };
}

/**
 * Calculate skills match score
 */
function calculateSkillsMatch(candidate: any, jobOrder: any): number {
  const candidateSkills = candidate.skills || [];
  const requiredSkills = jobOrder.requirements || [];
  
  if (requiredSkills.length === 0) return 100;
  
  const matchedSkills = requiredSkills.filter((skill: string) =>
    candidateSkills.some((candidateSkill: string) =>
      candidateSkill.toLowerCase().includes(skill.toLowerCase()) ||
      skill.toLowerCase().includes(candidateSkill.toLowerCase())
    )
  );
  
  return Math.round((matchedSkills.length / requiredSkills.length) * 100);
}

/**
 * Calculate experience match score
 */
function calculateExperienceMatch(candidate: any, jobOrder: any): number {
  const candidateExperience = candidate.experience || 0;
  const requiredExperience = jobOrder.minExperience || 0;
  
  if (candidateExperience >= requiredExperience) {
    return 100;
  } else if (candidateExperience >= requiredExperience * 0.7) {
    return 80;
  } else if (candidateExperience >= requiredExperience * 0.5) {
    return 60;
  } else {
    return Math.max(20, Math.round((candidateExperience / requiredExperience) * 100));
  }
}

/**
 * Calculate location match score
 */
function calculateLocationMatch(candidate: any, jobOrder: any): number {
  // This would integrate with geolocation services
  // For now, return a base score
  const candidateLocation = candidate.location;
  const jobLocation = jobOrder.location;
  
  if (!candidateLocation || !jobLocation) return 70;
  
  // Simple city/state matching
  if (candidateLocation.state === jobLocation.state) {
    return 90;
  } else if (candidateLocation.city === jobLocation.city) {
    return 100;
  } else {
    return 60;
  }
}

/**
 * Calculate availability match score
 */
function calculateAvailabilityMatch(candidate: any, jobOrder: any): number {
  const candidateAvailability = candidate.availability;
  const jobShifts = jobOrder.shifts || [];
  
  if (!candidateAvailability || jobShifts.length === 0) return 70;
  
  // Check if candidate is available immediately
  if (candidateAvailability.immediate) return 100;
  
  // Check preferred shifts
  const candidatePreferredShifts = candidateAvailability.preferredShifts || [];
  const hasShiftMatch = jobShifts.some((shift: any) =>
    candidatePreferredShifts.includes(shift.label)
  );
  
  return hasShiftMatch ? 90 : 70;
}

/**
 * Calculate compensation match score
 */
function calculateCompensationMatch(candidate: any, jobOrder: any): number {
  const candidateDesiredPay = candidate.compensation?.desiredPayRate;
  const jobPayRate = jobOrder.payRate;
  
  if (!candidateDesiredPay || !jobPayRate) return 80;
  
  const payDifference = Math.abs(candidateDesiredPay - jobPayRate);
  const payPercentage = payDifference / jobPayRate;
  
  if (payPercentage <= 0.1) return 100; // Within 10%
  else if (payPercentage <= 0.2) return 85; // Within 20%
  else if (payPercentage <= 0.3) return 70; // Within 30%
  else return 50; // More than 30% difference
}

/**
 * Calculate work authorization match score
 */
function calculateWorkAuthMatch(candidate: any, jobOrder: any): number {
  const candidateAuth = candidate.workAuth;
  
  if (candidateAuth === 'citizen') return 100;
  else if (candidateAuth === 'permanent_resident') return 95;
  else if (candidateAuth === 'work_visa') return 80;
  else return 60;
}

/**
 * Calculate reliability score based on candidate history
 */
function calculateReliabilityScore(candidate: any): number {
  // This would analyze candidate history, placements, etc.
  // For now, return a base score based on profile completeness
  const profileCompleteness = candidate.score || 0;
  return Math.min(100, profileCompleteness);
}

/**
 * Generate AI recommendations
 */
function generateRecommendations(breakdown: any, candidate: any, jobOrder: any): string[] {
  const recommendations: string[] = [];
  
  if (breakdown.skillsMatch < 70) {
    recommendations.push('Consider additional skills training or certification');
  }
  
  if (breakdown.experience < 60) {
    recommendations.push('May need additional training or mentorship');
  }
  
  if (breakdown.location < 80) {
    recommendations.push('Consider relocation assistance or remote work options');
  }
  
  if (breakdown.availability < 80) {
    recommendations.push('Verify availability and start date requirements');
  }
  
  if (breakdown.compensation < 70) {
    recommendations.push('Review compensation expectations and benefits');
  }
  
  if (breakdown.workAuth < 80) {
    recommendations.push('Verify work authorization documentation');
  }
  
  if (breakdown.reliability < 70) {
    recommendations.push('Consider additional background checks or references');
  }
  
  return recommendations;
}

/**
 * Identify risk factors
 */
function identifyRiskFactors(breakdown: any, candidate: any, jobOrder: any): string[] {
  const riskFactors: string[] = [];
  
  if (breakdown.skillsMatch < 50) {
    riskFactors.push('Significant skills gap');
  }
  
  if (breakdown.experience < 40) {
    riskFactors.push('Insufficient experience level');
  }
  
  if (breakdown.location < 60) {
    riskFactors.push('Location mismatch');
  }
  
  if (breakdown.workAuth < 70) {
    riskFactors.push('Work authorization concerns');
  }
  
  if (breakdown.reliability < 60) {
    riskFactors.push('Reliability concerns');
  }
  
  return riskFactors;
}
