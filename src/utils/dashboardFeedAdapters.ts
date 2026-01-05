/**
 * Dashboard Feed Adapters
 * 
 * Convert source-specific data into unified DashboardFeedItem format.
 */

import { DashboardFeedItem } from '../types/dashboardFeed';

function toEpochMs(value: any): number {
  if (!value) return 0;

  // Firestore Timestamp (client) or admin Timestamp-like
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date ? d.getTime() : 0;
  }

  if (value instanceof Date) return value.getTime();

  // ISO string (API serializes Firestore timestamps to ISO strings)
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }

  // Numeric timestamps (seconds or ms)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    // Heuristic: seconds are usually 10 digits; ms are 13 digits
    return value < 1e12 ? Math.floor(value * 1000) : Math.floor(value);
  }

  // Timestamp-like object
  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return Math.floor(seconds * 1000);
  }

  return 0;
}

// Email Thread Adapter
export interface EmailThreadSource {
  id: string;
  subject: string;
  participants: string[];
  lastMessageAt: any; // Firestore Timestamp or Date
  lastMessageSnippet?: string;
  unreadCount: number;
  participantContacts?: Array<{
    email: string;
    contactName?: string;
    userName?: string;
    avatarUrl?: string;
  }>;
}

export function adaptEmailThreadToFeedItem(
  thread: EmailThreadSource,
  tenantId: string
): DashboardFeedItem {
  const timestamp = toEpochMs(thread.lastMessageAt);

  // Get primary sender from participant contacts
  const primaryContact = thread.participantContacts?.[0];
  const fromLabel = primaryContact?.contactName || 
                    primaryContact?.userName || 
                    primaryContact?.email?.split('@')[0] || 
                    'Unknown';
  const avatarUrl = primaryContact?.avatarUrl;

  return {
    id: `email_${thread.id}`,
    sourceType: 'email',
    sourceId: thread.id,
    title: thread.subject || '(No subject)',
    snippet: thread.lastMessageSnippet || '',
    fromLabel,
    avatarUrl,
    isUnread: thread.unreadCount > 0,
    isMuted: false, // Email mute not implemented yet
    timestamp,
    drawerScope: {
      scopeType: 'email',
      threadId: thread.id,
    },
  };
}

// Slack DM Thread Adapter
export interface SlackDMThreadSource {
  id: string;
  otherUser: {
    uid: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
  };
  lastMessageText: string;
  lastMessageAt: Date | null;
  unreadCount: number;
  isMuted: boolean;
}

export function adaptSlackDMToFeedItem(
  thread: SlackDMThreadSource
): DashboardFeedItem {
  const timestamp = toEpochMs(thread.lastMessageAt);

  return {
    id: `slack_dm_${thread.id}`,
    sourceType: 'slack_dm',
    sourceId: thread.id,
    title: `DM with ${thread.otherUser.displayName}`,
    snippet: thread.lastMessageText || '',
    fromLabel: thread.otherUser.displayName,
    avatarUrl: thread.otherUser.avatarUrl,
    isUnread: thread.unreadCount > 0,
    isMuted: thread.isMuted,
    timestamp,
    drawerScope: {
      scopeType: 'slack_dm',
      channelId: thread.id,
      dmUserId: thread.otherUser.uid,
    },
  };
}

// Slack Channel Adapter
export interface SlackChannelSource {
  id: string;
  name: string;
  lastMessageText?: string;
  lastMessageUserName?: string;
  lastMessageAt?: Date | null;
  status: 'watching' | 'unlinked' | 'muted' | 'setup_needed';
  unreadCount?: number;
  hasMentions?: boolean;
}

export function adaptSlackChannelToFeedItem(
  channel: SlackChannelSource,
  userId: string
): DashboardFeedItem | null {
  const timestamp = toEpochMs(channel.lastMessageAt);
  const isMuted = channel.status === 'muted';
  
  // Dashboard feed inclusion rule: member + not muted.
  // Channel.status is not a reliable per-user membership indicator (often "unlinked" by default),
  // so we only exclude muted here. Membership filtering happens in the hook.
  if (isMuted) return null;
  if (!timestamp) return null;

  const channelName = channel.name.startsWith('#') 
    ? channel.name 
    : `#${channel.name}`;

  return {
    id: `slack_channel_${channel.id}`,
    sourceType: 'slack_channel',
    sourceId: channel.id,
    title: channelName,
    snippet: channel.lastMessageText || 
             (channel.lastMessageUserName 
               ? `${channel.lastMessageUserName}: (message)` 
               : 'No recent activity'),
    fromLabel: channel.lastMessageUserName || 'No activity',
    isUnread: (channel.unreadCount || 0) > 0,
    hasMentions: channel.hasMentions || false,
    isMuted: false, // Already filtered out muted channels
    timestamp,
    drawerScope: {
      scopeType: 'slack_channel',
      channelId: channel.id,
    },
  };
}

