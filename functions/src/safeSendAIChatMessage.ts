import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe AI chat message handling
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'sendAIChatMessage@v2',
  // Input validation limits
  MAX_MESSAGE_LENGTH: 5000,
  MAX_MESSAGES_ARRAY_LENGTH: 50,
  MAX_DEALS_QUERY_LIMIT: 25,
  MAX_DEALS_RETURN: 5,
  // Cost limits
  MAX_COST_PER_CALL: 0.10 // $0.10 USD max per call (higher for AI operations)
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
  threadId: string;
  messages: any[];
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { tenantId, userId, threadId, messages } = data;

  // Required field validation
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('userId is required and must be a non-empty string');
  }

  if (!threadId || typeof threadId !== 'string' || threadId.trim() === '') {
    throw new Error('threadId is required and must be a non-empty string');
  }

  // Messages validation
  if (!Array.isArray(messages)) {
    throw new Error('messages must be an array');
  }

  if (messages.length > SAFE_CONFIG.MAX_MESSAGES_ARRAY_LENGTH) {
    throw new Error(`messages array must have ${SAFE_CONFIG.MAX_MESSAGES_ARRAY_LENGTH} or fewer items`);
  }

  // Validate each message
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== 'object') {
      throw new Error(`message at index ${i} must be an object`);
    }

    if (!message.role || typeof message.role !== 'string') {
      throw new Error(`message at index ${i} must have a valid role`);
    }

    if (message.content && (typeof message.content !== 'string' || message.content.length > SAFE_CONFIG.MAX_MESSAGE_LENGTH)) {
      throw new Error(`message at index ${i} content must be a string and ${SAFE_CONFIG.MAX_MESSAGE_LENGTH} characters or less`);
    }
  }

  return {
    tenantId: tenantId.trim(),
    userId: userId.trim(),
    threadId: threadId.trim(),
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content?.trim() || ''
    }))
  };
}

/**
 * Get top deals safely with query limits
 */
async function getTopDealsSafely(tenantId: string): Promise<string> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getTopDealsSafely', 0.02);

  try {
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    
    // Try to get deals ordered by estimatedRevenue with limit
    let snap;
    try {
      snap = await dealsRef.orderBy('estimatedRevenue', 'desc').limit(SAFE_CONFIG.MAX_DEALS_QUERY_LIMIT).get();
    } catch (error) {
      // Fallback to order by updatedAt if estimatedRevenue not indexed
      snap = await dealsRef.orderBy('updatedAt', 'desc').limit(SAFE_CONFIG.MAX_DEALS_QUERY_LIMIT).get();
    }

    const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    
    // Filter active deals
    const active = all.filter((d: any) => {
      const stage = (d.stage || '').toLowerCase();
      return stage !== 'closedlost' && stage !== 'closed_lost' && stage !== 'dormant';
    });

    // Sort by estimatedRevenue desc with fallbacks
    active.sort((a: any, b: any) => (Number(b.estimatedRevenue || b.value || 0) - Number(a.estimatedRevenue || a.value || 0)));
    
    // Limit to top deals
    const top = active.slice(0, SAFE_CONFIG.MAX_DEALS_RETURN);
    
    if (top.length === 0) {
      return 'I did not find any active deals.';
    }

    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const lines = top.map((d: any, i: number) => 
      `${i + 1}. ${d.name || 'Untitled Deal'} — ${fmt.format(Number(d.estimatedRevenue || d.value || 0))}${d.companyName ? ` (Company: ${d.companyName})` : ''}`
    );
    
    return `Top deals by estimated revenue:\n\n${lines.join('\n')}`;
  } catch (error) {
    console.warn('Failed to get top deals:', error);
    return 'I was unable to retrieve deal information at this time.';
  }
}

/**
 * Generate AI response safely
 */
async function generateAIResponseSafely(messages: any[], tenantId: string): Promise<string> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('generateAIResponseSafely', 0.01);

  // Get the last user message
  const lastUserMsg = messages.slice().reverse().find((m: any) => m.role === 'user');
  const text: string = (lastUserMsg?.content || '').toLowerCase();

  let reply: string;
  if ((text.includes('biggest') || text.includes('top') || text.includes('largest')) && text.includes('deal')) {
    reply = await getTopDealsSafely(tenantId);
  } else {
    reply = lastUserMsg?.content
      ? `I received: "${lastUserMsg.content}". Ask about deals, contacts, tasks, or emails.`
      : 'Hello! Ask me about your CRM data.';
  }

  return reply;
}

/**
 * Save message safely
 */
async function saveMessageSafely(
  tenantId: string,
  threadId: string,
  role: string,
  content: string,
  userId: string
): Promise<void> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('saveMessageSafely', 0.001);

  await db
    .collection('tenants').doc(tenantId)
    .collection('ai_chats').doc(threadId)
    .collection('messages').add({
      role,
      content,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      userId
    });
}

/**
 * Safe version of sendAIChatMessage with hardening playbook compliance
 */
export const sendAIChatMessage = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
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
      const { tenantId, userId, threadId, messages } = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get the last user message
      const lastUserMsg = messages.slice().reverse().find((m: any) => m.role === 'user');

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Generate AI response safely
      const reply = await generateAIResponseSafely(messages, tenantId);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Save user message if included
      if (lastUserMsg?.content) {
        await saveMessageSafely(tenantId, threadId, 'user', lastUserMsg.content, userId);
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Save assistant response
      await saveMessageSafely(tenantId, threadId, 'assistant', reply, userId);

      const costSummary = CostTracker.getCostSummary();
      console.log(`AI chat message processed for ${tenantId}, ThreadId: ${threadId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        reply,
        success: true,
        _metadata: {
          tenantId,
          threadId,
          userId,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('Error in sendAIChatMessage:', error);
      throw new Error(`Failed to send AI chat message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
