/**
 * useTimesheetGridRows — load + reload state for the timesheet grid's
 * row resolver.
 *
 * Wraps `resolveTimesheetGrid` so the grid component stays focused on
 * rendering. Exposes `{ rows, loading, error, errors, refresh,
 * consideredAssignmentCount }`:
 *
 *   - `rows` — the resolved row set (or `[]` while loading / on hard
 *     error).
 *   - `loading` — true on initial load AND on `refresh()` re-fetches.
 *   - `error` — user-facing "the load failed entirely" message; `null`
 *     on success.
 *   - `errors` — soft per-assignment errors from the resolver. The
 *     grid surfaces these in a banner above the table without
 *     blocking the rows that DID load.
 *   - `consideredAssignmentCount` — assignments that overlapped the
 *     period (post-overlap, pre-DOW filter). Drives the "no scheduled
 *     work in this period" empty-state copy.
 *   - `refresh` — manual reload trigger. Idempotent; safe to call
 *     while a load is in flight (later call wins).
 *
 * Filter changes auto-trigger a reload via the effect dependency on
 * `filter` (referential equality — the page memoizes the filter
 * object). Passing `null` for filter exits early with empty state,
 * which is the page's "no entity + period selected yet" gate.
 *
 * **Cancellation.** A second filter change while the first is in
 * flight cancels the first via a stale-token check, so we never
 * commit stale rows to a newer filter.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  doc,
  getDoc,
} from 'firebase/firestore';

import { db } from '../firebase';
import {
  buildImportRow,
  resolveTimesheetGrid,
  type ResolvedWorkersComp,
  type TimesheetGridResolution,
  type TimesheetGridRow,
} from '../components/timesheets/timesheetGridResolver';
import type { TimesheetEntryV2, TimesheetFilter } from '../types/recruiter/timesheet';

export interface UseTimesheetGridRowsResult {
  rows: TimesheetGridRow[];
  loading: boolean;
  error: string | null;
  errors: string[];
  consideredAssignmentCount: number;
  refresh: () => void;
  /**
   * Apply a local patch to an entry row in-place, without refetching
   * the full grid. Used by P3.A inline edits to reflect a successful
   * save instantly. The patch overlays onto the existing entry data —
   * fields not in the patch keep their prior values.
   *
   * Empty rows can also be promoted: when the patch lands on a `key`
   * that maps to an `kind: 'empty'` row, the caller should follow the
   * patch with a server-side refetch so the row picks up the freshly-
   * minted entry doc. This is rare — P3.A edits only happen on rows
   * that are already `entry` kind.
   */
  mergeEntryUpdate: (entryId: string, patch: Partial<TimesheetEntryV2>) => void;
  /**
   * Re-fetch a single entry from Firestore and merge it in. Used
   * after a successful save to pick up the recompute trigger's
   * recomputed totals (which the local merge alone can't infer).
   * Also overlays the row's resolved WC display fields when the fresh
   * doc carries entry-level overrides (an override always wins the
   * resolution chain, so the local overlay matches what a full
   * re-resolve would show). Returns the fresh entry so callers can
   * fan values out (e.g. shift-sibling WC merge); null on miss/error.
   * Best-effort: silently swallows fetch errors so a transient
   * recompute-fetch flake doesn't poison the row.
   */
  refreshEntry: (entryId: string) => Promise<TimesheetEntryV2 | null>;
  /**
   * Overlay resolved WC onto every row of a shift that has no entry
   * override — mirrors the server's shift back-fill ("one edit fixes
   * the other entries on the shift") without a full grid reload.
   */
  mergeShiftWc: (shiftId: string, code: string, rate?: number) => void;
  /**
   * Swap ONE import row in place after a worker reassign moves its doc
   * (import doc ids are keyed by worker): drop the old row, fetch the
   * new doc, and rebuild just that row — no full grid reload. Falls back
   * silently on fetch errors (the next manual refresh reconciles).
   */
  replaceImportEntry: (oldEntryId: string, newEntryId: string) => Promise<void>;
}

const EMPTY_RESULT: TimesheetGridResolution = {
  rows: [],
  errors: [],
  consideredAssignmentCount: 0,
};

