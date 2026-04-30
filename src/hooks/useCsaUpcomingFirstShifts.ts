/**
 * RD.1 — Section 1 hook: workers starting their first shift in the next 72h.
 *
 * **v1 simplification (intentional, documented in the spec):**
 * The "isFirstShiftForWorker" derivation requires reading every worker's
 * historical assignments, which is O(workers × assignments) and would slow
 * the page noticeably. v1 ships the simpler "all upcoming confirmed shifts
 * in the next 72h" query and leaves the first-shift filter as a TODO. When
 * the AI cadence/engagement signals land (which is also when the row-color
 * "show-up likelihood" predictor lands), the same hook will get a derived
 * flag without changing the consumer.
 *
 * **Subscription shape:** equality filter on `status == 'confirmed'`. The
 * date window is applied in memory because:
 *   - `startDate` is a denormalized string (ISO) on most assignment docs
 *     and a Timestamp on a smaller subset (the schema is mid-migration —
 *     see ASSIGNMENTS_REQUIREMENTS_AND_IMPLEMENTATION.md). A composite index
 *     range query would only catch one of the two shapes.
 *   - The "next 72h confirmed shifts" universe is small per tenant (low
 *     hundreds at most), so client-side filtering is cheap.
 *
 * **My/All filter:** intersection with `myWorkerUids` (when non-null) is
 * applied after the date window narrows the row count. Saves the cost of
 * comparing every confirmed assignment against the CSA's worker set.
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

export interface UseCsaUpcomingFirstShiftsOptions {
  tenantId: string | null;
  /** Set returned by `useMyWorkerUids`. `null` = scope === 'all', skip filter. */
  myWorkerUids: ReadonlySet<string> | null;
  /** Lookahead window in milliseconds. Defaults to 72h per spec §3 §1. */
  windowMs?: number;
}

export interface UseCsaUpcomingFirstShiftsResult {
  rows: CsaAssignmentRow[];
  loading: boolean;
  error: string | null;
}

const DEFAULT_WINDOW_MS = 72 * 60 * 60 * 1000;

const useCsaUpcomingFirstShifts = ({
  tenantId,
  myWorkerUids,
  windowMs = DEFAULT_WINDOW_MS,
}: UseCsaUpcomingFirstShiftsOptions): UseCsaUpcomingFirstShiftsResult => {
  const [allConfirmed, setAllConfirmed] = useState<CsaAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setAllConfirmed([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = collection(db, 'tenants', tenantId, 'assignments');
    // 'confirmed' is the canonical pre-shift status; some legacy rows may
    // still be 'active' before clock-in. We keep the query narrow to
    // 'confirmed' to match the spec and avoid mixing in already-running
    // shifts (those belong on the Job Readiness page, not here).
    const q = query(ref, where('status', '==', 'confirmed'));

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot) => {
        const next: CsaAssignmentRow[] = [];
        for (const d of snap.docs) {
          const row = normalizeAssignmentRow(d.id, d.data() as Record<string, unknown>);
          if (row) next.push(row);
        }
        setAllConfirmed(next);
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[useCsaUpcomingFirstShifts] snapshot error', err);
        setError(err.message || 'Failed to load upcoming shifts.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [tenantId]);

  const rows = useMemo(() => {
    // Recompute `now` per snapshot rather than every render; otherwise we'd
    // re-run the filter on every parent re-render with a slightly different
    // window edge. `allConfirmed` changing is the only meaningful trigger.
    const now = Date.now();
    const windowed = filterAssignmentsByDateWindow(allConfirmed, {
      kind: 'startsBetween',
      fromMs: now,
      toMs: now + windowMs,
    });
    const scoped = filterAssignmentsByWorkerSet(windowed, myWorkerUids);
    // Earliest first — most-imminent shift is the most actionable.
    return scoped.slice().sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  }, [allConfirmed, myWorkerUids, windowMs]);

  return { rows, loading, error };
};

export default useCsaUpcomingFirstShifts;
