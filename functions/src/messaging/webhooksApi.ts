/**
 * Twilio Webhooks API
 * 
 * Handles Twilio webhook callbacks for inbound SMS and status updates.
 * 
 * Implements: HRX One Messaging API Spec — Section 4 Webhooks
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { handleInboundSms } from './inboundSmsWebhook';
import { updateMessageLogStatus } from './messageLogging';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN } from './twilioSecrets';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * POST /api/webhooks/twilio/inbound-sms
 * 
 * Handle all inbound SMS (keywords, replies, chat).
 * 
 * Implements: HRX Messaging API Spec §4.1
 * 
 * Note: This wraps the existing handleInboundSms function
 */
export const twilioInboundSmsWebhook = onRequest(
  {
    cors: true,
    invoker: 'public', // Twilio webhooks are unauthenticated
    // Bind secrets needed by handleInboundSms (for STOP/HELP confirmation sends)
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request, response) => {
    // Delegate to existing handler
    return handleInboundSms(request, response);
  }
);

/**
 * POST /api/webhooks/twilio/status-callback
 * 
 * Track outbound message delivery status changes (sent, delivered, failed).
 * 
 * Implements: HRX Messaging API Spec §4.2
 */
export const twilioStatusCallback = onRequest(
  {
    cors: true,
    invoker: 'public', // Twilio webhooks are unauthenticated
  },
  async (request, response) => {
    try {
      const {
        MessageSid,
        MessageStatus,
        ErrorCode,
        ErrorMessage,
      } = request.body;

      if (!MessageSid || !MessageStatus) {
        logger.warn('Twilio status callback missing required fields');
        response.status(200).send('OK');
        return;
      }

      logger.info(`Twilio status callback: ${MessageSid} -> ${MessageStatus}`);

      // PHASE 1.2: Find message log by provider message ID (tenant-scoped)
      // Search across tenants (we don't know tenantId from webhook)
      // This is a limitation - ideally webhook should include tenantId in custom args
      let messageLogsQuery: admin.firestore.QuerySnapshot | null = null;
      const tenantsSnapshot = await db.collection('tenants').limit(50).get();
      
      for (const tenantDoc of tenantsSnapshot.docs) {
        const query = await db
          .collection('tenants')
          .doc(tenantDoc.id)
          .collection('messageLogs')
          .where('providerMessageId', '==', MessageSid)
          .limit(1)
          .get();
        
        if (!query.empty) {
          messageLogsQuery = query;
          break;
        }
      }
      
      // Fallback: if not found in tenant-scoped, check legacy global collection
      if (!messageLogsQuery || messageLogsQuery.empty) {
        logger.warn(`Message log not found in tenant-scoped collections for ${MessageSid}, checking legacy collection`);
        messageLogsQuery = await db
          .collection('messageLogs')
          .where('providerMessageId', '==', MessageSid)
          .limit(1)
          .get();
      }

      if (!messageLogsQuery.empty) {
        const messageLogDoc = messageLogsQuery.docs[0];
        const messageLogId = messageLogDoc.id;

        // Map Twilio status to our status
        let status: 'queued' | 'sent' | 'delivered' | 'failed' | 'not_sent' = 'sent';
        if (MessageStatus === 'delivered') {
          status = 'delivered';
        } else if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
          status = 'failed';
        } else if (MessageStatus === 'sent') {
          status = 'sent';
        } else if (MessageStatus === 'queued') {
          status = 'queued';
        }

        // Update message log
        await updateMessageLogStatus(messageLogId, status, {
          failureReason: ErrorMessage || undefined,
          deliveredAt: status === 'delivered' ? admin.firestore.Timestamp.now() : undefined,
        });

        logger.info(`Updated message log ${messageLogId} status to ${status}`);
      } else {
        logger.warn(`No message log found for Twilio message ${MessageSid}`);
      }

      // PHASE 1.2: Also update SMS message in thread if it exists (with tenant scope)
      // First, try to get tenantId from message log if we found it
      let tenantIdFromLog: string | null = null;
      if (!messageLogsQuery.empty) {
        const logData = messageLogsQuery.docs[0].data();
        tenantIdFromLog = logData.tenantId || null;
      }
      
      // Search in tenant-scoped threads
      if (tenantIdFromLog) {
        // PHASE 1.2: Use tenant-scoped collection
        const threadsSnapshot = await db
          .collection('tenants')
          .doc(tenantIdFromLog)
          .collection('smsThreads')
          .limit(100)
          .get();
        
        for (const threadDoc of threadsSnapshot.docs) {
          const messagesQuery = await db
            .collection('tenants')
            .doc(tenantIdFromLog)
            .collection('smsThreads')
            .doc(threadDoc.id)
            .collection('messages')
            .where('providerMessageId', '==', MessageSid)
            .limit(1)
            .get();

          if (!messagesQuery.empty) {
            const messageDoc = messagesQuery.docs[0];
            const updateData: any = {
              status: MessageStatus === 'delivered' ? 'delivered' : 
                     MessageStatus === 'failed' || MessageStatus === 'undelivered' ? 'failed' : 'sent',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            if (MessageStatus === 'delivered') {
              updateData.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
            }

            await messageDoc.ref.update(updateData);
            logger.info(`Updated SMS message ${messageDoc.id} in thread ${threadDoc.id} (tenant ${tenantIdFromLog})`);
            break;
          }
        }
      } else {
        // Fallback: search across tenants (limited to first 50 tenants)
        // This is not ideal but better than unscoped global query
        logger.warn(`Searching for thread message across tenants (tenantId not found in log)`);
        const tenantsSnapshot = await db.collection('tenants').limit(50).get();
        for (const tenantDoc of tenantsSnapshot.docs) {
          const threadsSnapshot = await db
            .collection('tenants')
            .doc(tenantDoc.id)
            .collection('smsThreads')
            .limit(100)
            .get();
          
          for (const threadDoc of threadsSnapshot.docs) {
            const messagesQuery = await db
              .collection('tenants')
              .doc(tenantDoc.id)
              .collection('smsThreads')
              .doc(threadDoc.id)
              .collection('messages')
              .where('providerMessageId', '==', MessageSid)
              .limit(1)
              .get();

            if (!messagesQuery.empty) {
              const messageDoc = messagesQuery.docs[0];
              const updateData: any = {
                status: MessageStatus === 'delivered' ? 'delivered' : 
                       MessageStatus === 'failed' || MessageStatus === 'undelivered' ? 'failed' : 'sent',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              };

              if (MessageStatus === 'delivered') {
                updateData.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
              }

              await messageDoc.ref.update(updateData);
              logger.info(`Updated SMS message ${messageDoc.id} in thread ${threadDoc.id} (tenant ${tenantDoc.id})`);
              break;
            }
          }
          if (!messageLogsQuery.empty) break; // Found it, stop searching
        }
      }

      // Always respond 200 to Twilio
      response.status(200).send('OK');
    } catch (error: any) {
      logger.error('Error in Twilio status callback:', error);
      // Still respond 200 to avoid Twilio retries
      response.status(200).send('OK');
    }
  }
);

