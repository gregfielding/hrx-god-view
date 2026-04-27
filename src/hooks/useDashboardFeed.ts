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
import { collection, limit as fbLimit, onSnapshot, orderBy, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { subDays, addDays } from 'date-fns';
import type { FeedPost } from '../types/feed';
import { adaptFeedPostToFeedItem } from '../utils/dashboardFeedAdapters';

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

  // State for feed posts
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [feedPostsLoading, setFeedPostsLoading] = useState(true);
  const [feedPostsError, setFeedPostsError] = useState<string | null>(null);
  const [authorCache, setAuthorCache] = useState<Map<string, { name: string; avatarUrl?: string }>>(new Map());

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

  // ---------------------------------------------------------------------------
  // Mentions Feed Items
  // Subscribe to mention feed items from dashboardFeed collection.
  // ---------------------------------------------------------------------------
  const [mentionFeedItems, setMentionFeedItems] = useState<DashboardFeedItem[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(true);
  const [mentionsError, setMentionsError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Internal Notifications Feed Items
  // Subscribe to notification feed items from dashboardFeed collection.
  // ---------------------------------------------------------------------------
  const [notificationFeedItems, setNotificationFeedItems] = useState<DashboardFeedItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Task Feed Items
  // Subscribe to task feed items from dashboardFeed collection.
  // ---------------------------------------------------------------------------
  const [taskFeedItems, setTaskFeedItems] = useState<DashboardFeedItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

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

  // Fetch mention feed items
  useEffect(() => {
    console.log('[Mentions Feed] Hook effect triggered, userId:', userId);
    
    if (!userId) {
      console.log('[Mentions Feed] No userId, clearing mention feed items');
      setMentionFeedItems([]);
      setMentionsLoading(false);
      setMentionsError(null);
      return;
    }

    console.log('[Mentions Feed] Setting up Firestore query for userId:', userId, 'limit:', limit);
    setMentionsLoading(true);
    setMentionsError(null);

    const qy = query(
      collection(db, 'dashboardFeed'),
      where('userId', '==', userId),
      where('sourceType', '==', 'mention'),
      orderBy('timestamp', 'desc'),
      fbLimit(limit),
    );

    console.log('[Mentions Feed] Query created, setting up snapshot listener...');

    const unsub = onSnapshot(
      qy,
      (snap) => {
        console.log('[Mentions Feed] ✅ Snapshot received, processing...');
        console.log('[Mentions Feed] Snapshot metadata:', {
          hasPendingWrites: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
          size: snap.size,
        });
        
        try {
          const items: DashboardFeedItem[] = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              sourceType: 'mention' as const,
              sourceId: data.sourceId || d.id,
              messageId: data.messageId,
              title: data.title || data.channelLabel || 'Mention',
              snippet: data.snippet || '',
              fromLabel: data.fromLabel || 'Unknown',
              avatarUrl: data.avatarUrl,
              isUnread: data.isUnread !== false,
              isMuted: data.isMuted === true,
              timestamp: data.timestamp || (data.createdAt?.toMillis?.() || Date.now()),
              mentionedUserId: data.mentionedUserId,
              mentionedByUserId: data.mentionedByUserId,
              channelLabel: data.channelLabel,
              mentionMetadata: data.mentionMetadata,
              drawerScope: data.drawerScope || {
                scopeType: 'mention',
                channelId: data.mentionMetadata?.slackChannelId,
              },
            } as DashboardFeedItem;
          });
          console.log(`[Mentions Feed] ✅ Loaded ${items.length} mention feed items for user ${userId}`);
          setMentionFeedItems(items);
          setMentionsLoading(false);
        } catch (err: any) {
          console.error('[Mentions Feed] ❌ Error processing mention feed items:', err);
          console.error('[Mentions Feed] Error details:', JSON.stringify(err, null, 2));
          setMentionsError(err?.message || 'Failed to load mentions');
          setMentionsLoading(false);
        }
      },
      (err) => {
        console.error('[Mentions Feed] ❌ Firestore query error:', err);
        console.error('[Mentions Feed] Error code:', err?.code);
        console.error('[Mentions Feed] Error message:', err?.message);
        console.error('[Mentions Feed] Full error object:', JSON.stringify(err, null, 2));
        
        // Check if it's a permission error
        if (err?.code === 'permission-denied') {
          console.error('[Mentions Feed] 🔒 PERMISSION DENIED - Check Firestore rules for dashboardFeed collection');
          console.error('[Mentions Feed] User ID:', userId);
          console.error('[Mentions Feed] Make sure rule allows: request.auth.uid == resource.data.userId');
        }
        
        // Check if it's an index error
        if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
          console.warn('[Mentions Feed] ⚠️ Firestore index required. Create composite index for: userId, sourceType, timestamp');
        }
        
        setMentionsError(err?.message || 'Failed to load mentions');
        setMentionsLoading(false);
      },
    );

    return () => {
      console.log('[Mentions Feed] Cleaning up snapshot listener');
      unsub();
    };
  }, [userId, limit]);

  // Fetch internal notification feed items
  useEffect(() => {
    if (!userId) {
      setNotificationFeedItems([]);
      setNotificationsLoading(false);
      setNotificationsError(null);
      return;
    }

    setNotificationsLoading(true);
    setNotificationsError(null);

    const qy = query(
      collection(db, 'dashboardFeed'),
      where('userId', '==', userId),
      where('sourceType', '==', 'notification'),
      orderBy('timestamp', 'desc'),
      fbLimit(limit),
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        try {
          const items: DashboardFeedItem[] = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              sourceType: 'notification' as const,
              sourceId: data.sourceId || d.id,
              messageId: data.messageId,
              title: data.title || 'Notification',
              snippet: data.snippet || '',
              fromLabel: data.fromLabel || 'HRX',
              avatarUrl: data.avatarUrl,
              isUnread: data.isUnread !== false,
              isMuted: data.isMuted === true,
              timestamp: data.timestamp || (data.createdAt?.toMillis?.() || Date.now()),
              drawerScope: data.drawerScope || { scopeType: 'notification', route: data.route },
            } as DashboardFeedItem;
          });
          setNotificationFeedItems(items);
          setNotificationsLoading(false);
        } catch (err: any) {
          setNotificationsError(err?.message || 'Failed to load notifications');
          setNotificationsLoading(false);
        }
      },
      (err) => {
        setNotificationsError(err?.message || 'Failed to load notifications');
        setNotificationsLoading(false);
      },
    );

    return () => unsub();
  }, [userId, limit]);

  // Fetch task feed items
  useEffect(() => {
    if (!userId) {
      setTaskFeedItems([]);
      setTasksLoading(false);
      setTasksError(null);
      return;
    }

    setTasksLoading(true);
    setTasksError(null);

    const qy = query(
      collection(db, 'dashboardFeed'),
      where('userId', '==', userId),
      where('sourceType', '==', 'task'),
      orderBy('timestamp', 'desc'),
      fbLimit(limit),
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        try {
          const items: DashboardFeedItem[] = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              sourceType: 'task' as const,
              sourceId: data.sourceId || d.id,
              messageId: data.messageId,
              title: data.title || 'Task',
              snippet: data.snippet || '',
              fromLabel: data.fromLabel || 'HRX',
              avatarUrl: data.avatarUrl,
              isUnread: data.isUnread !== false,
              isMuted: data.isMuted === true,
              timestamp: data.timestamp || (data.createdAt?.toMillis?.() || Date.now()),
              drawerScope: data.drawerScope || { scopeType: 'task', route: '/tasks', taskId: data.extra?.taskId },
            } as DashboardFeedItem;
          });
          setTaskFeedItems(items);
          setTasksLoading(false);
        } catch (err: any) {
          setTasksError(err?.message || 'Failed to load tasks');
          setTasksLoading(false);
        }
      },
      (err) => {
        setTasksError(err?.message || 'Failed to load tasks');
        setTasksLoading(false);
      },
    );

    return () => unsub();
  }, [userId, limit]);

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

  // Fetch feed posts
  useEffect(() => {
    if (!tenantId) {
      setFeedPosts([]);
      setFeedPostsLoading(false);
      return;
    }

    setFeedPostsLoading(true);
    setFeedPostsError(null);

    const feedPostsRef = collection(db, 'tenants', tenantId, 'feed_posts');
    const feedPostsQuery = query(
      feedPostsRef,
      orderBy('createdAt', 'desc'),
      fbLimit(limit)
    );

    const unsubscribe = onSnapshot(
      feedPostsQuery,
      async (snapshot) => {
        try {
          const posts: FeedPost[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              tenantId: data.tenantId || tenantId,
              authorId: data.authorId,
              body: data.body || '',
              mentions: data.mentions || [],
              visibility: data.visibility || 'tenant',
              targetChannelId: data.targetChannelId,
              slackChannelId: data.slackChannelId,
              slackTs: data.slackTs,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            } as FeedPost;
          });
          setFeedPosts(posts);

          // Fetch author info for new posts
          const authorIds = new Set<string>();
          posts.forEach(post => {
            if (post.authorId && !authorCache.has(post.authorId)) {
              authorIds.add(post.authorId);
            }
          });

          // Fetch author data in parallel
          if (authorIds.size > 0) {
            const authorPromises = Array.from(authorIds).map(async (authorId) => {
              try {
                const userDoc = await getDoc(doc(db, 'users', authorId));
                if (userDoc.exists()) {
                  const userData = userDoc.data();
                  const name = userData.displayName || 
                    `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
                    userData.email?.split('@')[0] ||
                    'Unknown';
                  const avatarUrl = userData.avatar || userData.avatarUrl;
                  return { authorId, name, avatarUrl };
                }
              } catch (err) {
                console.warn(`Failed to fetch author info for ${authorId}:`, err);
              }
              return { authorId, name: 'Unknown', avatarUrl: undefined };
            });

            const authorData = await Promise.all(authorPromises);
            setAuthorCache(prev => {
              const newCache = new Map(prev);
              authorData.forEach(({ authorId, name, avatarUrl }) => {
                newCache.set(authorId, { name, avatarUrl });
              });
              return newCache;
            });
          }
        } catch (err: any) {
          console.error('Error processing feed posts:', err);
          setFeedPostsError(err.message || 'Failed to load feed posts');
        } finally {
          setFeedPostsLoading(false);
        }
      },
      (err) => {
        console.error('Error subscribing to feed posts:', err);
        setFeedPostsError(err.message || 'Failed to load feed posts');
        setFeedPostsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, limit, authorCache]);

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

    // Add feed posts
    feedPosts.forEach((post) => {
      try {
        const authorInfo = authorCache.get(post.authorId);
        const item = adaptFeedPostToFeedItem(
          post,
          authorInfo?.name,
          authorInfo?.avatarUrl
        );
        allItems.push(item);
      } catch (err) {
        console.error('Error adapting feed post:', err);
      }
    });

    // Add mention feed items
    mentionFeedItems.forEach((item) => {
      allItems.push(item);
    });

    // Add internal notification feed items
    notificationFeedItems.forEach((item) => {
      allItems.push(item);
    });

    // Add task feed items
    taskFeedItems.forEach((item) => {
      allItems.push(item);
    });

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
    mentionFeedItems,
    notificationFeedItems,
    taskFeedItems,
    feedPosts,
    authorCache,
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
                  (canAccessCalendar && calendarEventsLoading) ||
                  mentionsLoading ||
                  notificationsLoading ||
                  tasksLoading ||
                  feedPostsLoading;

  // Combined error state
  const error = emailError || 
                (canAccessSlack && dmError?.message) || 
                (canAccessSlack && slackChannelsError?.message) || 
                (canAccessSlack && slackMessagesError) ||
                (canAccessCalendar && calendarsError?.message) ||
                (canAccessCalendar && calendarEventsError?.message) ||
                mentionsError ||
                notificationsError ||
                tasksError ||
                feedPostsError ||
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

