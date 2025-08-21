import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe AI thread creation
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'startAIThread@v2',
  // Input validation limits
  MAX_CONTEXT_LENGTH: 1000,
  MAX_TITLE_LENGTH: 200,
  // Cost limits
  MAX_COST_PER_CALL: 0.05 // $0.05 USD max per call
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
  tenantId: string;
  userId: string;
  context?: string;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { tenantId, context } = data;
  const userId = data.userId || data.auth?.uid;

  // Required field validation
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('userId is required and must be a non-empty string');
  }

  // Optional field validation
  if (context && (typeof context !== 'string' || context.length > SAFE_CONFIG.MAX_CONTEXT_LENGTH)) {
    throw new Error(`context must be a string and ${SAFE_CONFIG.MAX_CONTEXT_LENGTH} characters or less`);
  }

  return {
    tenantId: tenantId.trim(),
    userId: userId.trim(),
    context: context?.trim() || 'assistant'
  };
}

/**
 * Create AI thread safely
 */
async function createAIThreadSafely(
  tenantId: string,
  userId: string,
  context: string
): Promise<string> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('createAIThreadSafely', 0.01);

  const threadData = {
    createdBy: userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    title: 'New Conversation',
    context: context || 'assistant',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const threadRef = await db.collection('tenants').doc(tenantId).collection('ai_chats').add(threadData);
  
  console.log(`✅ AI thread created: ${threadRef.id}`);
  return threadRef.id;
}

/**
 * Safe version of startAIThread with hardening playbook compliance
 */
export const startAIThread = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
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
      const { tenantId, userId, context } = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Create AI thread safely
      const threadId = await createAIThreadSafely(tenantId, userId, context);

      const costSummary = CostTracker.getCostSummary();
      console.log(`AI thread started for ${tenantId}, ThreadId: ${threadId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        threadId,
        success: true,
        _metadata: {
          tenantId,
          userId,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('Error in startAIThread:', error);
      throw new Error(`Failed to start AI thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
