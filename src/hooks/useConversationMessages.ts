/**
 * Real-time messages for a single conversation.
 * Uses tenants/{tenantId}/conversations/{conversationId}/messages.
 */

import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import type { ConversationMessage } from '../types/conversations';

export function useConversationMessages(
  tenantId: string | null,
  conversationId: string | null
) {
  const [messages, setMessages] = useState<(ConversationMessage & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!tenantId || !conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const ref = collection(db, 'tenants', tenantId, 'conversations', conversationId, 'messages');
    const q = query(ref, orderBy('createdAt', 'asc'), limit(200));

    const unsub = onSnapshot(
      q,
      (snap) => {
        console.debug('[WorkerInboxDetail] messages fetch success', {
          tenantId,
          conversationId,
          count: snap.size,
          routePath: `tenants/${tenantId}/conversations/${conversationId}/messages`,
        });
        setMessages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ConversationMessage, 'id'>) }))
        );
        setLoading(false);
      },
      (err) => {
        console.error('[WorkerInboxDetail] messages fetch failure', {
          tenantId,
          conversationId,
          routePath: `tenants/${tenantId}/conversations/${conversationId}/messages`,
          code: (err as any)?.code,
          message: (err as any)?.message,
        });
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [tenantId, conversationId]);

  return { messages, loading, error };
}
