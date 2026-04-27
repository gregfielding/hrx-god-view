/**
 * Slack Mentions Handler
 * 
 * Detects @mentions in Slack messages and creates mention feed items.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { mapSlackUserToHRXUser } from '../messaging/slackMapping';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MENTION_REGEX = /<@([A-Z0-9]+)>/g;

/**
 * Lookup HRX users by Slack user IDs
 */
async function lookupHrxUsersBySlackIds(
  mentionedSlackIds: string[],
  teamId: string,
  tenantId: string
): Promise<Array<{ id: string; email?: string; displayName?: string }>> {
  const hrxUsers: Array<{ id: string; email?: string; displayName?: string }> = [];

  for (const slackUserId of mentionedSlackIds) {
    try {
      const mappingResult = await mapSlackUserToHRXUser(
        tenantId,
        slackUserId,
        teamId
      );

      if (mappingResult.hrxUserId) {
        // Fetch user details
        const userDoc = await db.collection('users').doc(mappingResult.hrxUserId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          hrxUsers.push({
            id: mappingResult.hrxUserId,
            email: userData?.email,
            displayName: userData?.displayName || userData?.firstName || userData?.email?.split('@')[0],
          });
        }
      }
    } catch (error: any) {
      logger.warn(`Failed to map Slack user ${slackUserId} to HRX user:`, error);
    }
  }

  return hrxUsers;
}

/**
 * Lookup HRX user by Slack user ID (for message author)
 */
async function lookupHrxUserBySlackUserId(
  slackUserId: string,
  teamId: string,
  tenantId: string
): Promise<{ id: string; email?: string; displayName?: string } | null> {
  try {
    const mappingResult = await mapSlackUserToHRXUser(
      tenantId,
      slackUserId,
      teamId
    );

    if (mappingResult.hrxUserId) {
      const userDoc = await db.collection('users').doc(mappingResult.hrxUserId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        return {
          id: mappingResult.hrxUserId,
          email: userData?.email,
          displayName: userData?.displayName || userData?.firstName || userData?.email?.split('@')[0],
        };
      }
    }
  } catch (error: any) {
    logger.warn(`Failed to map Slack author ${slackUserId} to HRX user:`, error);
  }

  return null;
}

/**
 * Build snippet from Slack message text (strip mentions, truncate)
 */
function buildSlackSnippet(text: string, maxLength = 120): string {
  // Remove mention tokens like <@U123456>
  let snippet = text.replace(/<@[A-Z0-9]+>/g, '@user');
  // Remove other Slack formatting
  snippet = snippet.replace(/<[^>]+>/g, '');
  // Trim and truncate
  snippet = snippet.trim();
  if (snippet.length > maxLength) {
    snippet = snippet.substring(0, maxLength) + '...';
  }
  return snippet;
}

/**
 * Get or cache channel info
 */
async function getOrCacheChannelInfo(
  tenantId: string,
  teamId: string,
  channelId: string
): Promise<{ name: string }> {
  try {
    // Try to get from slackChannels collection
    const channelDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('slackChannels')
      .doc(channelId)
      .get();

    if (channelDoc.exists) {
      const data = channelDoc.data();
      const name = data?.name || data?.displayName || channelId;
      return { name: name.startsWith('#') ? name : `#${name}` };
    }
  } catch (error: any) {
    logger.warn(`Failed to get channel info for ${channelId}:`, error);
  }

  // Fallback: return channel ID
  return { name: `#${channelId}` };
}

/**
 * Get Slack message permalink
 */
async function getMessagePermalink(
  teamId: string,
  channelId: string,
  ts: string,
  botToken?: string
): Promise<string | undefined> {
  if (!botToken) {
    return undefined;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.getPermalink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        message_ts: ts,
      }),
    });

    const data = await response.json();
    if (data.ok && data.permalink) {
      return data.permalink;
    }
  } catch (error: any) {
    logger.warn(`Failed to get permalink for message ${ts}:`, error);
  }

  return undefined;
}

/**
 * Handle Slack message mentions
 * Creates mention feed items in dashboardFeed collection
 */
export async function handleSlackMentions(
  event: {
    text: string;
    channel: string;
    ts: string;
    user?: string;
    team?: string;
  },
  tenantId: string,
  teamId: string,
  botToken?: string
): Promise<void> {
  const { text = '', channel, ts, user: authorSlackId, team } = event;

  // 1️⃣ Extract mentioned Slack user IDs
  const mentionedSlackIds = Array.from(text.matchAll(MENTION_REGEX))
    .map(m => m[1]);

  if (mentionedSlackIds.length === 0) {
    return; // No mentions
  }

  // 2️⃣ Map Slack IDs → HRX users
  const hrxUsers = await lookupHrxUsersBySlackIds(mentionedSlackIds, teamId, tenantId);

  if (hrxUsers.length === 0) {
    logger.info('No HRX users found for mentioned Slack IDs', { mentionedSlackIds });
    return;
  }

  // 3️⃣ Build snippet + channel label
  const snippet = buildSlackSnippet(text);
  const channelInfo = await getOrCacheChannelInfo(tenantId, teamId, channel);
  const channelLabel = channelInfo.name;

  // 4️⃣ Resolve author HRX user (best effort)
  const authorHrx = authorSlackId
    ? await lookupHrxUserBySlackUserId(authorSlackId, teamId, tenantId)
    : null;

  // 5️⃣ Get message permalink
  const permalink = botToken
    ? await getMessagePermalink(teamId, channel, ts, botToken)
    : undefined;

  // 6️⃣ Create feed items
  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const hrxUser of hrxUsers) {
    const id = `mention:${teamId}:${channel}:${ts}:${hrxUser.id}`;

    const item = {
      id,
      userId: hrxUser.id,
      sourceType: 'mention' as const,
      sourceId: `slack:${teamId}:${channel}:${ts}`,
      messageId: ts,
      title: channelLabel,
      snippet,
      fromLabel: authorHrx?.displayName || 'Unknown',
      avatarUrl: undefined,
      isUnread: true,
      isMuted: false,
      timestamp: now.toMillis(),
      mentionedUserId: hrxUser.id,
      mentionedByUserId: authorHrx?.id || null,
      channelLabel,
      mentionMetadata: {
        origin: 'slack' as const,
        slackTeamId: teamId,
        slackChannelId: channel,
        slackChannelName: channelInfo.name.replace('#', ''),
        slackTs: ts,
        slackMessagePermalink: permalink,
      },
      drawerScope: {
        scopeType: 'mention' as const,
        channelId: channel,
      },
    };

    const ref = db.collection('dashboardFeed').doc(id);
    batch.set(ref, item, { merge: true });
  }

  await batch.commit();
  logger.info(`Created ${hrxUsers.length} mention feed items for Slack message ${ts}`);
}

