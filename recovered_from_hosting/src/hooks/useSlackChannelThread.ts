/**
 * useSlackChannelThread Hook
 * 
 * Encapsulates logic for loading Slack messages for a single channel
 * and posting new messages via the HRX Messaging Bridge.
 */

import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export interface SlackChannelMessage {
  id: string;
  text: string;
  userName: string;
  userId: string;
  direction: 'inbound' | 'outbound';
  sentAt: Date;
  ts: string;
  threadTs?: string;
}

interface UseSlackChannelThreadOptions {
  tenantId: string;
  channelId: string | null;
  limit?: number; // default 50
}

interface UseSlackChannelThreadResult {
  messages: SlackChannelMessage[];
  loading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  sending: boolean;
}

export function useSlackChannelThread({
  tenantId,
  channelId,
  limit: messageLimit = 50,
}: UseSlackChannelThreadOptions): UseSlackChannelThreadResult {
  const [messages, setMessages] = useState<SlackChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Load messages from Firestore
  useEffect(() => {
    if (!channelId || !tenantId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Query slack_messages collection
    const messagesQuery = query(
      collection(db, 'slack_messages'),
      where('tenantId', '==', tenantId),
      where('channelId', '==', channelId),
      orderBy('sentAt', 'desc'),
      limit(messageLimit)
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        try {
          const messageList: SlackChannelMessage[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            const sentAt = data.sentAt?.toDate 
              ? data.sentAt.toDate() 
              : data.sentAt 
              ? new Date(data.sentAt) 
              : new Date();

            return {
              id: doc.id,
              text: data.text || '',
              userName: data.userName || data.slackUserName || 'Unknown',
              userId: data.userId || data.slackUserId || '',
              direction: data.direction || (data.source === 'hrx' ? 'outbound' : 'inbound'),
              sentAt,
              ts: data.ts || '',
              threadTs: data.threadTs || undefined,
            };
          });

          // Reverse to show oldest first (chronological order)
          messageList.reverse();
          setMessages(messageList);
          setLoading(false);
        } catch (err: any) {
          console.error('Error processing Slack messages:', err);
          setError(err.message || 'Failed to load messages');
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error loading Slack messages:', err);
        setError(err.message || 'Failed to load messages');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, channelId, messageLimit]);

  // Send message function
  const sendMessage = useCallback(
    async (text: string) => {
      if (!channelId || !tenantId || !text.trim()) {
        return;
      }

      setSending(true);
      setError(null);

      try {
        const sendSlackChannelMessageFn = httpsCallable<
          { tenantId: string; channelId: string; text: string },
          { ok: boolean; slackChannelId: string; ts: string; error?: string }
        >(functions, 'sendSlackChannelMessage');

        const result = await sendSlackChannelMessageFn({
          tenantId,
          channelId,
          text: text.trim(),
        });

        if (result.data.ok) {
          // Message will appear via Firestore listener
          // No need to manually add it
        } else {
          throw new Error(result.data.error || 'Failed to send message');
        }
      } catch (err: any) {
        console.error('Error sending Slack message:', err);
        setError(err.message || 'Failed to send message');
        throw err;
      } finally {
        setSending(false);
      }
    },
    [tenantId, channelId]
  );

  return {
    messages,
    loading,
    error,
    sendMessage,
    sending,
  };
}

