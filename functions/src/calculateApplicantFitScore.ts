import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';

// Define OpenAI API key parameter
const openaiApiKey = defineString('OPENAI_API_KEY');

/**
 * Applicant Fit Score AI Function
 * 
 * Calculates AI-powered job fit scores for applicants with aggressive cost hardening:
 * 1. Only triggers on new/updated applications
 * 2. Threshold gating: Only scores profiles with Profile Score >= 40
 * 3. Aggressive caching: 7-day cache with job requirements hash
 * 4. Rate limiting: Max 100 AI calls per hour per tenant
 * 5. Lightweight prompts: ~150 tokens per applicant
 * 
 * Estimated cost: ~$0.02 per 1000 applicants with hardening
 */

const db = admin.firestore();

// Rate limiting storage
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if we're within rate limits for a tenant
 * Max 100 AI calls per hour per tenant
 */
async function checkRateLimit(tenantId: string): Promise<boolean> {
  const now = Date.now();
  const key = tenantId;
  
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 0, resetAt: now + 3600000 }); // 1 hour
  }
  
  const rateLimit = rateLimitMap.get(key)!;
  
  // Reset if hour has passed
  if (now > rateLimit.resetAt) {
    rateLimit.count = 0;
    rateLimit.resetAt = now + 3600000;
  }
  
  // Check if under limit
  if (rateLimit.count >= 100) {
    console.warn(`Rate limit exceeded for tenant ${tenantId}`);
    return false;
  }
  
  rateLimit.count++;
  return true;
}

/**
 * Calculate Profile Score (rule-based)
 * Same logic as frontend for consistency
 */
function calculateProfileScore(userData: any): number {
  let score = 0;

  // Basic Info Complete (20 points)
  const hasBasicInfo = !!(
    userData.firstName &&
    userData.lastName &&
    userData.email &&
    (userData.phone || userData.phoneE164) &&
    userData.dob &&
    (userData.address || userData.addressInfo)
  );
  if (hasBasicInfo) score += 20;

  // Verification Status (20 points)
  if (userData.phoneVerified) score += 10;
  if (userData.workEligibility) score += 10;

  // Skills Added (15 points)
  if (userData.skills && userData.skills.length >= 3) score += 15;
  else if (userData.skills && userData.skills.length > 0) {
    score += (userData.skills.length / 3) * 15;
  }

  // Work History (15 points)
  if (userData.workHistory && userData.workHistory.length > 0) score += 15;

  // Certifications (10 points)
  if (userData.certifications && userData.certifications.length > 0) score += 10;

  // Education (5 points)
  if (userData.education && userData.education.length > 0) score += 5;

  // Engagement Bonuses
  if (userData.loginCount && userData.loginCount > 3) score += 5;
  
  if (userData.updatedAt) {
    const updatedDate = userData.updatedAt.toDate();
    const daysSinceUpdate = (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate <= 30) score += 5;
  }

  if (userData.applicationData && Object.keys(userData.applicationData).length > 1) score += 3;
  if (userData.languages && userData.languages.length > 0) score += 2;

  return Math.min(Math.round(score), 100);
}

/**
 * Generate hash of job requirements for cache invalidation
 */
function hashJobRequirements(jobOrder: any): string {
  const requirements = {
    jobTitle: jobOrder.jobTitle,
    skillsRequired: jobOrder.skillsRequired || [],
    experienceRequired: jobOrder.experienceRequired,
    educationRequired: jobOrder.educationRequired,
    licensesCerts: jobOrder.licensesCerts || [],
    physicalRequirements: jobOrder.physicalRequirements || []
  };
  
  return JSON.stringify(requirements);
}

/**
 * Check if cached Fit Score is still valid
 */
function isFitScoreCacheValid(
  appData: any,
  currentJobRequirementsHash: string
): boolean {
  if (!appData.scores?.fitScore) return false;
  if (!appData.scores?.fitScoreCalculatedAt) return false;
  if (appData.scores?.jobRequirementsHash !== currentJobRequirementsHash) return false;

  const calculatedDate = appData.scores.fitScoreCalculatedAt.toDate();
  const daysSinceCalculation = (Date.now() - calculatedDate.getTime()) / (1000 * 60 * 60 * 24);
  
  return daysSinceCalculation <= 7;
}

/**
 * Call OpenAI to calculate Fit Score
 * Uses lightweight prompt to minimize token usage
 */
