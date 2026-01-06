/**
 * useHeartbeatPresence Hook
 * 
 * Writes user presence to Firestore on an interval.
 * Should be called once in a top-level component (e.g., App or Layout).
 */

import { useEffect } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const HEARTBEAT_INTERVAL_MS = 45_000; // 45 seconds

export function useHeartbeatPresence() {
  const { user } = useAuth(); // { uid, ... }

  useEffect(() => {
    if (!user?.uid) return;

    const userId = user.uid;
    const ref = doc(db, 'userPresence', userId);

    const writePresence = (status: 'online' | 'idle' | 'offline') => {
      return setDoc(
        ref,
        {
          status,
          lastSeenAt: serverTimestamp(),
          device: 'web',
          source: 'hrx',
        },
        { merge: true }
      );
    };

    // Initial write as online
    void writePresence('online');

    // Heartbeat
    const intervalId = window.setInterval(() => {
      void writePresence('online');
    }, HEARTBEAT_INTERVAL_MS);

    // Best-effort mark offline on unload
    const handleBeforeUnload = () => {
      // Navigator.sendBeacon or synchronous XHR are options;
      // but for simplicity we just fire and forget
      void writePresence('offline');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // On route change/unmount we don't force offline, in case user opened another tab.
    };
  }, [user]);
}

