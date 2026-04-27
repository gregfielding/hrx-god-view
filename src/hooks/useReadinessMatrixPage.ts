/**
 * **R.8** — Data hook for the CSA cross-worker readiness matrix view.
 *
 * Owns three concerns:
 *
 *   1. **Row universe.** Subscribes (via `useEmployeeReadinessItems`) to the
 *      tenant's `employeeReadinessItems` collection under the current
 *      workforce scope, groups by `(workerUid, hiringEntityId)`, and exposes
 *      the resulting `WorkerGroup[]` as the matrix's row universe — same
 *      universe the list view uses, so toggling List/Matrix never reveals
 *      different workers (locked by D1.R8 ‑ matrix is a secondary view, not
 *      a different scope).
 *
 *   2. **Page state.** Page index + page size, with stable client-side
 *      sorting (lastUpdatedAt desc). The matrix renders ≤50 row groups per
 *      page (D3.R8) — bigger pages are a memory-grenade UX even though
 *      Firestore can handle them.
 *
 *   3. **Per-page item fetch.** When the visible page changes, runs two
 *      `getDocs` queries (NOT `onSnapshot` — D3.R8 explicit lock):
 *
 *        a. `assignments where userId in [batch ≤30]` (and `candidateId`
 *           fallback) — projects `(assignmentId, hiringEntityId)` so we
 *           can correctly partition assignment items into per-entity rows.
 *           Workers occasionally span multiple entities; the matrix
 *           authoritatively places each item under the correct row.
 *        b. `assignmentReadinessItems where workerUid in [batch ≤30]` —
 *           one batched read per ≤30 workers. Items are partitioned by
 *           hiringEntityId via the map from (a).
 *
 *      The employee items are already loaded by the universe subscription
 *      (no extra read). They're filtered down to per-(worker × entity) at
 *      compose time.
 *
 * **Refresh semantics:**
 *   - `refresh()` re-runs the per-page fetch for the current page. The
 *     universe subscription is live so `employeeReadinessItems` are always
 *     fresh — the assignment-side data is what `refresh()` re-pulls.
 *   - `invalidateRows(keys)` re-fetches the assignment side for ONLY those
 *     row keys. Used by the bulk-action machine after a fan-out completes
 *     so we don't blow away the whole page just because 5 cells changed.
 *
 * **No `onSnapshot` per cell**, ever. The matrix is intentionally not live
 * for the assignment side — a refresh button is the contract (D3.R8).
 *
 * @see ./useEmployeeReadinessItems.ts (universe subscription)
 * @see ../utils/readinessQueue/groupByWorkerEntity.ts (grouping)
 * @see ../utils/readinessMatrix/aggregateByCategory.ts (per-cell aggregator)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore';

import { db } from '../firebase';
import useEmployeeReadinessItems from './useEmployeeReadinessItems';
import {
  groupByWorkerEntity,
  type WorkerGroup,
} from '../utils/readinessQueue';
import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from '../shared/employeeReadinessItemV1';

/** Default page size — matches D3.R8 cap. */
export const READINESS_MATRIX_DEFAULT_PAGE_SIZE = 50;

/** Firestore `in` operator cap. */
const FIRESTORE_IN_BATCH = 30;

export type ReadinessMatrixScope = 'all' | 'mine';

export interface UseReadinessMatrixPageArgs {
  tenantId: string | null;
  currentUserUid: string | null;
  scope: ReadinessMatrixScope;
  pageSize?: number;
}

/**
 * One matrix row — one (worker × hiringEntity) bundle ready for cell render.
 */
