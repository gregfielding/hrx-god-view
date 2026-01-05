/**
 * Slack Events API Endpoint
 * 
 * Handles Slack Events API webhooks including:
 * - URL verification (challenge/response)
 * - Message events (message.channels, message.groups, message.im, message.mpim)
 * - Signature verification for security
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as crypto from 'crypto';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import {
  getTenantIdFromSlackTeam,
  mapSlackUserToHRXUser,
  fetchSlackUserInfo,
  mapSlackChannelToHRXConversation,
  updateUnreadCountsForSlackMessage,
} from './messaging/slackMapping';
import { logSlackTraffic } from './messaging/slackTrafficLogging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Configuration - use defineSecret for Firebase Secret Manager secrets
const SLACK_SIGNING_SECRET = defineSecret('SLACK_SIGNING_SECRET');
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');

// Fallback config cache (Firestore) for when Secret Manager isn't configured.
// This keeps Slack inbound working in single-tenant deployments.
const slackSecretsCache = new Map<string, { at: number; signingSecret?: string; botToken?: string }>();
const SLACK_SECRETS_TTL_MS = 5 * 60 * 1000;

async function getSlackSecretsFallback(tenantId: string): Promise<{ signingSecret?: string; botToken?: string }> {
  const cached = slackSecretsCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.at < SLACK_SECRETS_TTL_MS) {
    return { signingSecret: cached.signingSecret, botToken: cached.botToken };
  }

  try {
    const snap = await db.collection('tenants').doc(tenantId).collection('integrations').doc('slack').get();
    const data = snap.data() as any;
    const signingSecret = typeof data?.signingSecret === 'string' ? data.signingSecret : undefined;
    const botToken = typeof data?.botToken === 'string' ? data.botToken : undefined;
    slackSecretsCache.set(tenantId, { at: now, signingSecret, botToken });
    return { signingSecret, botToken };
  } catch (err: any) {
    logger.warn('Failed to load Slack integration secrets from Firestore', { tenantId, error: err?.message });
    slackSecretsCache.set(tenantId, { at: now });
    return {};
  }
}

interface SlackUrlVerificationPayload {
  token?: string;
  challenge: string;
  type: 'url_verification';
}

interface SlackEventPayload {
  token?: string;
  team_id: string;
  api_app_id: string;
  type: 'event_callback';
  event_id: string;
  event_time: number;
  authed_users?: string[];
  event: {
    type: string;
    subtype?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    channel?: string;
    channel_type?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Verify Slack request signature
 * 
 * Implements Slack's signature verification algorithm:
 * 1. Construct basestring: v0:{timestamp}:{rawBody}
 * 2. Compute HMAC-SHA256 signature
 * 3. Compare with timing-safe comparison
 */
