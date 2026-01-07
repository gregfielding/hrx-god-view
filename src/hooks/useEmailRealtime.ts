/**
 * useEmailRealtime Hook
 * 
 * Provides real-time Firestore listeners for email threads and messages
 * Handles live updates, unread counts, and typing indicators
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface EmailThread {
  id: string;
  tenantId: string;
  subject: string;
  participants: string[];
  participantUserIds?: string[];
  participantContactIds?: string[];
  lastMessageAt: Timestamp | Date | null;
  lastMessageSnippet?: string;
  unreadCount: number;
  messageCount: number;
  status: 'active' | 'archived' | 'deleted';
  starred?: boolean;
  labels?: string[];
  gmailThreadId?: string;
  participantContacts?: any[];
}

export interface EmailMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  from: string;
  fromUserId?: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml?: string;
  bodyPlain?: string;
  bodySnippet?: string;
  attachments?: any[];
  status: string;
  read: boolean;
  createdAt: Timestamp | Date;
}

export interface UseEmailRealtimeOptions {
  tenantId: string;
  userId: string;
  userEmail?: string;
  status?: 'active' | 'archived' | 'deleted';
  limit?: number;
  enabled?: boolean;
}

export interface UseEmailRealtimeReturn {
  threads: EmailThread[];
  loading: boolean;
  error: Error | null;
  unreadCount: number;
  refresh: () => void;
}

/**
 * Normalize Firestore timestamp to Date
 */
function normalizeTimestamp(timestamp: any): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (timestamp?.toDate) return timestamp.toDate();
  if (typeof timestamp === 'string') return new Date(timestamp);
  if (typeof timestamp === 'number') return new Date(timestamp);
  return null;
}

/**
 * Real-time email threads hook
 */
export function useEmailRealtime(
  options: UseEmailRealtimeOptions
): UseEmailRealtimeReturn {
  const {
    tenantId,
    userId,
    userEmail,
    status = 'active',
    limit: limitCount = 200,
    enabled = true,
  } = options;

  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    // Force re-subscription
    if (unsubscribeRef.current) {
      try {
        unsubscribeRef.current();
      } catch (e) {
        // Firestore can occasionally throw internal assertion errors during rapid
        // subscribe/unsubscribe churn (notably in React StrictMode dev). Never let
        // that crash the app.
        console.warn('useEmailRealtime: unsubscribe threw', e);
      } finally {
        unsubscribeRef.current = null;
      }
    }
    setLoading(true);
  }, []);

  useEffect(() => {
    if (!enabled || !tenantId || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const threadsRef = collection(db, 'tenants', tenantId, 'emailThreads');

      // Build query - try participantUserIds first, fallback to email
      let threadsQuery;
      
      try {
        // Primary query: by participantUserIds (more efficient)
        threadsQuery = query(
          threadsRef,
          where('participantUserIds', 'array-contains', userId),
          where('status', '==', status),
          orderBy('lastMessageAt', 'desc'),
          limit(limitCount * 2) // Get more to filter in memory
        );
      } catch (err) {
        // Fallback to email-based query if participantUserIds index doesn't exist
        if (userEmail) {
          threadsQuery = query(
            threadsRef,
            where('participants', 'array-contains', userEmail.toLowerCase()),
            where('status', '==', status),
            orderBy('lastMessageAt', 'desc'),
            limit(limitCount * 2)
          );
        } else {
          throw new Error('No userEmail provided and participantUserIds query failed');
        }
      }

      // Set up real-time listener
      const unsubscribe = onSnapshot(
        threadsQuery,
        (snapshot: QuerySnapshot<DocumentData>) => {
          try {
            let fetchedThreads = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            })) as EmailThread[];

            // Filter out deleted if status is active
            if (status === 'active') {
              fetchedThreads = fetchedThreads.filter((t) => t.status !== 'deleted');
            }

            // Normalize timestamps
            fetchedThreads = fetchedThreads.map((t) => ({
              ...t,
              lastMessageAt: normalizeTimestamp(t.lastMessageAt),
            }));

            // Deduplicate by thread ID (in case of multiple queries or race conditions)
            const threadMap = new Map<string, EmailThread>();
            fetchedThreads.forEach((thread) => {
              const existing = threadMap.get(thread.id);
              // Keep the one with the most recent lastMessageAt
              if (!existing || 
                  (thread.lastMessageAt && existing.lastMessageAt &&
                   (thread.lastMessageAt instanceof Date ? thread.lastMessageAt.getTime() : 0) >
                   (existing.lastMessageAt instanceof Date ? existing.lastMessageAt.getTime() : 0))) {
                threadMap.set(thread.id, thread);
              }
            });
            fetchedThreads = Array.from(threadMap.values());

            // Sort by lastMessageAt (most recent first)
            fetchedThreads.sort((a, b) => {
              const dateA = a.lastMessageAt ? (a.lastMessageAt instanceof Date ? a.lastMessageAt.getTime() : 0) : 0;
              const dateB = b.lastMessageAt ? (b.lastMessageAt instanceof Date ? b.lastMessageAt.getTime() : 0) : 0;
              return dateB - dateA;
            });

            // Limit results
            fetchedThreads = fetchedThreads.slice(0, limitCount);

            setThreads(fetchedThreads);
            setLoading(false);
            setError(null);
          } catch (err: any) {
            console.error('Error processing email threads snapshot:', err);
            setError(err);
            setLoading(false);
          }
        },
        (err: Error) => {
          console.error('Email threads snapshot error:', err);
          setError(err);
          setLoading(false);
        }
      );

      unsubscribeRef.current = unsubscribe;

      return () => {
        if (unsubscribeRef.current) {
          try {
            unsubscribeRef.current();
          } catch (e) {
            console.warn('useEmailRealtime: unsubscribe threw', e);
          } finally {
            unsubscribeRef.current = null;
          }
        }
      };
    } catch (err: any) {
      console.error('Error setting up email threads listener:', err);
      setError(err);
      setLoading(false);
    }
  }, [tenantId, userId, userEmail, status, limitCount, enabled]);

  // Calculate unread count
  const unreadCount = threads.reduce((sum, thread) => sum + (thread.unreadCount || 0), 0);

  return {
    threads,
    loading,
    error,
    unreadCount,
    refresh,
  };
}

