import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { withIdempotency } from './middleware/aiGuard';
import { logAIAction } from './utils/aiLogging';

if (!admin.apps.length) {
  admin.initializeApp();
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

export const app_ai_generateResponse = onCall({ 
  cors: true, 
  region: 'us-central1', 
  timeoutSeconds: 60, 
  memory: '512MiB',
  maxInstances: 2 // Added for cost containment
}, async (request) => {
  try {
    const { prompt, conversationId, model = 'gpt-5', temperature = 0.7, maxTokens = 1000, context, metadata } = request.data || {};

    if (!prompt) throw new Error('Prompt is required');
    if (!conversationId) throw new Error('Conversation ID is required');

    const logicalInput = { conversationId, prompt, model, temperature, maxTokens };

    const result = await withIdempotency('app_ai_generateResponse.v1', logicalInput, 60, async () => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content:
            'You are a helpful AI assistant for HRX, a workforce management platform. You help workers with their questions, concerns, and requests. Be professional, empathetic, and solution-oriented. If you do not know something, say so rather than making things up.',
        },
      ];

      if (Array.isArray(context) && context.length > 0) {
        const tail = context.slice(-10);
        for (const msg of tail) {
          messages.push({ role: 'user', content: String(msg) });
        }
      }
      messages.push({ role: 'user', content: String(prompt) });

      const start = Date.now();
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });
      const duration = Date.now() - start;

      const response = completion.choices?.[0]?.message?.content || 'I apologize, but I was unable to generate a response.';
      const tokensUsed = completion.usage?.total_tokens || 0;
      const modelUsed = completion.model || model;
      const confidence = Math.min(0.95, Math.max(0.5, 1 - tokensUsed / Math.max(1, maxTokens)));

      try {
        await logAIAction({
          eventType: 'mobile.ai.response',
          targetType: 'conversation',
          targetId: conversationId,
          reason: 'Mobile AI response generated',
          contextType: 'mobile_app',
          aiTags: ['mobile', 'ai', 'assistant'],
          urgencyScore: 3,
          tenantId: request.auth?.token?.tenantId || '',
          userId: request.auth?.uid || '',
          aiResponse: response,
          latencyMs: duration,
          model: modelUsed,
          tokensOut: tokensUsed,
          metadata,
        });
      } catch {}

      return { response, confidence, tokensUsed, processingTime: duration, model: modelUsed, context: context || [], metadata: metadata || {} };
    });

    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('AI Generate Response Error', { error: msg, conversationId: request.data?.conversationId });
    throw new Error(`Failed to generate AI response: ${msg}`);
  }
});


