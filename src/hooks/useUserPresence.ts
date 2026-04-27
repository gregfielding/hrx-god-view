/**
 * useUserPresence Hook
 * 
 * Reads user presence from Firestore in real-time.
 * Returns the effective status (derived from lastSeenAt) and raw data.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserPresenceDoc, PresenceStatus } from '../types/presence';
import { getEffectiveStatus } from '../utils/presence';

export interface UseUserPresenceResult {
  status: PresenceStatus;
  lastSeenAt: Date | null;
  raw: UserPresenceDoc | null;
  loading: boolean;
}

export function useUserPresence(userId: string | undefined | null): UseUserPresenceResult {
  const [raw, setRaw] = useState<UserPresenceDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(!!userId);

  useEffect(() => {
    if (!userId) {
      setRaw(null);
      setLoading(false);
      return;
    }

    const ref = doc(db, 'userPresence', userId);

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setRaw(null);
        } else {
          setRaw(snap.data() as UserPresenceDoc);
        }
        setLoading(false);
      },
      (error) => {
        console.error('useUserPresence error', error);
        setRaw(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const status = getEffectiveStatus(raw);
  const lastSeenAt = raw?.lastSeenAt?.toDate() ?? null;

  return { status, lastSeenAt, raw, loading };
}

