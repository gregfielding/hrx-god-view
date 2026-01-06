/**
 * useDashboardFeed Hook
 * 
 * Aggregates feed items from Email, Slack DMs, Slack Channels, and Calendar
 * into a unified time-sorted activity stream.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDMThreads } from './useDMThreads';
import { useSlackChannels } from './useSlackChannels';
import { useSlackChannelMembership } from './useSlackChannelMembership';
import { useSlackChannelLastActivityFallback } from './useSlackChannelLastActivityFallback';
import { useCalendarList } from './useCalendarList';
import { useCalendarEvents } from './useCalendarEvents';
import { DashboardFeedItem } from '../types/dashboardFeed';
import {
  adaptEmailThreadToFeedItem,
  adaptSlackDMToFeedItem,
  adaptSlackChannelToFeedItem,
  adaptSlackChannelMessageToFeedItem,
  adaptCalendarEventToFeedItem,
  EmailThreadSource,
} from '../utils/dashboardFeedAdapters';
import { SlackChannelView } from '../types/slackChannels';
import { normalizeSecurityLevel } from '../utils/security';
import { collection, limit as fbLimit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { subDays, addDays } from 'date-fns';

interface UseDashboardFeedOptions {
  limit?: number;
  refreshInterval?: number; // ms between refreshes (default: 60000 = 1 minute)
}

interface UseDashboardFeedReturn {
  feedItems: DashboardFeedItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDashboardFeed(
  options: UseDashboardFeedOptions = {}
): UseDashboardFeedReturn {
  const { limit = 100, refreshInterval = 60000 } = options;
  const {
    user,
    activeTenant,
    tenantId: primaryTenantId,
    securityLevel,
    currentClaimsSecurityLevel,
  } = useAuth();
  
  // Prefer activeTenant.id, but fall back to AuthContext.tenantId (back-compat) before reaching into userAny.
  const tenantId =
    activeTenant?.id ||
    primaryTenantId ||
    (user as any)?.activeTenantId ||
    (user as any)?.tenantId ||
    '';
  const userId = user?.uid || null;
  const canAccessSlack = normalizeSecurityLevel(currentClaimsSecurityLevel || securityLevel) >= 5;

  // State for email threads
  const [emailThreads, setEmailThreads] = useState<EmailThreadSource[]>([]);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Use existing hooks for DM threads and Slack channels
  const {
    threads: dmThreads,
    loading: dmLoading,
    error: dmError,
  } = useDMThreads({
    tenantId: tenantId || '',
    currentUserId: userId || '',
    maxThreads: 50,
  });

  const {
    channels: slackChannels,
    loading: slackChannelsLoading,
    error: slackChannelsError,
  } = useSlackChannels(canAccessSlack ? tenantId : null);

  const { isMemberByChannel } = useSlackChannelMembership(tenantId, userId);

  // Calendar integration
  const canAccessCalendar = canAccessSlack; // Calendar access requires same security level as Slack
  const { calendars, loading: calendarsLoading, error: calendarsError } = useCalendarList({
    userId: userId || '',
    enabled: canAccessCalendar && !!userId,
  });

  // Date range for calendar events: now - 1 day to now + 7 days
  const calendarDateRange = useMemo(() => {
    const now = new Date();
    return {
      timeMin: subDays(now, 1),
      timeMax: addDays(now, 7),
    };
  }, []);

  // Get primary calendar ID (or first calendar)
  const primaryCalendarId = useMemo(() => {
    if (calendars.length === 0) return null;
    const primary = calendars.find((c) => c.isPrimary);
    return primary?.id || calendars[0]?.id || null;
  }, [calendars]);

  const { events: calendarEvents, loading: calendarEventsLoading, error: calendarEventsError } = useCalendarEvents({
    userId: userId || '',
    calendarIds: primaryCalendarId ? [primaryCalendarId] : [],
    timeMin: calendarDateRange.timeMin,
    timeMax: calendarDateRange.timeMax,
    enabled: canAccessCalendar && !!userId && !!primaryCalendarId,
  });

  // Fallback: for channels missing slackChannels.lastMessage* snapshot fields, query newest stored slack_messages.
  // This makes the unified feed ordering truly chronological even when slackChannels docs are stale.
  const memberChannelIds = useMemo(() => {
    if (!canAccessSlack) return [];
    if (!userId) return [];
    return (slackChannels || [])
      .filter((c: SlackChannelView) => {
        const isMember =
          (Array.isArray(c.memberIds) && c.memberIds.includes(userId)) ||
          !!isMemberByChannel[c.id];
        return isMember && c.status !== 'muted';
      })
      .map((c) => c.id);
  }, [canAccessSlack, userId, slackChannels, isMemberByChannel]);

  const slackLastActivityByChannel = useSlackChannelLastActivityFallback(
    canAccessSlack ? tenantId : null,
    memberChannelIds,
  );

  // ---------------------------------------------------------------------------
  // Slack Channel Messages (per-message feed items)
  // We subscribe to recent slack_messages and filter down to member channels.
  // ---------------------------------------------------------------------------
  const [slackChannelMessages, setSlackChannelMessages] = useState<any[]>([]);
  const [slackMessagesLoading, setSlackMessagesLoading] = useState(true);
  const [slackMessagesError, setSlackMessagesError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessSlack || !tenantId || !userId) {
      setSlackChannelMessages([]);
      setSlackMessagesLoading(false);
      setSlackMessagesError(null);
      return;
    }

    setSlackMessagesLoading(true);
    setSlackMessagesError(null);

    // Fetch a window of recent messages; membership filtering happens client-side.
    const qy = query(
      collection(db, 'slack_messages'),
      where('tenantId', '==', tenantId),
      orderBy('sentAt', 'desc'),
      fbLimit(200),
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        try {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setSlackChannelMessages(docs);
          setSlackMessagesLoading(false);
        } catch (err: any) {
          setSlackMessagesError(err?.message || 'Failed to load Slack messages');
          setSlackMessagesLoading(false);
        }
      },
      (err) => {
        setSlackMessagesError(err?.message || 'Failed to load Slack messages');
        setSlackMessagesLoading(false);
      },
    );

    return () => unsub();
  }, [canAccessSlack, tenantId, userId]);

  // Fetch email threads
  const fetchEmailThreads = useCallback(async () => {
    if (!userId || !tenantId) {
      setEmailThreads([]);
      setEmailLoading(false);
      return;
    }

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const params = new URLSearchParams({
        tenantId,
        userId,
        limit: '100', // Get more threads, will be limited in final aggregation
      });

      const response = await fetch(
        `${API_BASE_URL}/listEmailThreadsApi?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error('Failed to load email threads');
      }

      const data = await response.json();
      if (data.success) {
        const threads = (data.threads || []).map((thread: any) => ({
          id: thread.id || thread.threadId,
          subject: thread.subject || '',
          participants: thread.participants || [],
          lastMessageAt: thread.lastMessageAt,
          lastMessageSnippet: thread.lastMessageSnippet || '',
          unreadCount: thread.unreadCount || 0,
          participantContacts: thread.participantContacts || [],
        }));
        setEmailThreads(threads);
        setEmailError(null);
      } else {
        setEmailError(data.error || 'Failed to load email threads');
      }
    } catch (err: any) {
      console.error('Error fetching email threads:', err);
      setEmailError(err.message || 'Failed to load email threads');
      setEmailThreads([]);
    } finally {
      setEmailLoading(false);
    }
  }, [userId, tenantId]);

  // Load email threads on mount and refresh
  useEffect(() => {
    fetchEmailThreads();
  }, [fetchEmailThreads]);

  // Set up refresh interval
  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(() => {
        fetchEmailThreads();
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [fetchEmailThreads, refreshInterval]);

  // Aggregate all feed items
  const feedItems = useMemo(() => {
    const allItems: DashboardFeedItem[] = [];

    // Add email items
    emailThreads.forEach((thread) => {
      try {
        const item = adaptEmailThreadToFeedItem(thread, tenantId);
        allItems.push(item);
      } catch (err) {
        console.error('Error adapting email thread:', err);
      }
    });

    // Add Slack DM items
    if (canAccessSlack) {
      dmThreads.forEach((thread) => {
        try {
          const item = adaptSlackDMToFeedItem(thread);
          allItems.push(item);
        } catch (err) {
          console.error('Error adapting DM thread:', err);
        }
      });
    }

    // Add Slack channel message items (per-message feed) — social-feed style.
    if (canAccessSlack && userId) {
      const channelNameById = new Map(
        slackChannels.map((c) => [c.id, c.displayName || c.name || `#${c.id}`]),
      );

      slackChannelMessages.forEach((m: any) => {
        const channelId = m.channelId;
        if (!channelId) return;

        // Filter to channel/group messages only
        const ct = (m.channelType || '').toString();
        if (ct === 'im' || ct === 'mpim') return;

        // Membership filter (use both known sources)
        const isMember =
          memberChannelIds.includes(channelId) ||
          !!isMemberByChannel[channelId];
        if (!isMember) return;

        const channelName = channelNameById.get(channelId) || `#${channelId}`;
        const item = adaptSlackChannelMessageToFeedItem({
          id: m.id,
          channelId,
          channelName,
          text: m.text || '',
          userName: m.userName || m.slackUserName || m.username || 'Unknown',
          sentAt: m.sentAt || null,
        });
        if (item) allItems.push(item);
      });
    }

    // Add calendar event items (auto-hide past events older than 2-3 hours + deduplicate recurring)
    if (canAccessCalendar && calendarEvents.length > 0 && calendars.length > 0) {
      const calendarById = new Map(calendars.map((c) => [c.id, c]));
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      
      // Filter past events and group recurring events by series
      const validEvents: typeof calendarEvents = [];
      const recurringSeries = new Map<string, typeof calendarEvents[0]>();
      
      calendarEvents.forEach((event) => {
        // Auto-hide past events: skip if event ended more than 2 hours ago
        if (event.end.dateTime) {
          const endDate = new Date(event.end.dateTime);
          if (endDate < twoHoursAgo) {
            return; // Skip this past event
          }
        } else if (event.end.date) {
          // For all-day events, check if the end date (exclusive) is before today
          const endDate = new Date(event.end.date + 'T00:00:00');
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (endDate <= today) {
            return; // Skip all-day events that ended before today
          }
        }
        
        // Deduplicate recurring events: group by series key (summary + calendarId + time pattern)
        if (event.isRecurringInstance || event.recurrence?.length) {
          // Create a series key: summary + calendarId + normalized time (hour:minute for timed, "allday" for all-day)
          let timeKey = 'allday';
          if (event.start.dateTime) {
            const startDate = new Date(event.start.dateTime);
            timeKey = `${startDate.getHours()}:${String(startDate.getMinutes()).padStart(2, '0')}`;
          }
          const seriesKey = `${event.calendarId}:${event.summary}:${timeKey}`;
          
          // Keep only the next upcoming instance of each series
          const existing = recurringSeries.get(seriesKey);
          if (!existing) {
            recurringSeries.set(seriesKey, event);
          } else {
            // Compare start times and keep the earlier one (next occurrence)
            const existingStart = existing.start.dateTime 
              ? new Date(existing.start.dateTime).getTime()
              : (existing.start.date ? new Date(existing.start.date + 'T00:00:00').getTime() : 0);
            const currentStart = event.start.dateTime 
              ? new Date(event.start.dateTime).getTime()
              : (event.start.date ? new Date(event.start.date + 'T00:00:00').getTime() : 0);
            
            if (currentStart < existingStart) {
              recurringSeries.set(seriesKey, event);
            }
          }
        } else {
          // Non-recurring events go through normally
          validEvents.push(event);
        }
      });
      
      // Add deduplicated recurring events
      recurringSeries.forEach((event) => {
        validEvents.push(event);
      });
      
      // Adapt all valid events to feed items
      const userEmail = user?.email || null;
      validEvents.forEach((event) => {
        try {
          const calendar = calendarById.get(event.calendarId);
          if (!calendar) return; // Skip if calendar not found
          
          const item = adaptCalendarEventToFeedItem({ event, calendar }, userEmail);
          allItems.push(item);
        } catch (err) {
          console.error('Error adapting calendar event:', err);
        }
      });
    }

    // Sort by timestamp (newest first)
    const sorted = allItems.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    return sorted.slice(0, limit);
  }, [
    emailThreads,
    dmThreads,
    slackChannels,
    isMemberByChannel,
    slackLastActivityByChannel,
    slackChannelMessages,
    memberChannelIds,
    calendarEvents,
    calendars,
    tenantId,
    userId,
    canAccessSlack,
    canAccessCalendar,
    limit,
  ]);

  // Combined loading state
  const loading = emailLoading || 
                  (canAccessSlack && dmLoading) || 
                  (canAccessSlack && slackChannelsLoading) ||
                  (canAccessSlack && slackMessagesLoading) ||
                  (canAccessCalendar && calendarsLoading) ||
                  (canAccessCalendar && calendarEventsLoading);

  // Combined error state
  const error = emailError || 
                (canAccessSlack && dmError?.message) || 
                (canAccessSlack && slackChannelsError?.message) || 
                (canAccessSlack && slackMessagesError) ||
                (canAccessCalendar && calendarsError?.message) ||
                (canAccessCalendar && calendarEventsError?.message) ||
                null;

  // Refresh function
  const refresh = useCallback(() => {
    fetchEmailThreads();
  }, [fetchEmailThreads]);

  return {
    feedItems,
    loading,
    error,
    refresh,
  };
}

