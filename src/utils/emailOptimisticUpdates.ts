/**
 * Email Optimistic Updates Utilities
 * 
 * Provides optimistic update functions for email actions
 * Updates UI immediately, then syncs with backend
 */

import { EmailThread } from '../hooks/useEmailRealtime';

export interface OptimisticUpdate<T> {
  apply: (current: T) => T;
  revert: (current: T) => T;
}

/**
 * Create optimistic update for archiving thread
 */
export function createArchiveUpdate(threadId: string): OptimisticUpdate<EmailThread[]> {
  return {
    apply: (threads) =>
      threads.map((t) =>
        t.id === threadId ? { ...t, status: 'archived' as const, unreadCount: 0 } : t
      ),
    revert: (threads) =>
      threads.map((t) =>
        t.id === threadId ? { ...t, status: 'active' as const } : t
      ),
  };
}

/**
 * Create optimistic update for starring thread
 */
export function createStarUpdate(
  threadId: string,
  starred: boolean
): OptimisticUpdate<EmailThread[]> {
  return {
    apply: (threads) =>
      threads.map((t) => (t.id === threadId ? { ...t, starred } : t)),
    revert: (threads) =>
      threads.map((t) => (t.id === threadId ? { ...t, starred: !starred } : t)),
  };
}

/**
 * Create optimistic update for marking thread as read
 */
export function createMarkReadUpdate(threadId: string): OptimisticUpdate<EmailThread[]> {
  return {
    apply: (threads) =>
      threads.map((t) =>
        t.id === threadId ? { ...t, unreadCount: 0 } : t
      ),
    revert: (threads) =>
      threads.map((t) =>
        t.id === threadId ? { ...t, unreadCount: (t.unreadCount || 0) + 1 } : t
      ),
  };
}

/**
 * Create optimistic update for deleting thread
 */
export function createDeleteUpdate(threadId: string): OptimisticUpdate<EmailThread[]> {
  return {
    apply: (threads) => threads.filter((t) => t.id !== threadId),
    revert: (threads) => {
      // Note: We can't fully revert delete without storing the deleted thread
      // This is a limitation - in production, you might want to store deleted threads
      return threads;
    },
  };
}

/**
 * Execute optimistic update with error handling
 */
export async function executeOptimisticUpdate<T>(
  current: T,
  update: OptimisticUpdate<T>,
  apiCall: () => Promise<void>,
  onError?: (error: Error) => void
): Promise<{ updated: T; error: Error | null }> {
  // Apply optimistic update immediately
  const updated = update.apply(current);

  try {
    // Execute API call
    await apiCall();
    return { updated, error: null };
  } catch (error: any) {
    // Revert on error
    const reverted = update.revert(updated);
    if (onError) {
      onError(error);
    }
    return { updated: reverted, error };
  }
}

