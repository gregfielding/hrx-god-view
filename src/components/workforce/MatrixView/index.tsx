/**
 * **R.8** — `MatrixView` — top-level CSA cross-worker readiness matrix.
 *
 * Composition:
 *
 *   - `useReadinessMatrixPage` — universe + per-page item fetch.
 *   - `MatrixFilterBar` — severity / JO / worksite client-side filters.
 *   - `MatrixRow` × N — one row per (worker × hiringEntity) bundle.
 *   - `MatrixCell` (mounted inside each row) — per-category chip + actions.
 *   - `BulkActionBar` — selection summary + bulk Confirm / Waive / Mark fail.
 *   - `EverifyCaseDrawer`, `BackgroundCheckCaseDrawer` — vendor drill-in.
 *   - Single-cell action dialog (mirrors `ReadinessCsaActionsSection`).
 *
 * **State machine summary:**
 *
 *   - `selection: Map<rowKey, Set<categoryKey>>` — checked cells. Cap at 50
 *     (D4.R8). Rebuild on visible-row change because a no-longer-visible
 *     row's selection is invalid.
 *   - `singleAction` — `{rowKey, categoryKey, kind, itemRef}` for the per-
 *     cell action dialog. Shape mirrors `ReadinessCsaActionsSection`'s
 *     `actionDialog`.
 *   - `bulkInFlight` — guard the bulk bar's commit while a fan-out is
 *     running. Per-cell actions stay enabled (different surface).
 *   - `bulkLastResult` — surfaced in the bar after a fan-out completes.
 *     Cleared by selection change.
 *   - `drawerCaseId` / `drawerCheckId` — vendor drill-in mounts.
 *
 * **Bulk fan-out:** `Promise.allSettled` over R.3 callables with a small
 * concurrency pool (=5). After the run, we invalidate the affected
 * `rowKey`s on the hook so the matrix re-renders with fresh items
 * (avoiding a full page re-fetch). Failed rows stay selected so the CSA
 * can retry (D4.R8).
 *
 * **Vendor cells** never enter selection (the cell suppresses its
 * checkbox); the only path to act on them is via the per-cell menu →
 * vendor drawer (D5.R8).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { functions } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import StandardTablePagination from '../../StandardTablePagination';
import { EverifyCaseDrawer } from '../../recruiter/everify';
import { BackgroundCheckCaseDrawer } from '../../recruiter/backgroundCheck';

import useReadinessMatrixPage, {
  READINESS_MATRIX_DEFAULT_PAGE_SIZE,
  type MatrixPageRow,
  type ReadinessMatrixScope,
} from '../../../hooks/useReadinessMatrixPage';
import useBackgroundCheckPackageDrift, {
  type PackageDriftCaseSummary,
} from '../../../hooks/useBackgroundCheckPackageDrift';
import { aggregateByCategory } from '../../../utils/readinessMatrix/aggregateByCategory';
import {
  MATRIX_CATEGORIES,
  MATRIX_CATEGORY_BY_KEY,
  type MatrixCategoryDef,
  type MatrixCategoryKey,
} from '../../../utils/readinessMatrix/categories';
import MatrixRow from './MatrixRow';
import MatrixFilterBar, {
  MATRIX_FILTER_DEFAULT,
  type MatrixFilterState,
} from './MatrixFilterBar';
import BulkActionBar, { type BulkActionResult } from './BulkActionBar';
import type { MatrixVendorDrillIn } from './types';
import type {
  CsaReadinessActionInput,
  CsaReadinessActionKind,
  CsaReadinessActionResult,
  CsaReadinessItemCollection,
} from '../../../shared/csaReadinessActionTypes';

const SELECTION_CAP = 50;
const BULK_CONCURRENCY = 5;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

export interface MatrixViewProps {
  scope: ReadinessMatrixScope;
}

interface SingleActionState {
  rowKey: string;
  categoryKey: MatrixCategoryKey;
  kind: CsaReadinessActionKind;
  itemRef: { itemId: string; source: 'assignment' | 'employee' };
  note: string;
  inFlight: boolean;
  error: string | null;
}

const ACTION_LABELS: Record<CsaReadinessActionKind, string> = {
  csa_confirm: 'Confirm',
  csa_waive: 'Waive',
  csa_mark_failed: 'Mark failed',
};

const ACTION_NOTE_REQUIRED: Record<CsaReadinessActionKind, boolean> = {
  csa_confirm: false,
  csa_waive: true,
  csa_mark_failed: true,
};

/** Concurrency-limited Promise.allSettled. */
async function mapWithPool<T, R>(
  items: ReadonlyArray<T>,
  pool: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(pool, items.length)).fill(0).map(async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        out[idx] = { status: 'fulfilled', value: await fn(items[idx], idx) };
      } catch (err) {
        out[idx] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const CALLABLE_NAME: Record<CsaReadinessActionKind, string> = {
  csa_confirm: 'confirmReadinessItem',
  csa_waive: 'waiveReadinessItem',
  csa_mark_failed: 'markReadinessItemFailed',
};

function callCsaReadinessAction(
  kind: CsaReadinessActionKind,
  input: CsaReadinessActionInput,
): Promise<CsaReadinessActionResult> {
  const callable = httpsCallable<CsaReadinessActionInput, CsaReadinessActionResult>(
    functions,
    CALLABLE_NAME[kind],
  );
  return callable(input).then((res) => res.data);
}

const MatrixView: React.FC<MatrixViewProps> = ({ scope }) => {
  const navigate = useNavigate();
  const {
    user,
    activeTenant,
    isHRX,
    claimsRoles,
    tenantRolesFromProfile,
    securityLevel,
  } = useAuth();
  const tenantId = activeTenant?.id ?? null;
  const currentUserUid = user?.uid ?? null;

  /**
   * R.3-aligned admin gate, per-tenant. Mirrors `canManageBgCheck` from
   * `ProfileReadinessTabContent` so a CSA who can act on AccuSource cases
   * can also bulk-confirm uniform / PPE here. Server still re-checks via
   * `ensureReadinessCsaAdmin`.
   */
  const canManageInTenant = useMemo(() => {
    if (isHRX) return true;
    if (!tenantId) return false;
    const claimsRole = String(claimsRoles?.[tenantId]?.role ?? '').toLowerCase();
    if (['admin', 'super_admin', 'manager'].includes(claimsRole)) return true;
    const profile = tenantRolesFromProfile?.[tenantId];
    if (profile) {
      const role = String(profile.role ?? '').toLowerCase();
      if (['admin', 'super_admin', 'manager'].includes(role)) return true;
      const sl = Number.parseInt(String(profile.securityLevel ?? '0'), 10) || 0;
      if (sl >= 5) return true;
    }
    const sl = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
    return sl >= 5;
  }, [isHRX, tenantId, claimsRoles, tenantRolesFromProfile, securityLevel]);

  const {
    allGroups,
    visibleRows,
    page,
    setPage,
    pageSize,
    setPageSize,
    universeLoading,
    itemsLoading,
    error,
    refresh,
    invalidateRows,
  } = useReadinessMatrixPage({
    tenantId,
    currentUserUid,
    scope,
    pageSize: READINESS_MATRIX_DEFAULT_PAGE_SIZE,
  });

  // ---------- Filter state ----------
  const [filter, setFilter] = useState<MatrixFilterState>(MATRIX_FILTER_DEFAULT);
  // Reset filter when scope changes — different scope = different universe.
  useEffect(() => {
    setFilter(MATRIX_FILTER_DEFAULT);
  }, [scope]);

  /**
   * Apply client-side filters. We do this on `visibleRows` (NOT
   * `allGroups`) because filters apply to the current page (D7.R8).
   * Severity filter requires per-row chip aggregation; we cache the
   * aggregates per row to avoid recomputing inside MatrixRow.
   */
  const filteredVisibleRows = useMemo<MatrixPageRow[]>(() => {
    if (!visibleRows.length) return [];
    return visibleRows.filter((row) => {
      if (filter.jobOrderId && !row.jobOrderIds.includes(filter.jobOrderId)) {
        return false;
      }
      if (filter.worksiteId && !row.worksiteIds.includes(filter.worksiteId)) {
        return false;
      }
      if (filter.severity === 'all') return true;
      // 'pending' = any yellow or red cell. 'blockers' = any red cell.
      // We only need to know IF such a cell exists, so we short-circuit
      // without aggregating every category.
      if (!row.itemsLoaded) return true; // tentatively include while loading
      const aggregates = aggregateByCategory({
        assignmentItems: row.assignmentItems,
        employeeItems: row.employeeItems,
      });
      let hasYellow = false;
      let hasRed = false;
      aggregates.forEach((agg) => {
        if (agg.chip.state === 'red') hasRed = true;
        else if (agg.chip.state === 'yellow') hasYellow = true;
      });
      if (filter.severity === 'blockers') return hasRed;
      return hasRed || hasYellow;
    });
  }, [visibleRows, filter]);

  /**
   * Compute the visible categories for the page — drop any column that
   * is empty for every visible row. Keeps the matrix narrow on tenants
   * that don't use, say, language_willingness.
   */
  const visibleCategories = useMemo<ReadonlyArray<MatrixCategoryDef>>(() => {
    if (!filteredVisibleRows.length) return [];
    const presentKeys = new Set<MatrixCategoryKey>();
    for (const row of filteredVisibleRows) {
      if (!row.itemsLoaded) {
        // Mid-load — render every category as a skeleton.
        return MATRIX_CATEGORIES;
      }
      const aggregates = aggregateByCategory({
        assignmentItems: row.assignmentItems,
        employeeItems: row.employeeItems,
      });
      aggregates.forEach((_agg, key) => presentKeys.add(key));
      if (presentKeys.size === MATRIX_CATEGORIES.length) break;
    }
    return MATRIX_CATEGORIES.filter((c) => presentKeys.has(c.key));
  }, [filteredVisibleRows]);

  // ---------- Selection ----------
  const [selection, setSelection] = useState<Map<string, Set<MatrixCategoryKey>>>(
    new Map(),
  );
  const [bulkLastResult, setBulkLastResult] = useState<BulkActionResult | null>(
    null,
  );

  // Selection's underlying item refs map — rebuilt on selection or page
  // change; used by the bulk fan-out to know which items to act on.
  const selectionItemRefs = useMemo(() => {
    const out: Array<{
      rowKey: string;
      categoryKey: MatrixCategoryKey;
      itemRefs: ReadonlyArray<{
        itemId: string;
        source: 'assignment' | 'employee';
      }>;
    }> = [];
    for (const row of filteredVisibleRows) {
      const cats = selection.get(row.key);
      if (!cats || cats.size === 0) continue;
      const aggregates = aggregateByCategory({
        assignmentItems: row.assignmentItems,
        employeeItems: row.employeeItems,
      });
      cats.forEach((catKey) => {
        const agg = aggregates.get(catKey);
        if (!agg) return;
        out.push({
          rowKey: row.key,
          categoryKey: catKey,
          itemRefs: agg.itemRefs,
        });
      });
    }
    return out;
  }, [filteredVisibleRows, selection]);

  const selectedCount = selectionItemRefs.length;
  const itemFanOutCount = selectionItemRefs.reduce(
    (sum, s) => sum + s.itemRefs.length,
    0,
  );

  // Color counts on selected cells — drives bulk-bar affordances.
  const { selectedRedCount, selectedYellowCount } = useMemo(() => {
    let red = 0;
    let yellow = 0;
    for (const row of filteredVisibleRows) {
      const cats = selection.get(row.key);
      if (!cats || cats.size === 0) continue;
      const aggregates = aggregateByCategory({
        assignmentItems: row.assignmentItems,
        employeeItems: row.employeeItems,
      });
      cats.forEach((catKey) => {
        const agg = aggregates.get(catKey);
        if (!agg) return;
        if (agg.chip.state === 'red') red += 1;
        else if (agg.chip.state === 'yellow') yellow += 1;
      });
    }
    return { selectedRedCount: red, selectedYellowCount: yellow };
  }, [filteredVisibleRows, selection]);

  // Reset selection if the visible set materially changes (page change /
  // filter change). We don't reset on every render — only when the set
  // of rowKeys we can ACT on shrinks.
  const visibleRowKeysSig = useMemo(
    () =>
      filteredVisibleRows
        .map((r) => r.key)
        .sort()
        .join('|'),
    [filteredVisibleRows],
  );
  useEffect(() => {
    setSelection((prev) => {
      const validKeys = new Set(filteredVisibleRows.map((r) => r.key));
      let mutated = false;
      const next = new Map(prev);
      next.forEach((_set, k) => {
        if (!validKeys.has(k)) {
          next.delete(k);
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });
    setBulkLastResult(null);
  }, [visibleRowKeysSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleSelect = useCallback(
    (args: { rowKey: string; categoryKey: MatrixCategoryKey }) => {
      setSelection((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(args.rowKey) ?? []);
        if (set.has(args.categoryKey)) {
          set.delete(args.categoryKey);
        } else {
          // Cap enforcement.
          let total = 0;
          next.forEach((s) => (total += s.size));
          if (total >= SELECTION_CAP) return prev;
          set.add(args.categoryKey);
        }
        if (set.size === 0) next.delete(args.rowKey);
        else next.set(args.rowKey, set);
        return next;
      });
      setBulkLastResult(null);
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelection(new Map());
    setBulkLastResult(null);
  }, []);

  // ---------- Single-cell action dialog ----------
  const [singleAction, setSingleAction] = useState<SingleActionState | null>(null);

  const handleOpenSingleAction = useCallback(
    (args: {
      rowKey: string;
      categoryKey: MatrixCategoryKey;
      kind: CsaReadinessActionKind;
      itemRef: { itemId: string; source: 'assignment' | 'employee' };
    }) => {
      setSingleAction({
        ...args,
        note: '',
        inFlight: false,
        error: null,
      });
    },
    [],
  );

  const handleCloseSingleAction = useCallback(() => {
    setSingleAction((prev) => (prev?.inFlight ? prev : null));
  }, []);

  const handleSubmitSingleAction = useCallback(async () => {
    if (!singleAction || !tenantId) return;
    const noteRequired = ACTION_NOTE_REQUIRED[singleAction.kind];
    const note = singleAction.note.trim();
    if (noteRequired && note.length === 0) {
      setSingleAction((prev) => prev && { ...prev, error: 'A note is required.' });
      return;
    }
    setSingleAction((prev) => prev && { ...prev, inFlight: true, error: null });
    try {
      const collectionName: CsaReadinessItemCollection = singleAction.itemRef.source;
      await callCsaReadinessAction(singleAction.kind, {
        tenantId,
        itemId: singleAction.itemRef.itemId,
        collection: collectionName,
        note: note.length > 0 ? note : null,
      });
      // Targeted invalidation — only this row.
      await invalidateRows([singleAction.rowKey]);
      setSingleAction(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSingleAction((prev) =>
        prev && { ...prev, inFlight: false, error: msg },
      );
    }
  }, [singleAction, tenantId, invalidateRows]);

  // ---------- Vendor drawer mounts ----------
  const [drawerCaseId, setDrawerCaseId] = useState<string | null>(null);
  const [drawerCheckId, setDrawerCheckId] = useState<string | null>(null);
  const [drawerRowKey, setDrawerRowKey] = useState<string | null>(null);

  /**
   * **R.11** — Tenant-wide screening-package drift count + per-case
   * details for the matrix banner. Single Firestore query against the
   * `(tenantId, hasPendingPackageDrift)` composite index. The banner
   * itself only renders when `count > 0`.
   *
   * Refreshed on demand from the drift dialog's "Refresh" button and
   * implicitly via the drawer's `onActionApplied` chain after a CSA
   * acknowledgment clears `hasPendingPackageDrift` server-side.
   */
  const driftHook = useBackgroundCheckPackageDrift({ tenantId });
  const [driftDialogOpen, setDriftDialogOpen] = useState(false);

  const openDriftDialog = useCallback(() => setDriftDialogOpen(true), []);
  const closeDriftDialog = useCallback(() => setDriftDialogOpen(false), []);

  const handleOpenDriftCheck = useCallback(
    (caseSummary: PackageDriftCaseSummary) => {
      setDrawerRowKey(null);
      setDrawerCaseId(null);
      setDrawerCheckId(caseSummary.checkId);
      setDriftDialogOpen(false);
    },
    [],
  );

  const handleVendorDrillIn = useCallback((target: MatrixVendorDrillIn) => {
    setDrawerRowKey(target.rowKey);
    if (target.kind === 'everify') {
      setDrawerCheckId(null);
      setDrawerCaseId(target.caseId);
    } else {
      setDrawerCaseId(null);
      setDrawerCheckId(target.checkId);
    }
  }, []);

  const handleCloseEverifyDrawer = useCallback(() => {
    setDrawerCaseId(null);
    // Vendor drawer writes go through R.5/R.6 callables which update items;
    // we invalidate the affected row so the matrix reflects new state.
    if (drawerRowKey) void invalidateRows([drawerRowKey]);
    setDrawerRowKey(null);
  }, [drawerRowKey, invalidateRows]);

  const handleCloseBgDrawer = useCallback(() => {
    setDrawerCheckId(null);
    if (drawerRowKey) void invalidateRows([drawerRowKey]);
    setDrawerRowKey(null);
  }, [drawerRowKey, invalidateRows]);

  // ---------- Bulk fan-out ----------
  const [bulkInFlight, setBulkInFlight] = useState(false);

  const runBulkAction = useCallback(
    async ({
      kind,
      note,
    }: {
      kind: CsaReadinessActionKind;
      note: string | null;
    }) => {
      if (!tenantId || selectionItemRefs.length === 0) return;
      setBulkInFlight(true);
      setBulkLastResult(null);

      // Flatten cells → individual item operations. Track origin rowKey
      // so we can report failed rows accurately.
      type Op = {
        rowKey: string;
        itemId: string;
        collection: CsaReadinessItemCollection;
      };
      const ops: Op[] = [];
      for (const cell of selectionItemRefs) {
        for (const ref of cell.itemRefs) {
          ops.push({
            rowKey: cell.rowKey,
            itemId: ref.itemId,
            collection: ref.source,
          });
        }
      }

      const settled = await mapWithPool(ops, BULK_CONCURRENCY, (op) =>
        callCsaReadinessAction(kind, {
          tenantId,
          itemId: op.itemId,
          collection: op.collection,
          note,
        }),
      );

      let ok = 0;
      let idempotentNoOp = 0;
      let failed = 0;
      const failedKeys = new Set<string>();
      let firstError: string | undefined;
      settled.forEach((res, idx) => {
        const op = ops[idx];
        if (res.status === 'fulfilled') {
          if (res.value.unchanged) idempotentNoOp += 1;
          else ok += 1;
        } else {
          failed += 1;
          failedKeys.add(op.rowKey);
          if (!firstError) {
            const reason = res.reason;
            firstError = reason instanceof Error ? reason.message : String(reason);
          }
        }
      });

      // Targeted invalidation — only rows we actually touched.
      const touchedKeys = Array.from(new Set(ops.map((o) => o.rowKey)));
      try {
        await invalidateRows(touchedKeys);
      } catch {
        // Invalidation failure is non-fatal — refresh button is still
        // available; we still want to surface action results.
      }

      // Drop selection on rows that succeeded; KEEP failed rows selected
      // so the CSA can retry.
      setSelection((prev) => {
        const next = new Map<string, Set<MatrixCategoryKey>>();
        prev.forEach((cats, rowKey) => {
          if (failedKeys.has(rowKey)) {
            next.set(rowKey, new Set(cats));
          }
        });
        return next;
      });

      setBulkLastResult({
        total: ops.length,
        ok,
        idempotentNoOp,
        failed,
        failedKeys: Array.from(failedKeys),
        firstError,
      });
      setBulkInFlight(false);
    },
    [tenantId, selectionItemRefs, invalidateRows],
  );

  // ---------- Render ----------
  const handleWorkerNameClick = useCallback(
    (workerUid: string) => {
      navigate(`/users/${workerUid}`);
    },
    [navigate],
  );

  // Cap-add gate for cells: when we're at cap, only cells already
  // selected can be toggled (so the user can deselect to free a slot).
  const canAddSelection = selectedCount < SELECTION_CAP;

  const dialogConfig = singleAction
    ? {
        kind: singleAction.kind,
        category: MATRIX_CATEGORY_BY_KEY[singleAction.categoryKey],
        noteRequired: ACTION_NOTE_REQUIRED[singleAction.kind],
      }
    : null;

  const singleNoteValid =
    !singleAction ||
    !ACTION_NOTE_REQUIRED[singleAction.kind] ||
    singleAction.note.trim().length > 0;

  const headerCellSx = {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    color: 'text.secondary',
    letterSpacing: 0.4,
    py: 0.75,
    px: 0.5,
    whiteSpace: 'nowrap' as const,
  };

  const stickyHeaderSx = {
    ...headerCellSx,
    position: 'sticky' as const,
    left: 0,
    background: 'rgba(0,0,0,0.02)',
    zIndex: 3,
    minWidth: 280,
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <MatrixFilterBar
        state={filter}
        onChange={setFilter}
        pageJobOrderIds={visibleRows.flatMap((r) => r.jobOrderIds)}
        pageWorksiteIds={visibleRows.flatMap((r) => r.worksiteIds)}
        totalRows={allGroups.length}
        visibleAfterFilter={filteredVisibleRows.length}
        onRefresh={refresh}
        refreshDisabled={itemsLoading || universeLoading}
      />

      {/*
        **R.11** — Tenant-wide screening-package drift banner. Single-line
        nudge with a count + click-to-triage. Only renders when there are
        un-acknowledged drift cases. See `useBackgroundCheckPackageDrift`.
      */}
      {driftHook.count > 0 && (
        <Alert
          severity="warning"
          icon={false}
          sx={{ mb: 0.5, py: 0.5 }}
          action={
            <Button color="warning" size="small" onClick={openDriftDialog}>
              Review
            </Button>
          }
        >
          <Typography variant="body2" component="span">
            <strong>{driftHook.count}</strong>{' '}
            {driftHook.count === 1 ? 'background check needs' : 'background checks need'}{' '}
            package review — a job order&apos;s screening package changed while the check is
            still in-flight.
          </Typography>
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 0.5 }}>
          {error}
        </Alert>
      )}

      {(universeLoading || itemsLoading) && (
        <LinearProgress sx={{ mb: 0.5 }} />
      )}

      <TableContainer
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          bgcolor: 'background.paper',
          overflow: 'auto',
          maxHeight: 'calc(100vh - 260px)',
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
              <TableCell sx={stickyHeaderSx}>Worker · Hiring entity</TableCell>
              {visibleCategories.map((cat) => (
                <TableCell
                  key={cat.key}
                  sx={{ ...headerCellSx, minWidth: 110 }}
                  title={cat.description}
                >
                  {cat.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {!universeLoading && filteredVisibleRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={visibleCategories.length + 1}
                  sx={{ py: 6, textAlign: 'center' }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {allGroups.length === 0
                      ? 'No employee readiness items in this tenant yet.'
                      : 'No workers match your current filters on this page.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {filteredVisibleRows.map((row) => (
              <MatrixRow
                key={row.key}
                row={row}
                visibleCategories={visibleCategories}
                selection={selection.get(row.key) ?? new Set()}
                canAddSelection={canAddSelection}
                canManageInTenant={canManageInTenant}
                currentUserUid={currentUserUid}
                onWorkerNameClick={handleWorkerNameClick}
                onToggleSelect={handleToggleSelect}
                onOpenSingleAction={handleOpenSingleAction}
                onVendorDrillIn={handleVendorDrillIn}
              />
            ))}
          </TableBody>
        </Table>

        {allGroups.length > 0 && (
          <StandardTablePagination
            count={allGroups.length}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            onRowsPerPageChange={(e) => {
              setPageSize(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
        )}
      </TableContainer>

      <BulkActionBar
        selectedCount={selectedCount}
        selectionCap={SELECTION_CAP}
        itemFanOutCount={itemFanOutCount}
        selectedRedCount={selectedRedCount}
        selectedYellowCount={selectedYellowCount}
        inFlight={bulkInFlight}
        lastResult={bulkLastResult}
        onClearSelection={clearSelection}
        onCommit={runBulkAction}
      />

      <Dialog
        open={Boolean(singleAction)}
        onClose={handleCloseSingleAction}
        maxWidth="sm"
        fullWidth
      >
        {singleAction && dialogConfig && (
          <>
            <DialogTitle>
              {ACTION_LABELS[singleAction.kind]} ·{' '}
              {dialogConfig.category?.label ?? singleAction.categoryKey}
            </DialogTitle>
            <DialogContent>
              <Stack gap={1.5} sx={{ mt: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  Acts on a single readiness item. Use the bulk bar at the
                  bottom to apply across multiple workers in this matrix.
                </Typography>
                <TextField
                  label="Note"
                  value={singleAction.note}
                  onChange={(e) =>
                    setSingleAction((prev) =>
                      prev ? { ...prev, note: e.target.value, error: null } : prev,
                    )
                  }
                  placeholder={
                    dialogConfig.noteRequired ? 'Required' : 'Optional'
                  }
                  fullWidth
                  multiline
                  minRows={2}
                  required={dialogConfig.noteRequired}
                  error={!!singleAction.error}
                  helperText={singleAction.error}
                  disabled={singleAction.inFlight}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseSingleAction} disabled={singleAction.inFlight}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color={singleAction.kind === 'csa_mark_failed' ? 'error' : 'primary'}
                disabled={singleAction.inFlight || !singleNoteValid}
                onClick={handleSubmitSingleAction}
              >
                {ACTION_LABELS[singleAction.kind]}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {drawerCaseId && tenantId && (
        <EverifyCaseDrawer
          tenantId={tenantId}
          caseId={drawerCaseId}
          canManage={canManageInTenant}
          open={Boolean(drawerCaseId)}
          onClose={handleCloseEverifyDrawer}
        />
      )}

      {drawerCheckId && tenantId && (
        <BackgroundCheckCaseDrawer
          tenantId={tenantId}
          checkId={drawerCheckId}
          canManage={canManageInTenant}
          open={Boolean(drawerCheckId)}
          onClose={handleCloseBgDrawer}
          // **R.11** — Refresh the tenant-wide drift count after a
          // CSA acknowledgment so the banner number converges. Other
          // BG check actions (override, mark cleared) don't affect
          // drift state, so the no-op refresh is cheap & correct.
          onActionApplied={driftHook.refresh}
        />
      )}

      {/*
        **R.11** — Drift cases dialog. Mounted lazily; only rendered when
        the CSA clicks the banner. Each row opens the R.6 drawer for that
        case. The dialog exists so a CSA seeing "12 background checks
        need package review" has a triage list — not an aggregate that
        forces them to scroll the whole matrix to find the affected
        rows. Per-cell badges in the matrix are deferred to R.11.1.
      */}
      <Dialog
        open={driftDialogOpen}
        onClose={closeDriftDialog}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          Background checks needing package review ({driftHook.count})
        </DialogTitle>
        <DialogContent dividers>
          {driftHook.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {driftHook.error}
            </Alert>
          )}
          {driftHook.loading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <LinearProgress sx={{ width: '100%' }} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Loading drift cases…
              </Typography>
            </Stack>
          ) : driftHook.count === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No background checks currently flagged for package review.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                    Worker
                  </TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                    Old package
                  </TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                    New package
                  </TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                    Detected
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {driftHook.cases.map((c) => (
                  <TableRow key={c.checkId} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {c.candidateName ?? c.candidateId ?? '—'}
                      </Typography>
                      {c.driftKind === 'incomparable' && (
                        <Typography variant="caption" color="warning.main">
                          Conservative flag — service detail unavailable
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {c.requestedPackageName ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {c.expectedPackageName ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {c.detectedAt ? c.detectedAt.toLocaleDateString() : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleOpenDriftCheck(c)}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={driftHook.refresh} disabled={driftHook.loading}>
            Refresh
          </Button>
          <Button onClick={closeDriftDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MatrixView;
