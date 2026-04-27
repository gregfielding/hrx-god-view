/**
 * useSlackChannels Hook
 * 
 * Fetches and manages Slack channels for the active tenant.
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SlackChannelView, SlackChannelsFilter, SlackChannelStatus, SlackActivityBucket } from '../types/slackChannels';

/**
 * Compute activity time label (e.g. "3m ago", "Yesterday", "Oct 12")
 */
function computeActivityTimeLabel(date?: Date | null): string {
  if (!date) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  // Fallback to date string
  return date.toLocaleDateString();
}

/**
 * Compute activity label (e.g. "Tabitha: Updated job order for Arcil…")
 */
function computeActivityLabel(userName?: string | null, text?: string | null): string {
  if (!text && !userName) return 'No recent activity';
  const snippet = text ?? '';
  const preview = snippet.length > 80 ? `${snippet.slice(0, 77)}…` : snippet;
  return userName ? `${userName}: ${preview}` : preview;
}

interface UseSlackChannelsResult {
  channels: SlackChannelView[];
  loading: boolean;
  error: Error | null;
  filter: SlackChannelsFilter;
  setFilter: (update: Partial<SlackChannelsFilter>) => void;
  toggleMute: (channelId: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  refresh: () => void;
}

export function useSlackChannels(activeTenantId: string | null): UseSlackChannelsResult {
  const [channels, setChannels] = useState<SlackChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<SlackChannelsFilter>({
    membershipFilter: 'myChannels',
    search: '',
  });

  // Load channels from Firestore
  useEffect(() => {
    if (!activeTenantId) {
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const channelsRef = collection(db, 'tenants', activeTenantId, 'slackChannels');
    // Note: If tenantId is always the same as the path, we might not need the where clause
    // But keeping it for safety and potential future filtering
    const channelsQuery = query(channelsRef);

    const unsubscribe = onSnapshot(
      channelsQuery,
      (snapshot) => {
        try {
          const channelsList: SlackChannelView[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            const name = data.name || data.rawName || data.channelName || doc.id;
            const displayName = name.startsWith('#') ? name : `#${name}`;
            const status = (data.status || 'unlinked') as SlackChannelStatus;
            
            // Parse lastMessageAt (prefer new snapshot field, fallback to legacy)
            let lastMessageAt: Date | null = null;
            if (data.lastMessageAt) {
              lastMessageAt = data.lastMessageAt.toDate ? data.lastMessageAt.toDate() : new Date(data.lastMessageAt);
            }

            // Get activity bucket (from snapshot, or compute from lastMessageAt)
            let activityBucket: SlackActivityBucket = 'silent';
            if (data.activityBucket) {
              activityBucket = data.activityBucket as SlackActivityBucket;
            } else if (lastMessageAt) {
              const diffMs = Date.now() - lastMessageAt.getTime();
              const ONE_DAY_MS = 24 * 60 * 60 * 1000;
              const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
              if (diffMs <= ONE_DAY_MS) {
                activityBucket = 'active';
              } else if (diffMs <= SEVEN_DAYS_MS) {
                activityBucket = 'quiet';
              }
            }

            // Determine if active (for backwards compatibility)
            const isActive = activityBucket === 'active' || (lastMessageAt 
              ? (Date.now() - lastMessageAt.getTime()) / (1000 * 60 * 60 * 24) <= 7
              : false);

            // Get activity snapshot fields
            const lastMessageUserName = data.lastMessageUserName || data.lastMessageUser || null;
            const lastMessageText = data.lastMessageText || null;

            // Compute convenience labels
            const latestActivityLabel = computeActivityLabel(lastMessageUserName, lastMessageText);
            const latestActivityTimeLabel = computeActivityTimeLabel(lastMessageAt);

                    return {
                      id: doc.id,
                      tenantId: data.tenantId || activeTenantId,
                      slackTeamId: data.slackTeamId || data.teamId || '',
                      slackChannelId: data.slackChannelId || data.channelId || doc.id,
                      name,
                      displayName,
                      topic: data.topic || undefined,
                      isArchived: data.isArchived || false,
                      status,
                      memberIds: Array.isArray(data.memberIds) ? data.memberIds : [],
              linkedDeal: data.linkedDealId ? { id: data.linkedDealId, name: data.linkedDealName || 'Deal' } : null,
              linkedCustomer: data.linkedCustomerId ? { id: data.linkedCustomerId, name: data.linkedCustomerName || 'Customer' } : null,
              linkedJob: data.linkedJobId ? { id: data.linkedJobId, title: data.linkedJobTitle || 'Job' } : null,
              linkedTeam: data.linkedTeamId ? { id: data.linkedTeamId, name: data.linkedTeamName || 'Team' } : null,
              // New activity snapshot fields
              lastMessageText,
              lastMessageUserName,
              lastMessageUserId: data.lastMessageUserId || null,
              lastMessageTs: data.lastMessageTs || null,
              lastMessageAt,
              lastDirection: data.lastDirection || 'slack',
              lastActivityType: data.lastActivityType || 'message',
              hasRecentActivity: !!data.hasRecentActivity,
              activityBucket,
              messageCount: data.messageCount || null,
              // Legacy fields (for backwards compatibility)
              lastMessageUser: lastMessageUserName,
              unreadCount: data.unreadCount || null,
              unreadMentions: data.unreadMentions || null,
              // Computed convenience fields
              latestActivityLabel,
              latestActivityTimeLabel,
              // Derived booleans
              isWatched: status === 'watching',
              isMuted: status === 'muted',
              isActive,
            };
          });

          setChannels(channelsList);
          setLoading(false);
        } catch (err: any) {
          console.error('Error processing Slack channels:', err);
          setError(err);
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error loading Slack channels:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeTenantId]);

          // Apply filters (membership filter is applied at page level with membership data)
          const filteredChannels = useMemo(() => {
            // Filter out archived channels by default
            let result = channels.filter(c => !c.isArchived);

    // Search filter
    if (filter.search.trim()) {
      const searchLower = filter.search.toLowerCase();
      result = result.filter(c => {
        const nameMatch = c.name.toLowerCase().includes(searchLower);
        const topicMatch = c.topic?.toLowerCase().includes(searchLower);
        const dealMatch = c.linkedDeal?.name.toLowerCase().includes(searchLower);
        const customerMatch = c.linkedCustomer?.name.toLowerCase().includes(searchLower);
        const jobMatch = c.linkedJob?.title.toLowerCase().includes(searchLower);
        const senderMatch = c.lastMessageUser?.toLowerCase().includes(searchLower);
        const messageMatch = c.lastMessageText?.toLowerCase().includes(searchLower);
        return nameMatch || topicMatch || dealMatch || customerMatch || jobMatch || senderMatch || messageMatch;
      });
    }

    // Sort: by lastMessageAt desc
    result.sort((a, b) => {
      const aTime = a.lastMessageAt?.getTime() || 0;
      const bTime = b.lastMessageAt?.getTime() || 0;
      
      if (aTime !== bTime) {
        return bTime - aTime; // desc
      }
      
      // Secondary: by name (alphabetical)
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [channels, filter]);


  // Toggle mute status
  const toggleMute = async (channelId: string) => {
    if (!activeTenantId) return;

    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    // Determine new status: if currently muted, set to watching; otherwise set to muted
    const newStatus: SlackChannelStatus = channel.status === 'muted' ? 'watching' : 'muted';
    const isWatched = newStatus === 'watching';
    const isMuted = newStatus === 'muted';

    try {
      const channelRef = doc(db, 'tenants', activeTenantId, 'slackChannels', channelId);
      await updateDoc(channelRef, {
        status: newStatus,
        watchStatus: isWatched ? 'watched' : 'unwatched',
        muted: isMuted,
        updatedAt: new Date(),
      });
    } catch (err: any) {
      console.error('Error toggling mute status:', err);
      throw err;
    }
  };

  // Delete channel (admin only)
  const deleteChannel = async (channelId: string) => {
    if (!activeTenantId) return;

    try {
      const channelRef = doc(db, 'tenants', activeTenantId, 'slackChannels', channelId);
      await deleteDoc(channelRef);
    } catch (err: any) {
      console.error('Error deleting channel:', err);
      throw err;
    }
  };

  const refresh = () => {
    // Force a refresh by updating the filter (triggers re-render)
    setFilter(prev => ({ ...prev }));
  };

  return {
    channels: filteredChannels,
    loading,
    error,
    filter,
    setFilter: (update) => setFilter(prev => ({ ...prev, ...update })),
    toggleMute,
    deleteChannel,
    refresh,
  };
}

