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
const MIN_WRITE_INTERVAL_MS = 5000; // Minimum 5 seconds between writes
const INITIAL_DELAY_MS = 3000; // 3 seconds initial delay to ensure Firestore is ready

export function useHeartbeatPresence() {
  const { user } = useAuth(); // { uid, ... }
  const isWritingRef = useRef(false);
  const lastWriteTimeRef = useRef<number>(0);
  const intervalIdRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    const userId = user.uid;
    const ref = doc(db, 'userPresence', userId);

    const writePresence = async (status: 'online' | 'idle' | 'offline', force = false) => {
      const now = Date.now();
      
      // Throttle writes - ensure minimum interval between writes
      if (!force && (isWritingRef.current || (now - lastWriteTimeRef.current) < MIN_WRITE_INTERVAL_MS)) {
        // Queue the write if we're throttling
        if (!isWritingRef.current) {
          pendingWriteRef.current = () => writePresence(status, false);
        }
        return;
      }

      // Prevent concurrent writes
      if (isWritingRef.current) {
        return;
      }

      try {
        isWritingRef.current = true;
        lastWriteTimeRef.current = now;
        
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
        
        // Clear any pending write since we just wrote
        pendingWriteRef.current = null;
      } catch (error: any) {
        // Silently handle Firestore internal errors - these are often transient
        // and don't affect user experience. Specifically catch internal assertion errors.
        const errorMessage = error?.message || '';
        const isInternalError = 
          errorMessage.includes('INTERNAL ASSERTION FAILED') ||
          errorMessage.includes('Unexpected state') ||
          error?.code === 'internal' ||
          error?.code === 'unknown';
        
        if (process.env.NODE_ENV === 'development' && !isInternalError) {
          console.warn('[useHeartbeatPresence] Failed to write presence:', error?.code || error?.message);
        }
        // Don't throw - presence writes are best-effort
        // Internal assertion errors are SDK bugs and should be silently ignored
      } finally {
        // Use a delay before allowing next write to prevent rapid retries
        setTimeout(() => {
          isWritingRef.current = false;
          
          // Execute any pending write after the delay
          if (pendingWriteRef.current) {
            const pending = pendingWriteRef.current;
            pendingWriteRef.current = null;
            setTimeout(() => {
              void pending();
            }, MIN_WRITE_INTERVAL_MS);
          }
        }, 200);
      }
    };

    // Initial write as online (with longer delay to ensure Firestore is fully ready)
    const initialTimeout = setTimeout(() => {
      void writePresence('online', true); // Force initial write
    }, INITIAL_DELAY_MS);

    // Heartbeat
    intervalIdRef.current = window.setInterval(() => {
      void writePresence('online', false);
    }, HEARTBEAT_INTERVAL_MS);

    // Best-effort mark offline on unload
    const handleBeforeUnload = () => {
      // Reset flags for beforeunload to allow final write
      isWritingRef.current = false;
      lastWriteTimeRef.current = 0;
      void writePresence('offline', true); // Force offline write
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalIdRef.current !== null) {
        window.clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Clear pending writes on cleanup
      pendingWriteRef.current = null;
      // On route change/unmount we don't force offline, in case user opened another tab.
    };
  }, [user]);
}

