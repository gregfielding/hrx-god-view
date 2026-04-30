/**
 * RD.1 — batched best-effort user-doc fetch keyed off a uid set.
 *
 * Returns a `Map<uid, rawUserDoc>` populated by chunked Firestore reads
 * (`where(documentId(), 'in', […])` capped at 10 per chunk). Failures fall
 * back silently to a partial map — the consumer should always treat
 * missing entries as "not loaded yet" rather than "doesn't exist."
 *
 * **One-shot, not subscribed.** The CSA section tables drive their own
 * "fresh" snapshots from the source-of-truth collection (assignments /
 * tasks). When a worker doc changes, the surfacing event re-runs the
 * upstream snapshot, which in turn re-runs this fetch. A per-uid
 * `onSnapshot` would mean N subscriptions and resubscribe storms when
 * the universe rotates — same tradeoff documented in
 * `useCsaPendingOnboardingCallTasks.ts`.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../firebase';

const USER_BATCH_SIZE = 10;
const SEPARATOR = '\u001e';

export type UserDocsMap = ReadonlyMap<string, Record<string, unknown>>;

const useUserDocsByUids = (uids: ReadonlyArray<string>): { docs: UserDocsMap; loading: boolean } => {
  // Stable cache key so a re-rendered consumer with the same uids in a
  // different array reference doesn't trigger a re-fetch. Sorted + joined
  // so order doesn't matter to the consumer.
  const cacheKey = useMemo(
    () => Array.from(new Set(uids.filter(Boolean))).sort().join(SEPARATOR),
    [uids],
  );

  const [docs, setDocs] = useState<UserDocsMap>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cacheKey) {
      setDocs(new Map());
      setLoading(false);
      return;
    }

    const unique = cacheKey.split(SEPARATOR).filter(Boolean);
    let cancelled = false;
    setLoading(true);

    (async () => {
      const next = new Map<string, Record<string, unknown>>();
      try {
        for (let i = 0; i < unique.length; i += USER_BATCH_SIZE) {
          const chunk = unique.slice(i, i + USER_BATCH_SIZE);
          const snap = await getDocs(
            query(collection(db, 'users'), where(documentId(), 'in', chunk)),
          );
          for (const d of snap.docs) next.set(d.id, d.data() as Record<string, unknown>);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[useUserDocsByUids] fetch failed', e);
      }
      if (!cancelled) {
        setDocs(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  return { docs, loading };
};

export default useUserDocsByUids;
