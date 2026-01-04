/**
 * Send Message to Slack
 * 
 * Phase 4: Bi-directional messaging - HRX → Slack
 * Sends an HRX internal message to the mapped Slack channel/DM.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { InternalMessage, SlackMessageMeta, DirectMessage, InternalChannel, SlackConversationMode } from './internalMessaging';
import { getSecurityLevelForActiveTenant, normalizeSecurityLevel } from './slackMapping';
import { shouldMirrorMessageToSlack } from './slackRouting';
import { logSlackTraffic } from './slackTrafficLogging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Get Slack bot token from Secret Manager
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');

export interface SendMessageToSlackPayload {
  tenantId: string;
  internalConversationId: string; // HRX DM or channel id
  internalMessageId: string; // HRX message doc id
  conversationType: 'dm' | 'channel';
  botToken?: string; // Optional - if not provided, will try to get from secret
}

export interface SlackSentMeta {
  teamId: string;
  channelId: string;
  ts: string;
  threadTs?: string;
}

/**
 * Send an HRX internal message to Slack
 * 
 * @param payload - Message payload with tenantId, conversationId, messageId
 * @returns Slack metadata if successful, null if skipped or failed
 */
export async function sendMessageToSlack(
  payload: SendMessageToSlackPayload,
  botToken?: string
): Promise<SlackSentMeta | null> {
  const { tenantId, internalConversationId, internalMessageId, conversationType } = payload;

  try {
    // 1) Load message
    const conversationRef = conversationType === 'dm'
      ? db.collection('tenants').doc(tenantId)
          .collection('internalDMs').doc(internalConversationId)
      : db.collection('tenants').doc(tenantId)
          .collection('internalChannels').doc(internalConversationId);

    const messageRef = conversationRef.collection('internalMessages').doc(internalMessageId);
    const messageSnap = await messageRef.get();

    if (!messageSnap.exists) {
      logger.warn(`[sendMessageToSlack] Message ${internalMessageId} not found`);
      return null;
    }

    const message = messageSnap.data() as InternalMessage;

    // 2) Loop prevention - don't send messages that came from Slack
    if (message.mirroredFromSlack === true) {
      logger.info(`[sendMessageToSlack] Skipping message ${internalMessageId} - already from Slack`);
      return null;
    }

    // 3) Check if already sent
    if (message.mirroredToSlack === true) {
      logger.info(`[sendMessageToSlack] Message ${internalMessageId} already sent to Slack`);
      return message.slackMessageMeta ? {
        teamId: message.slackMessageMeta.teamId,
        channelId: message.slackMessageMeta.channelId,
        ts: message.slackMessageMeta.ts,
        threadTs: message.slackMessageMeta.threadTs,
      } : null;
    }

    // 4) Load conversation to get Slack mapping
    const conversationSnap = await conversationRef.get();
    if (!conversationSnap.exists) {
      logger.warn(`[sendMessageToSlack] Conversation ${internalConversationId} not found`);
      return null;
    }

    const conversation = conversationSnap.data() as DirectMessage | InternalChannel;
    let slackLink = conversation?.slackLink;
    const slackSettings = conversation?.slackSettings;

    // 5) If slackLink not on conversation, try to resolve from mappings
    if (!slackLink) {
      // Try to find mapping in slackChannels collection
      const channelsQuery = await db.collection('tenants').doc(tenantId)
        .collection('slackChannels')
        .where('hrxConversationId', '==', internalConversationId)
        .where('hrxConversationType', '==', conversationType)
        .limit(1)
        .get();

      if (!channelsQuery.empty) {
        const channelData = channelsQuery.docs[0].data();
        const slackTeamId = channelData.slackTeamId || channelData.teamId;
        
        // Get team info to find teamId
        if (slackTeamId) {
          slackLink = {
            teamId: slackTeamId,
            channelId: channelData.id || channelsQuery.docs[0].id,
            rootThreadTs: null,
          };
          
          // Update conversation with slackLink for future use
          await conversationRef.update({
            slackLink,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // 6) Check if conversation is linked to Slack
    if (!slackLink) {
      logger.info(`[sendMessageToSlack] Conversation ${internalConversationId} not linked to Slack`);
      await logSlackTraffic({
        tenantId,
        direction: 'outbound',
        type: 'message',
        source: 'sendMessageToSlack',
        internalConversationId,
        internalMessageId,
        ts: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
        status: 'skipped',
        reason: 'Conversation not linked to Slack',
      });
      return null;
    }

    // 7) Phase 5: Check if message should be mirrored based on mode
    const mode: SlackConversationMode = slackSettings?.mode || 'manual';
    
    // Get sender security level
    const userDoc = await db.collection('users').doc(message.fromUserId).get();
    const userData = userDoc.data();
    const senderSecurityLevel = normalizeSecurityLevel(
      userData?.tenantIds?.[tenantId]?.securityLevel ?? userData?.securityLevel
    );

    if (!shouldMirrorMessageToSlack({ mode, message, senderSecurityLevel })) {
      logger.info(`[sendMessageToSlack] Message not eligible for Slack mirroring (mode: ${mode})`);
      await logSlackTraffic({
        tenantId,
        direction: 'outbound',
        type: 'message',
        source: 'sendMessageToSlack',
        teamId: slackLink.teamId,
        channelId: slackLink.channelId,
        internalConversationId,
        internalMessageId,
        ts: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
        status: 'skipped',
        reason: `Mode: ${mode}, senderSecurityLevel: ${senderSecurityLevel}`,
      });
      return null;
    }

    // 8) Get Slack bot token
    let resolvedBotToken: string;
    if (botToken) {
      resolvedBotToken = botToken;
    } else {
      try {
        resolvedBotToken = SLACK_BOT_TOKEN.value();
      } catch (err) {
        logger.error('[sendMessageToSlack] SLACK_BOT_TOKEN not accessible:', err);
        return null;
      }
    }

    if (!resolvedBotToken) {
      logger.warn('[sendMessageToSlack] SLACK_BOT_TOKEN is empty');
      return null;
    }

    // 9) Phase 5: Resolve thread target
    // Priority: slackSettings.defaultThreadTs > slackLink.rootThreadTs > new root message
    let threadTs: string | undefined = undefined;
    
    if (slackSettings?.defaultThreadTs) {
      threadTs = slackSettings.defaultThreadTs;
    } else if (slackLink.rootThreadTs) {
      threadTs = slackLink.rootThreadTs;
    }
    // If no threadTs, this will be a new root message

    // 10) Build Slack API payload
    const slackPayload: any = {
      channel: slackLink.channelId,
      text: message.content,
    };

    // Add thread_ts if we have one
    if (threadTs) {
      slackPayload.thread_ts = threadTs;
    }

    // 11) Post to Slack
    const axios = require('axios');
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      slackPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedBotToken}`,
        },
      }
    );

    if (!response.data.ok) {
      logger.error('[sendMessageToSlack] Slack API error:', response.data.error);
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    const slackTs = response.data.ts;
    const slackThreadTs = response.data.message?.thread_ts || slackTs;

    // 12) Phase 5: If we didn't have a rootThreadTs, store it now (for new root messages)
    if (!threadTs && !slackLink.rootThreadTs) {
      // This is a new root message - store its ts as rootThreadTs for future messages
      await conversationRef.update({
        'slackLink.rootThreadTs': slackTs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      slackLink.rootThreadTs = slackTs;
    }

    // 13) Update message with Slack metadata
    const slackMeta: SlackMessageMeta = {
      teamId: slackLink.teamId,
      channelId: slackLink.channelId,
      ts: slackTs,
      threadTs: slackThreadTs,
    };

    const inSlackThread = slackThreadTs !== slackTs;

    await messageRef.update({
      source: 'hrx',
      mirroredToSlack: true,
      mirroredFromSlack: false,
      slackMessageMeta: slackMeta,
      inSlackThread,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 14) Phase 5: Log traffic
    await logSlackTraffic({
      tenantId,
      direction: 'outbound',
      type: 'message',
      source: 'sendMessageToSlack',
      teamId: slackLink.teamId,
      channelId: slackLink.channelId,
      internalConversationId,
      internalMessageId,
      ts: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
      slackTs,
      slackThreadTs,
      status: 'ok',
    });

    logger.info(`[sendMessageToSlack] Successfully sent message ${internalMessageId} to Slack channel ${slackLink.channelId}`);

    return {
      teamId: slackLink.teamId,
      channelId: slackLink.channelId,
      ts: slackTs,
      threadTs: slackThreadTs,
    };
  } catch (error: any) {
    logger.error(`[sendMessageToSlack] Error sending message to Slack:`, error);
    return null;
  }
}

/**
 * HTTPS Callable endpoint for sending HRX messages to Slack
 * 
 * Security: Requires securityLevel >= 5 for active tenant
 */
export const sendMessageToSlackApi = onCall(
  {
    cors: true,
    secrets: [SLACK_BOT_TOKEN],
  },
  async (request) => {
    const { tenantId, internalConversationId, internalMessageId, conversationType } = request.data || {};
    const authUid = request.auth?.uid;

    if (!authUid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    if (!tenantId || !internalConversationId || !internalMessageId || !conversationType) {
      throw new HttpsError('invalid-argument', 'Missing required fields: tenantId, internalConversationId, internalMessageId, conversationType');
    }

    // 1) Load user and check security level
    const userDoc = await db.collection('users').doc(authUid).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User record not found');
    }

    const userData = userDoc.data() as any;
    const activeTenantId = userData.activeTenantId || tenantId;
    const tenantSettings = userData.tenantIds?.[activeTenantId];

    // Get security level for active tenant
    const securityLevel = normalizeSecurityLevel(
      tenantSettings?.securityLevel ?? userData.securityLevel
    );

    if (securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Insufficient permission to send Slack messages. Requires security level 5-7.');
    }

    // 2) Get bot token
    let botToken: string;
    try {
      botToken = SLACK_BOT_TOKEN.value();
    } catch (err) {
      throw new HttpsError('failed-precondition', 'Slack bot token not configured');
    }

    // 3) Call sendMessageToSlack helper
    const result = await sendMessageToSlack({
      tenantId,
      internalConversationId,
      internalMessageId,
      conversationType: conversationType as 'dm' | 'channel',
    }, botToken);

    if (!result) {
      throw new HttpsError('failed-precondition', 'Message could not be sent to Slack. Check conversation mapping and message status.');
    }

    return {
      success: true,
      slackMeta: result,
    };
  }
);