export interface MatrixPageRow {
  /** Stable key — `${workerUid}__${hiringEntityId}`. */
  key: string;
  workerUid: string;
  workerName: string;
  workerAvatar?: string;
  hiringEntityId: string;
  hiringEntityName: string;
  /** Resolved worker primary recruiter. Drives the per-tenant role check. */
  primaryRecruiterId: string | null;
  ownerName?: string;
  ownerAvatar?: string;
  lastUpdatedAtMs: number;
  /**
   * Distinct job order ids referenced by this row's assignments. Used by
   * the JO filter (D7.R8 client-side post-page filter) and surfaced on the
   * row's hover meta (e.g. "+2 JOs").
   */
  jobOrderIds: ReadonlyArray<string>;
  /**
   * Worksite ids referenced by this row's assignments — same use as
   * `jobOrderIds` but for the worksite filter.
   */
  worksiteIds: ReadonlyArray<string>;
  /** Per-shift items for THIS (worker × entity) bundle. */
  assignmentItems: ReadonlyArray<AssignmentReadinessItem>;
  /** Employee-side items for this (workerUid × hiringEntityId) bundle. */
  employeeItems: ReadonlyArray<EmployeeReadinessItem>;
  /**
   * `true` once the per-page assignment-side fetch has resolved for this
   * row's worker. Distinguishes "no items, fetch finished" from "still
   * fetching, no items YET". The matrix renders a skeleton-ish row in the
   * latter case and "—" cells in the former.
   */
  itemsLoaded: boolean;
}

export interface UseReadinessMatrixPageResult {
  /** All groups in the universe — used for total-count, filters, pagination. */
  allGroups: ReadonlyArray<WorkerGroup>;
  /** Groups visible on the current page, with assignment items attached. */
  visibleRows: ReadonlyArray<MatrixPageRow>;
  page: number;
  setPage: (next: number) => void;
  pageSize: number;
  setPageSize: (next: number) => void;
  /** Universe-loading flag (initial subscription has not resolved). */
  universeLoading: boolean;
  /** Per-page assignment-fetch loading flag. */
  itemsLoading: boolean;
  error: string | null;
  /** Re-fetch assignment items for the current page. Universe is always live. */
  refresh: () => void;
  /**
   * Re-fetch assignment items for a targeted subset of row keys (formatted
   * as `${workerUid}__${hiringEntityId}`). Used after CSA actions complete
   * so we update the affected rows without rebuilding the whole page.
   */
  invalidateRows: (keys: ReadonlyArray<string>) => Promise<void>;
}

interface AssignmentEntityRef {
  assignmentId: string;
  workerUid: string;
  hiringEntityId: string;
  jobOrderId: string | null;
  worksiteId: string | null;
}

/**
 * Fetch the (assignmentId → hiringEntityId, jobOrderId, worksiteId) map for a
 * batch of workers. We need `hiringEntityId` to partition items into the
 * correct (worker × entity) row — `AssignmentReadinessItem` doesn't carry
 * the field. `jobOrderId` and `worksiteId` are lifted at the same time so
 * the matrix's filter bar can read them straight off the row without a
 * second hop.
 *
 * Workers can use either `userId` or `candidateId` on the assignment doc
 * (legacy split). We query both with two batched reads per worker batch.
 */
async function fetchAssignmentEntityRefs(
  tenantId: string,
  workerUids: ReadonlyArray<string>,
): Promise<AssignmentEntityRef[]> {
  if (workerUids.length === 0) return [];
  const refs: AssignmentEntityRef[] = [];
  const seen = new Set<string>();

  const batches: string[][] = [];
  for (let i = 0; i < workerUids.length; i += FIRESTORE_IN_BATCH) {
    batches.push([...workerUids.slice(i, i + FIRESTORE_IN_BATCH)]);
  }

  // Both `userId` and `candidateId` paths in parallel for each batch.
  // (Loader uses `userId || candidateId` per
  // `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`.)
  const reads: Promise<void>[] = [];
  for (const batch of batches) {
    for (const fieldName of ['userId', 'candidateId'] as const) {
      reads.push(
        (async () => {
          const q = query(
            collection(db, 'tenants', tenantId, 'assignments'),
            where(fieldName, 'in', batch),
          );
          const snap = await getDocs(q);
          snap.docs.forEach((d) => {
            if (seen.has(d.id)) return;
            const data = d.data() as DocumentData;
            const workerUid = String(data.userId || data.candidateId || '').trim();
            const hiringEntityId = data.hiringEntityId
              ? String(data.hiringEntityId)
              : '';
            if (!workerUid || !hiringEntityId) return;
            seen.add(d.id);
            refs.push({
              assignmentId: d.id,
              workerUid,
              hiringEntityId,
              jobOrderId: data.jobOrderId
                ? String(data.jobOrderId)
                : data.recruiterJobOrderId
                  ? String(data.recruiterJobOrderId)
                  : null,
              worksiteId: data.worksiteId ? String(data.worksiteId) : null,
            });
          });
        })(),
      );
    }
  }
  await Promise.all(reads);
  return refs;
}

