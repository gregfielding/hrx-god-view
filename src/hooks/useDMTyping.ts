/**
 * Typing Indicator Hooks
 * 
 * Hooks for managing typing indicators in DM conversations.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DMTypingDoc } from '../types/directMessenger';

/**
 * Hook to detect if the other user is typing
 */
export function useDMTyping(tenantId: string, threadId: string, currentUserId: string): {
  isOtherTyping: boolean;
} {
  const [isOtherTyping, setIsOtherTyping] = useState(false);

  useEffect(() => {
    if (!tenantId || !threadId || !currentUserId) {
      setIsOtherTyping(false);
      return;
    }

    const typingRef = collection(db, 'tenants', tenantId, 'dmTyping');
    const typingQuery = query(
      typingRef,
      where('threadId', '==', threadId)
    );

    const unsubscribe = onSnapshot(
      typingQuery,
      (snapshot) => {
        const now = Date.now();
        let foundTyping = false;

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as DMTypingDoc;
          // Only show typing indicator for other users, not current user
          if (data.userId !== currentUserId) {
            const updatedAt = data.updatedAt.toMillis();
            const timeSinceUpdate = now - updatedAt;
            // Show typing if updated within last 5 seconds
            if (timeSinceUpdate < 5000) {
              foundTyping = true;
            }
          }
        });

        setIsOtherTyping(foundTyping);
      },
      (error) => {
        console.error('Error listening to typing indicators:', error);
        setIsOtherTyping(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, threadId, currentUserId]);

  return { isOtherTyping };
}

/**
 * Hook to manage current user's typing state
 */
export function useMyDMTyping(tenantId: string, threadId: string, currentUserId: string): {
  setIsTyping: (isTyping: boolean) => void;
} {
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const THROTTLE_MS = 2000; // Update at most once every 2 seconds

  const updateTypingState = useCallback(
    async (isTyping: boolean) => {
      if (!tenantId || !threadId || !currentUserId) return;

      const now = Date.now();
      // Throttle updates to avoid too many writes
      if (isTyping && now - lastUpdateRef.current < THROTTLE_MS) {
        return;
      }

      lastUpdateRef.current = now;

      const typingDocRef = doc(db, 'tenants', tenantId, 'dmTyping', `${threadId}_${currentUserId}`);

      try {
        if (isTyping) {
          await setDoc(typingDocRef, {
            threadId,
            userId: currentUserId,
            updatedAt: serverTimestamp(),
          });
        } else {
          await deleteDoc(typingDocRef);
        }
      } catch (error) {
        console.error('Error updating typing state:', error);
      }
    },
    [tenantId, threadId, currentUserId]
  );

  const setIsTyping = useCallback(
    (isTyping: boolean) => {
      // Clear any existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      if (isTyping) {
        // User started typing - update immediately
        updateTypingState(true);
      } else {
        // User stopped typing - clear after a short delay (in case they start again)
        typingTimeoutRef.current = setTimeout(() => {
          updateTypingState(false);
        }, 1000);
      }
    },
    [updateTypingState]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      // Clear typing state on unmount
      updateTypingState(false);
    };
  }, [updateTypingState]);

  return { setIsTyping };
}


