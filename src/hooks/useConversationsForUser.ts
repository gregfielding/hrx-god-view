/**
 * Real-time list of conversations the user participates in (tenant-scoped).
 * Uses tenants/{tenantId}/conversations where participantUids array-contains uid.
 */

import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { db } from '../firebase';
import type { Conversation } from '../types/conversations';

export function useConversationsForUser(
  tenantId: string | null,
  uid: string | null
) {
  const [conversations, setConversations] = useState<(Conversation & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!tenantId || !uid) {
      setConversations([]);
      setLoading(false);
      return;
    }

    // Normalize C1 tenant ID typo (0 vs O)
    const resolvedTenantId =
      tenantId && tenantId.includes('CgV0C')
        ? tenantId.replace('CgV0C', 'CgVOC')
        : tenantId;

    setLoading(true);
    setError(null);
    mountedRef.current = true;

    const ref = collection(db, 'tenants', resolvedTenantId, 'conversations');
    const q = query(
      ref,
      where('participantUids', 'array-contains', uid),
      orderBy('lastMessageAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (!mountedRef.current) return;
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, 'id'>) }));
        setConversations(rows);
        setLoading(false);
      },
      (err: any) => {
        if (!mountedRef.current) return;
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [tenantId, uid]);

  return { conversations, loading, error };
}