/**
 * Fetch the assignment-side readiness items for a batch of workers.
 * Single Firestore field path (`workerUid in [...]`); the items collection
 * already has `workerUid` denormalized so this is a cheap batched read.
 */
async function fetchAssignmentReadinessItemsForWorkers(
  tenantId: string,
  workerUids: ReadonlyArray<string>,
): Promise<AssignmentReadinessItem[]> {
  if (workerUids.length === 0) return [];
  const out: AssignmentReadinessItem[] = [];
  const reads: Promise<void>[] = [];
  for (let i = 0; i < workerUids.length; i += FIRESTORE_IN_BATCH) {
    const batch = workerUids.slice(i, i + FIRESTORE_IN_BATCH);
    reads.push(
      (async () => {
        const q = query(
          collection(db, 'tenants', tenantId, 'assignmentReadinessItems'),
          where('workerUid', 'in', [...batch]),
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => {
          out.push({
            id: d.id,
            ...(d.data() as Omit<AssignmentReadinessItem, 'id'>),
          });
        });
      })(),
    );
  }
  await Promise.all(reads);
  return out;
}

/** Stable row key — must match `groupByWorkerEntity` so cross-references work. */
function buildRowKey(workerUid: string, hiringEntityId: string): string {
  return `${workerUid}__${hiringEntityId}`;
}