async function calculateFitScoreWithAI(
  userData: any,
  jobOrder: any
): Promise<{ score: number; reasoning: string }> {
  
  // Build lightweight prompt
  const prompt = `Score applicant fit (0-100) for job.

Job: ${jobOrder.jobTitle || 'Not specified'}
Required Skills: ${jobOrder.skillsRequired?.slice(0, 5).join(', ') || 'None specified'}
Experience Level: ${jobOrder.experienceRequired || 'Not specified'}
Required Certs: ${jobOrder.licensesCerts?.slice(0, 3).join(', ') || 'None'}

Applicant Skills: ${userData.skills?.slice(0, 10).join(', ') || 'None listed'}
Work History: ${userData.workHistory?.[0]?.title || 'None'} at ${userData.workHistory?.[0]?.employer || 'Unknown'}
Certifications: ${userData.certifications?.slice(0, 3).map((c: any) => c.name || c).join(', ') || 'None'}
Education: ${userData.education?.[0]?.degree || 'None'}

Output JSON only: {"score": 0-100, "reasoning": "1 sentence max"}`;

  try {
    // Use Firebase Functions parameter for API key
    const apiKey = openaiApiKey.value();
    
    if (!apiKey) {
      console.error('OpenAI API key not configured');
      return { score: 50, reasoning: 'API key not configured, using default score' };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cheapest model, good for scoring
        messages: [
          {
            role: 'system',
            content: 'You are a recruiter scoring applicant-job fit. Return only JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 100
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const result = JSON.parse(content);
    
    return {
      score: Math.min(Math.max(result.score, 0), 100),
      reasoning: result.reasoning || 'No reasoning provided'
    };
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    return { score: 50, reasoning: 'Error calculating score, using default' };
  }
}

/**
 * Main trigger: Calculate scores when user document is updated
 * Only processes new/updated applications
 */
export const calculateApplicantScores = onDocumentWritten(
  'users/{userId}',
  async (event) => {
    const userId = event.params.userId;
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    // Skip if document was deleted
    if (!afterData) {
      console.log(`User ${userId} deleted, skipping`);
      return null;
    }

    // Check if applicationData changed OR if profile data changed (affects scores)
    const beforeAppData = beforeData?.applicationData || {};
    const afterAppData = afterData?.applicationData || {};
    
    const beforeKeys = Object.keys(beforeAppData);
    const afterKeys = Object.keys(afterAppData);
    
    // Check if profile data changed (skills, work history, certifications, etc.)
    const profileDataChanged = 
      JSON.stringify(beforeData?.skills) !== JSON.stringify(afterData?.skills) ||
      JSON.stringify(beforeData?.workHistory) !== JSON.stringify(afterData?.workHistory) ||
      JSON.stringify(beforeData?.certifications) !== JSON.stringify(afterData?.certifications) ||
      JSON.stringify(beforeData?.education) !== JSON.stringify(afterData?.education) ||
      beforeData?.phoneVerified !== afterData?.phoneVerified ||
      beforeData?.workEligibility !== afterData?.workEligibility;
    
    // Check if manual fit score trigger was fired
    const manualTrigger = beforeData?._fitScoreTrigger !== afterData?._fitScoreTrigger;
    
    // Find new or updated applications
    let newOrUpdatedApps = afterKeys.filter(appId => {
      if (!beforeKeys.includes(appId)) return true; // New application
      
      // Check if status or job changed
      const before = beforeAppData[appId];
      const after = afterAppData[appId];
      
      return before.status !== after.status || 
             before.jobOrderId !== after.jobOrderId;
    });

    // If profile data changed OR manual trigger, re-score ALL active applications
    if ((profileDataChanged || manualTrigger) && newOrUpdatedApps.length === 0) {
      if (manualTrigger) {
        console.log(`Manual trigger for user ${userId}, re-scoring all applications`);
      } else {
        console.log(`Profile data changed for user ${userId}, re-scoring all applications`);
      }
      newOrUpdatedApps = afterKeys.filter(appId => {
        const app = afterAppData[appId];
        return app.status === 'submitted' || app.status === 'accepted';
      });
    }

    if (newOrUpdatedApps.length === 0) {
      // No applications to process
      return null;
    }

    console.log(`Processing ${newOrUpdatedApps.length} applications for user ${userId}`);

    // Calculate Profile Score (always, it's free)
    const profileScore = calculateProfileScore(afterData);
    
    // Process each new/updated application
    for (const applicationId of newOrUpdatedApps) {
      const appData = afterAppData[applicationId];
      
      console.log(`Processing application ${applicationId}:`, {
        status: appData?.status,
        jobOrderId: appData?.jobOrderId,
        hasStatus: !!appData?.status
      });
      
      // Skip malformed application entries (e.g., entries without proper structure)
      if (!appData || typeof appData !== 'object') {
        console.log(`Application ${applicationId} is malformed, skipping`);
        continue;
      }
      
      // Only process submitted or accepted applications
      if (appData.status !== 'submitted' && appData.status !== 'accepted') {
        console.log(`Application ${applicationId} has status ${appData.status}, skipping`);
        continue;
      }

      // Only calculate Fit Score if profile is >= 40% complete
      if (profileScore < 40) {
        console.log(`Profile score ${profileScore} below threshold for ${userId}`);
        
        // Save Profile Score only
        await db.collection('users').doc(userId).update({
          [`applicationData.${applicationId}.scores.profileScore`]: profileScore,
          [`applicationData.${applicationId}.scores.profileScoreCalculatedAt`]: admin.firestore.FieldValue.serverTimestamp()
        });
        
        continue;
      }

      // Get job order details
      if (!appData.jobOrderId) {
        console.log(`No jobOrderId for application ${applicationId}`);
        continue;
      }

      const tenantId = appData.jobOrderId.split('_')[0] || afterData.activeTenantId;
      if (!tenantId) {
        console.log(`Cannot determine tenantId for application ${applicationId}`);
        continue;
      }

      // Check rate limit
      if (!await checkRateLimit(tenantId)) {
        console.log(`Rate limit exceeded for tenant ${tenantId}, queueing for later`);
        // TODO: Add to queue for batch processing
        continue;
      }

      try {
        const jobOrderDoc = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('job_orders')
          .doc(appData.jobOrderId)
          .get();

        if (!jobOrderDoc.exists) {
          console.log(`Job order ${appData.jobOrderId} not found`);
          continue;
        }

        const jobOrder = jobOrderDoc.data();
        const jobRequirementsHash = hashJobRequirements(jobOrder);

        // Check if cached Fit Score is still valid
        if (isFitScoreCacheValid(appData, jobRequirementsHash)) {
          console.log(`Using cached Fit Score for ${applicationId}`);
          continue;
        }

        // Calculate Fit Score with AI
        console.log(`Calculating Fit Score for ${applicationId} (Profile Score: ${profileScore})`);
        const { score: fitScore, reasoning } = await calculateFitScoreWithAI(afterData, jobOrder);

        // Save both scores
        await db.collection('users').doc(userId).update({
          [`applicationData.${applicationId}.scores`]: {
            profileScore,
            profileScoreCalculatedAt: admin.firestore.FieldValue.serverTimestamp(),
            fitScore,
            fitScoreCalculatedAt: admin.firestore.FieldValue.serverTimestamp(),
            fitScoreReasoning: reasoning,
            jobRequirementsHash,
            version: 'v1'
          }
        });

        console.log(`✅ Scores calculated for ${applicationId}: Profile=${profileScore}, Fit=${fitScore}`);
      } catch (error) {
        console.error(`Error processing application ${applicationId}:`, error);
      }
    }

    return null;
  }
);

/**
 * Callable function to manually trigger scoring for a specific application
 * Useful for re-scoring or testing
 */
export const recalculateApplicantScore = onCall(async (request) => {
  // Require authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { userId, applicationId } = request.data;

  if (!userId || !applicationId) {
    throw new HttpsError('invalid-argument', 'userId and applicationId required');
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data()!;
    const appData = userData.applicationData?.[applicationId];

    if (!appData) {
      throw new HttpsError('not-found', 'Application not found');
    }

    // Calculate Profile Score
    const profileScore = calculateProfileScore(userData);

    // Only calculate Fit Score if profile >= 40%
    if (profileScore < 40) {
      return {
        success: true,
        profileScore,
        fitScore: null,
        message: 'Profile score below threshold for fit scoring'
      };
    }

    // Get job order
    const tenantId = appData.jobOrderId?.split('_')[0] || userData.activeTenantId;
    const jobOrderDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('job_orders')
      .doc(appData.jobOrderId)
      .get();

    if (!jobOrderDoc.exists) {
      throw new HttpsError('not-found', 'Job order not found');
    }

    const jobOrder = jobOrderDoc.data()!;
    const { score: fitScore, reasoning } = await calculateFitScoreWithAI(userData, jobOrder);
    const jobRequirementsHash = hashJobRequirements(jobOrder);

    // Save scores
    await db.collection('users').doc(userId).update({
      [`applicationData.${applicationId}.scores`]: {
        profileScore,
        profileScoreCalculatedAt: admin.firestore.FieldValue.serverTimestamp(),
        fitScore,
        fitScoreCalculatedAt: admin.firestore.FieldValue.serverTimestamp(),
        fitScoreReasoning: reasoning,
        jobRequirementsHash,
        version: 'v1'
      }
    });

    return {
      success: true,
      profileScore,
      fitScore,
      reasoning
    };
  } catch (error: any) {
    console.error('Error recalculating score:', error);
    throw new HttpsError('internal', error.message);
  }
});