function verifySlackRequest({
  rawBody,
  timestamp,
  slackSignature,
  signingSecretOverride,
}: {
  rawBody: string;
  timestamp: string | undefined;
  slackSignature: string | undefined;
  signingSecretOverride?: string;
}): boolean {
  let signingSecret: string;
  if (signingSecretOverride) {
    signingSecret = signingSecretOverride;
  } else {
  try {
    signingSecret = SLACK_SIGNING_SECRET.value();
  } catch (err) {
    logger.warn('SLACK_SIGNING_SECRET is not accessible. Slack verification will fail.', err);
    return false;
  }
  }
  
  if (!signingSecret) {
    logger.warn('SLACK_SIGNING_SECRET is empty. Slack verification will fail.');
    return false;
  }

  if (!timestamp || !slackSignature) {
    return false;
  }

  // Guard against replay attacks (max 5 minutes old)
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const timestampNum = parseInt(timestamp, 10);
  
  if (Math.abs(nowInSeconds - timestampNum) > 60 * 5) {
    logger.warn('Slack request timestamp too old. Possible replay attack.');
    return false;
  }

  // Construct basestring
  const basestring = `v0:${timestamp}:${rawBody}`;

  // Compute signature
  const mySig = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(basestring)
    .digest('hex');

  // Compare signatures using timing-safe comparison
  try {
    const slackSigBuffer = Buffer.from(slackSignature);
    const mySigBuffer = Buffer.from(mySig);
    
    if (slackSigBuffer.length !== mySigBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(slackSigBuffer, mySigBuffer);
  } catch (err) {
    logger.error('Error comparing Slack signatures', err);
    return false;
  }
}

/**
 * Slack Message Document Interface
 * 
 * Normalized structure for Slack messages in Firestore
 */
interface SlackMessageDoc {
  source: 'slack';
  tenantId: string; // Required - tenant context for all Slack messages
  eventId: string; // For deduplication
  teamId: string;
  channelId: string;
  channelType: 'im' | 'channel' | 'group' | 'mpim';
  slackUserId: string;
  hrxUserId?: string; // Phase 3.2: Optional HRX user mapping
  text: string;
  ts: string;
  threadTs?: string;
  isThreadReply: boolean;
  hrxConversationId?: string; // Phase 3.3: Optional HRX conversation mapping
  hrxConversationType?: 'dm' | 'channel'; // Phase 3.3: Optional conversation type
  raw: any; // Full payload (for debugging, can trim later)
  createdAt: admin.firestore.Timestamp;
}

/**
 * Determine channel type from Slack event
 */
function getChannelType(event: SlackEventPayload['event']): 'im' | 'channel' | 'group' | 'mpim' {
  // Slack channel types:
  // - 'C' prefix = public channel
  // - 'G' prefix = private channel (group)
  // - 'D' prefix = direct message (im)
  // - 'M' prefix = multi-person direct message (mpim)
  
  const channelId = event.channel || '';
  const channelType = event.channel_type;
  
  if (channelType) {
    if (channelType === 'im') return 'im';
    if (channelType === 'group') return 'group';
    if (channelType === 'channel') return 'channel';
    if (channelType === 'mpim') return 'mpim';
  }
  
  // Fallback: infer from channel ID prefix
  if (channelId.startsWith('C')) return 'channel';
  if (channelId.startsWith('G')) return 'group';
  if (channelId.startsWith('D')) return 'im';
  if (channelId.startsWith('M')) return 'mpim';
  
  // Default to channel if unknown
  return 'channel';
}

// TEMP: hard-coded tenant for C1 Staffing
// TODO (Phase 4): replace with dynamic mapping: const tenantId = await getTenantIdFromSlackTeam(teamId) ?? DEFAULT_TENANT_ID;
const DEFAULT_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

/**
 * Update slackChannels document with last message activity
 * Only updates for channel-type messages (not DMs)
 */
async function updateSlackChannelActivity(
  tenantId: string,
  channelId: string,
  channelType: string,
  messageDoc: SlackMessageDoc,
  userName?: string
): Promise<void> {
  // Only update for channel/group types, not DMs
  if (channelType !== 'channel' && channelType !== 'group') {
    return;
  }

  try {
    const channelRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('slackChannels')
      .doc(channelId);

    // Parse timestamp from ts (format: "1234567890.123456")
    const tsParts = messageDoc.ts.split('.');
    const tsMillis = tsParts.length > 0 
      ? parseInt(tsParts[0], 10) * 1000 
      : Date.now();

    await channelRef.set(
      {
        lastMessageAt: admin.firestore.Timestamp.fromMillis(tsMillis),
        lastMessageText: messageDoc.text?.slice(0, 500) ?? '',
        lastMessageUserId: messageDoc.slackUserId,
        lastMessageUserName: userName || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info('Updated Slack channel activity', {
      tenantId,
      channelId,
      lastMessageAt: tsMillis,
    });
  } catch (error: any) {
    logger.warn('Error updating Slack channel activity (non-critical)', {
      error: error.message,
      tenantId,
      channelId,
    });
    // Don't throw - this is non-critical
  }
}

/**
 * Upsert slackTeams document for connection status tracking
 * Helper function to ensure this happens in all code paths
 */
async function upsertSlackTeam(
  tenantId: string,
  teamId: string,
  event: SlackEventPayload['event'],
  messageDoc: SlackMessageDoc
): Promise<void> {
  try {
    const teamName = 'C1 Staffing'; // Hard-coded for single-tenant beta
    const lastEventTs = event.event_ts || event.ts || messageDoc.ts;
    
    await db.collection('slackTeams').doc(tenantId).set(
      {
        tenantId,
        teamId,
        teamName,
        botDisplayName: 'HRX Messaging Bridge',
        status: 'active',
        lastEventTs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Optional debugging field so we can see we've connected at least once
        lastEventSummary: {
          channelId: messageDoc.channelId,
          channelType: messageDoc.channelType,
          slackUserId: messageDoc.slackUserId,
          text: messageDoc.text?.slice(0, 200) || '',
        },
      },
      { merge: true }
    );
    
    logger.info('Slack team document upserted', {
      tenantId,
      teamId,
      lastEventTs,
    });
  } catch (error: any) {
    logger.error('Error upserting slackTeams document', {
      error: error.message,
      tenantId,
      teamId,
    });
    // Don't throw - this is non-critical for message processing
  }
}

/**
 * Handle Slack events asynchronously
 * 
 * Phase 2: Write normalized messages to Firestore `slack_messages` collection
 * with deduplication and TODO hooks for HRX mapping.
 */
async function handleSlackEventAsync(payload: SlackEventPayload): Promise<void> {
  const event = payload.event;

  // Only process message events
  if (event.type !== 'message') {
    logger.info('Ignoring non-message event', { eventType: event.type });
    return;
  }

  // Ignore our own HRX messages to avoid loops/duplication, but DO allow other apps/bots (e.g. Slack Email app).
  const metadata = (event as any)?.metadata;
  if (metadata?.event_type === 'hrx_message') {
    logger.info('Ignoring HRX-tagged message', { channel: event.channel, eventId: payload.event_id });
    return;
  }
  if (event.subtype === 'bot_message') {
    const botName = ((event as any)?.bot_profile?.name || (event as any)?.username || '').toString().toLowerCase();
    if (botName.includes('hrx')) {
      logger.info('Ignoring HRX bot_message', { channel: event.channel, botName, eventId: payload.event_id });
      return;
    }
  }

  // Skip other subtypes that aren't regular messages
  // (e.g., 'message_changed', 'message_deleted', 'channel_join', etc.)
  if (event.subtype && !['', 'thread_broadcast'].includes(event.subtype)) {
    logger.info('Ignoring message subtype', { subtype: event.subtype, channel: event.channel });
    return;
  }

  // Some app/bot messages may not include event.user; allow them through with a synthetic user id.
  const slackUserId = event.user || (event as any)?.bot_id || (event as any)?.username || 'unknown';

  // Skip if no text (e.g., file-only messages)
  if (!event.text || event.text.trim().length === 0) {
    logger.info('Ignoring message with no text', { channel: event.channel });
    return;
  }

  // Determine if this is a thread reply
  const isThreadReply = !!event.thread_ts && event.thread_ts !== event.ts;
  const channelType = getChannelType(event);

  // Check for duplicate event_id (deduplication)
  const eventId = payload.event_id;
  if (eventId) {
    const existingMessageQuery = await db.collection('slack_messages')
      .where('eventId', '==', eventId)
      .limit(1)
      .get();
    
    if (!existingMessageQuery.empty) {
      logger.info('Duplicate Slack event detected, skipping', { eventId, channel: event.channel });
      return;
    }
  }

  // ============================================================================
  // Phase 3.1: Team → Tenant Mapping
  // ============================================================================
  // TEMP: Use hard-coded tenant ID for C1 Staffing
  // TODO (Phase 4): Replace with dynamic mapping: const tenantId = await getTenantIdFromSlackTeam(payload.team_id) ?? DEFAULT_TENANT_ID;
  const tenantId = DEFAULT_TENANT_ID;
  
  // Optional: Try dynamic mapping but fallback to default
  // const dynamicTenantId = await getTenantIdFromSlackTeam(payload.team_id);
  // const tenantId = dynamicTenantId || DEFAULT_TENANT_ID;

  // Create normalized message document (Phase 2)
  const messageDoc: SlackMessageDoc = {
    source: 'slack',
    tenantId, // Required - always set to default for now
    eventId: eventId || `manual-${Date.now()}-${Math.random()}`, // Fallback if no event_id
    teamId: payload.team_id,
    channelId: event.channel || '',
    channelType,
    slackUserId,
    text: event.text,
    ts: event.ts || '',
    threadTs: event.thread_ts || undefined,
    isThreadReply,
    raw: payload, // Full payload for debugging (can trim later)
    createdAt: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
  };

  // ============================================================================
  // Phase 3.2: User Mapping (Slack → HRX Users)
  // ============================================================================
  let hrxUserId: string | null = null;
  let securityLevel = 1;
  let canAccessSlack = false;
  
  try {
    // Try to fetch Slack user info from Slack API (optional)
    let slackEmail: string | undefined;
    let slackDisplayName: string | undefined;
    
    try {
      const botToken = SLACK_BOT_TOKEN.value();
      if (botToken) {
        const userInfo = await fetchSlackUserInfo(event.user, botToken);
        if (userInfo) {
          slackEmail = userInfo.email;
          slackDisplayName = userInfo.displayName;
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch Slack user info for ${event.user}, continuing without it:`, err);
    }
    
    // Map Slack user to HRX user (returns security info)
    const mappingResult = await mapSlackUserToHRXUser(
      tenantId,
      event.user,
      payload.team_id,
      slackEmail,
      slackDisplayName
    );
    
    hrxUserId = mappingResult.hrxUserId;
    securityLevel = mappingResult.securityLevel;
    canAccessSlack = mappingResult.canAccessSlack;
    
    if (hrxUserId) {
      messageDoc.hrxUserId = hrxUserId;
    }
  } catch (error: any) {
    logger.error(`Error mapping Slack user ${event.user} to HRX user:`, error);
    // Continue without hrxUserId - message will be stored but not integrated
  }
  
  // If no HRX user mapped, log and bail (message still stored in slack_messages for audit)
  // NOTE: slackTeams upsert happens after message write, so connection status will still update
  if (!hrxUserId) {
    logger.info('Slack message received from unmapped user', { 
      slackUserId: event.user, 
      tenantId,
      channel: event.channel 
    });
    // Still write to slack_messages for audit trail
    await db.collection('slack_messages').add(messageDoc);
    
    // Update channel activity even for unmapped users
    await updateSlackChannelActivity(
      tenantId,
      messageDoc.channelId,
      messageDoc.channelType,
      messageDoc
    );
    
    // Upsert slackTeams BEFORE returning (so connection status updates even for unmapped users)
    await upsertSlackTeam(tenantId, payload.team_id, event, messageDoc);
    return;
  }
  
  // If the user is below the Slack security threshold, DO NOT create DM/channel
  // NOTE: slackTeams upsert happens after message write, so connection status will still update
  if (!canAccessSlack) {
    logger.info('Slack user below Slack security threshold — message stored but not exposed in HRX', {
      slackUserId: event.user,
      hrxUserId,
      tenantId,
      securityLevel,
      channel: event.channel,
    });
    // Store the normalized slack_messages doc (already done above), but skip internalMessages + unread updates
    await db.collection('slack_messages').add(messageDoc);
    
    // Update channel activity even for low-security users
    await updateSlackChannelActivity(
      tenantId,
      messageDoc.channelId,
      messageDoc.channelType,
      messageDoc
    );
    
    // Upsert slackTeams BEFORE returning (so connection status updates even for low-security users)
    await upsertSlackTeam(tenantId, payload.team_id, event, messageDoc);
    return;
  }

  // ============================================================================
  // Phase 3.3: Channel Mapping (Slack → HRX Conversations)
  // ============================================================================
  let hrxConversationMapping: { conversationType: string; conversationId: string } | null = null;
  
  try {
    // For DMs, we need participant IDs
    // For now, we'll try to map with what we have
    // TODO: Fetch participant IDs from Slack API for DMs if needed
    let participantSlackUserIds: string[] | undefined;
    
    if (channelType === 'im') {
      // For DMs, we need both participants
      // The sender is event.user, but we need the recipient
      // This would require a Slack API call to conversations.info
      // For now, we'll try to map with just the sender and see if a mapping exists
      participantSlackUserIds = undefined; // Will be fetched later or stored on first message
    }
    
    hrxConversationMapping = await mapSlackChannelToHRXConversation(
      tenantId,
      payload.team_id,
      event.channel || '',
      channelType,
      participantSlackUserIds
    );
    
    if (hrxConversationMapping) {
      messageDoc.hrxConversationId = hrxConversationMapping.conversationId;
      messageDoc.hrxConversationType = hrxConversationMapping.conversationType as 'dm' | 'channel';
    }
  } catch (error: any) {
    logger.error(`Error mapping Slack channel ${event.channel} to HRX conversation:`, error);
    // Continue without conversation mapping - message will be stored but not integrated
  }

  // Write to slack_messages (Phase 2) - Always write for audit trail
  try {
    await db.collection('slack_messages').add(messageDoc);
    
    logger.info('Slack message written to Firestore', {
      eventId: messageDoc.eventId,
      channel: messageDoc.channelId,
      channelType: messageDoc.channelType,
      slackUserId: messageDoc.slackUserId,
      tenantId: messageDoc.tenantId,
      hrxUserId: messageDoc.hrxUserId,
      hrxConversationId: messageDoc.hrxConversationId,
      securityLevel,
      canAccessSlack,
      isThreadReply: messageDoc.isThreadReply,
    });
  } catch (error: any) {
    logger.error('Error writing Slack message to Firestore', {
      error: error.message,
      eventId: messageDoc.eventId,
      channel: messageDoc.channelId,
    });
    throw error;
  }

  // ============================================================================
  // Update slackChannels document with last message activity
  // ============================================================================
  // Get user name for display (try from mapping result or Slack API)
  let userName: string | undefined;
  try {
    if (messageDoc.hrxUserId) {
      const hrxUserDoc = await db.collection('users').doc(messageDoc.hrxUserId).get();
      if (hrxUserDoc.exists) {
        userName = hrxUserDoc.data()?.displayName || hrxUserDoc.data()?.email;
      }
    }
  } catch (err) {
    // Non-critical, continue without user name
  }

  await updateSlackChannelActivity(
    tenantId,
    messageDoc.channelId,
    messageDoc.channelType,
    messageDoc,
    userName
  );

  // ============================================================================
  // Upsert slackTeams document for connection status tracking
  // IMPORTANT: This must happen AFTER writing to slack_messages
  // ============================================================================
  await upsertSlackTeam(tenantId, payload.team_id, event, messageDoc);

  // ============================================================================
  // Phase 3.4: Message Integration & Unread Counts
  // ============================================================================
  // Only integrate if we have all required mappings AND user can access Slack
  if (tenantId && hrxUserId && hrxConversationMapping && canAccessSlack) {
    try {
      // Import InternalMessage type
      type InternalMessage = import('./messaging/internalMessaging').InternalMessage;
      
      // Get user name and avatar
      let fromUserName = 'Unknown';
      let fromUserAvatar: string | undefined;
      
      try {
        const userDoc = await db.collection('users').doc(hrxUserId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          fromUserName = userData?.displayName || 
            `${userData?.firstName || ''} ${userData?.lastName || ''}`.trim() || 
            userData?.email?.split('@')[0] || 'Unknown';
          fromUserAvatar = userData?.avatar || userData?.avatarUrl;
        }
      } catch (err) {
        logger.warn(`Failed to fetch user data for ${hrxUserId}:`, err);
      }
      
      // Phase 5: Extract thread info
      const ts = messageDoc.ts;
      const threadTs = messageDoc.threadTs || ts;
      const inSlackThread = threadTs !== ts;

      // Create normalized internal message
      const internalMessage: Omit<InternalMessage, 'id'> = {
        tenantId,
        conversationType: hrxConversationMapping.conversationType as 'dm' | 'channel',
        conversationId: hrxConversationMapping.conversationId,
        threadId: threadTs !== ts ? threadTs : undefined, // For future thread support
        content: messageDoc.text,
        contentType: 'text',
        fromUserId: hrxUserId,
        fromUserName,
        fromUserAvatar,
        reactions: [],
        // Phase 4/5: Mark as from Slack
        source: 'slack',
        mirroredFromSlack: true,
        mirroredToSlack: false,
        slackMessageMeta: {
          teamId: messageDoc.teamId,
          channelId: messageDoc.channelId,
          ts,
          threadTs,
        },
        inSlackThread,
        createdAt: messageDoc.createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      // Write to internalMessages subcollection
      const conversationRef = hrxConversationMapping.conversationType === 'dm'
        ? db.collection('tenants').doc(tenantId)
            .collection('internalDMs').doc(hrxConversationMapping.conversationId)
        : db.collection('tenants').doc(tenantId)
            .collection('internalChannels').doc(hrxConversationMapping.conversationId);
      
      const messageRef = await conversationRef
        .collection('internalMessages')
        .add(internalMessage);
      
      const newMessageId = messageRef.id;
      logger.info(`Created internal message ${newMessageId} from Slack message`);

      // Phase 5: Log inbound traffic
      await logSlackTraffic({
        tenantId,
        direction: 'inbound',
        type: 'message',
        source: 'slackEvents',
        teamId: messageDoc.teamId,
        channelId: messageDoc.channelId,
        slackUserId: messageDoc.slackUserId,
        internalConversationId: hrxConversationMapping.conversationId,
        internalMessageId: newMessageId,
        ts: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
        slackTs: ts,
        slackThreadTs: threadTs,
        status: 'ok',
      });
      
      // Update conversation lastMessage fields
      await conversationRef.update({
        lastMessage: messageDoc.text.substring(0, 100),
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageFrom: internalMessage.fromUserId,
        lastMessageFromUserId: internalMessage.fromUserId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Update unread counts
      await updateUnreadCountsForSlackMessage(
        tenantId,
        hrxConversationMapping.conversationType as 'dm' | 'channel',
        hrxConversationMapping.conversationId,
        hrxUserId, // Sender - don't increment for them
        conversationRef
      );
      
      logger.info(`Successfully integrated Slack message into HRX messaging system`);
    } catch (error: any) {
      logger.error(`Error integrating Slack message into HRX messaging:`, error);
      // Don't throw - message is already stored in slack_messages
    }
  } else {
    logger.info('Slack message not fully integrated (missing mappings)', {
      hasTenantId: !!tenantId,
      hasHrxUserId: !!hrxUserId,
      hasConversationMapping: !!hrxConversationMapping,
    });
  }
}

/**
 * Slack Events API Endpoint
 * 
 * Route: POST /slack/events
 * 
 * Handles:
 * - URL verification (challenge/response)
 * - Event callbacks (messages, etc.)
 * - Signature verification
 * - Replay attack prevention
 */
export const slackEvents = onRequest(
  {
    maxInstances: 5,
    timeoutSeconds: 15,
    cors: false, // Slack doesn't need CORS
    secrets: [SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN], // Grant access to secrets
  },
  async (req, res) => {
    // Slack only supports POST
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      // Body handling for signature verification
      // Note: Firebase Functions v2 with Express parses JSON automatically
      // For proper signature verification, we need the raw body string
      // If rawBody is not available, we'll reconstruct it (Slack signature verification may fail if formatting differs)
      let rawBody: string;
      
      // Check if rawBody is available (Firebase Functions may provide this)
      if ((req as any).rawBody) {
        rawBody = (req as any).rawBody.toString('utf8');
      } else {
        // Fallback: reconstruct JSON string
        // WARNING: This may cause signature verification to fail if Slack's JSON has different formatting
        // For production, configure Firebase Functions to preserve raw body or use a middleware
        rawBody = JSON.stringify(req.body);
      }

      // 1. URL verification (no signature check needed for this)
      if (req.body && req.body.type === 'url_verification') {
        const payload = req.body as SlackUrlVerificationPayload;
        logger.info('Slack URL verification received', { challenge: payload.challenge });
        res.status(200).json({ challenge: payload.challenge });
        return;
      }

      // 2. Signature verification for all other requests
      const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
      const slackSignature = req.headers['x-slack-signature'] as string | undefined;

      let signingSecretOverride: string | undefined;
      try {
        // Prefer Secret Manager
        signingSecretOverride = SLACK_SIGNING_SECRET.value();
      } catch {
        signingSecretOverride = undefined;
      }
      if (!signingSecretOverride) {
        // Fallback to tenant integration config (single-tenant)
        const fallback = await getSlackSecretsFallback(DEFAULT_TENANT_ID);
        signingSecretOverride = fallback.signingSecret;
      }

      if (!verifySlackRequest({ rawBody, timestamp, slackSignature, signingSecretOverride })) {
        logger.warn('Invalid Slack signature. Rejecting request.', {
          hasTimestamp: !!timestamp,
          hasSignature: !!slackSignature,
        });
        res.status(401).send('Invalid signature');
        return;
      }

      const payload = req.body as SlackEventPayload;

      // 3. Event callback
      if (payload.type === 'event_callback') {
        const event = payload.event;
        
        logger.info('Slack event callback received', {
          eventType: event.type,
          subtype: event.subtype,
          channel: event.channel,
          user: event.user,
          eventId: payload.event_id,
        });

        // Immediately ACK to Slack (must respond within 3 seconds)
        res.status(200).json({ ok: true });

        // Process event asynchronously (do NOT await here)
        handleSlackEventAsync(payload).catch((err) => {
          logger.error('Error handling Slack event asynchronously', {
            error: err,
            eventId: payload.event_id,
            eventType: event.type,
          });
        });

        return;
      }

      // Fallback: unknown payload type (still ACK to avoid retries)
      logger.warn('Unknown Slack payload type', { type: (req.body as any)?.type });
      res.status(200).json({ ok: true });
    } catch (err: any) {
      logger.error('Error processing Slack event request', {
        error: err,
        message: err?.message,
        stack: err?.stack,
      });
      // Return 500 so Slack will retry
      res.status(500).send('Internal Server Error');
    }
  }
);

