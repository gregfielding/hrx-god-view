/**
 * Reusable Active Workers table: Career/Gig toggle + table of workers assigned to
 * and working a shift for job orders in the given scope (account or location).
 * Active = current date on or after assignment startDate and (no endDate or current date on or before endDate).
 *
 * When the optional `subAccountGrouping` prop is supplied (National accounts),
 * the component shows an extra Flat list / Sub accounts toggle. Sub-accounts
 * mode groups workers by which sub-account owns their job order, with an
 * "All sub accounts" / "With workers" secondary filter. Both toggles persist
 * per-account in localStorage under keys derived from `persistKey`.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Stack,
} from '@mui/material';
import { AccountTree as AccountTreeIcon, Business as BusinessIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';

export type ActiveWorkerMode = 'career' | 'gig';

export interface ActiveWorkerRow {
  id: string;
  assignmentId: string;
  tenantId: string;
  jobOrderId: string;
  jobOrderName: string;
  firstName: string;
  lastName: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

/**
 * Ordered sub-account group used by the Sub accounts grouped view. The first
 * entry should be the parent "(National)" group; children follow in whatever
 * order the caller wants them displayed.
 */
export interface ActiveWorkersSubAccountGroup {
  id: string;
  label: string;
  /** True for the parent "(National)" group — rendered with a slightly darker header + BusinessIcon. */
  isParent: boolean;
  /** Navigation target for clicking the header row (e.g. `/accounts/{id}`). Null = not clickable. */
  href: string | null;
}

export interface ActiveWorkersSubAccountGrouping {
  /** Ordered list of groups to render (parent first). */
  groups: ActiveWorkersSubAccountGroup[];
  /** Maps each job order id → the id of the group that owns it. JOs without a match land in the first (parent) group. */
  groupIdByJobOrderId: Record<string, string>;
  /** Used as the localStorage key suffix to persist the Flat/Sub and All/With-workers toggles per-account. */
  persistKey: string;
}

export interface ActiveWorkersTableProps {
  tenantId: string | null;
  /** Job order IDs to include (e.g. account's job orders or location's job orders). */
  jobOrderIds: string[];
  /** Optional title above the toggle. */
  title?: string;
  /**
   * Enables the Sub accounts grouped view. Only supply this on National
   * accounts — the toggle won't render when omitted.
   */
  subAccountGrouping?: ActiveWorkersSubAccountGrouping;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return null;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const ActiveWorkersTable: React.FC<ActiveWorkersTableProps> = ({
  tenantId,
  jobOrderIds,
  title = 'Active Workers',
  subAccountGrouping,
}) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ActiveWorkerMode>('career');
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<Array<Record<string, unknown>>>([]);
  const [jobOrderMeta, setJobOrderMeta] = useState<Record<string, { name: string; jobType: string }>>({});
  /**
   * `flat`: original single-table layout (existing behavior).
   * `sub-account`: workers grouped by the sub-account that owns their JO.
   * Only relevant when `subAccountGrouping` is supplied.
   */
  const [view, setView] = useState<'flat' | 'sub-account'>('flat');
  /** Secondary filter for Sub Accounts view — matches the Job Orders tab. */
  const [subFilter, setSubFilter] = useState<'all' | 'with-workers'>('all');

  // Hydrate toggles from localStorage on mount / when persist key changes.
  const persistKey = subAccountGrouping?.persistKey || null;
  useEffect(() => {
    if (!persistKey) {
      setView('flat');
      setSubFilter('all');
      return;
    }
    try {
      const storedView = localStorage.getItem(`activeWorkersView_${persistKey}`);
      setView(storedView === 'sub-account' ? 'sub-account' : 'flat');
      const storedFilter = localStorage.getItem(`activeWorkersSubFilter_${persistKey}`);
      setSubFilter(storedFilter === 'with-workers' ? 'with-workers' : 'all');
    } catch {
      setView('flat');
      setSubFilter('all');
    }
  }, [persistKey]);

  const handleViewChange = useCallback(
    (next: 'flat' | 'sub-account') => {
      setView(next);
      if (!persistKey) return;
      try {
        localStorage.setItem(`activeWorkersView_${persistKey}`, next);
      } catch {
        /* ignore */
      }
    },
    [persistKey],
  );
  const handleSubFilterChange = useCallback(
    (next: 'all' | 'with-workers') => {
      setSubFilter(next);
      if (!persistKey) return;
      try {
        localStorage.setItem(`activeWorkersSubFilter_${persistKey}`, next);
      } catch {
        /* ignore */
      }
    },
    [persistKey],
  );

