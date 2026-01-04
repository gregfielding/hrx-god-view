/**
 * Unified Inbox Types
 * 
 * Normalized message interface for displaying messages from all channels
 * (Email, SMS, Slack, Internal) in a single unified view.
 * 
 * Based on HRX Unified Inbox Implementation Pack
 */

import { Timestamp } from 'firebase/firestore';

export type InboxChannel = 'email' | 'sms' | 'slack' | 'internal';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'unreplied' | 'replied' | 'failed' | 'queued';

/**
 * Base message interface shared across all channels
 */
export interface BaseMessage {
  id: string;
  tenantId: string;
  channel: InboxChannel;
  direction: MessageDirection;
  createdAt: Date | Timestamp;
  /**
   * Backward-compatible alias used by some older UI helpers.
   * Prefer `createdAt`; this exists to avoid TS breaks when normalizers/sorters
   * still reference `timestamp`.
   */
  timestamp?: Date | Timestamp;
  updatedAt?: Date | Timestamp;
  sentAt?: Date | Timestamp | null;
  readAt?: Date | Timestamp | null;
  subject?: string | null;
  previewText: string;
  bodyPlain?: string | null;
  bodyHtml?: string | null;

  // Threading
  threadId?: string | null;
  parentId?: string | null;

  // Associations
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  jobId?: string | null;
  workerId?: string | null;

  // Flags
  isUnread: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
  hasAttachments?: boolean;

  // Audit
  createdByUserId?: string | null;
  lastUpdatedByUserId?: string | null;
}

/**
 * Email-specific message
 */
export interface EmailMessage extends BaseMessage {
  channel: 'email';
  messageId?: string;
  threadKey?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
}

/**
 * SMS-specific message
 */
export interface SmsMessage extends BaseMessage {
  channel: 'sms';
  fromNumber: string;
  toNumber: string;
  provider: 'twilio' | 'other';
  providerMessageId?: string;
}

/**
 * Slack message metadata
 */
export interface SlackMessageMeta {
  teamId: string;
  channelId: string;
  channelType: 'im' | 'channel' | 'group' | 'mpim';
  ts: string;
  threadTs?: string | null;
  userId?: string;
  channelName?: string;
}

/**
 * Slack-specific message
 */
export interface SlackMessage extends BaseMessage {
  channel: 'slack';
  slackUserId: string;
  slackTeamId: string;
  slackMessageMeta: SlackMessageMeta;
  mirroredFromSlack: boolean;
  mirroredToSlack: boolean;
}

/**
 * Internal message (DM or Channel)
 */
export interface InternalMessage extends BaseMessage {
  channel: 'internal';
  internalType: 'dm' | 'channel';
  internalConversationId: string;
}

/**
 * Unified inbox message - can be any channel type
 */
export interface UnifiedInboxMessage extends BaseMessage {
  channel: InboxChannel;
  // Channel-specific data (only one will be populated)
  email?: EmailMessage;
  sms?: SmsMessage;
  slack?: SlackMessage;
  internal?: InternalMessage;
}

/**
 * Filters for unified inbox
 */
export interface UnifiedInboxFilters {
  // High-level
  channel?: InboxChannel | 'all';
  direction?: MessageDirection | 'all';
  unreadOnly?: boolean;
  starredOnly?: boolean;

  // Associations
  companyId?: string;
  contactId?: string;
  dealId?: string;
  jobId?: string;
  workerId?: string;

  // Time
  from?: Date;
  to?: Date;

  // Search
  query?: string; // free-text (subject, preview, body)
  searchQuery?: string; // alias for query
}

/**
 * Pagination result
 */
export interface UnifiedInboxPageResult {
  messages: UnifiedInboxMessage[];
  nextCursor?: string | null;
  hasMore: boolean;
}

// Legacy type aliases for backward compatibility
export type MessageSource = InboxChannel;
export type UnifiedMessage = UnifiedInboxMessage;

