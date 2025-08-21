import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe deal coach analysis
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'dealCoachAnalyzeCallable@v2',
  // OpenAI API limits
  OPENAI_TIMEOUT_MS: 30000, // 30 seconds for OpenAI calls
  MAX_OPENAI_RETRIES: 2,
  // Cache settings
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  // Rate limiting
  MAX_REQUESTS_PER_MINUTE: 30,
  // Query limits
  MAX_MESSAGES_CONTEXT: 10,
  // Cost limits
  MAX_COST_PER_CALL: 0.10 // $0.10 USD max per call
};

// Zod schema for response validation (simplified)
const AnalyzeResponse = {
  parse: (data: any) => {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format');
    }
    return {
      summary: data.summary || 'No summary available.',
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : []
    };
  }
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Validate input parameters
 */
function validateInput(data: any): {
  dealId: string;
  stageKey: string;
  tenantId: string;
  entityType?: string;
  entityName?: string;
  contactCompany?: string;
  contactTitle?: string;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { dealId, stageKey, tenantId, entityType, entityName, contactCompany, contactTitle } = data;

  if (!dealId || typeof dealId !== 'string' || dealId.trim() === '') {
    throw new Error('dealId is required and must be a non-empty string');
  }

  if (!stageKey || typeof stageKey !== 'string' || stageKey.trim() === '') {
    throw new Error('stageKey is required and must be a non-empty string');
  }

  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  // Validate entityType if provided
  if (entityType && !['deal', 'contact', 'company'].includes(entityType)) {
    throw new Error('entityType must be one of: deal, contact, company');
  }

  return {
    dealId: dealId.trim(),
    stageKey: stageKey.trim(),
    tenantId: tenantId.trim(),
    entityType,
    entityName,
    contactCompany,
    contactTitle
  };
}

/**
 * Check cache for existing analysis
 */
async function checkCache(dealId: string, stageKey: string): Promise<any | null> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('checkCache', 0.001);

  const cacheId = `coach_analyze_${dealId}_${stageKey}`;
  const cacheRef = db.collection('ai_cache').doc(cacheId);
  const cached = await cacheRef.get();
  
  if (cached.exists) {
    const data = cached.data() as any;
    const now = Date.now();
    if (data.updatedAt && (now - data.updatedAt.toMillis()) < SAFE_CONFIG.CACHE_TTL_MS) {
      try {
        const parsed = AnalyzeResponse.parse(data.payload);
        console.log(`✅ Cache hit for deal ${dealId}, stage ${stageKey}`);
        return parsed;
      } catch (error) {
        console.warn('Invalid cache data, will regenerate');
      }
    }
  }
  
  return null;
}

/**
 * Get entity data safely with query limits
 */
async function getEntityDataSafely(
  tenantId: string,
  dealId: string,
  entityType: string = 'deal'
): Promise<{ entityData: any; snapshot: any }> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getEntityDataSafely', 0.002);

  const isContact = entityType === 'contact';
  const isCompany = entityType === 'company';
  
  let entityData: any = null;
  let snapshot: any = null;

  if (isContact) {
    // Get contact data
    const contactRef = db.doc(`tenants/${tenantId}/crm_contacts/${dealId}`);
    const contactSnap = await contactRef.get();
    if (!contactSnap.exists) {
      throw new Error('Contact not found');
    }
    entityData = contactSnap.data() as any;

    // Build contact snapshot
    snapshot = {
      contact: entityData,
      contactName: entityData.fullName || entityData.firstName || entityData.lastName,
      contactCompany: entityData.companyName,
      contactTitle: entityData.jobTitle || entityData.title,
      stage: 'contact_analysis'
    };
  } else if (isCompany) {
    // Get company data
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${dealId}`);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      throw new Error('Company not found');
    }
    entityData = companySnap.data() as any;

    // Build company snapshot
    snapshot = {
      company: entityData,
      companyName: entityData.companyName || entityData.name,
      stage: 'company_analysis'
    };
  } else {
    // Get deal data (default)
    const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${dealId}`);
    const dealSnap = await dealRef.get();
    if (!dealSnap.exists) {
      throw new Error('Deal not found');
    }
    entityData = dealSnap.data() as any;

    // Build deal snapshot
    snapshot = {
      deal: entityData,
      stage: entityData.stage || 'unknown'
    };
  }

  return { entityData, snapshot };
}

/**
 * Get thread messages safely with limits
 */