export function useTimesheetGridRows(
  tenantId: string | undefined | null,
  filter: TimesheetFilter | null,
): UseTimesheetGridRowsResult {
  const [resolution, setResolution] = useState<TimesheetGridResolution>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  /** Stale-token: each load increments this; only the most recent
   *  load is allowed to commit its result. */
  const loadTokenRef = useRef(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!tenantId || !filter) {
      setResolution(EMPTY_RESULT);
      setLoading(false);
      setError(null);
      return;
    }

    const myToken = ++loadTokenRef.current;
    setLoading(true);
    setError(null);

    let cancelled = false;

    resolveTimesheetGrid({ fdb: db, tenantId, filter })
      .then((result) => {
        if (cancelled || loadTokenRef.current !== myToken) return;
        setResolution(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || loadTokenRef.current !== myToken) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load timesheet rows: ${msg}`);
        setResolution(EMPTY_RESULT);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, filter, refreshTick]);

  const mergeEntryUpdate = useCallback(
    (entryId: string, patch: Partial<TimesheetEntryV2>, resolvedPatch?: Partial<ResolvedWorkersComp>) => {
      setResolution((prev) => {
        const next: TimesheetGridRow[] = prev.rows.map((r) => {
          if (r.kind !== 'entry') return r;
          if (r.key !== entryId && r.entry.id !== entryId) return r;
          return {
            ...r,
            ...(resolvedPatch ?? {}),
            entry: { ...r.entry, ...patch },
          };
        });
        return { ...prev, rows: next };
      });
    },
    [],
  );

  const refreshEntry = useCallback(
    async (entryId: string): Promise<TimesheetEntryV2 | null> => {
      if (!tenantId) return null;
      try {
        const ref = doc(db, 'tenants', tenantId, 'timesheet_entries', entryId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data() as TimesheetEntryV2;
        // Entry-level WC overrides win the resolution chain outright, so
        // reflecting them onto the row's resolved display fields locally is
        // exactly what a full re-resolve would produce. Only overlay when
        // present — a cleared override needs the real chain (next reload).
        const resolved: Partial<ResolvedWorkersComp> = {};
        const code = (data as unknown as Record<string, unknown>).workersCompCode;
        const rate = (data as unknown as Record<string, unknown>).workersCompRate;
        if (typeof code === 'string' && code.trim()) {
          resolved.resolvedWorkersCompCode = code.trim();
          resolved.hasEntryWorkersCompOverride = true;
        }
        if (typeof rate === 'number' && Number.isFinite(rate)) {
          resolved.resolvedWorkersCompRate = rate;
        }
        mergeEntryUpdate(entryId, { ...data, id: snap.id }, resolved);
        return { ...data, id: snap.id };
      } catch {
        // Silently ignore — the next user-initiated refresh() will
        // re-resolve the row set anyway.
        return null;
      }
    },
    [tenantId, mergeEntryUpdate],
  );

  const mergeShiftWc = useCallback(
    (shiftId: string, wcCode: string, wcRate?: number) => {
      if (!shiftId || !wcCode) return;
      setResolution((prev) => {
        const next: TimesheetGridRow[] = prev.rows.map((r) => {
          if (r.assignment.shiftId !== shiftId) return r;
          // Rows with their own entry override keep it — mirrors the chain.
          if (r.hasEntryWorkersCompOverride) return r;
          return {
            ...r,
            resolvedWorkersCompCode: wcCode,
            ...(typeof wcRate === 'number' && Number.isFinite(wcRate)
              ? { resolvedWorkersCompRate: wcRate }
              : {}),
          };
        });
        return { ...prev, rows: next };
      });
    },
    [],
  );

  const replaceImportEntry = useCallback(
    async (oldEntryId: string, newEntryId: string) => {
      if (!tenantId) return;
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId, 'timesheet_entries', newEntryId));
        setResolution((prev) => {
          // Drop the old row (its doc is gone) and any stale row already
          // keyed to the new id (the reassign may have merged into an
          // existing row for that worker+day).
          const rows = prev.rows.filter(
            (r) =>
              !(
                r.kind === 'entry' &&
                (r.entry.id === oldEntryId ||
                  r.key === oldEntryId ||
                  r.entry.id === newEntryId)
              ),
          );
          if (snap.exists()) {
            rows.push(buildImportRow({ ...(snap.data() as TimesheetEntryV2), id: snap.id }));
          }
          return { ...prev, rows };
        });
      } catch {
        // Best-effort — the next user-initiated refresh() reconciles.
      }
    },
    [tenantId],
  );

  return {
    rows: resolution.rows,
    loading,
    error,
    errors: resolution.errors,
    consideredAssignmentCount: resolution.consideredAssignmentCount,
    refresh,
    mergeEntryUpdate,
    refreshEntry,
    mergeShiftWc,
    replaceImportEntry,
  };
}

export default useTimesheetGridRows;
