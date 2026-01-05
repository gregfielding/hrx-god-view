/**
 * useDashboardFeed Hook
 * 
 * Aggregates feed items from Email, Slack DMs, and Slack Channels
 * into a unified time-sorted activity stream.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDMThreads } from './useDMThreads';
import { useSlackChannels } from './useSlackChannels';
import { useSlackChannelMembership } from './useSlackChannelMembership';
import { DashboardFeedItem } from '../types/dashboardFeed';
import {
  adaptEmailThreadToFeedItem,
  adaptSlackDMToFeedItem,
  adaptSlackChannelToFeedItem,
  EmailThreadSource,
} from '../utils/dashboardFeedAdapters';
import { SlackChannelView } from '../types/slackChannels';
import { normalizeSecurityLevel } from '../utils/security';

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
  const { user, activeTenant, securityLevel, currentClaimsSecurityLevel } = useAuth();
  
  const tenantId = activeTenant?.id || (user as any)?.activeTenantId || '';
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

    // Add Slack channel items (only for channels user is a member of and not muted)
    // IMPORTANT: Do not gate on slackChannelMembers loading; the canonical membership source is slackChannels.memberIds.
    if (canAccessSlack) {
      slackChannels.forEach((channel: SlackChannelView) => {
        // Only include channels where user is a member and not muted
        const isMember =
          (!!userId && Array.isArray(channel.memberIds) && channel.memberIds.includes(userId)) ||
          !!isMemberByChannel[channel.id];
        if (!isMember || channel.status === 'muted') {
          return;
        }

        try {
          const item = adaptSlackChannelToFeedItem(channel, userId || '');
          // Filter out null items (muted/unlinked channels)
          if (item) {
            allItems.push(item);
          }
        } catch (err) {
          console.error('Error adapting Slack channel:', err);
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
    tenantId,
    userId,
    canAccessSlack,
    limit,
  ]);

  // Combined loading state
  const loading = emailLoading || 
                  (canAccessSlack && dmLoading) || 
                  (canAccessSlack && slackChannelsLoading);

  // Combined error state
  const error = emailError || 
                (canAccessSlack && dmError?.message) || 
                (canAccessSlack && slackChannelsError?.message) || 
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

