/**
 * useUnifiedInboxMessages Hook
 * 
 * Fetches and merges messages from all channels (Email, SMS, Slack, Internal)
 * into a unified list, sorted by timestamp.
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { UnifiedMessage, UnifiedInboxFilters } from '../types/unifiedInboxLegacy';
import { normalizeEmailThread, normalizeSmsThread, normalizeSlackMessage, normalizeInternalMessage, sortMessagesByTimestamp } from '../utils/unifiedInboxNormalizers';
import { canUserAccessSlack } from '../utils/security';
import { useAuth } from '../contexts/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface UseUnifiedInboxMessagesOptions {
  filters?: UnifiedInboxFilters;
  limitPerChannel?: number;
}

export function useUnifiedInboxMessages(options: UseUnifiedInboxMessagesOptions = {}) {
  const { user, activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const { filters = {}, limitPerChannel = 50 } = options;
  
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenantId = activeTenant?.id || (user as any)?.activeTenantId || '';
  // Ensure the object passed into security helpers includes activeTenantId + tenantIds security level.
  const userAny = user as any;
  const userWithTenant = user
    ? {
        ...userAny,
        activeTenantId: userAny.activeTenantId || activeTenant?.id,
        tenantIds:
          userAny.tenantIds ||
          (activeTenant?.id
            ? {
                [activeTenant.id]: {
                  securityLevel: currentClaimsSecurityLevel || securityLevel,
                },
              }
            : {}),
      }
    : null;
  const canAccessSlack = canUserAccessSlack(userWithTenant as any);

  useEffect(() => {
    console.log('[useUnifiedInboxMessages] useEffect triggered', { 
      hasUser: !!user?.uid, 
      tenantId, 
      filters: JSON.stringify(filters) 
    });

    if (!user?.uid || !tenantId) {
      console.log('[useUnifiedInboxMessages] Missing user or tenantId, clearing state');
      setMessages([]);
      setLoading(false);
      return;
    }

    const fetchAllMessages = async () => {
      console.log('[useUnifiedInboxMessages] Starting fetchAllMessages');
      setLoading(true);
      setError(null);

      try {
        const allMessages: UnifiedMessage[] = [];
        const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
          'https://us-central1-hrx1-d3beb.cloudfunctions.net';

        // Fetch all channels in parallel with timeout protection
        const fetchPromises: Promise<void>[] = [];

        // 1. Fetch Email Threads
        if (!filters.channel || filters.channel === 'all' || filters.channel === 'email') {
          const emailPromise = (async () => {
            try {
              const params = new URLSearchParams({
                tenantId,
                userId: user.uid,
                limit: limitPerChannel.toString(),
              });
              
              if (filters.unreadOnly) {
                params.append('unreadOnly', 'true');
              }

              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

              try {
                const response = await fetch(
                  `${API_BASE_URL}/listEmailThreadsApi?${params.toString()}`,
                  {
                    method: 'GET',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    signal: controller.signal,
                  }
                );

                clearTimeout(timeoutId);

                if (response.ok) {
                  const data = await response.json();
                  if (data.success && data.threads) {
                    const emailMessages = data.threads.map((thread: any) => 
                      normalizeEmailThread(thread, tenantId)
                    );
                    allMessages.push(...emailMessages);
                  }
                } else {
                  console.warn('Failed to fetch email threads:', response.status);
                }
              } catch (err: any) {
                clearTimeout(timeoutId);
                if (err.name !== 'AbortError') {
                  console.error('Error fetching email threads:', err.message || err);
                }
              }
            } catch (err: any) {
              console.error('Error in email fetch:', err.message || err);
            }
          })();
          fetchPromises.push(emailPromise);
        }

        // 2. Fetch SMS Threads
        if (!filters.channel || filters.channel === 'all' || filters.channel === 'sms') {
          const smsPromise = (async () => {
            try {
              const params = new URLSearchParams({
                tenantId,
                candidateId: user.uid,
                limit: limitPerChannel.toString(),
              });

              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);

              try {
                const response = await fetch(
                  `${API_BASE_URL}/listThreadsApi?${params.toString()}`,
                  {
                    method: 'GET',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    signal: controller.signal,
                  }
                );

                clearTimeout(timeoutId);

                if (response.ok) {
                  const data = await response.json();
                  if (data.success && data.threads) {
                    const smsMessages = data.threads.map((thread: any) => 
                      normalizeSmsThread(thread, tenantId)
                    );
                    allMessages.push(...smsMessages);
                  }
                } else {
                  console.warn('Failed to fetch SMS threads:', response.status);
                }
              } catch (err: any) {
                clearTimeout(timeoutId);
                if (err.name !== 'AbortError') {
                  console.error('Error fetching SMS threads:', err.message || err);
                }
              }
            } catch (err: any) {
              console.error('Error in SMS fetch:', err.message || err);
            }
          })();
          fetchPromises.push(smsPromise);
        }

        // 3. Fetch Slack Messages (only if user has access)
        if (canAccessSlack && (!filters.channel || filters.channel === 'all' || filters.channel === 'slack')) {
          const slackPromise = (async () => {
            try {
              const slackRef = collection(db, 'tenants', tenantId, 'slack_messages');
              let slackQuery: any = query(
                slackRef,
                where('tenantId', '==', tenantId),
                orderBy('createdAt', 'desc'),
                limit(limitPerChannel)
              );

              const slackSnapshot = await getDocs(slackQuery);
              const slackMessages = slackSnapshot.docs.map(doc => 
                normalizeSlackMessage(doc, tenantId)
              );
              allMessages.push(...slackMessages);
            } catch (err) {
              console.error('Error fetching Slack messages:', err);
            }
          })();
          fetchPromises.push(slackPromise);
        }

        // 4. Fetch Internal Messages
        if (!filters.channel || filters.channel === 'all' || filters.channel === 'internal') {
          const internalPromise = (async () => {
            try {
              // Fetch from internalDMs
              const dmsRef = collection(db, 'tenants', tenantId, 'internalDMs');
              const dmsSnapshot = await getDocs(dmsRef);
              
              for (const dmDoc of dmsSnapshot.docs) {
                const messagesRef = collection(dmDoc.ref, 'internalMessages');
                const messagesQuery = query(
                  messagesRef,
                  orderBy('createdAt', 'desc'),
                  limit(1)
                );
                const messagesSnapshot = await getDocs(messagesQuery);
                
                messagesSnapshot.docs.forEach(msgDoc => {
                  const msg = normalizeInternalMessage(msgDoc, tenantId);
                  msg.conversationId = dmDoc.id;
                  allMessages.push(msg);
                });
              }

              // Fetch from internalChannels
              const channelsRef = collection(db, 'tenants', tenantId, 'internalChannels');
              const channelsSnapshot = await getDocs(channelsRef);
              
              for (const channelDoc of channelsSnapshot.docs) {
                const messagesRef = collection(channelDoc.ref, 'internalMessages');
                const messagesQuery = query(
                  messagesRef,
                  orderBy('createdAt', 'desc'),
                  limit(1)
                );
                const messagesSnapshot = await getDocs(messagesQuery);
                
                messagesSnapshot.docs.forEach(msgDoc => {
                  const msg = normalizeInternalMessage(msgDoc, tenantId);
                  msg.conversationId = channelDoc.id;
                  allMessages.push(msg);
                });
              }
            } catch (err) {
              console.error('Error fetching internal messages:', err);
            }
          })();
          fetchPromises.push(internalPromise);
        }

        // Wait for all fetches to complete (or fail) with a maximum timeout
        await Promise.race([
          Promise.allSettled(fetchPromises),
          new Promise(resolve => setTimeout(resolve, 15000)), // 15 second max total timeout
        ]);

        // Apply filters
        let filteredMessages = allMessages;

        // Filter by unread
        if (filters.unreadOnly) {
          filteredMessages = filteredMessages.filter(m => m.unread);
        }

        // Filter by status
        if (filters.status && filters.status !== 'any') {
          filteredMessages = filteredMessages.filter(m => m.status === filters.status);
        }

        // Filter by date range
        if (filters.dateFrom) {
          const fromTime = filters.dateFrom.getTime();
          filteredMessages = filteredMessages.filter(m => {
            const msgTime = m.timestamp instanceof Timestamp ? m.timestamp.toMillis() : 
                           m.timestamp instanceof Date ? m.timestamp.getTime() : 0;
            return msgTime >= fromTime;
          });
        }

        if (filters.dateTo) {
          const toTime = filters.dateTo.getTime();
          filteredMessages = filteredMessages.filter(m => {
            const msgTime = m.timestamp instanceof Timestamp ? m.timestamp.toMillis() : 
                           m.timestamp instanceof Date ? m.timestamp.getTime() : 0;
            return msgTime <= toTime;
          });
        }

        // Apply search query
        if (filters.searchQuery && filters.searchQuery.trim()) {
          const searchLower = filters.searchQuery.toLowerCase();
          filteredMessages = filteredMessages.filter(m => {
            return (
              m.from.toLowerCase().includes(searchLower) ||
              m.subject?.toLowerCase().includes(searchLower) ||
              m.preview.toLowerCase().includes(searchLower) ||
              m.to?.toLowerCase().includes(searchLower)
            );
          });
        }

        // Sort by timestamp (newest first)
        const sortedMessages = sortMessagesByTimestamp(filteredMessages);
        console.log('[useUnifiedInboxMessages] Fetch complete, setting messages', { 
          count: sortedMessages.length 
        });
        setMessages(sortedMessages);
        setLoading(false);

      } catch (err: any) {
        console.error('[useUnifiedInboxMessages] Error fetching unified messages:', err);
        setError(err.message || 'Failed to load messages');
        setLoading(false);
      }
    };

    // Call fetch function with error handling
    fetchAllMessages().catch((err) => {
      console.error('[useUnifiedInboxMessages] Unhandled error in fetchAllMessages:', err);
      setLoading(false);
      setError('Failed to load messages');
    });
  }, [user?.uid, tenantId, canAccessSlack, JSON.stringify(filters), limitPerChannel]);

  // Debug: Log state changes
  useEffect(() => {
    console.log('[useUnifiedInboxMessages] State update', { 
      messagesCount: messages.length, 
      loading, 
      error 
    });
  }, [messages.length, loading, error]);

  return { messages, loading, error };
}

