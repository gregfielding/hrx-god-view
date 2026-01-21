/**
 * Dashboard Feed Types
 * 
 * Unified feed item types for the Dashboard activity stream.
 */

export type FeedSourceType =
  | 'email'
  | 'slack_dm'
  | 'slack_channel'
  | 'calendar'
  | 'mention'
  | 'notification';

// Mention-specific metadata types
export type MentionOrigin = 'slack' | 'hrx';

export interface MentionMetadataSlack {
  origin: 'slack';
  slackTeamId: string;
  slackChannelId: string;
  slackChannelName?: string;
  slackTs: string;            // message timestamp
  slackMessagePermalink?: string;
}

export interface MentionMetadataHrx {
  origin: 'hrx';
  threadId: string;           // HRX internal thread / conversation
  messageId: string;
  contextType: 'deal' | 'company' | 'contact' | 'task' | 'generic';
  contextId?: string;
  contextName?: string;
}

export type MentionMetadata = MentionMetadataSlack | MentionMetadataHrx;

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
  // Mention-specific fields (only when sourceType === 'mention')
  mentionedUserId?: string;     // HRX uid of the mentioned user
  mentionedByUserId?: string;   // HRX uid of author (if known)
  channelLabel?: string;        // e.g. "#dev", "Deal: C1–Sodexo"
  mentionMetadata?: MentionMetadata;
  // Cross-system mentions (for feed posts and messages with mentions)
        mentions?: Array<{
          type: 'user' | 'contact' | 'company' | 'deal' | 'job' | 'candidate' | 'location' | 'task' | 'worker';
          id: string;
          label: string;
          slug?: string;
          userId?: string;
          workerId?: string;  // For worker mentions
          contactId?: string;
          companyId?: string;
          dealId?: string;
          jobId?: string;
          candidateId?: string;
          locationId?: string;
          taskId?: string;
        }>;
  // linking info for Drawer
  drawerScope: {
    scopeType: 'email' | 'slack_dm' | 'slack_channel' | 'calendar' | 'mention' | 'notification';
    threadId?: string;
    channelId?: string;
    dmUserId?: string;
    eventId?: string; // For calendar events
    dateKey?: string; // For calendar events, e.g., YYYY-MM-DD
    route?: string; // For internal notifications that navigate
  };
}

