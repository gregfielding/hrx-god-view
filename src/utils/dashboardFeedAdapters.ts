/**
 * Dashboard Feed Adapters
 * 
 * Convert source-specific data into unified DashboardFeedItem format.
 */

import { DashboardFeedItem } from '../types/dashboardFeed';
import { CalendarEvent, CalendarSummary } from '../types/calendar';
import { format, isToday, isTomorrow, isSameDay, addDays } from 'date-fns';

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

  // "From" (best-effort): prefer enriched participantContacts, fallback to raw participants list.
  const contacts = thread.participantContacts || [];
  const bestContact =
    contacts.find((c) => !!(c.contactName || c.userName || c.email)) || contacts[0];

  const fallbackEmail =
    bestContact?.email ||
    (Array.isArray(thread.participants) ? thread.participants.find((p) => !!p) : undefined);

  const fromLabel =
    bestContact?.contactName ||
    bestContact?.userName ||
    (fallbackEmail ? fallbackEmail.split('@')[0] : 'Unknown');

  const avatarUrl = bestContact?.avatarUrl;

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

// Slack Channel Message Adapter (per-message feed items)
export interface SlackChannelMessageSource {
  id: string; // slack_messages doc id
  channelId: string;
  channelName: string; // "#benefits"
  text: string;
  userName: string;
  sentAt: any; // Timestamp | Date | ISO | number
}

export function adaptSlackChannelMessageToFeedItem(
  msg: SlackChannelMessageSource
): DashboardFeedItem | null {
  const timestamp = toEpochMs(msg.sentAt);
  if (!timestamp) return null;

  const channelName = msg.channelName?.startsWith('#')
    ? msg.channelName
    : `#${msg.channelName || msg.channelId}`;

  return {
    id: `slack_channel_msg_${msg.id}`,
    sourceType: 'slack_channel',
    sourceId: msg.channelId,
    messageId: msg.id,
    title: channelName,
    snippet: msg.text || '',
    fromLabel: msg.userName || 'Unknown',
    isUnread: false, // unread not reliably computed for channel messages yet
    isMuted: false,
    timestamp,
    drawerScope: {
      scopeType: 'slack_channel',
      channelId: msg.channelId,
    },
  };
}

// Calendar Event Adapter
export interface CalendarEventSource {
  event: CalendarEvent;
  calendar: CalendarSummary;
}

export function adaptCalendarEventToFeedItem(
  source: CalendarEventSource,
  userEmail?: string | null
): DashboardFeedItem {
  const { event, calendar } = source;
  
  // Parse start date to get timestamp and dateKey
  const startDate = event.start.dateTime 
    ? new Date(event.start.dateTime)
    : (event.start.date ? new Date(event.start.date + 'T00:00:00') : new Date());
  const timestamp = startDate.getTime();
  
  // Generate dateKey (YYYY-MM-DD) for navigation
  const dateKey = event.start.date 
    ? event.start.date
    : startDate.toISOString().split('T')[0];
  
  // Format snippet with date + time range
  // Format: "Today · 3:00–3:30 PM" or "Tomorrow · All day" or "Mon Jan 12 · 9:00–10:00 AM"
  let dateLabel = '';
  const now = new Date();
  const today = startDate;
  
  if (isToday(today)) {
    dateLabel = 'Today';
  } else if (isTomorrow(today)) {
    dateLabel = 'Tomorrow';
  } else {
    dateLabel = format(today, 'EEE MMM d');
  }
  
  let timeLabel = '';
  if (event.isAllDay) {
    timeLabel = 'All day';
  } else if (event.start.dateTime && event.end.dateTime) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    const startTime = format(start, 'h:mm a');
    const endTime = format(end, 'h:mm a');
    timeLabel = `${startTime}–${endTime}`;
  }
  
  // Extract recurrence pattern from RRULE if available
  let recurrenceLabel = '';
  if (event.recurrence && event.recurrence.length > 0) {
    const rrule = event.recurrence[0]; // Usually just one RRULE
    if (rrule.includes('FREQ=DAILY')) {
      recurrenceLabel = 'repeats daily';
    } else if (rrule.includes('FREQ=WEEKLY')) {
      recurrenceLabel = 'repeats weekly';
    } else if (rrule.includes('FREQ=MONTHLY')) {
      recurrenceLabel = 'repeats monthly';
    } else if (rrule.includes('FREQ=YEARLY')) {
      recurrenceLabel = 'repeats yearly';
    } else if (rrule.includes('FREQ=HOURLY')) {
      recurrenceLabel = 'repeats hourly';
    } else {
      recurrenceLabel = 'repeats';
    }
  } else if (event.isRecurringInstance) {
    // Fallback: if it's a recurring instance but no RRULE available, use generic label
    recurrenceLabel = 'repeats';
  }
  
  let snippet = `${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''}${recurrenceLabel ? ` · ${recurrenceLabel}` : ''}`;
  
  if (event.location) {
    snippet += ` · ${event.location}`;
  }
  
  // From label: organizer or creator, or calendar name
  const fromLabel = event.organizer?.displayName 
    || event.organizer?.email?.split('@')[0]
    || event.creator?.displayName
    || event.creator?.email?.split('@')[0]
    || calendar.summary;
  
  // Get avatar from first attendee if available
  const avatarUrl = event.attendees?.[0]?.avatarUrl;
  
  // Determine event ownership type and RSVP status
  let eventOwnership: 'owned' | 'invited' | 'external' | undefined;
  let rsvpStatus: 'accepted' | 'tentative' | 'declined' | 'needsAction' | undefined;
  if (userEmail) {
    const organizerEmail = event.organizer?.email?.toLowerCase();
    const creatorEmail = event.creator?.email?.toLowerCase();
    const userEmailLower = userEmail.toLowerCase();
    
    // Check if user is organizer or creator (owns the event)
    if (organizerEmail === userEmailLower || creatorEmail === userEmailLower) {
      eventOwnership = 'owned';
    } else {
      // Check if user is an attendee (invited)
      const userAttendee = event.attendees?.find(
        (a) => a.email?.toLowerCase() === userEmailLower
      );
      if (userAttendee) {
        eventOwnership = 'invited';
        // Extract RSVP status from attendee
        if (userAttendee.responseStatus) {
          const status = userAttendee.responseStatus.toLowerCase();
          if (status === 'accepted') {
            rsvpStatus = 'accepted';
          } else if (status === 'tentative') {
            rsvpStatus = 'tentative';
          } else if (status === 'declined') {
            rsvpStatus = 'declined';
          } else if (status === 'needsaction') {
            rsvpStatus = 'needsAction';
          }
        }
      } else if (organizerEmail) {
        // External organization (different domain)
        const userDomain = userEmailLower.split('@')[1];
        const organizerDomain = organizerEmail.split('@')[1];
        if (userDomain !== organizerDomain) {
          eventOwnership = 'external';
        }
      }
    }
  }
  
  return {
    id: `calendar_${event.id}`,
    sourceType: 'calendar',
    sourceId: event.id,
    title: event.summary || 'Untitled Event',
    snippet: snippet || calendar.summary,
    fromLabel,
    avatarUrl,
    isUnread: false, // Calendar events don't have unread state
    isMuted: false,
    timestamp,
    hangoutLink: event.hangoutLink,
    eventStatus: event.status,
    eventOwnership,
    rsvpStatus,
    drawerScope: {
      scopeType: 'calendar',
      eventId: event.id,
      dateKey,
    },
  };
}

