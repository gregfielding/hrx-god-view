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
    console.log('[Mentions Count] Hook initialized with userId:', userId);
    
    if (!userId) {
      console.log('[Mentions Count] No userId provided, setting count to 0');
      setCount(0);
      setLoading(false);
      return;
    }

    console.log('[Mentions Count] Setting up Firestore query for userId:', userId);
    setLoading(true);

    const q = query(
      collection(db, 'dashboardFeed'),
      where('userId', '==', userId),
      where('sourceType', '==', 'mention'),
      where('isUnread', '==', true)
    );

    console.log('[Mentions Count] Query created, setting up snapshot listener...');

    const unsub = onSnapshot(
      q,
      (snap) => {
        const unreadCount = snap.size;
        console.log(`[Mentions Count] ✅ Snapshot received: ${unreadCount} unread mentions for user ${userId}`);
        console.log('[Mentions Count] Snapshot metadata:', {
          hasPendingWrites: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
        setCount(unreadCount);
        setLoading(false);
      },
      (err) => {
        console.error('[Mentions Count] ❌ Firestore error:', err);
        console.error('[Mentions Count] Error code:', err?.code);
        console.error('[Mentions Count] Error message:', err?.message);
        console.error('[Mentions Count] Full error object:', JSON.stringify(err, null, 2));
        
        // Check if it's a permission error
        if (err?.code === 'permission-denied') {
          console.error('[Mentions Count] 🔒 PERMISSION DENIED - Check Firestore rules for dashboardFeed collection');
          console.error('[Mentions Count] User ID:', userId);
          console.error('[Mentions Count] Make sure rule allows: request.auth.uid == resource.data.userId');
        }
        
        // Check if it's an index error
        if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
          console.warn('[Mentions Count] ⚠️ Firestore index required. Create composite index for: userId, sourceType, isUnread');
        }
        
        setCount(0);
        setLoading(false);
      }
    );

    return () => {
      console.log('[Mentions Count] Cleaning up snapshot listener');
      unsub();
    };
  }, [userId]);

  return { count, loading };
}

