/**
 * AI Assist API
 * 
 * AI-powered features for messaging: classification, reply suggestions, translation.
 * 
 * Implements: HRX One Messaging API Spec — Section 6 AI Assist Endpoints
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { getThreadWithMessages } from './twoWayMessaging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export type InboundLabel = 'YES' | 'NO' | 'MAYBE' | 'RESCHEDULE' | 'STOP' | 'HELP' | 'OTHER';

/**
 * POST /api/messaging/ai/classify-inbound
 * 
 * Classify a candidate's inbound message for UI hints + automations.
 * 
 * Implements: HRX Messaging API Spec §6.1
 */
export const classifyInboundApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication

      const { messageId, body, threadId, tenantId } = request.body;

      let messageBody = body;
      let resolvedTenantId = tenantId;

      // PHASE 1.2: Fix tenant scoping - get tenantId from thread if not provided
      if (threadId && !resolvedTenantId) {
        // Try to find thread in tenant-scoped collection
        // We'll need to search across tenants (this is a limitation, but better than unscoped)
        const tenantsSnapshot = await db.collection('tenants').limit(50).get();
        for (const tenantDoc of tenantsSnapshot.docs) {
          const threadDoc = await db
            .collection('tenants')
            .doc(tenantDoc.id)
            .collection('smsThreads')
            .doc(threadId)
            .get();
          
          if (threadDoc.exists) {
            resolvedTenantId = tenantDoc.id;
            break;
          }
        }
      }

      // If messageId provided, fetch message (with tenant scope)
      if (messageId && !messageBody) {
        if (resolvedTenantId) {
          // PHASE 1.2: Use tenant-scoped collection
          const threadDoc = await db
            .collection('tenants')
            .doc(resolvedTenantId)
            .collection('smsThreads')
            .doc(threadId || 'dummy')
            .collection('messages')
            .doc(messageId)
            .get();
          
          if (threadDoc.exists) {
            messageBody = threadDoc.data()?.body;
          }
        } else {
          // Fallback: search across tenants (limited to first 50 tenants)
          // This is not ideal but better than unscoped global query
          logger.warn('Searching for message across tenants (tenantId not provided)');
          const tenantsSnapshot = await db.collection('tenants').limit(50).get();
          for (const tenantDoc of tenantsSnapshot.docs) {
            const threadsSnapshot = await db
              .collection('tenants')
              .doc(tenantDoc.id)
              .collection('smsThreads')
              .limit(100)
              .get();
            
            for (const threadDoc of threadsSnapshot.docs) {
              const messageDoc = await db
                .collection('tenants')
                .doc(tenantDoc.id)
                .collection('smsThreads')
                .doc(threadDoc.id)
                .collection('messages')
                .doc(messageId)
                .get();
              
              if (messageDoc.exists) {
                messageBody = messageDoc.data()?.body;
                resolvedTenantId = tenantDoc.id;
                break;
              }
            }
            if (messageBody) break;
          }
        }
      }

      if (!messageBody) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'messageId or body is required' },
        });
        return;
      }

      // Simple keyword-based classification (can be enhanced with AI later)
      const normalizedBody = messageBody.trim().toUpperCase();
      
      let label: InboundLabel = 'OTHER';
      let confidence = 0.5;

      // Check for explicit keywords
      if (normalizedBody.match(/\b(YES|YEP|YEAH|OK|OKAY|SURE|CONFIRM|ACCEPT)\b/)) {
        label = 'YES';
        confidence = 0.9;
      } else if (normalizedBody.match(/\b(NO|NOPE|NAH|DECLINE|REJECT|CANCEL)\b/)) {
        label = 'NO';
        confidence = 0.9;
      } else if (normalizedBody.match(/\b(MAYBE|PERHAPS|POSSIBLY|LATER)\b/)) {
        label = 'MAYBE';
        confidence = 0.7;
      } else if (normalizedBody.match(/\b(RESCHEDULE|RESCHEDULING|DIFFERENT TIME|ANOTHER TIME)\b/)) {
        label = 'RESCHEDULE';
        confidence = 0.8;
      } else if (normalizedBody.match(/\b(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)\b/)) {
        label = 'STOP';
        confidence = 1.0;
      } else if (normalizedBody.match(/\b(HELP|INFO|SUPPORT|QUESTION)\b/)) {
        label = 'HELP';
        confidence = 0.9;
      }

      // TODO: Enhance with AI/ML classification
      // const aiClassification = await classifyWithAI(messageBody, threadId);
      // label = aiClassification.label;
      // confidence = aiClassification.confidence;

      response.status(200).json({
        success: true,
        label,
        confidence,
        reasoningSummary: `Classified based on keyword matching`,
      });
    } catch (error: any) {
      logger.error('Error in classifyInboundApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/messaging/ai/suggest-reply
 * 
 * Provide suggested replies for recruiters in a thread.
 * 
 * Implements: HRX Messaging API Spec §6.2
 */
export const suggestReplyApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication

      const { threadId, messageId, numSuggestions = 3 } = request.body;

      if (!threadId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId is required' },
        });
        return;
      }

      // Get thread with recent messages
      const { thread, messages } = await getThreadWithMessages(threadId, { limit: 10 });

      // Get candidate data for context
      const candidateDoc = await db.collection('users').doc(thread.candidateUserId).get();
      const candidateData = candidateDoc.data();

      // Get last candidate message
      const lastCandidateMessage = messages
        .filter(m => m.direction === 'inbound')
        .sort((a, b) => {
          const aTime = a.createdAt instanceof admin.firestore.Timestamp ? a.createdAt.toMillis() : 0;
          const bTime = b.createdAt instanceof admin.firestore.Timestamp ? b.createdAt.toMillis() : 0;
          return bTime - aTime;
        })[0];

      // Simple template-based suggestions (can be enhanced with AI)
      const suggestions = [];

      if (lastCandidateMessage) {
        const lastMessageBody = lastCandidateMessage.body.toUpperCase();

        // Generate suggestions based on message content
        if (lastMessageBody.includes('YES') || lastMessageBody.includes('CONFIRM')) {
          suggestions.push({
            id: 'suggestion-1',
            body: `Great! We'll see you then. If anything changes, please let me know.`,
            tone: 'friendly',
            language: 'en' as const,
          });
          suggestions.push({
            id: 'suggestion-2',
            body: `Perfect! Looking forward to working with you.`,
            tone: 'encouraging',
            language: 'en' as const,
          });
        } else if (lastMessageBody.includes('NO') || lastMessageBody.includes('DECLINE')) {
          suggestions.push({
            id: 'suggestion-1',
            body: `I understand. Let me know if your availability changes.`,
            tone: 'friendly',
            language: 'en' as const,
          });
          suggestions.push({
            id: 'suggestion-2',
            body: `No problem. We'll keep you in mind for future opportunities.`,
            tone: 'friendly',
            language: 'en' as const,
          });
        } else if (lastMessageBody.includes('QUESTION') || lastMessageBody.includes('?')) {
          suggestions.push({
            id: 'suggestion-1',
            body: `I'd be happy to help! What would you like to know?`,
            tone: 'friendly',
            language: 'en' as const,
          });
        }
      }

      // Default suggestions if none generated
      if (suggestions.length === 0) {
        suggestions.push({
          id: 'suggestion-1',
          body: `Hi ${candidateData?.firstName || 'there'}, thanks for your message. How can I help you today?`,
          tone: 'friendly',
          language: 'en' as const,
        });
        suggestions.push({
          id: 'suggestion-2',
          body: `Thanks for reaching out. Let me know if you have any questions.`,
          tone: 'friendly',
          language: 'en' as const,
        });
      }

      // Limit to requested number
      const limitedSuggestions = suggestions.slice(0, numSuggestions);

      // TODO: Enhance with AI-generated suggestions
      // const aiSuggestions = await generateReplySuggestions(thread, messages, candidateData);
      // suggestions = aiSuggestions;

      response.status(200).json({
        success: true,
        suggestions: limitedSuggestions,
      });
    } catch (error: any) {
      logger.error('Error in suggestReplyApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/messaging/ai/translate
 * 
 * Translate a message between English and Spanish.
 * 
 * Implements: HRX Messaging API Spec §6.3
 */
export const translateApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication

      const { body, fromLang = 'auto', toLang } = request.body;

      if (!body || !toLang) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'body and toLang are required' },
        });
        return;
      }

      if (toLang !== 'en' && toLang !== 'es') {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'toLang must be "en" or "es"' },
        });
        return;
      }

      // Simple language detection (can be enhanced)
      let detectedSourceLang: 'en' | 'es' = 'en';
      if (fromLang === 'auto') {
        // Simple heuristic: check for Spanish characters/words
        const spanishWords = ['hola', 'gracias', 'por favor', 'sí', 'no', 'buenos', 'días'];
        const hasSpanishWords = spanishWords.some(word => body.toLowerCase().includes(word));
        detectedSourceLang = hasSpanishWords ? 'es' : 'en';
      } else {
        detectedSourceLang = fromLang as 'en' | 'es';
      }

      // If same language, return as-is
      if (detectedSourceLang === toLang) {
        response.status(200).json({
          success: true,
          translated: body,
          detectedSourceLang,
        });
        return;
      }

      // TODO: Integrate with translation service (Google Translate API, OpenAI, etc.)
      // For now, return placeholder
      const translated = `[Translation from ${detectedSourceLang} to ${toLang}]: ${body}`;

      // Example with a simple translation library or API:
      // const translated = await translateText(body, detectedSourceLang, toLang);

      response.status(200).json({
        success: true,
        translated,
        detectedSourceLang,
      });
    } catch (error: any) {
      logger.error('Error in translateApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

