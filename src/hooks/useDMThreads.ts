/**
 * useDMThreads Hook
 * 
 * Fetches and manages DM threads for the current user.
 * Provides global unread count and thread list.
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { DMThread, DMThreadView } from '../types/directMessenger';
import { getOtherParticipant } from '../utils/dmThreadUtils';

interface UseDMThreadsOptions {
  tenantId: string;
  currentUserId: string;
  maxThreads?: number;
}

interface UseDMThreadsReturn {
  threads: DMThreadView[];
  loading: boolean;
  error: Error | null;
  globalUnreadCount: number;
}

/**
 * Format relative time label (e.g., "3m ago", "1h ago", "Yesterday")
 */
function formatTimeLabel(date: Date | null): string {
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
  
  return date.toLocaleDateString();
}

/**
 * Hook to fetch and manage DM threads
 */
export function useDMThreads({
  tenantId,
  currentUserId,
  maxThreads = 30,
}: UseDMThreadsOptions): UseDMThreadsReturn {
  const [threads, setThreads] = useState<DMThreadView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tenantId || !currentUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Query threads where current user is a participant
    const threadsRef = collection(db, 'tenants', tenantId, 'dmThreads');
    // Note: We can't order by lastMessageAt if it might be null, so we'll sort in memory
    // For now, query without orderBy and sort client-side
    // Use simpler query without status filter to avoid composite index requirement
    // We'll filter status client-side
    const threadsQuery = query(
      threadsRef,
      where('participantIds', 'array-contains', currentUserId),
      limit(maxThreads * 2) // Get more to account for null lastMessageAt
    );

    const unsubscribe = onSnapshot(
      threadsQuery,
      (snapshot) => {
        try {
          console.log('[useDMThreads] Snapshot received:', snapshot.docs.length, 'threads');
          console.log('[useDMThreads] Snapshot metadata:', {
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
            fromCache: snapshot.metadata.fromCache,
          });
          // Filter by status client-side (active only)
          const threadsList = snapshot.docs
            .filter((doc) => {
              const data = doc.data() as DMThread;
              return (data.status || 'active') === 'active'; // Default to active if not set
            })
            .map((doc) => {
            const data = doc.data() as DMThread;
            const otherUid = getOtherParticipant(data.participantIds, currentUserId);
            
            if (!otherUid) {
              // Skip threads without valid other participant (shouldn't happen in 1:1)
              return null;
            }

            const otherMeta = data.participantMeta[otherUid] || {
              displayName: 'Unknown User',
              email: '',
            };

            const lastMessageAt = data.lastMessageAt
              ? data.lastMessageAt.toDate()
              : null;
            
            // Defensive defaults: older/newer threads may not have these maps yet
            const unreadCounts = (data.unreadCounts || {}) as Record<string, number>;
            const isMutedMap = (data.isMuted || {}) as Record<string, boolean>;
            const pinnedByMap = (data.pinnedBy || {}) as Record<string, boolean>;

            return {
              id: doc.id,
              otherUser: {
                uid: otherUid,
                displayName: otherMeta.displayName,
                email: otherMeta.email,
                avatarUrl: otherMeta.avatarUrl,
              },
              lastMessageText: data.lastMessageText || '',
              lastMessageAt,
              lastMessageTimeLabel: formatTimeLabel(lastMessageAt),
              unreadCount: unreadCounts[currentUserId] || 0,
              isMuted: isMutedMap[currentUserId] || false,
              isPinned: pinnedByMap[currentUserId] || false,
              status: data.status,
            };
          })
          .filter((thread) => thread !== null) as DMThreadView[];

          // Sort: pinned first, then by lastMessageAt
          threadsList.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            if (a.lastMessageAt && b.lastMessageAt) {
              return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
            }
            if (a.lastMessageAt) return -1;
            if (b.lastMessageAt) return 1;
            return 0;
          });

          setThreads(threadsList);
          setLoading(false);
        } catch (err: any) {
          console.error('Error processing DM threads:', err);
          setError(err);
          setLoading(false);
        }
      },
              (err: any) => {
                console.error('[useDMThreads] Error loading DM threads:', err);
                console.error('[useDMThreads] Error code:', err.code);
                console.error('[useDMThreads] Error message:', err.message);
                console.error('[useDMThreads] Full error:', JSON.stringify(err, null, 2));
                console.error('[useDMThreads] Tenant ID:', tenantId);
                console.error('[useDMThreads] Current User ID:', currentUserId);
                console.error('[useDMThreads] Query path:', `tenants/${tenantId}/dmThreads`);
                setError(err);
                setLoading(false);
              }
    );

    return () => unsubscribe();
  }, [tenantId, currentUserId, maxThreads]);

  // Calculate global unread count
  const globalUnreadCount = useMemo(() => {
    return threads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  }, [threads]);

  return {
    threads,
    loading,
    error,
    globalUnreadCount,
  };
}

