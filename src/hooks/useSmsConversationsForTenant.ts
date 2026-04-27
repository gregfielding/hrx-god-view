/**
 * Admin: list SMS conversations for a tenant (canonical).
 * Query: tenants/{tenantId}/conversations, orderBy lastMessageAt desc, limit 100.
 * Client filter: channelEndpoints?.sms != null.
 */

import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import type { Conversation } from '../types/conversations';

export type SmsConversation = (Conversation & { id: string }) & {
  channelEndpoints?: { sms?: { workerPhoneE164?: string; twilioNumberE164?: string } };
};

export function useSmsConversationsForTenant(tenantId: string | null) {
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!tenantId) {
      setConversations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const ref = collection(db, 'tenants', tenantId, 'conversations');
    const q = query(ref, orderBy('lastMessageAt', 'desc'), limit(100));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, 'id'>) } as SmsConversation))
          .filter((c) => c.channelEndpoints?.sms != null);
        setConversations(list);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [tenantId]);

  return { conversations, loading, error };
}