  const today = useMemo(() => toDateOnly(new Date()), []);

  useEffect(() => {
    if (!tenantId || jobOrderIds.length === 0) {
      setAssignments([]);
      setJobOrderMeta({});
      return;
    }
    setLoading(true);
    const assignmentsRef = collection(db, p.assignments(tenantId));
    const chunks: string[][] = [];
    for (let i = 0; i < jobOrderIds.length; i += 10) {
      chunks.push(jobOrderIds.slice(i, i + 10));
    }
    Promise.all([
      Promise.all(chunks.map((chunk) => getDocs(query(assignmentsRef, where('jobOrderId', 'in', chunk))))),
      Promise.all(jobOrderIds.map((id) => getDoc(doc(db, p.jobOrder(tenantId, id))))),
    ])
      .then(([querySnaps, jobOrderSnaps]) => {
        const list: Array<Record<string, unknown>> = [];
        querySnaps.forEach((snap) => {
          snap.docs.forEach((d) => list.push({ id: d.id, ...d.data() } as Record<string, unknown>));
        });
        const meta: Record<string, { name: string; jobType: string }> = {};
        jobOrderSnaps.forEach((snap, idx) => {
          const id = jobOrderIds[idx];
          const data = snap.exists() ? snap.data() : null;
          const jobType = (data?.jobType ?? data?.jobOrderType ?? 'gig') as string;
          const name = (data?.jobOrderName ?? data?.title ?? data?.jobTitle ?? id) as string;
          meta[id] = { name, jobType: jobType.toLowerCase() };
        });
        setAssignments(list);
        setJobOrderMeta(meta);
      })
      .catch(() => {
        setAssignments([]);
        setJobOrderMeta({});
      })
      .finally(() => setLoading(false));
  }, [tenantId, jobOrderIds.join(',')]);

