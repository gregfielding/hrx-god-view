/**
 * Hook for real-time SMS thread messages
 * Similar to useThreadMessagesRealtime but for SMS
 */

import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { Timestamp } from 'firebase/firestore';

export interface SmsMessage {
  id: string;
  threadId: string;
  tenantId: string;
  direction: 'inbound' | 'outbound';
  fromType: 'candidate' | 'recruiter' | 'system';
  fromUserId?: string;
  body: string;
  status: string;
  providerMessageId?: string;
  createdAt: Timestamp | Date | string;
  language?: string | null;
}

interface UseSmsThreadMessagesOptions {
  tenantId: string;
  threadId: string;
  enabled?: boolean;
}

interface UseSmsThreadMessagesReturn {
  messages: SmsMessage[];
  loading: boolean;
  error: Error | null;
}

export function useSmsThreadMessages({
  tenantId,
  threadId,
  enabled = true,
}: UseSmsThreadMessagesOptions): UseSmsThreadMessagesReturn {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
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
        'smsThreads',
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
            })) as SmsMessage[];

            // Normalize timestamps
            const normalizedMessages = fetchedMessages.map((msg) => ({
              ...msg,
              createdAt: msg.createdAt instanceof Timestamp 
                ? msg.createdAt.toDate() 
                : msg.createdAt instanceof Date 
                ? msg.createdAt 
                : new Date(msg.createdAt as string),
            }));

            setMessages(normalizedMessages);
            setLoading(false);
            setError(null);
          } catch (err: any) {
            console.error('Error processing SMS messages snapshot:', err);
            setError(err);
            setLoading(false);
          }
        },
        (err: Error) => {
          console.error('SMS messages snapshot error:', err);
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
            console.warn('useSmsThreadMessages: unsubscribe threw', e);
          } finally {
            unsubscribeRef.current = null;
          }
        }
      };
    } catch (err: any) {
      console.error('Error setting up SMS messages listener:', err);
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
