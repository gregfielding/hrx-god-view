/**
 * Slack Message Activity Trigger
 * 
 * Firestore trigger that updates slackChannels activity snapshots
 * whenever a new Slack message is created in the slack_messages collection.
 * 
 * This implements the activity snapshot pattern for the Slack Channels page.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Activity bucket thresholds
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

/**
 * Determine activity bucket based on message timestamp
 */
function getActivityBucket(messageDate: Date): 'active' | 'quiet' | 'silent' {
  const now = Date.now();
  const diff = now - messageDate.getTime();

  if (diff <= ONE_DAY_MS) return 'active';
  if (diff <= SEVEN_DAYS_MS) return 'quiet';
  return 'silent';
}

/**
 * Firestore trigger: onCreate for slack_messages
 * 
 * Updates the corresponding slackChannels document with activity snapshot fields.
 */
export const onSlackMessageActivity = onDocumentCreated(
  {
    document: 'slack_messages/{messageId}',
    region: 'us-central1',
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      logger.warn('[onSlackMessageActivity] No data in document', {
        messageId: event.params.messageId,
      });
      return;
    }

    const {
      tenantId,
      channelId,
      teamId,
      text,
      slackUserId,
      userName,
      ts,
      source,
      type,
      channelType,
      channelName,
    } = data;

    // Validate required fields
    if (!tenantId || !channelId || !ts) {
      logger.warn('[onSlackMessageActivity] Missing required fields', {
        messageId: event.params.messageId,
        hasTenantId: !!tenantId,
        hasChannelId: !!channelId,
        hasTs: !!ts,
      });
      return;
    }

    // Only process channel/group types, not DMs
    if (channelType && channelType !== 'channel' && channelType !== 'group') {
      logger.debug('[onSlackMessageActivity] Skipping non-channel message', {
        channelType,
        channelId,
      });
      return;
    }

    try {
      // Parse Slack timestamp (format: "1234567890.123456")
      const tsParts = ts.split('.');
      const tsSeconds = tsParts.length > 0 ? parseFloat(tsParts[0]) : 0;
      const messageDate = new Date(tsSeconds * 1000);
      const activityBucket = getActivityBucket(messageDate);

      const channelRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('slackChannels')
        .doc(channelId);

      // Use transaction to ensure idempotency and handle concurrent updates
      await db.runTransaction(async (tx) => {
        const channelSnap = await tx.get(channelRef);

        const existing = channelSnap.data();
        const existingTs = existing?.lastMessageTs
          ? parseFloat(existing.lastMessageTs)
          : 0;
        const incomingTs = parseFloat(ts);

        // If we already have a newer message, skip update
        if (existingTs >= incomingTs) {
          logger.debug('[onSlackMessageActivity] Skipping older message', {
            channelId,
            existingTs,
            incomingTs,
          });
          return;
        }

        // Clean and truncate message text
        const cleanText = (text ?? '').trim().replace(/\s+/g, ' ');
        const snippet =
          cleanText.length > 120
            ? cleanText.slice(0, 117) + '…'
            : cleanText;

        // Increment message count (best-effort)
        const messageCount = (existing?.messageCount ?? 0) + 1;

        // Determine activity type
        const activityType = type || 'message';

        // Update channel snapshot
        const updateData: any = {
          teamId: teamId ?? existing?.teamId,
          tenantId: tenantId ?? existing?.tenantId,
          lastMessageText: snippet || existing?.lastMessageText || null,
          lastMessageUserName: (userName ?? existing?.lastMessageUserName) || null,
          // For HRX messages, slackUserId is null, so use userId as fallback
          lastMessageUserId: (slackUserId ?? data.userId ?? existing?.lastMessageUserId) || null,
          lastMessageTs: ts,
          lastMessageAt: admin.firestore.Timestamp.fromDate(messageDate),
          lastDirection: source ?? 'slack',
          lastActivityType: activityType,
          hasRecentActivity: true,
          activityBucket,
          messageCount,
          lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Preserve existing channel metadata if this is a new channel doc
        if (!channelSnap.exists) {
          updateData.rawName = channelName || channelId;
          updateData.name = channelName || channelId;
          updateData.watched = false;
          updateData.muted = false;
          updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        tx.set(channelRef, updateData, { merge: true });
      });

      logger.info('[onSlackMessageActivity] Updated channel activity snapshot', {
        tenantId,
        channelId,
        activityBucket,
        messageTs: ts,
      });
    } catch (error: any) {
      logger.error('[onSlackMessageActivity] Error updating channel activity', {
        error: error.message,
        stack: error.stack,
        tenantId,
        channelId,
        messageId: event.params.messageId,
      });
      // Don't throw - this is non-critical for message processing
    }
  }
);

