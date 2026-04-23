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
  const unsubscribeRefs = useRef<Array<() => void>>([]);
  // Keep the two source sets separate so snapshots from either subscription
  // can be merged without losing the other's latest state.
  const byUserIdRef = useRef<Map<string, EmailThread>>(new Map());
  const byEmailRef = useRef<Map<string, EmailThread>>(new Map());

  const clearSubscriptions = useCallback(() => {
    for (const unsub of unsubscribeRefs.current) {
      try {
        unsub();
      } catch (e) {
        // Firestore can occasionally throw internal assertion errors during rapid
        // subscribe/unsubscribe churn (notably in React StrictMode dev). Never let
        // that crash the app.
        console.warn('useEmailRealtime: unsubscribe threw', e);
      }
    }
    unsubscribeRefs.current = [];
  }, []);

  const refresh = useCallback(() => {
    clearSubscriptions();
    byUserIdRef.current = new Map();
    byEmailRef.current = new Map();
    setLoading(true);
  }, [clearSubscriptions]);

  const publishMerged = useCallback(() => {
    try {
      const merged = new Map<string, EmailThread>();
      // Prefer the most recent doc version across both queries (either could
      // be more up to date depending on which write arrived first in cache).
      const consider = (t: EmailThread) => {
        const existing = merged.get(t.id);
        const tMs = t.lastMessageAt instanceof Date ? t.lastMessageAt.getTime() : 0;
        const eMs = existing?.lastMessageAt instanceof Date ? existing.lastMessageAt.getTime() : 0;
        if (!existing || tMs >= eMs) merged.set(t.id, t);
      };
      byUserIdRef.current.forEach(consider);
      byEmailRef.current.forEach(consider);

      let fetchedThreads = Array.from(merged.values());

      // Filter out deleted when viewing active
      if (status === 'active') {
        fetchedThreads = fetchedThreads.filter((t) => t.status !== 'deleted');
      }

      // Sort by lastMessageAt desc
      fetchedThreads.sort((a, b) => {
        const dateA = a.lastMessageAt instanceof Date ? a.lastMessageAt.getTime() : 0;
        const dateB = b.lastMessageAt instanceof Date ? b.lastMessageAt.getTime() : 0;
        return dateB - dateA;
      });

      fetchedThreads = fetchedThreads.slice(0, limitCount);
      setThreads(fetchedThreads);
      setLoading(false);
      setError(null);
    } catch (err: any) {
      console.error('Error merging email threads snapshots:', err);
      setError(err);
      setLoading(false);
    }
  }, [status, limitCount]);

  useEffect(() => {
    if (!enabled || !tenantId || !userId) {
      setLoading(false);
      return;
    }

    clearSubscriptions();
    byUserIdRef.current = new Map();
    byEmailRef.current = new Map();
    setLoading(true);
    setError(null);

    const threadsRef = collection(db, 'tenants', tenantId, 'emailThreads');
    // Over-fetch per query; we merge and cap at limitCount after dedupe.
    const perQueryLimit = limitCount * 2;

    const normalizeSnapshot = (snapshot: QuerySnapshot<DocumentData>): EmailThread[] =>
      snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          lastMessageAt: normalizeTimestamp(data.lastMessageAt),
        } as EmailThread;
      });

    // Subscription 1: by participantUserIds (includes threads where owner is linked by userId)
    try {
      const q1 = query(
        threadsRef,
        where('participantUserIds', 'array-contains', userId),
        where('status', '==', status),
        orderBy('lastMessageAt', 'desc'),
        limit(perQueryLimit)
      );
      const unsub1 = onSnapshot(
        q1,
        (snap) => {
          const fresh = normalizeSnapshot(snap);
          const next = new Map<string, EmailThread>();
          fresh.forEach((t) => next.set(t.id, t));
          byUserIdRef.current = next;
          publishMerged();
        },
        (err) => {
          console.error('useEmailRealtime userId listener error:', err);
          // Don't clobber state — the email-based listener may still succeed.
          setError(err);
          setLoading(false);
        }
      );
      unsubscribeRefs.current.push(unsub1);
    } catch (err: any) {
      console.error('useEmailRealtime: failed to build userId query:', err);
    }

    // Subscription 2: by participants (email address). Catches threads that pre-date the
    // participantUserIds ingestion fix, or any thread where the userId hasn't been merged yet.
    // This guarantees parity with Gmail: every email addressed to the user's address shows up.
    const normalizedEmail = userEmail?.toLowerCase();
    if (normalizedEmail) {
      try {
        const q2 = query(
          threadsRef,
          where('participants', 'array-contains', normalizedEmail),
          where('status', '==', status),
          orderBy('lastMessageAt', 'desc'),
          limit(perQueryLimit)
        );
        const unsub2 = onSnapshot(
          q2,
          (snap) => {
            const fresh = normalizeSnapshot(snap);
            const next = new Map<string, EmailThread>();
            fresh.forEach((t) => next.set(t.id, t));
            byEmailRef.current = next;
            publishMerged();
          },
          (err) => {
            // Missing composite index would land here; log but continue with userId listener.
            console.warn('useEmailRealtime email listener error (non-fatal):', err);
          }
        );
        unsubscribeRefs.current.push(unsub2);
      } catch (err: any) {
        console.warn('useEmailRealtime: failed to build email query:', err);
      }
    }

    return () => {
      clearSubscriptions();
    };
  }, [tenantId, userId, userEmail, status, limitCount, enabled, clearSubscriptions, publishMerged]);

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

