/**
 * useHeartbeatPresence Hook
 * 
 * Writes user presence to Firestore on an interval.
 * Should be called once in a top-level component (e.g., App or Layout).
 */

import { useEffect, useRef } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const HEARTBEAT_INTERVAL_MS = 45_000; // 45 seconds

export function useHeartbeatPresence() {
  const { user } = useAuth(); // { uid, ... }
  const isWritingRef = useRef(false);
  const intervalIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    const userId = user.uid;
    const ref = doc(db, 'userPresence', userId);

    const writePresence = async (status: 'online' | 'idle' | 'offline') => {
      // Prevent concurrent writes
      if (isWritingRef.current) {
        return;
      }

      try {
        isWritingRef.current = true;
        await setDoc(
          ref,
          {
            status,
            lastSeenAt: serverTimestamp(),
            device: 'web',
            source: 'hrx',
          },
          { merge: true }
        );
      } catch (error: any) {
        // Silently handle Firestore internal errors - these are often transient
        // and don't affect user experience. Log only in development.
        if (process.env.NODE_ENV === 'development') {
          console.warn('[useHeartbeatPresence] Failed to write presence:', error?.code || error?.message);
        }
        // Don't throw - presence writes are best-effort
      } finally {
        // Use a small delay before allowing next write to prevent rapid retries
        setTimeout(() => {
          isWritingRef.current = false;
        }, 100);
      }
    };

    // Initial write as online (with delay to ensure Firestore is ready)
    const initialTimeout = setTimeout(() => {
      void writePresence('online');
    }, 1000);

    // Heartbeat
    intervalIdRef.current = window.setInterval(() => {
      void writePresence('online');
    }, HEARTBEAT_INTERVAL_MS);

    // Best-effort mark offline on unload
    const handleBeforeUnload = () => {
      // Navigator.sendBeacon or synchronous XHR are options;
      // but for simplicity we just fire and forget
      // Use synchronous flag to try to ensure it completes
      isWritingRef.current = false; // Reset flag for beforeunload
      void writePresence('offline');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalIdRef.current !== null) {
        window.clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // On route change/unmount we don't force offline, in case user opened another tab.
    };
  }, [user]);
}

