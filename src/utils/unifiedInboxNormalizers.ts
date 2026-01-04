/**
 * Unified Inbox Normalizers
 * 
 * Functions to normalize messages from different channels into UnifiedMessage format
 */

import { UnifiedMessage } from '../types/unifiedInboxLegacy';
import { Timestamp } from 'firebase/firestore';

// Keep these normalizers decoupled from the inbox page implementation.
// The inbox UI may change its local TS interfaces without affecting these helpers.
type EmailThreadLike = any;
type SmsThreadLike = any;

/**
 * Normalize an email thread to UnifiedMessage
 */
export function normalizeEmailThread(
  thread: EmailThreadLike,
  tenantId: string
): UnifiedMessage {
  const lastMessageAt = thread.lastMessageAt?.toDate?.() || 
                       (thread.lastMessageAt instanceof Date ? thread.lastMessageAt : new Date());
  
  return {
    id: `email_${thread.id}`,
    source: 'email',
    conversationId: thread.id,
    tenantId,
    from: thread.participants[0] || 'Unknown',
    subject: thread.subject || '(No subject)',
    preview: thread.lastMessageSnippet || '',
    timestamp: lastMessageAt instanceof Date ? lastMessageAt : Timestamp.fromDate(lastMessageAt),
    unread: thread.unreadCount > 0,
    status: thread.unreadCount > 0 ? 'unreplied' : 'replied',
    originalDocId: thread.id,
  };
}

/**
 * Normalize an SMS thread to UnifiedMessage
 */
export function normalizeSmsThread(
  thread: SmsThreadLike,
  tenantId: string
): UnifiedMessage {
  const lastMessageAt = thread.lastMessageAt?.toDate?.() || 
                       (thread.lastMessageAt instanceof Date ? thread.lastMessageAt : new Date());
  
  return {
    id: `sms_${thread.id}`,
    source: 'sms',
    conversationId: thread.id,
    tenantId,
    from: thread.candidateName || thread.candidatePhoneMasked || 'Unknown',
    preview: thread.lastMessageSnippet || '',
    timestamp: lastMessageAt instanceof Date ? lastMessageAt : Timestamp.fromDate(lastMessageAt),
    unread: thread.status === 'unread' || thread.status === 'new',
    status: thread.status === 'unread' || thread.status === 'new' ? 'unreplied' : 'replied',
    originalDocId: thread.id,
  };
}

/**
 * Normalize a Slack message to UnifiedMessage
 * 
 * Formats messages according to spec:
 * - DM: "Slack – DM" with sender name
 * - Channel: "Slack – #channel-name" with sender name
 */
export function normalizeSlackMessage(
  doc: any,
  tenantId: string
): UnifiedMessage {
  const data = doc.data();
  const timestamp = data.createdAt?.toDate?.() || 
                   (data.createdAt instanceof Date ? data.createdAt : new Date());
  
  // Determine channel context label
  const channelType = data.channelType || 'channel';
  const channelName = data.channelName || '';
  const isDM = channelType === 'im';
  const isGroupDM = channelType === 'mpim';
  
  // Format the "from" field to show Slack context
  let fromLabel = data.userName || data.slackUserId || 'Unknown';
  let slackContext = '';
  
  if (isDM) {
    slackContext = 'Slack – DM';
  } else if (isGroupDM) {
    slackContext = 'Slack – Group DM';
  } else if (channelName) {
    slackContext = `Slack – #${channelName}`;
  } else {
    slackContext = 'Slack – Channel';
  }
  
  // Format subject/preview to include Slack context
  const preview = data.text || '';
  
  return {
    id: `slack_${doc.id}`,
    source: 'slack',
    conversationId: data.channelId || doc.id,
    tenantId,
    from: fromLabel,
    subject: slackContext, // Use subject field to show Slack context
    preview: preview,
    timestamp: timestamp instanceof Date ? timestamp : Timestamp.fromDate(timestamp),
    unread: data.isUnread !== false, // Default to unread if not specified
    status: data.mirroredToSlack ? 'replied' : 'unreplied',
    slackMeta: {
      teamId: data.teamId || '',
      channelId: data.channelId || '',
      ts: data.ts || '',
      channelName: channelName,
      channelType: channelType,
    },
    originalDocId: doc.id,
  };
}

/**
 * Normalize an internal message to UnifiedMessage
 */
export function normalizeInternalMessage(
  doc: any,
  tenantId: string
): UnifiedMessage {
  const data = doc.data();
  const timestamp = data.createdAt?.toDate?.() || 
                   (data.createdAt instanceof Date ? data.createdAt : new Date());
  
  return {
    id: `internal_${doc.id}`,
    source: 'internal',
    conversationId: data.conversationId || data.threadId || doc.id,
    tenantId,
    from: data.senderName || data.senderId || 'Unknown',
    preview: data.content || data.text || '',
    timestamp: timestamp instanceof Date ? timestamp : Timestamp.fromDate(timestamp),
    unread: data.isUnread !== false,
    status: 'unreplied',
    originalDocId: doc.id,
  };
}

/**
 * Sort messages by timestamp (newest first)
 */
export function sortMessagesByTimestamp(messages: UnifiedMessage[]): UnifiedMessage[] {
  return [...messages].sort((a, b) => {
    const aTime = a.timestamp instanceof Timestamp ? a.timestamp.toMillis() : 
                  a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
    const bTime = b.timestamp instanceof Timestamp ? b.timestamp.toMillis() : 
                  b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
    return bTime - aTime; // Descending (newest first)
  });
}

