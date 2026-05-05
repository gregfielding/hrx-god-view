/**
 * **D.4** — Data hook for the Workforce → Job Readiness matrix.
 *
 * Sister hook to `useReadinessMatrixPage` (R.8 worker × hiringEntity matrix).
 * Same general structure, different grouping primitive: rows here are
 * **one per `jobOrderId`** instead of `(workerUid, hiringEntityId)`.
 *
 * **What this hook owns**
 *
 *   1. **Row universe.** A page of `job_orders` docs — the candidate JOs we
 *      might surface. We filter to "active-ish" JOs (open / in-progress /
 *      partially-staffed) so the matrix isn't drowning in closed orders.
 *      Scope ('mine' / 'all') applies a recruiter-side filter on top:
 *
 *        - `'mine'`: union of `assignedRecruiters` array-contains uid OR
 *          legacy `recruiterId == uid`. Mirrors the pattern in
 *          `RecruiterJobOrders.tsx` so "My Orders" semantics stay aligned
 *          across the app.
 *        - `'all'`: every active JO in tenant.
 *
 *   2. **Page state.** Page index + page size, sorted by `createdAt desc`.
 *      The matrix renders ≤50 rows per page — same cap as the worker
 *      matrix (D3.R8) — large pages remain a memory grenade even when
 *      Firestore can serve them.
 *
 *   3. **Per-page item fetch.** Takes the visible JO ids and runs
 *      `assignmentReadinessItems where jobOrderId in [batch ≤30]` chunked.
 *      Items are partitioned back to their parent JO. Worker count is
 *      derived from `distinct workerUid`s in those items so the UI can
 *      show "12 workers" alongside the row label.
 *
 * **No `onSnapshot`** — paginated `getDocs` + `refresh()`, matching the
 * R.8 D3 lock. Listening per-cell across 50 rows × ~10 cells is a memory
 * grenade; bulk-action surfaces deserve an explicit refresh contract,
 * not surprise re-renders mid-selection.
 *
 * **No employee items.** The JO matrix shows only `source === 'assignment'`
 * categories — BG / drug / E-Verify / per-(worker × entity) screening live
 * on the worker matrix. The aggregator (`aggregateByCategory`) accepts
 * `employeeItems: []` and silently skips those columns, so the same helper
 * reuses cleanly.
 *
 * @see ./useReadinessMatrixPage.ts (sibling worker × entity hook)
 * @see ../utils/readinessMatrix/aggregateByCategory.ts (per-cell aggregator — reused)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore';

import { db } from '../firebase';
import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';

/** Default page size — matches the R.8 worker-matrix cap. */
export const JOB_READINESS_MATRIX_DEFAULT_PAGE_SIZE = 50;

/** Firestore `in` operator cap. */
const FIRESTORE_IN_BATCH = 30;

/**
 * Universe pull cap. We over-fetch the candidate JO universe so client-side
 * search + pagination work without round-trips. 500 keeps us well under the
 * Firestore 1MB doc cap and matches `RecruiterJobOrders.tsx`'s budget.
 */
const JOB_ORDER_UNIVERSE_LIMIT = 500;

/**
 * JO statuses we surface in the matrix. Closed / cancelled JOs are filtered
 * out — they have historical readiness items, but the CSA's question on
 * this page is "what work is open right now and is it covered?".
 */
const ACTIVE_JO_STATUSES: ReadonlyArray<string> = [
  'open',
  'in-progress',
  'in_progress',
  'partially-staffed',
  'partially_staffed',
  'partial',
  'pending',
  'draft',
];

export type JobReadinessMatrixScope = 'all' | 'mine';

export interface UseJobReadinessMatrixPageArgs {
  tenantId: string | null;
  currentUserUid: string | null;
  scope: JobReadinessMatrixScope;
  /** Free-text search applied client-side over jobOrderNumber + jobTitle. */
  search?: string;
  pageSize?: number;
}

/**
 * One matrix row — one JO bundle ready for cell render.
 */
export interface JobReadinessMatrixRow {
  /** Stable key — currently equals `jobOrderId`. */
  key: string;
  jobOrderId: string;
  jobOrderNumber: string;
  jobTitle: string;
  worksiteName?: string;
  recruiterAccountId?: string;
  recruiterAccountName?: string;
  status: string;
  /** Distinct `workerUid`s referenced by this JO's items. */
  workerCount: number;
  /** Per-shift items belonging to this JO. */
  assignmentItems: ReadonlyArray<AssignmentReadinessItem>;
  /** Highest `lastUpdatedAt` among the items, in ms. Used for sort tiebreak / freshness display. */
  lastUpdatedAtMs: number;
  /**
   * `true` once the per-page item fetch has resolved for this row. Lets the
   * UI distinguish "no items, fetch finished" (render dashes) from "still
   * fetching" (render skeleton).
   */
  itemsLoaded: boolean;
}

export interface UseJobReadinessMatrixPageResult {
  rows: ReadonlyArray<JobReadinessMatrixRow>;
  /** Total rows after scope + search filter, before pagination. */
  totalRows: number;
  page: number;
  pageSize: number;
  setPage: (next: number) => void;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  lastRefreshedAtMs: number | null;
}

