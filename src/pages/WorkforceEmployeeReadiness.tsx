/**
 * Workforce > Employee Readiness — primary CSA queue.
 *
 * **Phase D.1.1a — per-worker row redesign (active commit).**
 * The v1 layout (one row per item) is replaced with one row per
 * `(workerUid, hiringEntityId)` group. Each row shows aggregate status —
 * progress bar, count chips, blocking badge — plus disabled action
 * shells that wire in subsequent commits:
 *   - D.1.1b: row expansion + per-item inline actions + `Remind worker ▾`
 *   - D.1.1c: worker-level `⋯` menu + bulk-action bar
 *
 * **Why this changed:**
 * Per Greg's 2026-04-25 production-traffic feedback (addendum to spec §3):
 * the CSA's unit of work is the worker, not the item. Repeated worker
 * names in v1 were the visible symptom of the wrong organization. Spec
 * addendum §1 has the full reasoning.
 *
 * **Filter semantics shift (spec addendum §4):** chips now operate at
 * the WORKER level. "Needs Review" shows workers with ≥1 needs-review
 * item; their (eventual) expansion view will highlight just the matching
 * items. Multi-chip = workers matching ANY chip (OR). `Show complete`
 * unions in workers who are fully done.
 *
 * **Data layer impact: near zero.** The hook (`useEmployeeReadinessItems`)
 * still subscribes to the same Firestore collection with the same
 * scope filter. We bypass its in-hook chip / entity / search filters by
 * passing wide-open values and do all filtering at the worker-group
 * level here. `groupByWorkerEntity` is the only new pure helper.
 *
 * @see ../utils/readinessQueue/groupByWorkerEntity.ts
 * @see ../components/workforce/WorkerReadinessRow.tsx
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useNavigate, useOutletContext } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import StandardTablePagination from '../components/StandardTablePagination';
import WorkforceScopeToggle from '../components/workforce/WorkforceScopeToggle';
import WorkforceViewToggle, {
  type WorkforceReadinessView,
} from '../components/workforce/WorkforceViewToggle';
import WorkforceStatusChips from '../components/workforce/WorkforceStatusChips';
import WorkforceEntityFilter from '../components/workforce/WorkforceEntityFilter';
import WorkerReadinessRow from '../components/workforce/WorkerReadinessRow';
import MatrixView from '../components/workforce/MatrixView';
import useEmployeeReadinessItems from '../hooks/useEmployeeReadinessItems';
import {
  expandStatusFilters,
  groupByWorkerEntity,
  humanizeRequirementType,
  type WorkerGroup,
} from '../utils/readinessQueue';
import type { WorkforceOutletContext } from './Workforce';

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

/** Workers where every item is complete / N-A. The "Show complete" toggle
 *  unions these in on top of whatever the chip filter selects. */
function isFullyComplete(group: WorkerGroup): boolean {
  return group.items.every(
    (item) =>
      item.status === 'complete_pass' ||
      item.status === 'complete' ||
      item.status === 'not_applicable',
  );
}

