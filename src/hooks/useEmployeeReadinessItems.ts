/**
 * Phase D — `useEmployeeReadinessItems`
 *
 * Real-time hook backing the Workforce > Employee Readiness queue.
 *
 * **Source-of-truth alignment:** Greg's 2026-04-25 directive on the D.1
 * promote PR was to lift the in-production `RecruiterMyQueue.tsx` data
 * fetcher rather than write a parallel one (spec §11: "Don't invent a new
 * readiness data shape"). This hook reuses the same `QueueRow` shape and
 * `normalizeEmployeeItem` helper that surface uses, so when the underlying
 * `EmployeeReadinessItem` schema changes we have one place to adapt.
 *
 * **What's different vs. RecruiterMyQueue's `loadQueue`:**
 *   - Subscribes via `onSnapshot` instead of a one-shot `getDocs` (spec §7
 *     "Real-time onSnapshot vs polling on the queue" — Greg locked
 *     onSnapshot). Filters re-run in memory on each snapshot, so chip
 *     toggles are instant without re-binding the subscription.
 *   - Drops the Pool / Visibility tier dimension entirely per the
 *     `pool_visibility = drop` answer to the D.1 questions. All / My is the
 *     primary scope; tier wasn't earning its complexity budget.
 *   - Reads from `employeeReadinessItems` only (assignment items are the
 *     Job Readiness tab's concern; D.4 will add a sibling hook so the two
 *     subscription lifecycles are independent).
 *
 * @see ../utils/readinessQueue/queueRow.ts for the row shape.
 * @see ../utils/readinessQueue/statusPriority.ts for sort + filter logic.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type QuerySnapshot,
} from 'firebase/firestore';

import { db } from '../firebase';
import type { EmployeeReadinessItem } from '../types/employeeReadinessItemV1';
import {
  ACTIVE_WORKFORCE_STATUSES,
  COMPLETE_WORKFORCE_STATUSES,
  compareReadinessRowsForQueue,
  expandStatusFilters,
  loadWorkerNames,
  normalizeEmployeeItem,
  type QueueRow,
  type WorkerNameMap,
  type WorkforceItemStatus,
  type WorkforceStatusFilterId,
} from '../utils/readinessQueue';

export interface UseEmployeeReadinessItemsOptions {
  /** Tenant scope. Pass `null` to short-circuit (returns empty + not loading). */
  tenantId: string | null;
  /** Current user's uid — required when `scope === 'mine'`. */
  currentUserUid: string | null;
  /** All / My toggle. */
  scope: 'all' | 'mine';
  /** Status chip ids (collapses to raw statuses internally). */
  statusFilters: ReadonlyArray<WorkforceStatusFilterId>;
  /** Show `complete_pass` / legacy `complete` rows too? */
  showComplete: boolean;
  /** `'all'` or a specific hiring entity id. */
  entityFilter: string | 'all';
  /** Search box value — filters worker name / uid / email / requirement label. */
  searchText: string;
}

export interface UseEmployeeReadinessItemsResult {
  /** Filtered + sorted rows ready for table render. */
  rows: QueueRow[];
  /** Unfiltered rows — for the entity dropdown's distinct-options pass. */
  allRows: QueueRow[];
  /** Worker uid → name/avatar lookup (best-effort). Includes recruiter
   *  uids for owner-avatar rendering on the All scope. */
  nameMap: WorkerNameMap;
  /** True until the first snapshot resolves. */
  loading: boolean;
  error: string | null;
  /**
   * Force-refetch the worker / owner name map (e.g. after a profile edit
   * elsewhere). The Firestore subscription itself is always live — no need
   * to refetch it.
   */
  refetchNames: () => void;
}

/**
 * Set of statuses the queue actually subscribes to client-side. The
 * `complete` toggle widens this; everything else stays in-memory because
 * the universe is small enough for client filtering to be cheaper than
 * re-subscribing on every chip click.
 */
function statusUniverse(showComplete: boolean): Set<WorkforceItemStatus> {
  const all = new Set<WorkforceItemStatus>(ACTIVE_WORKFORCE_STATUSES);
  if (showComplete) {
    for (const s of COMPLETE_WORKFORCE_STATUSES) all.add(s);
  }
  return all;
}

