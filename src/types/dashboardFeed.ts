/**
 * Dashboard Feed Types
 * 
 * Unified feed item types for the Dashboard activity stream.
 */

export type FeedSourceType = 'email' | 'slack_dm' | 'slack_channel' | 'calendar';

export interface DashboardFeedItem {
  id: string;                 // global unique ID for the feed item
  sourceType: FeedSourceType; // which subsystem
  sourceId: string;           // ID in that subsystem (e.g. email threadId, slack channelId, DM threadId)
  messageId?: string;         // optional: specific message id in that source
  title: string;              // subject line, channel name + snippet, etc.
  snippet: string;            // short text preview
  fromLabel: string;          // "From" contact name or author
  avatarUrl?: string;         // primary avatar (optional)
  isUnread: boolean;
  hasMentions?: boolean;      // for Slack – @mentions of this user
  isMuted: boolean;           // true if muted at the source level (e.g. channel muted)
  timestamp: number;          // ms since epoch – used for sorting
  // Calendar-specific fields
  hangoutLink?: string;       // Google Meet link for calendar events
  eventStatus?: 'confirmed' | 'tentative' | 'cancelled'; // Status for calendar events
  eventOwnership?: 'owned' | 'invited' | 'external'; // Event ownership type
  rsvpStatus?: 'accepted' | 'tentative' | 'declined' | 'needsAction'; // User's RSVP status
  // linking info for Drawer
  drawerScope: {
    scopeType: 'email' | 'slack_dm' | 'slack_channel' | 'calendar';
    threadId?: string;
    channelId?: string;
    dmUserId?: string;
    eventId?: string; // For calendar events
    dateKey?: string; // For calendar events, e.g., YYYY-MM-DD
  };
}

