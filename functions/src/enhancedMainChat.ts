import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Deal detection patterns
const DEAL_PATTERNS = [
  /deal\s+([a-zA-Z0-9-_]+)/i,
  /deal\s+([a-zA-Z0-9-_]+)\s+([a-zA-Z0-9-_]+)/i,
  /deal\s+([a-zA-Z0-9-_]+)\s+([a-zA-Z0-9-_]+)\s+([a-zA-Z0-9-_]+)/i,
  /next\s+step.*deal/i,
  /advance.*deal/i,
  /move.*deal.*forward/i,
  /deal.*stage/i,
  /deal.*progress/i,
  /deal.*strategy/i,
  /deal.*advice/i,
  /deal.*guidance/i,
  /deal.*coach/i,
  /deal.*help/i,
  /deal.*suggestion/i,
  /deal.*recommendation/i,
  /deal.*action/i,
  /deal.*plan/i,
  /deal.*approach/i,
  /deal.*tactic/i,
  /deal.*technique/i
];

interface DealContext {
  dealId: string;
  dealName: string;
  stage: string;
  companyName?: string;
  contactNames?: string[];
  salespersonNames?: string[];
  recentActivity?: string[];
  enhancedContext?: any;
}

export const enhancedChatWithGPT = onRequest({ 
  region: 'us-central1', 
  concurrency: 80, 
  timeoutSeconds: 60, 
  memory: '512MiB', 
  minInstances: 1 
}, async (req, res): Promise<void> => {
  const startedAt = Date.now();
  
  try {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    const { tenantId, userId, threadId, messages, toolMode } = req.body || {};
    if (!tenantId || !userId || !threadId || !Array.isArray(messages)) {
      res.set('Access-Control-Allow-Origin', '*');
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const lastUserMsg = messages?.slice().reverse().find((m: any) => m.role === 'user');
    const userMessage = lastUserMsg?.content || '';

    // 🎯 AGENT-BASED CONTEXT DETECTION
    let contextShare: any = null;
    let enhancedSystemPrompt = '';
    let enhancedUserMessage = userMessage;

    try {
      // Import agent registry
      const { agentRegistry } = await import('./agents/agentRegistry');
      
      // Detect and enhance with relevant agent
      const enhancement = await agentRegistry.detectAndEnhance(userMessage, tenantId, userId);
      
      if (enhancement.enhanced && enhancement.contextShare) {
        contextShare = enhancement.contextShare;
        enhancedSystemPrompt = enhancement.systemPrompt || '';
        enhancedUserMessage = enhancement.enhancedMessage || userMessage;
        
        console.log(`🎯 Enhanced main chat with ${enhancement.agent?.agentName} context`);
      }
    } catch (error) {
      console.error('Error with agent-based enhancement:', error);
      // Fallback to original deal detection logic
      if (isDealRelatedQuestion(userMessage)) {
        console.log('🔍 Fallback: Detected deal-related question:', userMessage);
        
        // Try to extract deal ID from the message
        const dealId = await extractDealId(userMessage, tenantId);
        
        if (dealId) {
          console.log('📊 Found deal ID:', dealId);
          const dealContext = await getDealContext(dealId, tenantId, userId);
          
          if (dealContext) {
            console.log('✅ Enhanced context loaded for deal:', dealContext.dealName);
            
            // Generate enhanced system prompt with Deal Coach context
            enhancedSystemPrompt = generateEnhancedMainChatPrompt(dealContext);
            
            // Enhance the user's message with deal context
            enhancedUserMessage = enhanceUserMessageWithDealContext(userMessage, dealContext);
            
            console.log('🎯 Enhanced main chat with Deal Coach context (fallback)');
          }
        }
      }
    }

    // Simplified context building (we'll focus on deal context enhancement)
    const context = '';
    const codeContext = '';

    // Use enhanced system prompt if deal context is available, otherwise use original
    const systemPrompt = enhancedSystemPrompt || `You are an AI assistant embedded in a React + Firebase CRM.\n- Only answer within the user's tenant scope.\n- Use the provided context when relevant.\n- Prefer concise, actionable output.\n${toolMode ? '- When the user intent is to create tasks or update location associations, respond via function/tool calls (createTask, updateLocationAssociation) instead of plain text. If information is missing, ask one concise follow-up question or make a best-effort using defaults.' : ''}`;

    // Use enhanced user message if available
    const finalUserMessage = enhancedUserMessage || userMessage;

    // Call OpenAI with enhanced context
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.set('Access-Control-Allow-Origin', '*');
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: finalUserMessage }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || 'I apologize, but I encountered an issue processing your request.';

    // Log the enhanced interaction
    if (contextShare) {
      try {
        await logEnhancedChatInteraction({
          tenantId,
          userId,
          threadId,
          agentId: contextShare.agentId,
          entityId: contextShare.entityId,
          originalMessage: userMessage,
          enhancedMessage: enhancedUserMessage,
          response: reply,
          contextShare: contextShare
        });
      } catch (error) {
        console.warn('Failed to log enhanced chat interaction:', error);
      }
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ reply, latencyMs: Date.now() - startedAt });

  } catch (error) {
    console.error('enhancedChatWithGPT error:', error);
    res.set('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
function isDealRelatedQuestion(message: string): boolean {
  return DEAL_PATTERNS.some(pattern => pattern.test(message));
}

async function extractDealId(message: string, tenantId: string): Promise<string | null> {
  // First, try to extract deal ID from the message using patterns
  for (const pattern of DEAL_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const potentialDealId = match[1];
      
      // Verify the deal exists
      try {
        const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${potentialDealId}`);
        const dealSnap = await dealRef.get();
        if (dealSnap.exists) {
          return potentialDealId;
        }
      } catch (error) {
        console.warn('Error checking deal existence:', error);
      }
    }
  }

  // If no direct match, try to find deals by name
  try {
    const dealsQuery = db.collection(`tenants/${tenantId}/crm_deals`)
      .where('name', '>=', message.split(' ')[0])
      .where('name', '<=', message.split(' ')[0] + '\uf8ff')
      .limit(5);
    
    const dealsSnap = await dealsQuery.get();
    if (!dealsSnap.empty) {
      // Return the first matching deal
      return dealsSnap.docs[0].id;
    }
  } catch (error) {
    console.warn('Error searching deals by name:', error);
  }

  return null;
}

async function getDealContext(dealId: string, tenantId: string, userId: string): Promise<DealContext | null> {
  try {
    // Import the enhanced deal context system
    const { getEnhancedDealContext } = await import('./enhancedDealContext');
    const enhancedContext = await getEnhancedDealContext(dealId, tenantId, userId);

    return {
      dealId,
      dealName: enhancedContext.deal?.name || 'Unknown Deal',
      stage: enhancedContext.deal?.stage || 'Unknown Stage',
      companyName: enhancedContext.company?.company?.name,
      contactNames: enhancedContext.contacts.map(c => c.contact?.fullName || c.contact?.name).filter(Boolean),
      salespersonNames: enhancedContext.salespeople.map(s => s.salesperson?.displayName || s.salesperson?.name).filter(Boolean),
      recentActivity: enhancedContext.activities?.slice(0, 5).map(a => a.description || a.type).filter(Boolean),
      enhancedContext
    };
  } catch (error) {
    console.error('Error getting deal context:', error);
    return null;
  }
}

function generateEnhancedMainChatPrompt(dealContext: DealContext): string {
  const { dealName, stage, companyName, contactNames, salespersonNames, recentActivity } = dealContext;
  
  return `You are an AI assistant embedded in a React + Firebase CRM with enhanced Deal Coach capabilities.

DEAL CONTEXT:
- Deal: ${dealName} (${stage})
- Company: ${companyName || 'Unknown Company'}
- Contacts: ${contactNames?.join(', ') || 'None'}
- Salespeople: ${salespersonNames?.join(', ') || 'None'}
- Recent Activity: ${recentActivity?.join(', ') || 'None'}

INSTRUCTIONS:
1. You have access to comprehensive Deal Coach context for this specific deal
2. Provide strategic, actionable advice based on the deal's current stage and context
3. Consider the company, contacts, salespeople, and recent activity when making recommendations
4. Be specific about next steps and actions the user should take
5. Reference relevant context when making suggestions
6. Maintain the conversational, helpful tone of the main chat
7. If the user asks about deals not in context, ask for clarification

RESPONSE FORMAT:
- Provide a brief analysis of the current situation
- Suggest specific next steps and actions
- Reference relevant context when making recommendations
- Be specific about which contacts to engage and how
- Consider the salesperson's strengths and the deal's unique dynamics

IMPORTANT: Always consider the personality and preferences of each contact when making recommendations.`;
}

function enhanceUserMessageWithDealContext(message: string, dealContext: DealContext): string {
  const { dealName, stage, companyName, contactNames, salespersonNames } = dealContext;
  
  return `${message}

[Deal Context: ${dealName} (${stage}) - ${companyName || 'Unknown Company'}
Contacts: ${contactNames?.join(', ') || 'None'}
Salespeople: ${salespersonNames?.join(', ') || 'None'}]`;
}

async function logEnhancedChatInteraction(data: {
  tenantId: string;
  userId: string;
  threadId: string;
  agentId: string;
  entityId: string;
  originalMessage: string;
  enhancedMessage: string;
  response: string;
  contextShare: any;
}): Promise<void> {
  try {
    const { logAIAction } = await import('./utils/aiLogging');
    
    await logAIAction({
      eventType: `enhancedMainChat.${data.agentId}`,
      targetType: data.contextShare.contextType,
      targetId: data.entityId,
      reason: 'main_chat_enhanced_with_agent',
      contextType: 'enhancedMainChat',
      aiTags: ['enhancedMainChat', data.agentId],
      urgencyScore: 5,
      tenantId: data.tenantId,
      userId: data.userId,
      aiResponse: data.response,
      metadata: {
        originalMessage: data.originalMessage,
        enhancedMessage: data.enhancedMessage,
        agentId: data.agentId,
        entityId: data.entityId,
        contextType: data.contextShare.contextType
      }
    });
  } catch (error) {
    console.error('Error logging enhanced chat interaction:', error);
  }
}