interface JobOrderUniverseDoc {
  id: string;
  jobOrderNumber: string;
  jobTitle: string;
  worksiteName?: string;
  recruiterAccountId?: string;
  recruiterAccountName?: string;
  status: string;
  createdAtMs: number;
  recruiterId?: string;
  assignedRecruiters?: string[];
}

/**
 * Pull-and-merge helper: union two getDocs results by doc id, preserving the
 * first-seen instance. Used to stitch the legacy `recruiterId ==` and modern
 * `assignedRecruiters array-contains` queries on the "Mine" path.
 */
function unionByDocId(
  a: ReadonlyArray<{ id: string; data: () => DocumentData }>,
  b: ReadonlyArray<{ id: string; data: () => DocumentData }>,
): Array<{ id: string; data: () => DocumentData }> {
  const byId = new Map<string, { id: string; data: () => DocumentData }>();
  for (const d of a) byId.set(d.id, d);
  for (const d of b) if (!byId.has(d.id)) byId.set(d.id, d);
  return Array.from(byId.values());
}

function projectJobOrderUniverseDoc(
  id: string,
  data: DocumentData,
): JobOrderUniverseDoc {
  const createdAt = data.createdAt;
  const createdAtMs =
    createdAt && typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : typeof createdAt === 'number'
        ? createdAt
        : 0;
  return {
    id,
    jobOrderNumber: typeof data.jobOrderNumber === 'string' ? data.jobOrderNumber : '',
    jobTitle: typeof data.jobTitle === 'string' ? data.jobTitle : '',
    worksiteName: typeof data.worksiteName === 'string' ? data.worksiteName : undefined,
    recruiterAccountId:
      typeof data.recruiterAccountId === 'string' ? data.recruiterAccountId : undefined,
    recruiterAccountName:
      typeof data.recruiterAccountName === 'string' ? data.recruiterAccountName : undefined,
    status: typeof data.status === 'string' ? data.status : 'unknown',
    createdAtMs,
    recruiterId: typeof data.recruiterId === 'string' ? data.recruiterId : undefined,
    assignedRecruiters: Array.isArray(data.assignedRecruiters)
      ? (data.assignedRecruiters as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : undefined,
  };
}

const useJobReadinessMatrixPage = (
  args: UseJobReadinessMatrixPageArgs,
): UseJobReadinessMatrixPageResult => {
  const {
    tenantId,
    currentUserUid,
    scope,
    search = '',
    pageSize = JOB_READINESS_MATRIX_DEFAULT_PAGE_SIZE,
  } = args;

  const [universe, setUniverse] = useState<ReadonlyArray<JobOrderUniverseDoc>>([]);
  const [page, setPage] = useState(0);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [itemsByJoId, setItemsByJoId] = useState<
    ReadonlyMap<string, ReadonlyArray<AssignmentReadinessItem>>
  >(new Map());
  const [loadedJoIds, setLoadedJoIds] = useState<ReadonlySet<string>>(new Set());
  const [lastRefreshedAtMs, setLastRefreshedAtMs] = useState<number | null>(null);

  /**
   * Bumped by `refresh()` to retrigger both the universe pull and the per-page
   * fetch. Independent counters would be cheaper, but the matrix's contract is
   * "click refresh, get fresh everything"; one bump is simpler.
   */
  const refreshTokenRef = useRef(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    refreshTokenRef.current += 1;
    setRefreshToken(refreshTokenRef.current);
  }, []);

  // ─── Universe pull ────────────────────────────────────────────────────
  // Run when tenant / scope / uid / refresh changes. We DO NOT depend on
  // `search` here — search filters the in-memory universe, no need to refetch.
  useEffect(() => {
    if (!tenantId) {
      setUniverse([]);
      setUniverseLoading(false);
      return;
    }
    if (scope === 'mine' && !currentUserUid) {
      setUniverse([]);
      setUniverseLoading(false);
      return;
    }

    let cancelled = false;
    setUniverseLoading(true);
    setError(null);

    (async () => {
      try {
        const baseRef = collection(db, `tenants/${tenantId}/job_orders`);

        let docs: Array<{ id: string; data: () => DocumentData }> = [];
        if (scope === 'mine' && currentUserUid) {
          // Two queries union'd: legacy single recruiter + modern multi-assigned.
          // We deliberately skip an `orderBy` here so the legacy single-field
          // index is sufficient — mirrors the "rock-solid My Orders" comment in
          // RecruiterJobOrders.tsx (no composite-index dependency).
          const qAssigned = query(
            baseRef,
            where('assignedRecruiters', 'array-contains', currentUserUid),
            limit(JOB_ORDER_UNIVERSE_LIMIT),
          );
          const qLegacy = query(
            baseRef,
            where('recruiterId', '==', currentUserUid),
            limit(JOB_ORDER_UNIVERSE_LIMIT),
          );
          const [snapAssigned, snapLegacy] = await Promise.all([
            getDocs(qAssigned),
            getDocs(qLegacy),
          ]);
          docs = unionByDocId(snapAssigned.docs, snapLegacy.docs);
        } else {
          // "All" path — order by createdAt desc so newest active orders
          // surface first. Status filter happens client-side because
          // `where('status', 'in', [...])` requires a composite index that
          // we'd rather not provision for a single screen.
          const q = query(
            baseRef,
            orderBy('createdAt', 'desc'),
            limit(JOB_ORDER_UNIVERSE_LIMIT),
          );
          const snap = await getDocs(q);
          docs = snap.docs;
        }

        const projected = docs
          .map((d) => projectJobOrderUniverseDoc(d.id, d.data()))
          .filter((j) => ACTIVE_JO_STATUSES.includes(j.status))
          .sort((a, b) => b.createdAtMs - a.createdAtMs);

        if (cancelled) return;
        setUniverse(projected);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setUniverse([]);
      } finally {
        if (!cancelled) setUniverseLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, scope, currentUserUid, refreshToken]);

  // ─── Search + pagination, derived from universe ───────────────────────
  const filteredUniverse = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return universe;
    return universe.filter((j) => {
      const num = j.jobOrderNumber.toLowerCase();
      const title = j.jobTitle.toLowerCase();
      return num.includes(term) || title.includes(term);
    });
  }, [universe, search]);

  // Reset to page 0 when filter inputs change so users don't end up on a now-
  // empty page after a search narrows the universe.
  useEffect(() => {
    setPage(0);
  }, [tenantId, scope, currentUserUid, search]);

  const totalRows = filteredUniverse.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visible = useMemo(
    () => filteredUniverse.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filteredUniverse, safePage, pageSize],
  );

  // ─── Per-page item fetch ──────────────────────────────────────────────
  // Fires when the visible JO id set changes. We cache items keyed by JO id
  // across page navigation so a user paging back to page 0 doesn't re-fetch.
  const visibleJoIdsKey = useMemo(() => visible.map((v) => v.id).join('|'), [visible]);

  useEffect(() => {
    if (!tenantId || visible.length === 0) return;

    let cancelled = false;
    setPageLoading(true);
    setError(null);

    (async () => {
      try {
        const itemsRef = collection(db, `tenants/${tenantId}/assignmentReadinessItems`);
        const idsToFetch = visible.map((v) => v.id);

        const chunkedSnaps = await Promise.all(
          chunk(idsToFetch, FIRESTORE_IN_BATCH).map(async (batch) => {
            const q = query(itemsRef, where('jobOrderId', 'in', batch));
            return getDocs(q);
          }),
        );

        if (cancelled) return;

        const nextItems = new Map<string, AssignmentReadinessItem[]>();
        for (const id of idsToFetch) nextItems.set(id, []);
        for (const snap of chunkedSnaps) {
          for (const d of snap.docs) {
            const data = d.data() as AssignmentReadinessItem;
            const list = nextItems.get(data.jobOrderId);
            if (list) list.push({ ...data });
          }
        }

        // Merge with the previously-cached map (keep items for off-page rows)
        // so re-paging to a previously-fetched page doesn't show empty cells
        // mid-fetch.
        setItemsByJoId((prev) => {
          const merged = new Map(prev);
          for (const [k, v] of nextItems) merged.set(k, v);
          return merged;
        });
        setLoadedJoIds((prev) => {
          const merged = new Set(prev);
          for (const id of idsToFetch) merged.add(id);
          return merged;
        });
        setLastRefreshedAtMs(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, visibleJoIdsKey, refreshToken, visible]);

  // ─── Compose rows ────────────────────────────────────────────────────
  const rows = useMemo<ReadonlyArray<JobReadinessMatrixRow>>(() => {
    return visible.map((jo) => {
      const items = itemsByJoId.get(jo.id) ?? [];
      const distinctWorkers = new Set<string>();
      let lastUpdated = 0;
      for (const it of items) {
        if (it.workerUid) distinctWorkers.add(it.workerUid);
        const raw = (it as { updatedAt?: unknown }).updatedAt;
        const ts =
          raw && typeof (raw as { toMillis?: () => number }).toMillis === 'function'
            ? (raw as { toMillis: () => number }).toMillis()
            : typeof raw === 'number'
              ? (raw as number)
              : 0;
        if (ts > lastUpdated) lastUpdated = ts;
      }
      return {
        key: jo.id,
        jobOrderId: jo.id,
        jobOrderNumber: jo.jobOrderNumber || jo.id,
        jobTitle: jo.jobTitle,
        worksiteName: jo.worksiteName,
        recruiterAccountId: jo.recruiterAccountId,
        recruiterAccountName: jo.recruiterAccountName,
        status: jo.status,
        workerCount: distinctWorkers.size,
        assignmentItems: items,
        lastUpdatedAtMs: lastUpdated,
        itemsLoaded: loadedJoIds.has(jo.id),
      };
    });
  }, [visible, itemsByJoId, loadedJoIds]);

  return {
    rows,
    totalRows,
    page: safePage,
    pageSize,
    setPage,
    isLoading: universeLoading || pageLoading,
    error,
    refresh,
    lastRefreshedAtMs,
  };
};

function chunk<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default useJobReadinessMatrixPage;