/**
 * Real-time thread messages hook
 */
export function useThreadMessagesRealtime(
  tenantId: string,
  threadId: string,
  enabled = true
): {
  messages: EmailMessage[];
  loading: boolean;
  error: Error | null;
} {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId || !threadId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const messagesRef = collection(
        db,
        'tenants',
        tenantId,
        'emailThreads',
        threadId,
        'messages'
      );

      const messagesQuery = query(
        messagesRef,
        orderBy('createdAt', 'asc')
      );

      const unsubscribe = onSnapshot(
        messagesQuery,
        (snapshot: QuerySnapshot<DocumentData>) => {
          try {
            const fetchedMessages = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            })) as EmailMessage[];

            // Normalize timestamps
            const normalizedMessages = fetchedMessages.map((msg) => ({
              ...msg,
              createdAt: normalizeTimestamp(msg.createdAt) || new Date(),
            }));

            setMessages(normalizedMessages);
            setLoading(false);
            setError(null);
          } catch (err: any) {
            console.error('Error processing messages snapshot:', err);
            setError(err);
            setLoading(false);
          }
        },
        (err: Error) => {
          console.error('Messages snapshot error:', err);
          setError(err);
          setLoading(false);
        }
      );

      unsubscribeRef.current = unsubscribe;

      return () => {
        if (unsubscribeRef.current) {
          try {
            unsubscribeRef.current();
          } catch (e) {
            console.warn('useThreadMessagesRealtime: unsubscribe threw', e);
          } finally {
            unsubscribeRef.current = null;
          }
        }
      };
    } catch (err: any) {
      console.error('Error setting up messages listener:', err);
      setError(err);
      setLoading(false);
    }
  }, [tenantId, threadId, enabled]);

  return {
    messages,
    loading,
    error,
  };
}