  const rows: ActiveWorkerRow[] = useMemo(() => {
    return assignments
      .filter((a) => {
        const status = String(a.status || '').toLowerCase();
        if (status !== 'active') return false;
        const jobOrderId = a.jobOrderId as string;
        const type = jobOrderMeta[jobOrderId]?.jobType ?? (a.jobOrderType as string)?.toLowerCase();
        if (type !== mode) return false;
        const start = parseDate(a.startDate);
        const end = a.endDate != null ? parseDate(a.endDate) : null;
        if (!start) return false;
        const startStr = toDateOnly(start);
        if (today < startStr) return false;
        if (end != null && today > toDateOnly(end)) return false;
        return true;
      })
      .map((a) => {
        const jobOrderId = a.jobOrderId as string;
        const start = parseDate(a.startDate);
        const end = a.endDate != null ? parseDate(a.endDate) : null;
        return {
          id: `${a.id}-${jobOrderId}`,
          assignmentId: a.id as string,
          tenantId: a.tenantId as string,
          jobOrderId,
          jobOrderName: jobOrderMeta[jobOrderId]?.name ?? (a.jobOrderName as string) ?? jobOrderId,
          firstName: (a.firstName as string) ?? '',
          lastName: (a.lastName as string) ?? '',
          startDate: start ? toDateOnly(start) : '—',
          endDate: end ? toDateOnly(end) : null,
          status: (a.status as string) ?? '—',
        };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  }, [assignments, jobOrderMeta, mode, today]);

  /**
   * Sub-account-grouped rows. Always returns every group from
   * `subAccountGrouping.groups` (in order) so empty sub-accounts still show
   * a header + "No active workers" placeholder, matching the Job Orders tab
   * pattern. Rows that don't match any mapped group fall into the first
   * group (which by convention is the parent "(National)" group).
   */
  const groupedRows = useMemo(() => {
    if (!subAccountGrouping || subAccountGrouping.groups.length === 0) return null;
    const { groups, groupIdByJobOrderId } = subAccountGrouping;
    const rowsByGroupId = new Map<string, ActiveWorkerRow[]>();
    for (const g of groups) rowsByGroupId.set(g.id, []);
    const parentId = groups[0]?.id;
    for (const row of rows) {
      const mappedId = groupIdByJobOrderId[row.jobOrderId];
      const targetId = mappedId && rowsByGroupId.has(mappedId) ? mappedId : parentId;
      if (targetId) rowsByGroupId.get(targetId)!.push(row);
    }
    return groups.map((g) => ({ group: g, rows: rowsByGroupId.get(g.id) || [] }));
  }, [rows, subAccountGrouping]);

  /** Shared row renderer — identical between flat and grouped table bodies. */
  const renderWorkerRow = (row: ActiveWorkerRow) => (
    <TableRow key={row.id}>
      <TableCell>{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</TableCell>
      <TableCell>{row.jobOrderName}</TableCell>
      <TableCell>{row.startDate}</TableCell>
      <TableCell>{row.endDate ?? '—'}</TableCell>
      <TableCell>{row.status}</TableCell>
    </TableRow>
  );

  const isGroupedView = Boolean(subAccountGrouping) && view === 'sub-account';
  const visibleGroupedRows =
    isGroupedView && groupedRows
      ? subFilter === 'with-workers'
        ? groupedRows.filter((g) => g.rows.length > 0)
        : groupedRows
      : null;

  return (
    <Box>
      {title && (
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          {title}
        </Typography>
      )}
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap" sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Show:
          </Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, v) => v != null && setMode(v)}
            size="small"
          >
            <ToggleButton value="career" aria-label="Career">
              Career
            </ToggleButton>
            <ToggleButton value="gig" aria-label="Gig">
              Gig
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {subAccountGrouping && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, next) => {
              if (next === 'flat' || next === 'sub-account') handleViewChange(next);
            }}
            aria-label="Active workers view"
            sx={{
              '& .MuiToggleButton-root': { textTransform: 'none' },
              '& .MuiToggleButton-root.Mui-selected': {
                backgroundColor: '#0B63C5',
                color: 'white',
                '&:hover': { backgroundColor: '#0B63C5' },
              },
            }}
          >
            <ToggleButton value="flat">Flat list</ToggleButton>
            <ToggleButton value="sub-account">Sub accounts</ToggleButton>
          </ToggleButtonGroup>
        )}
        {subAccountGrouping && view === 'sub-account' && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={subFilter}
            onChange={(_, next) => {
              if (next === 'all' || next === 'with-workers') handleSubFilterChange(next);
            }}
            aria-label="Sub accounts filter"
            sx={{
              '& .MuiToggleButton-root': { textTransform: 'none' },
              '& .MuiToggleButton-root.Mui-selected': {
                backgroundColor: '#0B63C5',
                color: 'white',
                '&:hover': { backgroundColor: '#0B63C5' },
              },
            }}
          >
            <ToggleButton value="all">All sub accounts</ToggleButton>
            <ToggleButton value="with-workers">With workers</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : !isGroupedView && rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No active {mode} workers in this scope.
        </Typography>
      ) : isGroupedView && visibleGroupedRows && visibleGroupedRows.length === 0 ? (
        // Sub Accounts view + "With workers" filter on + nothing matched.
        <Typography variant="body2" color="text.secondary">
          No sub accounts have active {mode} workers. Switch to "All sub accounts" to see every sub account.
        </Typography>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
        >
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Job order</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Start date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>End date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isGroupedView && visibleGroupedRows
                ? visibleGroupedRows.flatMap(({ group, rows: groupRows }) => {
                    // Sub-account header row — same tonal treatment as the Job
                    // Orders tab: BusinessIcon for the parent "(National)" group,
                    // AccountTreeIcon for sub-accounts, clickable when href is set.
                    const HeaderIcon = group.isParent ? BusinessIcon : AccountTreeIcon;
                    const headerRow = (
                      <TableRow
                        key={`grp-${group.id}`}
                        onClick={group.href ? () => navigate(group.href as string) : undefined}
                        sx={{
                          cursor: group.href ? 'pointer' : 'default',
                          backgroundColor: group.isParent ? '#EEF2F7' : '#F3F4F6',
                          '&:hover': group.href
                            ? { backgroundColor: group.isParent ? '#E3E9F1' : '#E5E7EB' }
                            : undefined,
                          borderTop: '2px solid',
                          borderTopColor: 'divider',
                        }}
                      >
                        <TableCell
                          colSpan={5}
                          sx={{ py: 1, fontWeight: 700, color: 'text.primary' }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <HeaderIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight={700} component="span">
                              {group.label}
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                    const bodyRows = groupRows.length
                      ? groupRows.map(renderWorkerRow)
                      : [
                          <TableRow key={`grp-${group.id}-empty`}>
                            <TableCell
                              colSpan={5}
                              sx={{
                                py: 1.5,
                                pl: 5,
                                color: 'text.secondary',
                                fontStyle: 'italic',
                                fontSize: '0.875rem',
                              }}
                            >
                              No active {mode} workers
                            </TableCell>
                          </TableRow>,
                        ];
                    return [headerRow, ...bodyRows];
                  })
                : rows.map(renderWorkerRow)}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default ActiveWorkersTable;