const useEmployeeReadinessItems = (
  options: UseEmployeeReadinessItemsOptions,
): UseEmployeeReadinessItemsResult => {
  const {
    tenantId,
    currentUserUid,
    scope,
    statusFilters,
    showComplete,
    entityFilter,
    searchText,
  } = options;

  const [allRows, setAllRows] = useState<QueueRow[]>([]);
  const [nameMap, setNameMap] = useState<WorkerNameMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [namesRefetchToken, setNamesRefetchToken] = useState(0);

  // -------- Firestore subscription --------
  useEffect(() => {
    if (!tenantId) {
      setAllRows([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = collection(db, 'tenants', tenantId, 'employeeReadinessItems');
    // Server filter is intentionally narrow:
    //   - `scope === 'mine'` → primary recruiter equality (cheap index hit)
    //   - `scope === 'all'`  → whole tenant collection
    // Status / entity / search are applied in memory so chip toggling
    // doesn't re-subscribe.
    //
    // Index requirement (firestore.indexes.json):
    //   collection: employeeReadinessItems
    //   fields: ownership.primaryRecruiterId ASC, status ASC, updatedAt DESC
    //   (only needed once we add server-side status / orderBy in D.3+; the
    //   single-equality query above doesn't strictly require a composite
    //   index, but the index is pre-staged so D.3 doesn't add a deploy
    //   prereq.)
    const subscriptionQuery =
      scope === 'mine' && currentUserUid
        ? query(ref, where('ownership.primaryRecruiterId', '==', currentUserUid))
        : query(ref);

    const unsub = onSnapshot(
      subscriptionQuery,
      (snap: QuerySnapshot) => {
        const next: QueueRow[] = snap.docs.map((d) =>
          normalizeEmployeeItem(d.id, d.data() as EmployeeReadinessItem),
        );
        setAllRows(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        // Common failure mode in dev: composite index missing. Surface the
        // raw message so the recruiter sees the firebase console URL.
        // eslint-disable-next-line no-console
        console.error('[useEmployeeReadinessItems] snapshot error', err);
        setError(err.message || 'Failed to subscribe to readiness items.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [tenantId, scope, currentUserUid]);

  // -------- Worker + owner name denorm (best-effort batched fetch) --------
  // We fetch BOTH worker uids and primary-recruiter uids in one pass so the
  // Owner column on the All-scope view doesn't need a second hop.
  useEffect(() => {
    if (allRows.length === 0) {
      setNameMap(new Map());
      return;
    }
    const uids = new Set<string>();
    for (const row of allRows) {
      if (row.workerUid) uids.add(row.workerUid);
      if (row.primaryRecruiterId) uids.add(row.primaryRecruiterId);
    }
    let cancelled = false;
    loadWorkerNames(db, Array.from(uids))
      .then((map) => {
        if (!cancelled) setNameMap(map);
      })
      .catch(() => {
        if (!cancelled) setNameMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [allRows, namesRefetchToken]);

  const refetchNames = useCallback(() => {
    setNamesRefetchToken((t) => t + 1);
  }, []);

  // -------- In-memory filter + sort --------
  const rows = useMemo(() => {
    if (allRows.length === 0) return [];
    const universe = statusUniverse(showComplete);
    const requestedRaw =
      statusFilters.length === 0
        ? universe
        : (() => {
            const expanded = expandStatusFilters(statusFilters);
            // Intersect with the universe so toggling "Show complete" off
            // while a stale "complete" filter chip is selected doesn't
            // smuggle complete rows back in.
            const out = new Set<WorkforceItemStatus>();
            for (const s of expanded) {
              if (universe.has(s)) out.add(s);
            }
            return out;
          })();

    const search = searchText.trim().toLowerCase();

    const filtered = allRows.filter((row) => {
      if (!requestedRaw.has(row.status)) return false;
      if (entityFilter !== 'all' && row.hiringEntityId !== entityFilter) return false;
      if (search) {
        const profile = nameMap.get(row.workerUid);
        const haystack = [
          profile?.name,
          row.workerUid,
          row.requirementLabel,
          row.hiringEntityName,
        ]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    // Annotate each row with denorm display info for downstream consumers.
    // Done after filter so we don't mutate rows we're about to drop.
    const annotated = filtered.map((row) => {
      const worker = nameMap.get(row.workerUid);
      const owner = row.primaryRecruiterId ? nameMap.get(row.primaryRecruiterId) : undefined;
      return {
        ...row,
        workerName: worker?.name,
        workerAvatar: worker?.avatar,
        ownerName: owner?.name,
        ownerAvatar: owner?.avatar,
      };
    });

    annotated.sort(compareReadinessRowsForQueue);
    return annotated;
  }, [allRows, statusFilters, showComplete, entityFilter, searchText, nameMap]);

  return {
    rows,
    allRows,
    nameMap,
    loading,
    error,
    refetchNames,
  };
};

export default useEmployeeReadinessItems;
