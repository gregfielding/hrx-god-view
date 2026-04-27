/**
 * useDMReactions Hook
 * 
 * Manages emoji reactions for DM messages.
 * Subscribes to reactions subcollection and provides add/remove functions.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { DMReaction, DMReactionView } from '../types/directMessenger';

interface UseDMReactionsOptions {
  tenantId: string;
  threadId: string;
  messageId: string;
  currentUserId: string;
}

interface UseDMReactionsReturn {
  reactions: DMReactionView[];
  loading: boolean;
  addReaction: (emoji: string) => Promise<void>;
  removeReaction: (emoji: string) => Promise<void>;
  toggleReaction: (emoji: string) => Promise<void>;
}

/**
 * Hook to manage reactions for a specific message
 */
export function useDMReactions({
  tenantId,
  threadId,
  messageId,
  currentUserId,
}: UseDMReactionsOptions): UseDMReactionsReturn {
  const [reactions, setReactions] = useState<DMReactionView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !threadId || !messageId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const reactionsRef = collection(
      db,
      'tenants',
      tenantId,
      'dmThreads',
      threadId,
      'messages',
      messageId,
      'reactions'
    );

    const unsubscribe = onSnapshot(
      reactionsRef,
      (snapshot) => {
        try {
          // Group reactions by emoji
          const reactionMap = new Map<string, DMReaction[]>();

          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data() as DMReaction;
            const emoji = data.emoji;

            if (!reactionMap.has(emoji)) {
              reactionMap.set(emoji, []);
            }
            reactionMap.get(emoji)!.push(data);
          });

          // Convert to view model
          const reactionViews: DMReactionView[] = Array.from(reactionMap.entries()).map(
            ([emoji, reactionList]) => {
              const userIds = reactionList.map((r) => r.userId);
              const userReacted = userIds.includes(currentUserId);

              return {
                emoji,
                count: reactionList.length,
                userReacted,
                userIds,
              };
            }
          );

          // Sort by count (descending), then by emoji
          reactionViews.sort((a, b) => {
            if (b.count !== a.count) {
              return b.count - a.count;
            }
            return a.emoji.localeCompare(b.emoji);
          });

          setReactions(reactionViews);
          setLoading(false);
        } catch (err: any) {
          console.error('Error processing reactions:', err);
          setLoading(false);
        }
      },
      (err: any) => {
        // If permission denied, the message might not exist yet - this is expected
        if (err.code === 'permission-denied' || err.code === 'not-found') {
          setReactions([]);
          setLoading(false);
        } else {
          console.error('Error loading reactions:', err);
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [tenantId, threadId, messageId, currentUserId]);

  /**
   * Add a reaction (or remove if user already reacted with this emoji)
   */
  const toggleReaction = useCallback(
    async (emoji: string) => {
      if (!tenantId || !threadId || !messageId || !currentUserId) {
        return;
      }

      const reactionsRef = collection(
        db,
        'tenants',
        tenantId,
        'dmThreads',
        threadId,
        'messages',
        messageId,
        'reactions'
      );

      try {
        // Check if user already reacted with this emoji
        const existingQuery = query(
          reactionsRef,
          where('emoji', '==', emoji),
          where('userId', '==', currentUserId)
        );
        const existingSnap = await getDocs(existingQuery);

        if (!existingSnap.empty) {
          // Remove reaction
          const reactionDoc = existingSnap.docs[0];
          await deleteDoc(reactionDoc.ref);
        } else {
          // Add reaction
          await addDoc(reactionsRef, {
            emoji,
            userId: currentUserId,
            createdAt: serverTimestamp(),
          });
        }
      } catch (err: any) {
        console.error('Error toggling reaction:', err);
        throw err;
      }
    },
    [tenantId, threadId, messageId, currentUserId]
  );

  /**
   * Add a reaction
   */
  const addReaction = useCallback(
    async (emoji: string) => {
      if (!tenantId || !threadId || !messageId || !currentUserId) {
        return;
      }

      const reactionsRef = collection(
        db,
        'tenants',
        tenantId,
        'dmThreads',
        threadId,
        'messages',
        messageId,
        'reactions'
      );

      try {
        // Check if user already reacted with this emoji
        const existingQuery = query(
          reactionsRef,
          where('emoji', '==', emoji),
          where('userId', '==', currentUserId)
        );
        const existingSnap = await getDocs(existingQuery);

        if (existingSnap.empty) {
          // Add reaction
          await addDoc(reactionsRef, {
            emoji,
            userId: currentUserId,
            createdAt: serverTimestamp(),
          });
        }
        // If already exists, do nothing (idempotent)
      } catch (err: any) {
        console.error('Error adding reaction:', err);
        throw err;
      }
    },
    [tenantId, threadId, messageId, currentUserId]
  );

  /**
   * Remove a reaction
   */
  const removeReaction = useCallback(
    async (emoji: string) => {
      if (!tenantId || !threadId || !messageId || !currentUserId) {
        return;
      }

      const reactionsRef = collection(
        db,
        'tenants',
        tenantId,
        'dmThreads',
        threadId,
        'messages',
        messageId,
        'reactions'
      );

      try {
        // Find and delete user's reaction with this emoji
        const existingQuery = query(
          reactionsRef,
          where('emoji', '==', emoji),
          where('userId', '==', currentUserId)
        );
        const existingSnap = await getDocs(existingQuery);

        if (!existingSnap.empty) {
          const reactionDoc = existingSnap.docs[0];
          await deleteDoc(reactionDoc.ref);
        }
      } catch (err: any) {
        console.error('Error removing reaction:', err);
        throw err;
      }
    },
    [tenantId, threadId, messageId, currentUserId]
  );

  return {
    reactions,
    loading,
    addReaction,
    removeReaction,
    toggleReaction,
  };
}


