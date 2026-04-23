/**
 * Subscribe to `users/{userId}.avatarVerification` and return the latest record plus a
 * small amount of derived UI state.
 *
 * The verification record is written by the `onUserAvatarChangedVerify` Cloud Function
 * whenever the avatar URL on the user doc changes. Callers typically:
 *   1. Upload a new image to Firebase Storage.
 *   2. Write `users/{uid}.avatar = downloadURL`.
 *   3. Use this hook to render pending/approved/rejected feedback against the upload.
 *
 * See `functions/src/avatar/avatarVerificationTrigger.ts` for the write path.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '../firebase';
import type {
  AvatarVerification,
  AvatarVerificationStatus,
} from '../types/avatarVerification';

export interface UseAvatarVerificationResult {
  /** The full verification record from Firestore, or null if none exists yet. */
  verification: AvatarVerification | null;
  /** Convenience accessor; 'pending' until the trigger has written anything. */
  status: AvatarVerificationStatus | null;
  /** True until the first snapshot has returned (even if the doc is missing). */
  loading: boolean;
  /** True when the current avatar on the user doc is in the "being checked" state. */
  isPending: boolean;
  /** True when the verification record was produced for a DIFFERENT avatar URL than the one now on the user doc. Useful while a new upload is propagating. */
  isStale: boolean;
  /** The avatar URL currently persisted on the user doc (for staleness comparison). */
  currentAvatarUrl: string | null;
}

/**
 * @param userId - the UID to subscribe to. If null/undefined, the hook returns inert state
 *                 (no listener is registered). This lets callers render before auth is ready.
 */
export function useAvatarVerification(userId: string | null | undefined): UseAvatarVerificationResult {
  const [verification, setVerification] = useState<AvatarVerification | null>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(userId));

  useEffect(() => {
    if (!userId) {
      setVerification(null);
      setCurrentAvatarUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'users', userId),
      (snap) => {
        const data = snap.data() as { avatar?: string; avatarVerification?: AvatarVerification } | undefined;
        setVerification((data?.avatarVerification as AvatarVerification) ?? null);
        setCurrentAvatarUrl(typeof data?.avatar === 'string' ? data!.avatar : null);
        setLoading(false);
      },
      (err) => {
        // Permission denied / offline / etc. Treat as no record rather than blowing up the UI.
        console.warn('useAvatarVerification: snapshot error', err);
        setVerification(null);
        setCurrentAvatarUrl(null);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [userId]);

  const status = verification?.status ?? null;
  // If the user just replaced their avatar the trigger immediately writes status='pending'
  // with the new URL as sourceAvatarUrl. If we see a verification but it's for a different
  // URL, render "rechecking" UI rather than showing stale approved/rejected copy.
  const isStale = Boolean(
    verification &&
      currentAvatarUrl &&
      verification.sourceAvatarUrl &&
      verification.sourceAvatarUrl !== currentAvatarUrl,
  );
  const isPending = status === 'pending' || (isStale && Boolean(currentAvatarUrl));

  return {
    verification,
    status,
    loading,
    isPending,
    isStale,
    currentAvatarUrl,
  };
}
