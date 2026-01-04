/**
 * Cloud Functions for Message Routing
 * 
 * Provides callable functions for sending messages through the unified routing system
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { sendMessage, MessageContext } from './routingOrchestrator';

/**
 * Send a message through the unified messaging system
 */
export const sendUnifiedMessage = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const {
    userId,
    tenantId,
    messageTypeId,
    variables,
    metadata,
    source,
    sourceId,
    priority,
  } = request.data as {
    userId: string;
    tenantId: string;
    messageTypeId: string;
    variables?: Record<string, any>;
    metadata?: Record<string, any>;
    source?: string;
    sourceId?: string;
    priority?: 'low' | 'normal' | 'high';
  };

  if (!userId || !tenantId || !messageTypeId) {
    throw new HttpsError('invalid-argument', 'userId, tenantId, and messageTypeId are required');
  }

  try {
    const context: MessageContext = {
      userId,
      tenantId,
      messageTypeId,
      variables,
      metadata,
      source,
      sourceId,
      priority,
    };

    const result = await sendMessage(context);
    return result;
  } catch (error: any) {
    logger.error('Error sending unified message:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to send message: ${error.message}`);
  }
});

