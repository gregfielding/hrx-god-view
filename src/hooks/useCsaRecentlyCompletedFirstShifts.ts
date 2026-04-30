/**
 * RD.1 — Section 2 hook: workers who just finished their first shift.
 *
 * Same v1 simplification as `useCsaUpcomingFirstShifts`: the
 * "first ever completed shift" derivation is deferred. v1 surfaces all
 * completions in the last 7 days; when AI signals land, the hook narrows
 * to true first-shifts without changing the consumer contract.
 *
 * **Subscription shape:** equality filter on `status == 'completed'`. The
 * data model also uses `'ended'` as a terminal status for shifts that
 * finished early or were closed by the recruiter; we include both to avoid
 * silently dropping rows. The date window then narrows to the last 7 days.
 *
 * **`endMs` vs `startMs`:** sorted descending by `endMs` (most-recently-
 * finished first) when present, falling back to `startMs` for legacy rows
 * that never got an `endDate` denormalized.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type QuerySnapshot,
} from 'firebase/firestore';

import { db } from '../firebase';
import {
  filterAssignmentsByDateWindow,
  filterAssignmentsByWorkerSet,
  normalizeAssignmentRow,
  type CsaAssignmentRow,
} from './internal/csaAssignmentRows';

export interface UseCsaRecentlyCompletedFirstShiftsOptions {
  tenantId: string | null;
  myWorkerUids: ReadonlySet<string> | null;
  /** Lookback window in milliseconds. Defaults to 7 days per spec §3 §2. */
  windowMs?: number;
}

export interface UseCsaRecentlyCompletedFirstShiftsResult {
  rows: CsaAssignmentRow[];
  loading: boolean;
  error: string | null;
}

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Status values that count as a "completed shift" for this section. The
 * spec talks about "completed" colloquially; the schema actually splits
 * into 'completed' (worker clocked out happy) and 'ended' (closed by the
 * recruiter, possibly mid-shift). Both belong on this page since either
 * means a worker just finished a touchpoint we want the CSA to follow up on.
 */
const TERMINAL_COMPLETED_STATUSES = ['completed', 'ended'] as const;

const useCsaRecentlyCompletedFirstShifts = ({
  tenantId,
  myWorkerUids,
  windowMs = DEFAULT_WINDOW_MS,
}: UseCsaRecentlyCompletedFirstShiftsOptions): UseCsaRecentlyCompletedFirstShiftsResult => {
  const [allCompleted, setAllCompleted] = useState<CsaAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setAllCompleted([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = collection(db, 'tenants', tenantId, 'assignments');
    // `where('status', 'in', [...])` requires a single composite index;
    // since both statuses already exist on the collection it's a cheap
    // index hit. (Alternative: two separate listeners. Single listener
    // with `in` keeps the loading flag honest.)
    const q = query(
      ref,
      where('status', 'in', [...TERMINAL_COMPLETED_STATUSES]),
    );

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot) => {
        const next: CsaAssignmentRow[] = [];
        for (const d of snap.docs) {
          const row = normalizeAssignmentRow(d.id, d.data() as Record<string, unknown>);
          if (row) next.push(row);
        }
        setAllCompleted(next);
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[useCsaRecentlyCompletedFirstShifts] snapshot error', err);
        setError(err.message || 'Failed to load recent shifts.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [tenantId]);

  const rows = useMemo(() => {
    const now = Date.now();
    const windowed = filterAssignmentsByDateWindow(allCompleted, {
      kind: 'endsBetween',
      fromMs: now - windowMs,
      toMs: now,
    });
    const scoped = filterAssignmentsByWorkerSet(windowed, myWorkerUids);
    // Most-recently-finished first; fall back to startMs for legacy rows
    // missing endDate. Negative coalesce keeps undefined rows at the bottom.
    return scoped.slice().sort((a, b) => {
      const aEnd = a.endMs ?? a.startMs ?? 0;
      const bEnd = b.endMs ?? b.startMs ?? 0;
      return bEnd - aEnd;
    });
  }, [allCompleted, myWorkerUids, windowMs]);

  return { rows, loading, error };
};

export default useCsaRecentlyCompletedFirstShifts;
