/**
 * SendGrid Webhook Handler
 * 
 * Handles SendGrid event webhooks (delivered, bounced, spam, etc.)
 * Updates messageLogs with delivery status.
 * 
 * Implements: HRX One Email Provider Spec — Section 5 Twilio / SendGrid Webhook Tie-In
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { updateMessageLogStatus } from './messageLogging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * POST /api/webhooks/sendgrid
 * 
 * Handle SendGrid event webhooks for email delivery status
 */
export const sendGridWebhook = onRequest(
  {
    cors: true,
    invoker: 'public', // SendGrid webhooks are unauthenticated
  },
  async (request, response) => {
    try {
      // SendGrid sends events as an array
      const events = Array.isArray(request.body) ? request.body : [request.body];

      logger.info(`Received ${events.length} SendGrid webhook events`);

      for (const event of events) {
        try {
          const {
            sg_message_id,
            event: eventType,
            email,
            timestamp,
            reason,
            status,
            'custom-args': customArgs,
          } = event;

          if (!sg_message_id) {
            logger.warn('SendGrid webhook event missing sg_message_id');
            continue;
          }

          // Extract metadata from custom args
          const tenantId = customArgs?.tenantId;
          const messageTypeId = customArgs?.messageTypeId;
          const userId = customArgs?.userId;

          if (!tenantId) {
            logger.warn(`SendGrid webhook event missing tenantId for message ${sg_message_id}`);
            continue;
          }

          // Find message log by provider message ID
          const messageLogsQuery = await db
            .collection('tenants')
            .doc(tenantId)
            .collection('messageLogs')
            .where('providerMessageId', '==', sg_message_id)
            .limit(1)
            .get();

          if (messageLogsQuery.empty) {
            logger.warn(`No message log found for SendGrid message ${sg_message_id}`);
            continue;
          }

          const messageLogDoc = messageLogsQuery.docs[0];
          const messageLogId = messageLogDoc.id;

          // Map SendGrid event types to our status
          let logStatus: 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'not_sent' = 'sent';
          let failureReason: string | undefined;

          switch (eventType) {
            case 'delivered':
              logStatus = 'delivered';
              break;
            case 'bounce':
              logStatus = 'bounced';
              failureReason = reason || 'Email bounced';
              break;
            case 'dropped':
            case 'blocked':
              logStatus = 'failed';
              failureReason = reason || eventType;
              break;
            case 'deferred':
              logStatus = 'queued';
              break;
            case 'processed':
              logStatus = 'sent';
              break;
            case 'open':
            case 'click':
              // These are engagement events, not status changes
              // Could log separately if needed
              continue;
            default:
              logger.info(`Unhandled SendGrid event type: ${eventType}`);
              continue;
          }

          // Update message log
          await updateMessageLogStatus(
            messageLogId,
            logStatus,
            {
              tenantId,
              failureReason,
              deliveredAt: logStatus === 'delivered' ? admin.firestore.Timestamp.fromDate(new Date(timestamp * 1000)) : undefined,
            }
          );

          logger.info(`Updated message log ${messageLogId} status to ${logStatus} for SendGrid event ${eventType}`);
        } catch (eventError: any) {
          logger.error(`Error processing SendGrid webhook event:`, eventError);
          // Continue processing other events
        }
      }

      // Always respond 200 to SendGrid
      response.status(200).send('OK');
    } catch (error: any) {
      logger.error('Error in SendGrid webhook handler:', error);
      // Still respond 200 to avoid retries
      response.status(200).send('OK');
    }
  }
);

