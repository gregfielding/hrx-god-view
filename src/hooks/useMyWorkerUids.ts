/**
 * RD.1 — derive the set of worker uids whose CSA is the current user.
 *
 * The CSA scalar lives at `users/{uid}.primaryRecruiterId` per
 * `docs/RECRUITING_ROLE_MODEL.md` §4.5 (the field name predates the role
 * rename; under the new model it semantically narrows to "Candidate
 * Success Agent").
 *
 * **Why a hook returning `Set | null` instead of just always returning a
 * Set:** the consumer pages need a way to distinguish "scope = mine, no
 * matches" (Set with 0 entries → render empty state) from "scope = all,
 * skip this filter entirely" (null → don't intersect at all). A nullable
 * Set conveys both with one return value.
 *
 * **Why no tenantId filter:** the CSA → workers relationship is one-to-many
 * within a single tenant in practice; CSAs working across tenants are an
 * edge case. The downstream queries (assignments / entity_employments) are
 * already tenant-scoped, so the intersection narrows correctly without
 * needing to query workers per-tenant.
 *
 * @returns `null` when scope is 'all' (no filter to apply), or a `Set<uid>`
 *          when scope is 'mine'. The set is empty until the snapshot
 *          resolves; consumers should treat the `loading` flag as a
 *          separate signal.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, type QuerySnapshot } from 'firebase/firestore';

import { db } from '../firebase';

export interface UseMyWorkerUidsOptions {
  /** Current user's uid — required when `scope === 'mine'`. */
  currentUserUid: string | null;
  /** Active scope toggle from the page-level My/All control. */
  scope: 'mine' | 'all';
}

export interface UseMyWorkerUidsResult {
  /** Set of worker uids the current user is the CSA for, or `null` when */
  /** scope === 'all' so consumers know to skip the filter entirely. */
  myWorkerUids: ReadonlySet<string> | null;
  /** True until the first snapshot resolves (only meaningful for 'mine'). */
  loading: boolean;
  error: string | null;
}

const useMyWorkerUids = ({
  currentUserUid,
  scope,
}: UseMyWorkerUidsOptions): UseMyWorkerUidsResult => {
  const [uids, setUids] = useState<ReadonlySet<string> | null>(null);
  const [loading, setLoading] = useState(scope === 'mine');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scope !== 'mine' || !currentUserUid) {
      // 'all' → null so callers know to skip the intersection entirely.
      // No-uid 'mine' → empty set (no workers can be matched to a missing
      // CSA), still null-checked at the call site.
      setUids(scope === 'mine' ? new Set<string>() : null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    // Live subscription: if a CSA is reassigned to a worker mid-session
    // (admin edits the user-group roster), the page picks it up without a
    // refresh. The query is a single-equality filter — no composite index
    // required.
    const ref = collection(db, 'users');
    const q = query(ref, where('primaryRecruiterId', '==', currentUserUid));

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot) => {
        const next = new Set<string>();
        for (const d of snap.docs) next.add(d.id);
        setUids(next);
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[useMyWorkerUids] snapshot error', err);
        setError(err.message || 'Failed to load my workers.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [scope, currentUserUid]);

  return useMemo(
    () => ({ myWorkerUids: uids, loading, error }),
    [uids, loading, error],
  );
};

export default useMyWorkerUids;
