import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
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

type ScoreOptions = {
  force?: boolean;
  tenantId?: string | null;
  requestedBy?: string | null;
  source?: string | null;
};

type ScoreResult = {
  success: boolean;
  reason?: string;
  profileScore?: number;
  fitScore?: number | null;
  skipped?: boolean;
};

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

async function processApplicationScore(
  userId: string,
  applicationId: string,
  options: ScoreOptions = {}
): Promise<ScoreResult> {
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return { success: false, reason: 'user_not_found' };
  }

  const userData = userDoc.data() as any;
  const applicationData = userData.applicationData?.[applicationId];

  if (!applicationData) {
    return { success: false, reason: 'application_not_found' };
  }

  const profileScore = calculateProfileScore(userData);
  const profileUpdatePayload: Record<string, any> = {
    [`applicationData.${applicationId}.scores.profileScore`]: profileScore,
    [`applicationData.${applicationId}.scores.profileScoreCalculatedAt`]: admin.firestore.FieldValue.serverTimestamp(),
  };

  const updateScores = async (payload: Record<string, any>) => {
    await userRef.update(payload);
  };

  const tenantId =
    applicationData.jobOrderId?.split('_')[0] ||
    options.tenantId ||
    userData.activeTenantId ||
    userData.tenantId ||
    null;

  // Always persist the latest profile score snapshot
  await updateScores(profileUpdatePayload);

  if (profileScore < 40 && !options.force) {
    return {
      success: true,
      reason: 'profile_score_below_threshold',
      profileScore,
      fitScore: null,
      skipped: true,
    };
  }

  const jobOrderId = applicationData.jobOrderId;
  if (!jobOrderId) {
    return { success: false, reason: 'missing_job_order_id', profileScore };
  }

  if (!tenantId) {
    return { success: false, reason: 'missing_tenant_id', profileScore };
  }

  if (!(await checkRateLimit(tenantId))) {
    return { success: false, reason: 'rate_limited', profileScore };
  }

  const jobOrderDoc = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .get();

  if (!jobOrderDoc.exists) {
    return { success: false, reason: 'job_order_not_found', profileScore };
  }

  const jobOrder = jobOrderDoc.data();
  const jobRequirementsHash = hashJobRequirements(jobOrder);

  if (!options.force && isFitScoreCacheValid(applicationData, jobRequirementsHash)) {
    return {
      success: true,
      reason: 'cache_valid',
      profileScore,
      fitScore: applicationData.scores?.fitScore ?? null,
      skipped: true,
    };
  }

  const { score: fitScore, reasoning } = await calculateFitScoreWithAI(userData, jobOrder);

  const fitUpdatePayload: Record<string, any> = {
    ...profileUpdatePayload,
    [`applicationData.${applicationId}.scores.fitScore`]: fitScore,
    [`applicationData.${applicationId}.scores.fitScoreCalculatedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    [`applicationData.${applicationId}.scores.fitScoreReasoning`]: reasoning,
    [`applicationData.${applicationId}.scores.jobRequirementsHash`]: jobRequirementsHash,
    [`applicationData.${applicationId}.scores.version`]: 'v1',
  };

  await updateScores(fitUpdatePayload);

  return {
    success: true,
    profileScore,
    fitScore,
  };
}

export const processApplicantScoreQueue = onDocumentCreated(
  'applicantScoreQueue/{queueId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.warn('processApplicantScoreQueue: missing snapshot data');
      return null;
    }

    const queueRef = snapshot.ref;
    const payload = snapshot.data() as any;
    const userId = payload.userId;
    const applicationId = payload.applicationId;
    const force = payload.force === true;

    if (!userId || !applicationId) {
      await queueRef.update({
        status: 'error',
        errorMessage: 'Missing userId or applicationId',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }

    await queueRef.update({
      status: 'processing',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const result = await processApplicationScore(userId, applicationId, {
        force,
        tenantId: payload.tenantId || null,
        requestedBy: payload.requestedBy || null,
        source: payload.source || null,
      });

      const status = result.success
        ? result.skipped
          ? 'skipped'
          : 'completed'
        : result.reason === 'rate_limited'
          ? 'rate_limited'
          : 'error';

      await queueRef.update({
        status,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        profileScore: result.profileScore ?? null,
        fitScore: result.fitScore ?? null,
        resultReason: result.reason || null,
        skipped: !!result.skipped,
      });
    } catch (error) {
      console.error('processApplicantScoreQueue error:', error);
      await queueRef.update({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return null;
  }
);

export const enqueueApplicantScore = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const {
    userId,
    applicationId,
    tenantId = null,
    force = false,
    source = 'unknown',
  } = request.data || {};

  if (!userId || !applicationId) {
    throw new HttpsError('invalid-argument', 'userId and applicationId are required');
  }

  await db.collection('applicantScoreQueue').add({
    userId,
    applicationId,
    tenantId,
    source,
    force: !!force,
    requestedBy: request.auth.uid,
    status: 'queued',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

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
    const result = await processApplicationScore(userId, applicationId, {
      force: true,
      requestedBy: request.auth.uid,
      source: 'manual_recalculate',
    });

    return {
      success: result.success,
      profileScore: result.profileScore ?? null,
      fitScore: result.fitScore ?? null,
      reasoning: result.reason,
      skipped: result.skipped ?? false,
    };
  } catch (error: any) {
    console.error('Error recalculating score:', error);
    throw new HttpsError('internal', error.message);
  }
});

