/**
 * Send Slack Channel Message
 * 
 * Cloud Function to post a message to a Slack channel via the HRX Messaging Bridge.
 * Requires security level >= 5.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { getSecurityLevelForActiveTenant } from '../messaging/slackMapping';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Get Slack bot token from Secret Manager
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');

interface SendSlackChannelMessagePayload {
  tenantId: string;
  channelId: string;
  text: string;
}

interface SendSlackChannelMessageResponse {
  ok: boolean;
  slackChannelId: string;
  ts: string;
  error?: string;
}

/**
 * Send a message to a Slack channel
 */
export const sendSlackChannelMessage = onCall(
  {
    secrets: [SLACK_BOT_TOKEN],
    cors: true,
    invoker: 'public', // Allow unauthenticated CORS preflight requests
    maxInstances: 2,
  },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { tenantId, channelId, text } = request.data as SendSlackChannelMessagePayload;

    if (!tenantId || !channelId || !text || !text.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId, channelId, and text are required');
    }

    try {
      // 1. Auth check - require security level >= 5
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError('permission-denied', 'User not found');
      }

      const user = userDoc.data();
      const securityLevel = getSecurityLevelForActiveTenant(user);

      if (securityLevel < 5) {
        throw new HttpsError(
          'permission-denied',
          'Insufficient permissions. Slack access requires security level 5 or higher.'
        );
      }

      // 2. Channel verification
      const channelDoc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('slackChannels')
        .doc(channelId)
        .get();

      if (!channelDoc.exists) {
        throw new HttpsError('not-found', 'Slack channel not found');
      }

      const channelData = channelDoc.data();
      const teamId = channelData?.teamId || channelData?.slackTeamId;

      if (!teamId) {
        throw new HttpsError('failed-precondition', 'Channel teamId not found');
      }

      // 3. Get bot token
      let botToken: string;
      try {
        botToken = SLACK_BOT_TOKEN.value();
      } catch (err) {
        // Try to get from integrations collection as fallback
        const integrationsDoc = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('integrations')
          .doc('slack')
          .get();

        if (integrationsDoc.exists) {
          const integrationData = integrationsDoc.data();
          botToken = integrationData?.botToken;
        }

        if (!botToken) {
          throw new HttpsError(
            'failed-precondition',
            'Slack bot token not found. Please configure Slack integration.'
          );
        }
      }

      // 4. Post to Slack using chat.postMessage
      const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          text: text.trim(),
          // Optional: Add metadata to tag as HRX message
          metadata: {
            event_type: 'hrx_message',
            event_payload: {
              tenantId,
              userId,
              source: 'hrx',
            },
          },
        }),
      });

      const slackData = await slackResponse.json();

      if (!slackData.ok) {
        logger.error('Slack chat.postMessage error', {
          error: slackData.error,
          channelId,
          tenantId,
        });
        throw new HttpsError(
          'internal',
          `Failed to post message to Slack: ${slackData.error || 'Unknown error'}`
        );
      }

      const messageTs = slackData.ts || slackData.message?.ts;
      if (!messageTs) {
        throw new HttpsError('internal', 'Slack API did not return message timestamp');
      }

      // 5. Persist outbound message to slack_messages
      // Note: For HRX messages, slackUserId will be null since it's from the bot
      const messageDoc = {
        source: 'hrx',
        tenantId,
        teamId,
        channelId,
        channelName: channelData?.name || channelData?.rawName || channelId,
        channelType: channelData?.channelType || 'channel',
        userId: userId, // HRX user ID
        hrxUserId: userId, // HRX user ID (for clarity)
        slackUserId: null, // No Slack user ID for bot messages
        userName: user?.displayName || user?.email || 'HRX User',
        text: text.trim(),
        ts: messageTs,
        type: 'message', // Message type for activity tracking
        direction: 'outbound',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        raw: slackData, // Store full Slack response for debugging
      };

      await db.collection('slack_messages').add(messageDoc);

      logger.info('Slack message sent successfully', {
        tenantId,
        channelId,
        messageTs,
        userId,
      });

      // 6. Return response
      const response: SendSlackChannelMessageResponse = {
        ok: true,
        slackChannelId: channelId,
        ts: messageTs,
      };

      return response;
    } catch (error: any) {
      logger.error('Error sending Slack channel message', {
        error: error.message,
        stack: error.stack,
        tenantId,
        channelId,
        userId,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', `Failed to send message: ${error.message}`);
    }
  }
);

