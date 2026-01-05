/**
 * useDMMessages Hook
 * 
 * Fetches and manages messages for a specific DM thread.
 * Provides sendMessage and markAsRead functions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  increment,
} from 'firebase/firestore';
import { db } from '../firebase';
import { DMMessage, DMMessageView } from '../types/directMessenger';

interface UseDMMessagesOptions {
  tenantId: string;
  threadId: string;
  currentUserId: string;
  otherUserId?: string; // Required for creating thread if it doesn't exist
  otherUserData?: { displayName: string; email: string; avatarUrl?: string }; // User data to avoid Firestore read
  maxMessages?: number;
}

interface UseDMMessagesReturn {
  messages: DMMessageView[];
  loading: boolean;
  error: Error | null;
  sendMessage: (text: string, gifData?: { url: string; stillUrl: string; width: number; height: number; provider: 'giphy' | 'tenor' }) => Promise<void>;
  markAsRead: () => Promise<void>;
}

/**
 * Format timestamp for message display
 */
function formatMessageTime(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (diffDays === 0) {
    return timeStr; // Today: "3:45 PM"
  } else if (diffDays === 1) {
    return `Yesterday · ${timeStr}`;
  } else if (diffDays < 7) {
    return `${date.toLocaleDateString('en-US', { weekday: 'short' })} · ${timeStr}`;
  } else {
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${timeStr}`;
  }
}

/**
 * Get date label for date separators (e.g., "Today", "Yesterday", "Jan 15")
 */
function getDateLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Hook to fetch and manage messages for a DM thread
 */
export function useDMMessages({
  tenantId,
  threadId,
  currentUserId,
  otherUserId,
  otherUserData,
  maxMessages = 100,
}: UseDMMessagesOptions): UseDMMessagesReturn {
  const [messages, setMessages] = useState<DMMessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const optimisticMessagesRef = useRef<Map<string, DMMessageView>>(new Map());

  useEffect(() => {
    if (!tenantId || !threadId || !currentUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const messagesRef = collection(db, 'tenants', tenantId, 'dmThreads', threadId, 'messages');
    const messagesQuery = query(
      messagesRef,
      orderBy('createdAt', 'asc'),
      limit(maxMessages)
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        try {
          // If we get a permission error, the thread might not exist yet
          // This is fine - we'll just show an empty message list
          const messagesList: DMMessageView[] = snapshot.docs
            .filter((doc) => {
              const data = doc.data() as DMMessage;
              // Only include non-deleted messages with valid createdAt (filter out race conditions during send)
              return !data.deletedAt && data.createdAt != null;
            })
            .map((doc, index, filteredDocs) => {
              const data = doc.data() as DMMessage;
              // createdAt is guaranteed to be non-null Timestamp due to filter above
              const createdAt = data.createdAt.toDate();
              const editedAt = data.editedAt?.toDate();
              const deletedAt = data.deletedAt?.toDate();

              // Determine if we need a date separator
              let dateLabel: string | undefined;
              if (index === 0) {
                // First message always shows date
                dateLabel = getDateLabel(createdAt);
              } else {
                // Show date if different from previous message
                const prevDoc = filteredDocs[index - 1];
                if (prevDoc) {
                  const prevData = prevDoc.data() as DMMessage;
                  const prevCreatedAt = prevData.createdAt.toDate();
                  const prevDate = new Date(
                    prevCreatedAt.getFullYear(),
                    prevCreatedAt.getMonth(),
                    prevCreatedAt.getDate()
                  );
                  const currentDate = new Date(
                    createdAt.getFullYear(),
                    createdAt.getMonth(),
                    createdAt.getDate()
                  );
                  if (prevDate.getTime() !== currentDate.getTime()) {
                    dateLabel = getDateLabel(createdAt);
                  }
                }
              }

              return {
                id: doc.id,
                senderId: data.senderId,
                text: data.text || '',
                createdAt,
                editedAt,
                deletedAt,
                type: data.type || 'message',
                isOwn: data.senderId === currentUserId,
                timeLabel: formatMessageTime(createdAt),
                dateLabel,
                // GIF fields
                gifUrl: data.gifUrl,
                stillPreviewUrl: data.stillPreviewUrl,
                gifWidth: data.gifWidth,
                gifHeight: data.gifHeight,
                gifProvider: data.gifProvider,
              };
            });

          // Merge real messages with optimistic messages
          // Remove optimistic messages that have been confirmed (by matching text and sender)
          const currentOptimistic = optimisticMessagesRef.current;
          const confirmedOptimisticIds = new Set<string>();
          messagesList.forEach((realMsg) => {
            currentOptimistic.forEach((optMsg, optId) => {
              // If we find a real message that matches the optimistic one (same text, same sender, close timestamp)
              if (
                optMsg.senderId === realMsg.senderId &&
                optMsg.text === realMsg.text &&
                Math.abs(realMsg.createdAt.getTime() - optMsg.createdAt.getTime()) < 10000 // Within 10 seconds
              ) {
                confirmedOptimisticIds.add(optId);
              }
            });
          });

          // Remove confirmed optimistic messages
          confirmedOptimisticIds.forEach((id) => currentOptimistic.delete(id));

          // Merge: real messages + remaining optimistic messages
          const mergedMessages = [...messagesList];
          currentOptimistic.forEach((optMsg) => {
            // Insert optimistic message in correct position (sorted by createdAt)
            const insertIndex = mergedMessages.findIndex(
              (msg) => msg.createdAt.getTime() > optMsg.createdAt.getTime()
            );
            if (insertIndex === -1) {
              mergedMessages.push(optMsg);
            } else {
              mergedMessages.splice(insertIndex, 0, optMsg);
            }
          });

          setMessages(mergedMessages);
          setLoading(false);
        } catch (err: any) {
          console.error('Error processing DM messages:', err);
          setError(err);
          setLoading(false);
        }
      },
      (err: any) => {
        // If permission denied, the thread might not exist yet - this is expected
        if (err.code === 'permission-denied' || err.code === 'not-found') {
          // Thread doesn't exist yet, just show empty messages
          setMessages([]);
          setLoading(false);
          setError(null); // Don't set error for expected case
        } else {
          console.error('Error loading DM messages:', err);
          setError(err);
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [tenantId, threadId, currentUserId, maxMessages]);

  /**
   * Send a new message to the thread
   */
  const sendMessage = useCallback(
    async (text: string, gifData?: { url: string; stillUrl: string; width: number; height: number; provider: 'giphy' | 'tenor' }) => {
      if (!tenantId || !threadId || !currentUserId) {
        throw new Error('Missing required fields');
      }

      // For GIF messages, text can be empty
      const trimmedText = text.trim();
      if (!gifData && !trimmedText) {
        throw new Error('Message text cannot be empty');
      }

      // Create optimistic message immediately
      const optimisticId = `optimistic-${Date.now()}-${Math.random()}`;
      const now = new Date();
      const optimisticMessage: DMMessageView = {
        id: optimisticId,
        senderId: currentUserId,
        text: trimmedText,
        createdAt: now,
        type: gifData ? 'gif' : 'message',
        isOwn: true,
        timeLabel: formatMessageTime(now),
        dateLabel: getDateLabel(now),
        isPending: true,
        // Include GIF fields if present
        gifUrl: gifData?.url,
        stillPreviewUrl: gifData?.stillUrl,
        gifWidth: gifData?.width,
        gifHeight: gifData?.height,
        gifProvider: gifData?.provider,
      };

      // Add optimistic message immediately
      optimisticMessagesRef.current.set(optimisticId, optimisticMessage);
      // Trigger a re-render by updating messages state
      setMessages((prev) => {
        const merged = [...prev, optimisticMessage].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
        return merged;
      });

      const threadRef = doc(db, 'tenants', tenantId, 'dmThreads', threadId);
      const messagesRef = collection(db, 'tenants', tenantId, 'dmThreads', threadId, 'messages');
      
      let currentUserData: any = null;
      let otherUserDataForThread: any = null; // Renamed to avoid shadowing the parameter

      try {
        // IMPORTANT:
        // Do NOT "check if thread exists" with getDoc(threadRef).
        // Our Firestore rules for dmThreads read are participant-based and will deny reads when the doc doesn't exist.
        // That produces the exact 403/batchGet + permission-denied you're seeing.
        //
        // Instead, we "ensure" the thread exists via a write (create/update) that doesn't require a read.
        if (!otherUserId) {
          throw new Error('Cannot send DM: otherUserId is required');
        }

        console.log('[useDMMessages] Ensuring thread exists (no pre-read)...');
        console.log('[useDMMessages] otherUserData provided:', !!otherUserData);

        // Prefer provided otherUserData (from People list) and avoid reading other user's Firestore doc.
        if (otherUserData) {
          otherUserDataForThread = {
            displayName: otherUserData.displayName,
            email: otherUserData.email,
            avatarUrl: otherUserData.avatarUrl,
          };
        }

        // Try reading current user's own doc (should be allowed), but don't hard-fail if it isn't.
        try {
          const currentUserDoc = await getDoc(doc(db, 'users', currentUserId));
          if (currentUserDoc.exists()) currentUserData = currentUserDoc.data();
        } catch {
          // ignore – we can still create the thread with minimal meta
        }

        // IMPORTANT: Firestore rules for messages rely on reading the parent dmThreads/{threadId}.
        // If we create the thread and the first message in the SAME transaction, rules `get(...)`
        // for the thread won't see the just-created doc and message create will fail with permission-denied.
        // So: first ensure thread exists via setDoc(merge:true) WITHOUT reading it.

        const currentDisplayName =
          currentUserData?.displayName ||
          (currentUserData?.firstName && currentUserData?.lastName
            ? `${currentUserData.firstName} ${currentUserData.lastName}`
            : currentUserData?.email?.split('@')[0] || 'User');

        const otherDisplayName =
          otherUserDataForThread?.displayName ||
          (otherUserDataForThread?.email ? otherUserDataForThread.email.split('@')[0] : 'User');

        const ensureThreadData: any = {
          participantIds: [currentUserId, otherUserId],
          participantMeta: {
            [currentUserId]: {
              displayName: currentDisplayName,
              email: currentUserData?.email || '',
              avatarUrl: currentUserData?.avatar || currentUserData?.photoURL || '',
            },
            [otherUserId]: {
              displayName: otherDisplayName,
              email: otherUserDataForThread?.email || '',
              avatarUrl: otherUserDataForThread?.avatarUrl || '',
            },
          },
          status: 'active',
          updatedAt: serverTimestamp(),
        };

        // Use setDoc with merge to avoid overwriting existing thread fields (unreadCounts, lastMessage*, createdAt, etc.)
        await setDoc(threadRef, ensureThreadData, { merge: true });

        // Create message (no transaction read). Rules validate sender and membership using the parent thread doc.
        console.log('[useDMMessages] Creating message (no transaction read)...');
        await addDoc(messagesRef, {
          senderId: currentUserId,
          text: trimmedText,
          createdAt: serverTimestamp(),
          type: gifData ? 'gif' : 'message',
          gifUrl: gifData?.url,
          stillPreviewUrl: gifData?.stillUrl,
          gifWidth: gifData?.width,
          gifHeight: gifData?.height,
          gifProvider: gifData?.provider,
        });

        // Update thread metadata + unread counts without reading existing values.
        console.log('[useDMMessages] Updating thread metadata + unread counts (no read)...');
        const lastMessageText = gifData ? '📎 GIF' : trimmedText;
        await updateDoc(threadRef, {
          lastMessageText,
          lastMessageAt: serverTimestamp(),
          lastMessageSenderId: currentUserId,
          updatedAt: serverTimestamp(),
          [`unreadCounts.${currentUserId}`]: 0,
          [`unreadCounts.${otherUserId}`]: increment(1),
        });
        
        // Remove optimistic message on success (real message will arrive via snapshot)
        optimisticMessagesRef.current.delete(optimisticId);
      } catch (err: any) {
        // Remove optimistic message on error
        optimisticMessagesRef.current.delete(optimisticId);
        // Also remove from displayed messages
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
        console.error('Error sending DM message:', err);
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);
        console.error('Tenant ID:', tenantId);
        console.error('Thread ID:', threadId);
        console.error('Current User ID:', currentUserId);
        console.error('Other User ID:', otherUserId);
        console.error('Thread exists:', 'unknown (we avoid pre-reads to prevent permission-denied)');
        console.error('User data loaded:', !!currentUserData && !!otherUserDataForThread);
        console.error('Provided otherUserData:', !!otherUserData);
        console.error('currentUserData:', !!currentUserData);
        console.error('otherUserDataForThread:', !!otherUserDataForThread);
        
        // Provide more helpful error message
        if (err.code === 'permission-denied') {
          throw new Error('Permission denied: Unable to send message. Please check your permissions.');
        } else if (err.code === 'not-found') {
          throw new Error('User or thread not found. Please try again.');
        } else {
          throw new Error(`Failed to send message: ${err.message || err.code || 'Unknown error'}`);
        }
      }
    },
    [tenantId, threadId, currentUserId, otherUserId, otherUserData]
  );

  /**
   * Mark thread as read (reset unread count for current user)
   */
  const markAsRead = useCallback(async () => {
    if (!tenantId || !threadId || !currentUserId) {
      return;
    }

    try {
      const threadRef = doc(db, 'tenants', tenantId, 'dmThreads', threadId);

      // Use updateDoc with FieldValue to update nested map field
      // This sets unreadCounts.{currentUserId} to 0 without needing to read the thread first
      await updateDoc(threadRef, {
        [`unreadCounts.${currentUserId}`]: 0,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      // Silently handle errors - thread might not exist yet, or permission issues
      // This is non-critical, so we don't want to throw
      if (err.code !== 'permission-denied' && err.code !== 'not-found') {
        console.error('Error marking DM thread as read:', err);
      }
    }
  }, [tenantId, threadId, currentUserId]);

  return {
    messages,
    loading,
    error,
    sendMessage,
    markAsRead,
  };
}