const useReadinessMatrixPage = (
  args: UseReadinessMatrixPageArgs,
): UseReadinessMatrixPageResult => {
  const {
    tenantId,
    currentUserUid,
    scope,
    pageSize: initialPageSize = READINESS_MATRIX_DEFAULT_PAGE_SIZE,
  } = args;

  // 1. Universe — reuse the list-view subscription so list ↔ matrix
  // toggling shows identical workers. We bypass the in-hook chip / entity
  // / search filters by passing wide-open values; matrix filtering happens
  // post-page, client-side (D7.R8).
  const {
    allRows: universeQueueRows,
    nameMap,
    loading: universeLoading,
    error: universeError,
  } = useEmployeeReadinessItems({
    tenantId,
    currentUserUid,
    scope,
    statusFilters: [],
    showComplete: true,
    entityFilter: 'all',
    searchText: '',
  });

  const allGroups = useMemo(
    () => groupByWorkerEntity(universeQueueRows, nameMap),
    [universeQueueRows, nameMap],
  );

  // 2. Page state.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const totalGroups = allGroups.length;
  // Guard against the universe shrinking out from under us (e.g. after a
  // bulk-confirm + rescope) — clamp the page index so we never render an
  // empty page when there's data on page 0.
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(totalGroups / pageSize) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, pageSize, totalGroups]);

  const visibleGroups = useMemo(() => {
    const start = page * pageSize;
    return allGroups.slice(start, start + pageSize);
  }, [allGroups, page, pageSize]);

  // 3. Per-page assignment item fetch. Two parallel reads:
  //   a. assignments under the visible workers (for the assignmentId →
  //      hiringEntityId map)
  //   b. assignmentReadinessItems for the visible workers
  //
  // The fetch is keyed by `[tenantId, visibleWorkerUidsKey, refreshToken]`.
  // Targeted invalidations bump `refreshToken`. Re-renders that don't
  // change the visible worker set don't re-fire the fetch.
  const [assignmentRefs, setAssignmentRefs] = useState<AssignmentEntityRef[]>(
    [],
  );
  const [assignmentItems, setAssignmentItems] = useState<
    ReadonlyArray<AssignmentReadinessItem>
  >([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Stable string key from the visible worker uids so the effect doesn't
  // re-fire on identical-but-new array references (e.g. when the universe
  // re-emits without changing the visible page).
  const visibleWorkerUidsKey = useMemo(() => {
    const set = new Set<string>();
    for (const g of visibleGroups) set.add(g.workerUid);
    return Array.from(set).sort().join('|');
  }, [visibleGroups]);

  // Race-guard ref — discard stale fetches when the visible page changes
  // mid-flight.
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (!tenantId || visibleGroups.length === 0) {
      setAssignmentRefs([]);
      setAssignmentItems([]);
      setItemsLoaded(true);
      setItemsLoading(false);
      setItemsError(null);
      return;
    }
    const mySeq = ++fetchSeqRef.current;
    setItemsLoading(true);
    setItemsError(null);
    setItemsLoaded(false);

    const workerUids = Array.from(
      new Set(visibleGroups.map((g) => g.workerUid)),
    );

    Promise.all([
      fetchAssignmentEntityRefs(tenantId, workerUids),
      fetchAssignmentReadinessItemsForWorkers(tenantId, workerUids),
    ])
      .then(([refs, items]) => {
        if (mySeq !== fetchSeqRef.current) return;
        setAssignmentRefs(refs);
        setAssignmentItems(items);
        setItemsLoaded(true);
        setItemsLoading(false);
      })
      .catch((err) => {
        if (mySeq !== fetchSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setItemsError(msg);
        setItemsLoaded(true);
        setItemsLoading(false);
      });
    // tenantId + the set of visible workers + refreshToken are the only
    // inputs to this fetch. Don't add `visibleGroups` (its identity churns).
  }, [tenantId, visibleWorkerUidsKey, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Compose visible rows from groups + per-page fetch results.
  const visibleRows = useMemo<MatrixPageRow[]>(() => {
    if (visibleGroups.length === 0) return [];

    // Build (workerUid, hiringEntityId) → assignmentRefs[] map for the page.
    const refsByKey = new Map<string, AssignmentEntityRef[]>();
    // assignmentId → hiringEntityId for filtering items.
    const entityByAssignment = new Map<string, string>();
    for (const ref of assignmentRefs) {
      const k = buildRowKey(ref.workerUid, ref.hiringEntityId);
      const list = refsByKey.get(k);
      if (list) list.push(ref);
      else refsByKey.set(k, [ref]);
      entityByAssignment.set(ref.assignmentId, ref.hiringEntityId);
    }

    return visibleGroups.map((g) => {
      const k = g.key;
      const groupRefs = refsByKey.get(k) ?? [];
      const groupAssignmentIds = new Set(groupRefs.map((r) => r.assignmentId));
      const jobOrderIds = Array.from(
        new Set(groupRefs.map((r) => r.jobOrderId).filter((v): v is string => Boolean(v))),
      );
      const worksiteIds = Array.from(
        new Set(groupRefs.map((r) => r.worksiteId).filter((v): v is string => Boolean(v))),
      );

      const groupAssignmentItems = assignmentItems.filter((it) => {
        if (it.workerUid !== g.workerUid) return false;
        // Bind item to entity via its parent assignment. Items whose
        // assignment isn't in our refs map (race / stale data) are
        // dropped — better than mis-attributing them.
        return groupAssignmentIds.has(it.assignmentId);
      });

      // The universe rows are already employee items (per the list-view
      // hook), but they're flattened into `QueueRow`. We need the original
      // `EmployeeReadinessItem` shape for the chip aggregator. The
      // `groupByWorkerEntity` helper preserves the original via
      // `g.items[].sourceItem` — but that helper drops to a flattened row.
      // For R.8 we read directly off the queue row's denormalized fields,
      // mapped back to a minimal `EmployeeReadinessItem` shape that has
      // the fields the chip aggregator + R.5/R.6 drill-in need.
      const groupEmployeeItems: EmployeeReadinessItem[] = g.items
        .filter((row) => row.kind === 'employee')
        .map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          workerUid: row.workerUid,
          hiringEntityId: row.hiringEntityId ?? '',
          hiringEntityName: row.hiringEntityName,
          requirementType: row.requirementType as EmployeeReadinessItem['requirementType'],
          requirementLabel: row.requirementLabel,
          status: row.status as EmployeeReadinessItem['status'],
          actor: row.actor as EmployeeReadinessItem['actor'],
          blocking: Boolean(row.blocking),
          ownership: {
            primaryRecruiterId: row.primaryRecruiterId,
            visibleRecruiterIds: row.visibleRecruiterIds,
            primarySource: row.primarySource,
            history: row.history,
          },
          createdAt: '',
          updatedAt: '',
          externalRef: row.externalRef,
        }));

      return {
        key: k,
        workerUid: g.workerUid,
        workerName: g.workerName,
        workerAvatar: g.workerAvatar,
        hiringEntityId: g.hiringEntityId,
        hiringEntityName: g.hiringEntityName ?? g.hiringEntityId,
        primaryRecruiterId: g.primaryRecruiterId,
        ownerName: g.ownerName,
        ownerAvatar: g.ownerAvatar,
        lastUpdatedAtMs: g.lastUpdatedAtMs,
        jobOrderIds,
        worksiteIds,
        assignmentItems: groupAssignmentItems,
        employeeItems: groupEmployeeItems,
        itemsLoaded,
      };
    });
  }, [visibleGroups, assignmentRefs, assignmentItems, itemsLoaded]);

  // 5. Refresh + targeted invalidation.
  const refresh = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  const invalidateRows = useCallback(
    async (keys: ReadonlyArray<string>): Promise<void> => {
      if (!tenantId || keys.length === 0) return;
      // Pull workerUids out of the keys (which are `workerUid__hiringEntityId`).
      // We re-fetch the same paginated read for those workers and merge into
      // existing state. No new state-machine — same workerUid path, same
      // batching.
      const workerUids = Array.from(
        new Set(
          keys
            .map((k) => k.split('__')[0])
            .filter((u): u is string => Boolean(u)),
        ),
      );
      if (workerUids.length === 0) return;

      try {
        const [refs, items] = await Promise.all([
          fetchAssignmentEntityRefs(tenantId, workerUids),
          fetchAssignmentReadinessItemsForWorkers(tenantId, workerUids),
        ]);
        // Merge: drop existing entries for those workers, then append the
        // fresh ones. Items missing from the fresh result (e.g. a CSA
        // markFailed dropped them) need to disappear, so DROP-BY-WORKER is
        // the right granularity (vs DROP-BY-ITEMID which would orphan
        // deleted items).
        setAssignmentRefs((prev) => [
          ...prev.filter((r) => !workerUids.includes(r.workerUid)),
          ...refs,
        ]);
        setAssignmentItems((prev) => [
          ...prev.filter((it) => !workerUids.includes(it.workerUid)),
          ...items,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setItemsError(msg);
      }
    },
    [tenantId],
  );

  // Marker used for tree-shaking / future-tightening; documentId is imported
  // pre-emptively for a potential R.8.1 ID-IN read of assignment docs.
  // Reference a no-op so unused-import lint can't fire.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = documentId;

  return {
    allGroups,
    visibleRows,
    page,
    setPage,
    pageSize,
    setPageSize,
    universeLoading,
    itemsLoading,
    error: itemsError ?? universeError,
    refresh,
    invalidateRows,
  };
};

export default useReadinessMatrixPage;
