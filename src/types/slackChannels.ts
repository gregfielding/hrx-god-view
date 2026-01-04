/**
 * Slack Channels Types
 * 
 * Types for Slack channel data model and UI components.
 */

export type SlackChannelStatus =
  | 'watching'
  | 'muted'
  | 'unlinked'
  | 'setup_needed';

export type SlackActivityBucket = 'active' | 'quiet' | 'silent';

export interface SlackChannelView {
  id: string;                  // Firestore doc ID
  tenantId: string;
  slackTeamId: string;
  slackChannelId: string;

  name: string;                // raw name, e.g. "c1-events-oakland"
  displayName: string;         // e.g. "#c1-events-oakland"
  topic?: string;
  isArchived?: boolean;        // true if channel is archived in Slack

  status: SlackChannelStatus;

  // HRX links
  linkedDeal?: { id: string; name: string } | null;
  linkedCustomer?: { id: string; name: string } | null;
  linkedJob?: { id: string; title: string } | null;
  linkedTeam?: { id: string; name: string } | null;

  // Activity snapshot fields (from Firestore)
  lastMessageText?: string;
  lastMessageUserName?: string;
  lastMessageUserId?: string;
  lastMessageTs?: string;
  lastMessageAt?: Date | null;
  lastDirection?: 'slack' | 'hrx';
  lastActivityType?: 'message' | 'thread_reply' | 'reaction' | 'other';
  hasRecentActivity: boolean;
  activityBucket: SlackActivityBucket;
  messageCount?: number;

  // Legacy activity fields (for backwards compatibility)
  lastMessageUser?: string | null;
  unreadCount?: number | null;
  unreadMentions?: number | null;

  // Convenience fields for UI (computed in hook)
  latestActivityLabel: string;   // e.g. "Tabitha: Updated job order for Arcil…"
  latestActivityTimeLabel: string; // e.g. "3m ago", "Yesterday", "Oct 12"

  // Derived booleans for filters
  isWatched: boolean;
  isMuted: boolean;
  isActive: boolean;           // derived from lastMessageAt or activityBucket
}

export interface SlackChannelsFilter {
  membershipFilter: 'myChannels' | 'all';
  search: string;
}