const WorkforceEmployeeReadiness: React.FC = () => {
  const navigate = useNavigate();
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? null;
  const currentUserUid = user?.uid ?? null;

  const ctx = useOutletContext<WorkforceOutletContext>();
  const {
    scope,
    setScope,
    statusFilters,
    setStatusFilters,
    showComplete,
    setShowComplete,
    entityFilter,
    setEntityFilter,
    search,
  } = ctx;

  // **R.8** — primary view is the per-worker triage list. The matrix is
  // a secondary view for cross-worker, per-category bulk actions (D1.R8 —
  // matrix is a SECONDARY view via toggle, not a replacement). The
  // selection lives in component state intentionally; persisting it in
  // the outlet context would couple the matrix to the Job Readiness
  // page, which doesn't have a matrix.
  const [view, setView] = useState<WorkforceReadinessView>('list');

  // The hook's in-memory chip / entity / search filters are bypassed —
  // worker-level filtering happens here, after grouping. We still rely on
  // the hook for:
  //   - the scope-aware Firestore subscription (`scope === 'mine'`
  //     adds the `ownership.primaryRecruiterId == me` server filter)
  //   - the worker / owner name denormalization (`nameMap`)
  // Passing `statusFilters: []` + `showComplete: true` means the hook's
  // universe includes everything; we narrow at the group level.
  const { allRows, nameMap, loading, error } = useEmployeeReadinessItems({
    tenantId,
    currentUserUid,
    scope,
    statusFilters: [],
    showComplete: true,
    entityFilter: 'all',
    searchText: '',
  });

  // -------- Group + filter --------
  const groups = useMemo(() => groupByWorkerEntity(allRows, nameMap), [allRows, nameMap]);

  const filteredGroups = useMemo(() => {
    const requestedRawStatuses = expandStatusFilters(statusFilters);
    const searchText = search.trim().toLowerCase();

    return groups.filter((group) => {
      // Entity filter — AND with everything else.
      if (entityFilter !== 'all' && group.hiringEntityId !== entityFilter) {
        return false;
      }

      // Search filter — matches worker name, uid, hiring entity, or any
      // item's requirement label. AND with everything else.
      if (searchText) {
        const haystack = [
          group.workerName,
          group.workerUid,
          group.hiringEntityName,
          ...group.items.map(
            (i) => i.requirementLabel || humanizeRequirementType(i.requirementType),
          ),
        ]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(searchText)) return false;
      }

      // Chip + showComplete filter (OR'd internally). The chip cluster
      // refuses to emit an empty selection (snaps back to `needs_review`
      // when emptied), so `requestedRawStatuses` should never be empty in
      // practice — defensive check anyway.
      const matchesChip =
        requestedRawStatuses.size > 0 &&
        group.items.some((item) => requestedRawStatuses.has(item.status));

      const isComplete = isFullyComplete(group);
      // Spec §4: "Show complete" unions in workers who are fully done.
      // We DON'T want a fully-complete worker to slip in via a chip match
      // alone (they can't — none of the chips select complete statuses),
      // so this is a clean OR.
      if (matchesChip) return true;
      if (showComplete && isComplete) return true;
      return false;
    });
  }, [groups, statusFilters, showComplete, entityFilter, search]);

  // -------- Pagination (over groups, not items) --------
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0]);

  // Reset to page 0 when the filter set materially changes — same UX as
  // v1; without this the user sits on an empty page after toggling chips
  // off mid-scroll.
  useEffect(() => {
    setPage(0);
  }, [scope, statusFilters, showComplete, entityFilter, search]);

  const visibleGroups = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredGroups.slice(start, start + rowsPerPage);
  }, [filteredGroups, page, rowsPerPage]);

  // -------- Drawer placeholder (D.2 lands the matrix drawer) --------
  // We use the same placeholder UX as v1: clicking a row opens a stub
  // alert pointing at the most-urgent item in the group. D.2 swaps the
  // placeholder for the real worker × entity matrix.
  const [drawerGroupKey, setDrawerGroupKey] = useState<string | null>(null);
  const drawerGroup = drawerGroupKey
    ? filteredGroups.find((g) => g.key === drawerGroupKey) ?? null
    : null;

  const handleRowClick = useCallback((group: WorkerGroup) => {
    setDrawerGroupKey(group.key);
  }, []);

  const handleWorkerNameClick = useCallback(
    (group: WorkerGroup) => {
      navigate(`/users/${group.workerUid}`);
    },
    [navigate],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: { xs: 2, md: 3 }, pt: 1.5 }}>
      {/* Filter row — visually grouped under the page header so it reads
          as one toolbar instead of two stacks. Same widgets as v1; only
          their semantic interpretation changed. */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        flexWrap="wrap"
      >
        <WorkforceScopeToggle value={scope} onChange={setScope} />
        <WorkforceViewToggle value={view} onChange={setView} />
        {/* List-view chips/entity filter: matrix view has its own filter
            bar (severity / JO / worksite). Hiding these in matrix mode
            keeps the toolbar from looking double-stacked, since matrix
            ignores the chip / entity filters. */}
        {view === 'list' && (
          <>
            <WorkforceStatusChips
              selected={statusFilters}
              onChange={setStatusFilters}
              showComplete={showComplete}
              onShowCompleteChange={setShowComplete}
            />
            <WorkforceEntityFilter
              value={entityFilter}
              onChange={setEntityFilter}
              rows={allRows}
            />
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {view === 'list' && (
          <Typography variant="caption" color="text.secondary">
            {loading
              ? 'Loading…'
              : `${filteredGroups.length} worker${filteredGroups.length === 1 ? '' : 's'}${
                  filteredGroups.length !== groups.length ? ` of ${groups.length}` : ''
                }`}
          </Typography>
        )}
      </Stack>

      {view === 'matrix' && <MatrixView scope={scope} />}

      {view === 'list' && error && (
        <Alert severity="error" sx={{ mb: 0.5 }}>
          {error}
        </Alert>
      )}

      {view === 'list' && (
      <TableContainer
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
              <TableCell sx={headerCellSx}>Worker · Hiring entity</TableCell>
              <TableCell sx={headerCellSx}>Progress</TableCell>
              <TableCell sx={headerCellSx}>Status</TableCell>
              <TableCell sx={headerCellSx}>Owner</TableCell>
              <TableCell sx={headerCellSx}>Last activity</TableCell>
              <TableCell sx={{ ...headerCellSx, textAlign: 'right' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && filteredGroups.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 6, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {groups.length === 0
                      ? 'No employee readiness items in this tenant yet.'
                      : 'No workers match your current filters.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {loading && filteredGroups.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 6, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Loading employee readiness queue…
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleGroups.map((group) => (
              <WorkerReadinessRow
                key={group.key}
                group={group}
                currentUserUid={currentUserUid}
                onRowClick={handleRowClick}
                onWorkerNameClick={handleWorkerNameClick}
              />
            ))}
          </TableBody>
        </Table>

        {filteredGroups.length > 0 && (
          <StandardTablePagination
            count={filteredGroups.length}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
        )}
      </TableContainer>
      )}

      {/* Drawer placeholder — D.2 swaps in the worker × entity matrix.
          Surface the most urgent item in the group so the placeholder
          stays informative without committing to the per-item layout that
          D.1.1b retires. */}
      {drawerGroup && (
        <Alert
          severity="info"
          onClose={() => setDrawerGroupKey(null)}
          sx={{ position: 'fixed', right: 24, bottom: 24, maxWidth: 380, zIndex: 1500 }}
        >
          Worker × entity matrix drawer arrives in D.2. Selected:{' '}
          <strong>
            {drawerGroup.workerName} · {drawerGroup.hiringEntityName || drawerGroup.hiringEntityId}
          </strong>
          {drawerGroup.items.length > 0 && (
            <Box sx={{ mt: 0.5, fontSize: 12 }}>
              Most urgent:{' '}
              {drawerGroup.items[0].requirementLabel ||
                humanizeRequirementType(drawerGroup.items[0].requirementType)}
              {' · '}
              {drawerGroup.items[0].status}
            </Box>
          )}
        </Alert>
      )}
    </Box>
  );
};

const headerCellSx = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'text.secondary',
  letterSpacing: 0.4,
};

export default WorkforceEmployeeReadiness;