async function getThreadMessagesSafely(tenantId: string, dealId: string): Promise<any[]> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getThreadMessagesSafely', 0.001);

  // Ensure thread doc exists and update stageKey
  const threadRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}`);
  const threadSnap = await threadRef.get();
  const existing = threadSnap.exists ? (threadSnap.data() as any) : {};
  const existingMessages: any[] = Array.isArray(existing.messages) ? existing.messages : [];
  
  // Limit to last N messages for context
  const limitedMessages = existingMessages.slice(-SAFE_CONFIG.MAX_MESSAGES_CONTEXT);
  
  return limitedMessages;
}

/**
 * Call OpenAI API safely with timeout and retry logic
 */
async function callOpenAISafely(system: string, snapshot: any, entityType: string): Promise<any> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('callOpenAISafely', 0.05); // Estimate $0.05 per OpenAI call

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('OpenAI API key not configured, returning default response');
    return { summary: `Summary for ${entityType}.`, suggestions: [] };
  }

  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= SAFE_CONFIG.MAX_OPENAI_RETRIES; attempt++) {
    try {
      console.log(`🔄 OpenAI API call attempt ${attempt}/${SAFE_CONFIG.MAX_OPENAI_RETRIES}`);
      
      // Set up timeout for OpenAI call
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SAFE_CONFIG.OPENAI_TIMEOUT_MS);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${apiKey}` 
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Use more cost-effective model
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Stage: ${snapshot.stage}\nSnapshot: ${JSON.stringify(snapshot)}` }
          ],
          temperature: 0.3,
          max_tokens: 1000 // Limit token usage for cost control
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();
      const raw = data?.choices?.[0]?.message?.content;
      
      if (!raw) {
        throw new Error('No content in OpenAI response');
      }

      const result = JSON.parse(raw);
      console.log(`✅ OpenAI API call successful on attempt ${attempt}`);
      return result;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown OpenAI error');
      console.warn(`OpenAI API call attempt ${attempt} failed:`, lastError.message);
      
      if (attempt < SAFE_CONFIG.MAX_OPENAI_RETRIES) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  console.error('All OpenAI API call attempts failed');
  return { summary: 'Analysis temporarily unavailable.', suggestions: [] };
}

/**
 * Update thread document safely
 */
async function updateThreadSafely(tenantId: string, dealId: string, stageKey: string, messages: any[]): Promise<void> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('updateThreadSafely', 0.001);

  const threadRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}`);
  await threadRef.set({
    id: dealId,
    stageKey,
    model: 'gpt-4o-mini',
    messages,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/**
 * Update cache safely
 */
async function updateCacheSafely(dealId: string, stageKey: string, result: any): Promise<void> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('updateCacheSafely', 0.001);

  const cacheId = `coach_analyze_${dealId}_${stageKey}`;
  const cacheRef = db.collection('ai_cache').doc(cacheId);
  await cacheRef.set({ 
    payload: result, 
    updatedAt: admin.firestore.FieldValue.serverTimestamp() 
  }, { merge: true });
}

/**
 * Safe version of dealCoachAnalyzeCallable with hardening playbook compliance
 */
export const dealCoachAnalyzeCallable = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '1GiB', // More memory for AI processing
    maxInstances: 2
  },
  async (request) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate input
      const { dealId, stageKey, tenantId, entityType, entityName, contactCompany, contactTitle } = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Check cache first
      const cachedResult = await checkCache(dealId, stageKey);
      if (cachedResult) {
        const costSummary = CostTracker.getCostSummary();
        console.log(`Deal coach analysis completed (cache hit) for ${dealId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);
        return { ...cachedResult, threadId: dealId, cacheHit: true };
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get entity data
      const { entityData, snapshot } = await getEntityDataSafely(tenantId, dealId, entityType);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get thread messages
      const messages = await getThreadMessagesSafely(tenantId, dealId);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Update thread document
      await updateThreadSafely(tenantId, dealId, stageKey, messages);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Determine system prompt based on entity type
      let system = '';
      if (entityType === 'contact') {
        system = 'You are the Sales Coach AI. Analyze the current contact and provide actionable suggestions for engagement. Focus on relationship building, communication strategies, and specific actions the salesperson can take. Keep suggestions practical and specific to the staffing industry.';
      } else if (entityType === 'company') {
        system = 'You are the Company Coach AI. Analyze the current company and provide actionable suggestions for business development and relationship building. Focus on company engagement strategies, partnership opportunities, and specific actions the salesperson can take to grow the relationship. Keep suggestions practical and specific to the staffing industry.';
      } else {
        system = 'You are the Deal Coach AI. Analyze the current deal stage and provide actionable suggestions. Focus on next steps, potential roadblocks, and specific actions the salesperson can take. Keep suggestions practical and specific to the staffing industry.';
      }

      // Call OpenAI safely
      const result = await callOpenAISafely(system, snapshot, entityType);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate response
      const parsed = AnalyzeResponse.parse(result);

      // Check cost limits
      const costSummary = CostTracker.getCostSummary();
      if (costSummary.estimatedCost > SAFE_CONFIG.MAX_COST_PER_CALL) {
        console.warn(`Cost limit exceeded: $${costSummary.estimatedCost.toFixed(4)} > $${SAFE_CONFIG.MAX_COST_PER_CALL}`);
      }

      // Update cache
      await updateCacheSafely(dealId, stageKey, parsed);

      console.log(`Deal coach analysis completed for ${dealId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        ...parsed, 
        threadId: dealId, 
        cacheHit: false,
        _metadata: {
          entityType,
          stageKey,
          tenantId,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('Error in dealCoachAnalyzeCallable:', error);
      throw new Error(`Deal coach analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
