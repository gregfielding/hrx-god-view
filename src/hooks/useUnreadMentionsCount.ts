/**
 * useUnreadMentionsCount Hook
 * 
 * Returns the count of unread mentions for the current user.
 */

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface UseUnreadMentionsCountResult {
  count: number;
  loading: boolean;
}

export function useUnreadMentionsCount(userId: string | null): UseUnreadMentionsCountResult {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'dashboardFeed'),
      where('userId', '==', userId),
      where('sourceType', '==', 'mention'),
      where('isUnread', '==', true)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const unreadCount = snap.size;
        setCount(unreadCount);
        setLoading(false);
      },
      (err) => {
        // Only log actual errors, not debug info
        if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
          console.error('[Mentions Count] Firestore error:', err?.code, err?.message);
        }
        setCount(0);
        setLoading(false);
      }
    );

    return () => {
      unsub();
    };
  }, [userId]);

  return { count, loading };
}

