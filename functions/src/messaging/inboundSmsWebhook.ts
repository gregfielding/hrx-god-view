/**
 * Inbound SMS Webhook Handler
 * 
 * Handles incoming SMS messages from Twilio webhook.
 * Processes keywords (STOP/HELP/START) and routes to appropriate handlers.
 * 
 * Based on: hrxone-unified-messaging-framework-v1.md Section 6.2 & 8
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { processInboundSms } from './stopHelpHandler';
import { logMessage } from './messageLogging';
import { findOrCreateThread, createInboundMessage } from './twoWayMessaging';
import { createAIDraft, classifyInboundMessage } from './aiAssist';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN } from './twilioSecrets';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Twilio webhook handler for inbound SMS
 * 
 * Configure in Twilio Console:
 * - Webhook URL: https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms
 * - Method: POST
 */
export const handleInboundSms = onRequest(
  {
    cors: true,
    invoker: 'public', // Twilio webhooks are unauthenticated
    // Needed for STOP/HELP confirmation sends via Twilio
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request, response) => {
    try {
      // Twilio sends POST requests with form data
      const {
        From: fromNumber,
        To: toNumber,
        Body: messageBody,
        MessageSid: messageSid,
        AccountSid: accountSid,
      } = request.body;

      logger.info(`Inbound SMS received: ${messageSid} from ${fromNumber} to ${toNumber}`);

      // Validate required fields
      if (!fromNumber || !messageBody) {
        logger.error('Missing required fields in Twilio webhook');
        response.status(400).send('Missing required fields');
        return;
      }

      // Normalize phone number to E.164 format if needed
      const phoneE164 = fromNumber.startsWith('+') ? fromNumber : `+${fromNumber}`;

      // Process keywords (STOP/HELP/START)
      const keywordResult = await processInboundSms(phoneE164, messageBody, messageSid, toNumber);

      if (keywordResult.handled) {
        logger.info(`Keyword ${keywordResult.keyword} handled for ${phoneE164}`);
        // Twilio expects 200 response
        response.status(200).send('OK');
        return;
      }

      // Not a keyword - handle as regular inbound message via two-way messaging
      await handleRegularInboundMessage(phoneE164, toNumber, messageBody, messageSid);

      // Always respond 200 to Twilio
      response.status(200).send('OK');
    } catch (error: any) {
      logger.error('Error handling inbound SMS webhook:', error);
      // Still respond 200 to Twilio to avoid retries
      response.status(200).send('OK');
    }
  }
);

/**
 * Handle regular inbound message (not a keyword)
 * Routes to two-way messaging thread system
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 2.3 Twilio Webhook Flow
 */
async function handleRegularInboundMessage(
  fromPhoneE164: string,
  toNumber: string,
  messageBody: string,
  messageSid: string
): Promise<void> {
  try {
    // Find user (candidate) by phone number
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', fromPhoneE164)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      logger.warn(`Inbound message from unknown phone ${fromPhoneE164}`);
      // Could create a new user or handle differently
      return;
    }

    const userDoc = usersQuery.docs[0];
    const candidateId = userDoc.id;
    const userData = userDoc.data();
    const tenantId = userData?.tenantId || 'unknown';

    // Find or create thread
    // TODO: Determine primaryRecruiterId based on routing rules
    // For now, use last recruiter who messaged or null
    const thread = await findOrCreateThread(
      candidateId,
      fromPhoneE164,
      toNumber,
      tenantId,
      {
        primaryRecruiterId: null, // Will be enhanced with routing logic
      }
    );

    if (!thread.id) {
      throw new Error('Failed to create thread');
    }

    // Create inbound message in thread
    await createInboundMessage(thread.id, messageBody, messageSid, {
      tenantId,
      language: (userData?.preferredLanguage || 'en') as 'en' | 'es',
    });

    // Log to unified message log
    await logMessage({
      userId: candidateId,
      tenantId,
      threadId: thread.id,
      messageTypeId: 'inbound_message',
      channel: 'sms',
      direction: 'inbound',
      fromIdentity: 'candidate',
      contentSent: messageBody,
      language: (userData?.preferredLanguage || 'en') as 'en' | 'es',
      status: 'delivered',
      providerMessageId: messageSid,
    });

    // PHASE 5.3: AI Assist - Classify and create draft
    try {
      const classification = await classifyInboundMessage(messageBody, thread.id, tenantId);
      await createAIDraft(thread.id, candidateId, tenantId, messageBody, classification);
      logger.info(`Created AI draft for inbound message in thread ${thread.id}`);
    } catch (aiError: any) {
      // Don't fail the inbound message if AI assist fails
      logger.error('Error creating AI draft for inbound message:', aiError);
    }

    // TODO: Notify recruiter(s) with access to thread

    logger.info(`Inbound message processed for candidate ${candidateId} in thread ${thread.id}`);
  } catch (error: any) {
    logger.error(`Error handling regular inbound message:`, error);
    // Don't throw - message is already logged
  }
}

