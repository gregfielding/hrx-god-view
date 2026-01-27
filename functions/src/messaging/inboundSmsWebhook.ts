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
    // CRITICAL: Find the most recent thread that sent a message to this phone number
    // This ensures replies go to the correct user when multiple users share the same phone
    // Strategy: Query all tenants' smsThreads by candidatePhone + twilioNumber, order by lastMessageAt desc
    
    // First, try to find existing thread by phone + Twilio number
    // CRITICAL: Order by lastOutboundAt (not lastMessageAt) to find the thread that
    // most recently SENT a message to this phone, not the thread with most recent activity
    // This ensures replies go to the correct thread when multiple users share a phone
    const threadQuery = await db
      .collectionGroup('smsThreads')
      .where('candidatePhone', '==', fromPhoneE164)
      .where('twilioNumber', '==', toNumber)
      .where('status', '==', 'open')
      .orderBy('lastOutboundAt', 'desc')
      .limit(1)
      .get();

    let candidateId: string | null = null;
    let tenantId: string | null = null;
    let existingThread: any = null;

    if (!threadQuery.empty) {
      // Found existing thread - use its candidateUserId
      existingThread = threadQuery.docs[0];
      const threadData = existingThread.data();
      candidateId = threadData.candidateUserId || threadData.participant?.id || null;
      tenantId = threadData.tenantId || existingThread.ref.parent.parent?.id || null;
      logger.info(`Found existing thread ${existingThread.id} for phone ${fromPhoneE164}, candidate ${candidateId}, tenant ${tenantId}`);
    }

    // If no thread found, fall back to finding user by phone number
    if (!candidateId || !tenantId) {
      logger.info(`No existing thread found for ${fromPhoneE164}, falling back to user lookup`);
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
      candidateId = userDoc.id;
      const userData = userDoc.data();
      // Resolve tenantId using same pattern as systemSms.ts and systemSmsTriggers.ts
      tenantId =
        userData?.tenantId ||
        userData?.activeTenantId ||
        (userData?.tenantIds && typeof userData.tenantIds === 'object' ? Object.keys(userData.tenantIds)[0] : null) ||
        'unknown';
    }

    if (!candidateId || !tenantId || tenantId === 'unknown') {
      logger.error(`Could not determine candidateId or tenantId for inbound message from ${fromPhoneE164}`);
      return;
    }

    // Get user data for language/preferences
    const userDoc = await db.collection('users').doc(candidateId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // Use existing thread if found, otherwise find or create
    let thread: any;
    if (existingThread) {
      thread = {
        id: existingThread.id,
        ...existingThread.data(),
      };
    } else {
      // Find or create thread
      // TODO: Determine primaryRecruiterId based on routing rules
      // For now, use last recruiter who messaged or null
      thread = await findOrCreateThread(
        candidateId,
        fromPhoneE164,
        toNumber,
        tenantId,
        {
          primaryRecruiterId: null, // Will be enhanced with routing logic
        }
      );
    }

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

