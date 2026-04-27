import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { PrescreenCategoryScoresV1 } from '../types/prescreenCategoryScores';
import { parseCategoryScoresCurrentFromUserDoc } from '../utils/parseRecruiterCategoryScores';

/**
 * Map of Firebase uid → parsed `users/{uid}.categoryScoresCurrent`, or `null` when missing/invalid.
 * Used by recruiter tables to avoid per-row Firestore listeners.
 */
export type CategoryScoresCurrentMap = Record<string, PrescreenCategoryScoresV1 | null>;

/** Max parallel getDoc calls per batch (client-side; keeps concurrency reasonable). */
const BATCH_SIZE = 30;

function stableSortedIdsKey(userIds: readonly string[]): string {
  const unique = Array.from(new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))).sort();
  return unique.join('|');
}

/**
 * One-time batched reads of user docs to read `categoryScoresCurrent` for many workers at once.
 * Re-fetches when the set of user ids changes (sorted key).
 */
export function useCategoryScoresCurrentMap(userIds: readonly string[]): {
  scoresByUserId: CategoryScoresCurrentMap;
  loading: boolean;
} {
  const idsKey = useMemo(() => stableSortedIdsKey(userIds), [userIds]);

  const uniqueIds = useMemo(() => (idsKey ? idsKey.split('|') : []), [idsKey]);

  const [scoresByUserId, setScoresByUserId] = useState<CategoryScoresCurrentMap>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (uniqueIds.length === 0) {
      setScoresByUserId({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const next: CategoryScoresCurrentMap = {};
        for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
          const chunk = uniqueIds.slice(i, i + BATCH_SIZE);
          const snaps = await Promise.all(chunk.map((uid) => getDoc(doc(db, 'users', uid))));
          if (cancelled) return;
          snaps.forEach((snap, j) => {
            const uid = chunk[j];
            next[uid] = snap.exists() ? parseCategoryScoresCurrentFromUserDoc(snap.data()) : null;
          });
        }
        if (!cancelled) {
          setScoresByUserId(next);
        }
      } catch (e) {
        console.warn('useCategoryScoresCurrentMap: batch fetch failed', e);
        if (!cancelled) {
          setScoresByUserId({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return { scoresByUserId, loading };
}
