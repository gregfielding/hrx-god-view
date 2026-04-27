/**
 * Account Workforce tab — Phase 3 of `docs/WORKFORCE_DOMAIN_MODEL.md`.
 *
 * Three sub-tabs over the same account scope:
 *   - Scheduled: confirmed future assignments (who's coming to work).
 *   - Active:    `account_workforce` roster with status === 'active'.
 *   - Inactive:  `account_workforce` roster with status === 'inactive'.
 *
 * Reuses the Flat / Sub accounts grouping pattern from the Job Orders tab.
 * Career/Gig only meaningful on Scheduled (it filters by JO type); Active
 * and Inactive are workforce-level views and don't expose it.
 *
 * Writes flow through the `setAccountWorkforceStatus` callable (no direct
 * Firestore writes from this component).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccountTree as AccountTreeIcon,
  Business as BusinessIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../firebase';
import { p } from '../../data/firestorePaths';
import type {
  AccountWorkforce,
  AccountWorkforceBlocker,
  AccountWorkforceDeactivationReason,
  AccountWorkforceStatus,
  SetAccountWorkforceStatusInput,
  SetAccountWorkforceStatusResult,
} from '../../shared/accountWorkforce';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import AssignmentOutcomeMenu from './AssignmentOutcomeMenu';
import WorkforceReadinessChip from './WorkforceReadinessChip';
import type { WorkerState } from '../../types/workforceStateV1';

/** Sub-tab keys; also used as localStorage key suffixes. */
type WorkforceSubTab = 'scheduled' | 'active' | 'inactive';

/** Mirrors ActiveWorkersTable.ActiveWorkersSubAccountGroup — kept local so this component stays standalone. */
export interface WorkforceSubAccountGroup {
  id: string;
  label: string;
  isParent: boolean;
  href: string | null;
}
export interface WorkforceSubAccountGrouping {
  groups: WorkforceSubAccountGroup[];
  /** Map: jobOrderId → group id that owns it (for Scheduled view). */
  groupIdByJobOrderId: Record<string, string>;
  /** Used as localStorage key suffix for toggle persistence (e.g. accountId). */
  persistKey: string;
}

export interface AccountWorkforceTabProps {
  tenantId: string | null;
  /** Account the tab is currently rendered for — National parent or child. */
  account: {
    id?: string;
    name?: string;
    accountType?: string | null;
    childAccountIds?: string[];
  } | null;
  /** Full set of job order IDs in scope (including children for National). Feeds Scheduled queries. */
  jobOrderIds: string[];
  /** Provided only for National accounts. */
  subAccountGrouping?: WorkforceSubAccountGrouping;
}

/** Reason codes + display labels — matches the seven from shared/accountWorkforce.ts. */
const DEACTIVATION_REASONS: Array<{
  value: AccountWorkforceDeactivationReason;
  label: string;
}> = [
  { value: 'no_show', label: 'No-show (repeated)' },
  { value: 'left_early_repeat', label: 'Left early (repeated)' },
  { value: 'client_requested', label: 'Client requested replacement' },
  { value: 'performance', label: 'Performance / quality' },
  { value: 'attendance', label: 'Attendance / reliability' },
  { value: 'policy', label: 'Policy violation' },
  { value: 'worker_request', label: 'Worker requested off this account' },
  { value: 'other', label: 'Other (notes required)' },
];

const setAccountWorkforceStatusCallable = httpsCallable<
  SetAccountWorkforceStatusInput,
  SetAccountWorkforceStatusResult
>(functions, 'setAccountWorkforceStatus');

// ===========================================================================
// Main component
// ===========================================================================

const AccountWorkforceTab: React.FC<AccountWorkforceTabProps> = ({
  tenantId,
  account,
  jobOrderIds,
  subAccountGrouping,
}) => {
  const isNationalAccount = account?.accountType === 'national';

  // --- Persisted toggle state ---
  const [subTab, setSubTab] = useState<WorkforceSubTab>('active');
  const [careerGig, setCareerGig] = useState<'career' | 'gig'>('career');
  const [view, setView] = useState<'flat' | 'sub-account'>('flat');
  const [subFilter, setSubFilter] = useState<'all' | 'with-workers'>('all');

  const persistKey = subAccountGrouping?.persistKey || account?.id || null;

  useEffect(() => {
    if (!persistKey) return;
    try {
      const storedTab = localStorage.getItem(`workforceSubTab_${persistKey}`);
      if (storedTab === 'scheduled' || storedTab === 'active' || storedTab === 'inactive') {
        setSubTab(storedTab);
      }
      const storedCareer = localStorage.getItem(`workforceCareerGig_${persistKey}`);
      setCareerGig(storedCareer === 'gig' ? 'gig' : 'career');
      const storedView = localStorage.getItem(`workforceView_${persistKey}`);
      setView(storedView === 'sub-account' ? 'sub-account' : 'flat');
      const storedFilter = localStorage.getItem(`workforceSubFilter_${persistKey}`);
      setSubFilter(storedFilter === 'with-workers' ? 'with-workers' : 'all');
    } catch {
      /* localStorage disabled (private tab) — defaults stand. */
    }
  }, [persistKey]);

  const persist = useCallback(
    (suffix: string, value: string) => {
      if (!persistKey) return;
      try {
        localStorage.setItem(`workforce${suffix}_${persistKey}`, value);
      } catch {
        /* ignore */
      }
    },
    [persistKey],
  );
  const handleSubTab = useCallback(
    (next: WorkforceSubTab) => {
      setSubTab(next);
      persist('SubTab', next);
    },
    [persist],
  );
  const handleCareerGig = useCallback(
    (next: 'career' | 'gig') => {
      setCareerGig(next);
      persist('CareerGig', next);
    },
    [persist],
  );
  const handleView = useCallback(
    (next: 'flat' | 'sub-account') => {
      setView(next);
      persist('View', next);
    },
    [persist],
  );
  const handleSubFilter = useCallback(
    (next: 'all' | 'with-workers') => {
      setSubFilter(next);
      persist('SubFilter', next);
    },
    [persist],
  );

  // --- Shared roster data (Active + Inactive sub-tabs) ---
  const { rosterRows, rosterLoading, rosterError, refreshRoster } = useAccountWorkforceRoster({
    tenantId,
    account,
  });

  // --- Scheduled data ---
  const { scheduledRows, scheduledLoading, scheduledError, refreshScheduled } =
    useScheduledAssignments({
      tenantId,
      jobOrderIds,
      mode: careerGig,
      enabled: subTab === 'scheduled',
    });

  // --- Dialog state (deactivate / reactivate) ---
  const [deactivateTarget, setDeactivateTarget] = useState<AccountWorkforceRosterRow | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<AccountWorkforceRosterRow | null>(null);

  // Shared sx for toggles — matches the Job Orders / Workforce filter bar look.
  const toggleSx = {
    height: 36,
    '& .MuiToggleButton-root': {
      textTransform: 'none',
      fontSize: '0.875rem',
      px: 1.75,
      borderRadius: '6px',
      backgroundColor: 'white',
    },
    '& .MuiToggleButton-root.Mui-selected': {
      backgroundColor: '#0B63C5',
      color: 'white',
      '&:hover': { backgroundColor: '#0B63C5' },
    },
  } as const;

  return (
    <Box>
      {/* Sub-tab strip — MUI Tabs with a thin underline, sits above the filter bar. */}
      <Tabs
        value={subTab}
        onChange={(_, v) => handleSubTab(v as WorkforceSubTab)}
        sx={{
          minHeight: 36,
          mb: 1.5,
          '& .MuiTab-root': {
            textTransform: 'none',
            fontSize: '0.9375rem',
            fontWeight: 500,
            minHeight: 36,
            px: 2,
          },
          '& .MuiTabs-indicator': { backgroundColor: '#0B63C5' },
        }}
      >
        <Tab value="scheduled" label="Scheduled" />
        <Tab value="active" label="Active" />
        <Tab value="inactive" label="Inactive" />
      </Tabs>

      {/* Filter bar — same container as Job Orders / Workforce filter strip. */}
      <Box
        sx={{
          p: 1.5,
          mb: 2,
          backgroundColor: '#F9FAFB',
          borderRadius: '8px',
          border: '1px solid #E5E7EB',
        }}
      >
        <Stack direction="row" gap={1.5} flexWrap="wrap">
          {/* Career / Gig: only meaningful on Scheduled — it's a JO type filter. */}
          {subTab === 'scheduled' && (
            <ToggleButtonGroup
              value={careerGig}
              exclusive
              onChange={(_, v) => v && handleCareerGig(v as 'career' | 'gig')}
              size="small"
              aria-label="Career or Gig"
              sx={toggleSx}
            >
              <ToggleButton value="career">Career</ToggleButton>
              <ToggleButton value="gig">Gig</ToggleButton>
            </ToggleButtonGroup>
          )}
          {subAccountGrouping && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_, next) => {
                if (next === 'flat' || next === 'sub-account') handleView(next);
              }}
              aria-label="Workforce view"
              sx={toggleSx}
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
                if (next === 'all' || next === 'with-workers') handleSubFilter(next);
              }}
              aria-label="Sub accounts filter"
              sx={toggleSx}
            >
              <ToggleButton value="all">All sub accounts</ToggleButton>
              <ToggleButton value="with-workers">
                {subTab === 'scheduled' ? 'With shifts' : 'With workers'}
              </ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
      </Box>

      {/* Content — per sub-tab. */}
      {subTab === 'scheduled' && (
        <ScheduledView
          tenantId={tenantId}
          loading={scheduledLoading}
          error={scheduledError}
          rows={scheduledRows}
          mode={careerGig}
          view={view}
          subFilter={subFilter}
          subAccountGrouping={subAccountGrouping}
          onRefresh={refreshScheduled}
        />
      )}
      {subTab === 'active' && (
        <RosterView
          mode="active"
          loading={rosterLoading}
          error={rosterError}
          rows={rosterRows.filter((r) => r.status === 'active')}
          view={view}
          subFilter={subFilter}
          subAccountGrouping={subAccountGrouping}
          onDeactivate={(row) => setDeactivateTarget(row)}
          onReactivate={undefined}
        />
      )}
      {subTab === 'inactive' && (
        <RosterView
          mode="inactive"
          loading={rosterLoading}
          error={rosterError}
          rows={rosterRows.filter((r) => r.status === 'inactive')}
          view={view}
          subFilter={subFilter}
          subAccountGrouping={subAccountGrouping}
          onDeactivate={undefined}
          onReactivate={(row) => setReactivateTarget(row)}
        />
      )}

      {/* Dialogs — mounted lazily, controlled by target state. */}
      {deactivateTarget && tenantId && (
        <DeactivateDialog
          tenantId={tenantId}
          row={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          onSuccess={async () => {
            setDeactivateTarget(null);
            await refreshRoster();
          }}
        />
      )}
      {reactivateTarget && tenantId && (
        <ReactivateDialog
          tenantId={tenantId}
          row={reactivateTarget}
          onClose={() => setReactivateTarget(null)}
          onSuccess={async () => {
            setReactivateTarget(null);
            await refreshRoster();
          }}
        />
      )}
    </Box>
  );
};

export default AccountWorkforceTab;

// ===========================================================================
// Roster (Active + Inactive) data hook
// ===========================================================================

type AccountWorkforceRosterRow = {
  docId: string;
  tenantId: string;
  accountId: string;
  workerId: string;
  status: AccountWorkforceStatus;
  workerName: string;
  engagementType?: 'w2' | '1099';
  firstConfirmedAt?: Date | null;
  lastShiftAt?: Date | null;
  totalShifts: number;
  completedShifts: number;
  deactivatedAt?: Date | null;
  deactivatedBy?: string;
  deactivationReason?: AccountWorkforceDeactivationReason;
  deactivationNotes?: string;
  blockers: AccountWorkforceBlocker[];
  /**
   * Canonical worker readiness state (`users.{uid}.workerReadinessV1.overallWorkerState`).
   * Surfaced as a chip in the Active list — same data the profile banner uses.
   */
  overallWorkerState?: WorkerState | null;
};

function useAccountWorkforceRoster(args: {
  tenantId: string | null;
  account: AccountWorkforceTabProps['account'];
}): {
  rosterRows: AccountWorkforceRosterRow[];
  rosterLoading: boolean;
  rosterError: string | null;
  refreshRoster: () => Promise<void>;
} {
  const { tenantId, account } = args;
  const [rosterRows, setRosterRows] = useState<AccountWorkforceRosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const accountIds = useMemo(() => {
    if (!account?.id) return [] as string[];
    const ids = new Set<string>([account.id]);
    (account.childAccountIds || []).forEach((id) => {
      if (typeof id === 'string' && id.trim() !== '') ids.add(id.trim());
    });
    return Array.from(ids);
  }, [account?.id, account?.childAccountIds?.join(',')]);

  const load = useCallback(async () => {
    if (!tenantId || accountIds.length === 0) {
      setRosterRows([]);
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      // Firestore `in` supports up to 30 values. National accounts with
      // more children than that — chunk. Deduplicate docs across chunks.
      const CHUNK = 30;
      const rawDocs = new Map<string, AccountWorkforce>();
      const ref = collection(db, p.accountWorkforce(tenantId));
      for (let i = 0; i < accountIds.length; i += CHUNK) {
        const slice = accountIds.slice(i, i + CHUNK);
        const q = query(ref, where('accountId', 'in', slice));
        const snap = await getDocs(q);
        snap.docs.forEach((d) => {
          rawDocs.set(d.id, d.data() as AccountWorkforce);
        });
      }

      // Resolve worker names + readiness state in parallel — one users doc
      // per unique workerId. Same fetch powers the roster name and the
      // Phase 5 readiness chip, so no extra roundtrip.
      const workerIds = Array.from(
        new Set(Array.from(rawDocs.values()).map((v) => v.workerId)),
      );
      const workerNameById = new Map<string, string>();
      const workerStateById = new Map<string, WorkerState | null>();
      await Promise.all(
        workerIds.map(async (wid) => {
          try {
            const wSnap = await getDoc(doc(db, 'users', wid));
            if (!wSnap.exists()) {
              workerNameById.set(wid, wid);
              workerStateById.set(wid, null);
              return;
            }
            const wData = wSnap.data() as Record<string, unknown>;
            const first = typeof wData.firstName === 'string' ? wData.firstName : '';
            const last = typeof wData.lastName === 'string' ? wData.lastName : '';
            const display =
              typeof wData.displayName === 'string' ? wData.displayName.trim() : '';
            const combined = `${first} ${last}`.trim();
            workerNameById.set(wid, combined || display || wid);
            const wr = (wData.workerReadinessV1 || {}) as Record<string, unknown>;
            const rawState = typeof wr.overallWorkerState === 'string'
              ? (wr.overallWorkerState as WorkerState)
              : null;
            workerStateById.set(wid, rawState);
          } catch {
            workerNameById.set(wid, wid);
            workerStateById.set(wid, null);
          }
        }),
      );

      const rows: AccountWorkforceRosterRow[] = Array.from(rawDocs.entries()).map(
        ([docId, data]) => ({
          docId,
          tenantId: data.tenantId,
          accountId: data.accountId,
          workerId: data.workerId,
          status: data.status,
          workerName: workerNameById.get(data.workerId) || data.workerId,
          engagementType: data.engagementType,
          firstConfirmedAt: timestampToDate(data.firstConfirmedAt),
          lastShiftAt: timestampToDate(data.lastShiftAt),
          totalShifts: data.totalShifts ?? 0,
          completedShifts: data.completedShifts ?? 0,
          deactivatedAt: timestampToDate(data.deactivatedAt),
          deactivatedBy: data.deactivatedBy,
          deactivationReason: data.deactivationReason,
          deactivationNotes: data.deactivationNotes,
          blockers: Array.isArray(data.blockers) ? data.blockers : [],
          overallWorkerState: workerStateById.get(data.workerId) ?? null,
        }),
      );
      // Sort: active rows by lastShiftAt desc (fallback firstConfirmedAt);
      // inactive rows by deactivatedAt desc. Components filter by status
      // before rendering, so one combined array is fine.
      rows.sort((a, b) => {
        const aKey =
          a.status === 'inactive'
            ? a.deactivatedAt?.getTime() ?? 0
            : a.lastShiftAt?.getTime() ?? a.firstConfirmedAt?.getTime() ?? 0;
        const bKey =
          b.status === 'inactive'
            ? b.deactivatedAt?.getTime() ?? 0
            : b.lastShiftAt?.getTime() ?? b.firstConfirmedAt?.getTime() ?? 0;
        return bKey - aKey;
      });
      setRosterRows(rows);
    } catch (err) {
      setRosterError((err as Error).message || 'Failed to load workforce roster');
      setRosterRows([]);
    } finally {
      setRosterLoading(false);
    }
  }, [tenantId, accountIds.join(',')]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rosterRows, rosterLoading, rosterError, refreshRoster: load };
}

// ===========================================================================
// Scheduled data hook
// ===========================================================================

type ScheduledRow = {
  id: string;
  assignmentId: string;
  jobOrderId: string;
  workerId: string;
  workerName: string;
  jobOrderName: string;
  jobOrderType: 'career' | 'gig';
  shiftStart: Date | null;
  shiftEnd: Date | null;
  status: string;
  /** Canonical readiness state from `users.{uid}.workerReadinessV1.overallWorkerState`. */
  overallWorkerState?: WorkerState | null;
};

function useScheduledAssignments(args: {
  tenantId: string | null;
  jobOrderIds: string[];
  mode: 'career' | 'gig';
  enabled: boolean;
}): {
  scheduledRows: ScheduledRow[];
  scheduledLoading: boolean;
  scheduledError: string | null;
  refreshScheduled: () => Promise<void>;
} {
  const { tenantId, jobOrderIds, mode, enabled } = args;
  const [scheduledRows, setScheduledRows] = useState<ScheduledRow[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledError, setScheduledError] = useState<string | null>(null);
  /** Bumped by `refreshScheduled` to force a re-run of the load effect. */
  const [reloadKey, setReloadKey] = useState(0);

  const refreshScheduled = useCallback(async () => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !tenantId || jobOrderIds.length === 0) {
      setScheduledRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setScheduledLoading(true);
      setScheduledError(null);
      try {
        // Fetch assignments + JO metadata in parallel, chunking by 10
        // (Firestore `in` limit for `jobOrderId in [...]`).
        const assignmentsRef = collection(db, p.assignments(tenantId));
        const chunks: string[][] = [];
        for (let i = 0; i < jobOrderIds.length; i += 10) {
          chunks.push(jobOrderIds.slice(i, i + 10));
        }
        const [assignmentSnaps, jobOrderSnaps] = await Promise.all([
          Promise.all(
            chunks.map((c) =>
              getDocs(query(assignmentsRef, where('jobOrderId', 'in', c))),
            ),
          ),
          Promise.all(
            chunks.map((c) =>
              getDocs(
                query(
                  collection(db, p.jobOrders(tenantId)),
                  where(documentId(), 'in', c),
                ),
              ),
            ),
          ),
        ]);
        if (cancelled) return;

        const jobOrderMeta = new Map<string, { name: string; jobType: 'career' | 'gig' }>();
        for (const snap of jobOrderSnaps) {
          snap.docs.forEach((d) => {
            const data = d.data() as Record<string, unknown>;
            const rawType = String(data.jobType || data.jobOrderType || 'gig').toLowerCase();
            const jobType: 'career' | 'gig' = rawType === 'career' ? 'career' : 'gig';
            const name = String(
              data.jobOrderName ?? data.title ?? data.jobTitle ?? d.id,
            );
            jobOrderMeta.set(d.id, { name, jobType });
          });
        }

        const assignments: Array<Record<string, unknown> & { id: string }> = [];
        for (const snap of assignmentSnaps) {
          snap.docs.forEach((d) =>
            assignments.push({ id: d.id, ...(d.data() as Record<string, unknown>) }),
          );
        }

        const now = Date.now();
        // Outcome-capture grace — shifts that ended within the last 48h
        // stay on the Scheduled list with an actionable menu. Once the
        // recruiter marks an outcome, the row drops out (status flips
        // away from `confirmed`). Prevents building a separate
        // "past shifts" view just to host the menu.
        const OUTCOME_GRACE_MS = 48 * 60 * 60 * 1000;
        const earliestEndCutoff = now - OUTCOME_GRACE_MS;
        const rows: ScheduledRow[] = [];
        const workerIdsNeedingLookup = new Set<string>();
        for (const a of assignments) {
          const status = String(a.status || '').toLowerCase();
          if (status !== 'confirmed') continue;
          const jobOrderId = String(a.jobOrderId || '');
          const meta = jobOrderMeta.get(jobOrderId);
          if (!meta) continue;
          if (meta.jobType !== mode) continue;
          const shiftStart = toDate(a.startDate);
          const shiftEnd = toDate(a.endDate);
          // Include future shifts, in-progress shifts, and shifts that
          // ended within the last 48h (the outcome-capture grace window).
          const upperBound = shiftEnd ?? shiftStart;
          if (upperBound && upperBound.getTime() < earliestEndCutoff) continue;

          const workerId =
            pickString(a.userId, a.candidateId, (a as any).workerUid) ?? '';
          if (!workerId) continue;

          const firstName =
            typeof a.firstName === 'string' ? (a.firstName as string) : '';
          const lastName = typeof a.lastName === 'string' ? (a.lastName as string) : '';
          const inlineName = `${firstName} ${lastName}`.trim();
          // Always add to the lookup set — Phase 5 needs readiness state
          // from the user doc regardless of whether the assignment carried
          // an inline name. One query per unique worker.
          workerIdsNeedingLookup.add(workerId);

          rows.push({
            id: `${a.id}-${jobOrderId}`,
            assignmentId: a.id,
            jobOrderId,
            workerId,
            workerName: inlineName,
            jobOrderName: meta.name,
            jobOrderType: meta.jobType,
            shiftStart,
            shiftEnd,
            status,
          });
        }

        // Resolve names + readiness state for every unique worker in the set.
        if (workerIdsNeedingLookup.size > 0) {
          const idList = Array.from(workerIdsNeedingLookup);
          const workerNameById = new Map<string, string>();
          const workerStateById = new Map<string, WorkerState | null>();
          await Promise.all(
            idList.map(async (wid) => {
              try {
                const wSnap = await getDoc(doc(db, 'users', wid));
                if (!wSnap.exists()) return;
                const data = wSnap.data() as Record<string, unknown>;
                const f = typeof data.firstName === 'string' ? data.firstName : '';
                const l = typeof data.lastName === 'string' ? data.lastName : '';
                const dn = typeof data.displayName === 'string' ? data.displayName : '';
                const combined = `${f} ${l}`.trim();
                workerNameById.set(wid, combined || dn || wid);
                const wr = (data.workerReadinessV1 || {}) as Record<string, unknown>;
                const rawState = typeof wr.overallWorkerState === 'string'
                  ? (wr.overallWorkerState as WorkerState)
                  : null;
                workerStateById.set(wid, rawState);
              } catch {
                /* ignore — name falls back to id, state stays null */
              }
            }),
          );
          for (const r of rows) {
            if (!r.workerName) {
              r.workerName = workerNameById.get(r.workerId) || r.workerId;
            }
            r.overallWorkerState = workerStateById.get(r.workerId) ?? null;
          }
        }

        rows.sort((a, b) => {
          const aMs = a.shiftStart?.getTime() ?? Number.POSITIVE_INFINITY;
          const bMs = b.shiftStart?.getTime() ?? Number.POSITIVE_INFINITY;
          return aMs - bMs;
        });

        if (!cancelled) setScheduledRows(rows);
      } catch (err) {
        if (!cancelled) {
          setScheduledError((err as Error).message || 'Failed to load scheduled shifts');
          setScheduledRows([]);
        }
      } finally {
        if (!cancelled) setScheduledLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrderIds.join(','), mode, enabled, reloadKey]);

  return { scheduledRows, scheduledLoading, scheduledError, refreshScheduled };
}

// ===========================================================================
// RosterView — shared renderer for Active + Inactive
// ===========================================================================

function RosterView(props: {
  mode: 'active' | 'inactive';
  loading: boolean;
  error: string | null;
  rows: AccountWorkforceRosterRow[];
  view: 'flat' | 'sub-account';
  subFilter: 'all' | 'with-workers';
  subAccountGrouping?: WorkforceSubAccountGrouping;
  onDeactivate?: (row: AccountWorkforceRosterRow) => void;
  onReactivate?: (row: AccountWorkforceRosterRow) => void;
}) {
  const {
    mode,
    loading,
    error,
    rows,
    view,
    subFilter,
    subAccountGrouping,
    onDeactivate,
    onReactivate,
  } = props;
  const navigate = useNavigate();

  const isGrouped = view === 'sub-account' && !!subAccountGrouping;

  if (loading && rows.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }
  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  const renderRow = (row: AccountWorkforceRosterRow) => (
    <TableRow key={row.docId} hover>
      <TableCell>
        <Typography variant="body2">{row.workerName}</Typography>
        {row.engagementType && (
          <Typography variant="caption" color="text.secondary">
            {row.engagementType.toUpperCase()}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <WorkforceReadinessChip state={row.overallWorkerState} dense />
      </TableCell>
      {mode === 'active' ? (
        <>
          <TableCell>
            {row.lastShiftAt ? (
              row.lastShiftAt.toLocaleDateString()
            ) : (
              <Typography variant="caption" color="text.secondary">
                —
              </Typography>
            )}
          </TableCell>
          <TableCell align="right">
            {row.totalShifts}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              ({row.completedShifts} completed)
            </Typography>
          </TableCell>
          <TableCell align="right">
            {onDeactivate && (
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => onDeactivate(row)}
                sx={{ textTransform: 'none' }}
              >
                Deactivate
              </Button>
            )}
          </TableCell>
        </>
      ) : (
        <>
          <TableCell>
            {row.deactivatedAt ? row.deactivatedAt.toLocaleDateString() : '—'}
          </TableCell>
          <TableCell>
            {row.deactivationReason ? reasonLabel(row.deactivationReason) : '—'}
            {row.deactivationNotes && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {row.deactivationNotes}
              </Typography>
            )}
          </TableCell>
          <TableCell>
            {row.blockers.length > 0 && (
              <Stack spacing={0.5}>
                {row.blockers.map((b, i) => (
                  <Tooltip
                    key={`${b.code}-${b.assignmentId}-${i}`}
                    title={`Assignment ${b.assignmentId} confirmed while inactive (${new Date(b.at).toLocaleString()})`}
                  >
                    <Chip
                      icon={<WarningIcon />}
                      label="Confirmed while inactive"
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  </Tooltip>
                ))}
              </Stack>
            )}
          </TableCell>
          <TableCell align="right">
            {onReactivate && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => onReactivate(row)}
                sx={{ textTransform: 'none' }}
              >
                Reactivate
              </Button>
            )}
          </TableCell>
        </>
      )}
    </TableRow>
  );

  const headers =
    mode === 'active' ? (
      <TableRow sx={{ bgcolor: 'grey.50' }}>
        <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
        <TableCell sx={{ fontWeight: 600 }}>Readiness</TableCell>
        <TableCell sx={{ fontWeight: 600 }}>Last shift</TableCell>
        <TableCell sx={{ fontWeight: 600 }} align="right">Shifts</TableCell>
        <TableCell align="right" />
      </TableRow>
    ) : (
      <TableRow sx={{ bgcolor: 'grey.50' }}>
        <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
        <TableCell sx={{ fontWeight: 600 }}>Readiness</TableCell>
        <TableCell sx={{ fontWeight: 600 }}>Deactivated</TableCell>
        <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
        <TableCell sx={{ fontWeight: 600 }}>Blockers</TableCell>
        <TableCell align="right" />
      </TableRow>
    );
  const colSpan = mode === 'active' ? 5 : 6;

  // --- Grouped body ---
  if (isGrouped && subAccountGrouping) {
    const groups = subAccountGrouping.groups;
    const rowsByGroup = new Map<string, AccountWorkforceRosterRow[]>();
    for (const g of groups) rowsByGroup.set(g.id, []);
    for (const r of rows) {
      const bucket = rowsByGroup.has(r.accountId)
        ? r.accountId
        : (groups[0]?.id ?? '');
      if (bucket) rowsByGroup.get(bucket)!.push(r);
    }
    const visibleGroups =
      subFilter === 'with-workers'
        ? groups.filter((g) => (rowsByGroup.get(g.id) || []).length > 0)
        : groups;

    if (rows.length === 0 && subFilter === 'with-workers') {
      return (
        <Typography variant="body2" color="text.secondary">
          {mode === 'active'
            ? 'No sub accounts have active workers. Switch to "All sub accounts" to see every sub account.'
            : 'No sub accounts have inactive workers. Switch to "All sub accounts" to see every sub account.'}
        </Typography>
      );
    }

    return (
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
      >
        <Table size="small">
          <TableHead>{headers}</TableHead>
          <TableBody>
            {visibleGroups.flatMap((g) => {
              const groupRows = rowsByGroup.get(g.id) || [];
              const HeaderIcon = g.isParent ? BusinessIcon : AccountTreeIcon;
              const headerRow = (
                <TableRow
                  key={`group-${g.id}`}
                  onClick={g.href ? () => navigate(g.href as string) : undefined}
                  sx={{
                    cursor: g.href ? 'pointer' : 'default',
                    backgroundColor: g.isParent ? '#EEF2F7' : '#F3F4F6',
                    '&:hover': g.href
                      ? { backgroundColor: g.isParent ? '#E3E9F1' : '#E5E7EB' }
                      : undefined,
                    borderTop: '2px solid',
                    borderTopColor: 'divider',
                  }}
                >
                  <TableCell
                    colSpan={colSpan}
                    sx={{ py: 1, fontWeight: 700, color: 'text.primary' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <HeaderIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" fontWeight={700} component="span">
                        {g.label}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              );
              const bodyRows = groupRows.length
                ? groupRows.map(renderRow)
                : [
                    <TableRow key={`group-${g.id}-empty`}>
                      <TableCell
                        colSpan={colSpan}
                        sx={{
                          py: 1.5,
                          pl: 5,
                          color: 'text.secondary',
                          fontStyle: 'italic',
                          fontSize: '0.875rem',
                        }}
                      >
                        {mode === 'active'
                          ? 'No active workers'
                          : 'No inactive workers'}
                      </TableCell>
                    </TableRow>,
                  ];
              return [headerRow, ...bodyRows];
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  // --- Flat body ---
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {mode === 'active'
          ? 'No active workers in this scope yet.'
          : 'No inactive workers in this scope.'}
      </Typography>
    );
  }
  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
    >
      <Table size="small">
        <TableHead>{headers}</TableHead>
        <TableBody>{rows.map(renderRow)}</TableBody>
      </Table>
    </TableContainer>
  );
}

// ===========================================================================
// ScheduledView
// ===========================================================================

function ScheduledView(props: {
  tenantId: string | null;
  loading: boolean;
  error: string | null;
  rows: ScheduledRow[];
  mode: 'career' | 'gig';
  view: 'flat' | 'sub-account';
  subFilter: 'all' | 'with-workers';
  subAccountGrouping?: WorkforceSubAccountGrouping;
  onRefresh: () => Promise<void>;
}) {
  const { tenantId, loading, error, rows, mode, view, subFilter, subAccountGrouping, onRefresh } =
    props;
  const navigate = useNavigate();
  const isGrouped = view === 'sub-account' && !!subAccountGrouping;

  if (loading && rows.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;

  const renderRow = (row: ScheduledRow) => (
    <TableRow
      key={row.id}
      hover
      onClick={() => navigate(`/jobs/job-orders/${row.jobOrderId}`)}
      sx={{ cursor: 'pointer' }}
    >
      <TableCell>
        <Typography variant="body2">{row.workerName || row.workerId}</Typography>
      </TableCell>
      <TableCell>
        <WorkforceReadinessChip state={row.overallWorkerState} dense />
      </TableCell>
      <TableCell>{row.jobOrderName}</TableCell>
      <TableCell>
        {row.shiftStart ? (
          <>
            <Typography variant="body2">
              {row.shiftStart.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {row.shiftStart.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Typography>
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <Chip label={row.jobOrderType === 'gig' ? 'Gig' : 'Career'} size="small" />
      </TableCell>
      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
        {tenantId && (
          <AssignmentOutcomeMenu
            tenantId={tenantId}
            assignmentId={row.assignmentId}
            currentStatus={row.status}
            shiftStart={row.shiftStart}
            onOutcomeChanged={onRefresh}
          />
        )}
      </TableCell>
    </TableRow>
  );

  const headers = (
    <TableRow sx={{ bgcolor: 'grey.50' }}>
      <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Readiness</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Job order</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Starts</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
      <TableCell sx={{ fontWeight: 600, width: 48 }} align="right" />
    </TableRow>
  );
  const colSpan = 6;

  if (isGrouped && subAccountGrouping) {
    const groups = subAccountGrouping.groups;
    const groupIdByJo = subAccountGrouping.groupIdByJobOrderId;
    const rowsByGroup = new Map<string, ScheduledRow[]>();
    for (const g of groups) rowsByGroup.set(g.id, []);
    for (const r of rows) {
      const mappedId = groupIdByJo[r.jobOrderId];
      const bucket = mappedId && rowsByGroup.has(mappedId) ? mappedId : groups[0]?.id ?? '';
      if (bucket) rowsByGroup.get(bucket)!.push(r);
    }
    const visibleGroups =
      subFilter === 'with-workers'
        ? groups.filter((g) => (rowsByGroup.get(g.id) || []).length > 0)
        : groups;

    if (rows.length === 0 && subFilter === 'with-workers') {
      return (
        <Typography variant="body2" color="text.secondary">
          No sub accounts have scheduled {mode} shifts. Switch to "All sub accounts" to see every sub account.
        </Typography>
      );
    }

    return (
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
      >
        <Table size="small">
          <TableHead>{headers}</TableHead>
          <TableBody>
            {visibleGroups.flatMap((g) => {
              const groupRows = rowsByGroup.get(g.id) || [];
              const HeaderIcon = g.isParent ? BusinessIcon : AccountTreeIcon;
              const headerRow = (
                <TableRow
                  key={`group-${g.id}`}
                  onClick={g.href ? () => navigate(g.href as string) : undefined}
                  sx={{
                    cursor: g.href ? 'pointer' : 'default',
                    backgroundColor: g.isParent ? '#EEF2F7' : '#F3F4F6',
                    '&:hover': g.href
                      ? { backgroundColor: g.isParent ? '#E3E9F1' : '#E5E7EB' }
                      : undefined,
                    borderTop: '2px solid',
                    borderTopColor: 'divider',
                  }}
                >
                  <TableCell colSpan={colSpan} sx={{ py: 1, fontWeight: 700 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <HeaderIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" fontWeight={700} component="span">
                        {g.label}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              );
              const bodyRows = groupRows.length
                ? groupRows.map(renderRow)
                : [
                    <TableRow key={`group-${g.id}-empty`}>
                      <TableCell
                        colSpan={colSpan}
                        sx={{
                          py: 1.5,
                          pl: 5,
                          color: 'text.secondary',
                          fontStyle: 'italic',
                          fontSize: '0.875rem',
                        }}
                      >
                        No scheduled {mode} shifts
                      </TableCell>
                    </TableRow>,
                  ];
              return [headerRow, ...bodyRows];
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No scheduled {mode} shifts in this scope.
      </Typography>
    );
  }
  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
    >
      <Table size="small">
        <TableHead>{headers}</TableHead>
        <TableBody>{rows.map(renderRow)}</TableBody>
      </Table>
    </TableContainer>
  );
}

// ===========================================================================
// DeactivateDialog
// ===========================================================================

function DeactivateDialog(props: {
  tenantId: string;
  row: AccountWorkforceRosterRow;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const { tenantId, row, onClose, onSuccess } = props;
  const [reason, setReason] = useState<AccountWorkforceDeactivationReason | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load this worker's confirmed future assignments for THIS account so the
  // recruiter can see exactly what gets cancelled, and opt items out if
  // needed (default-on checkboxes, per doc §3.5).
  const [futureAssignments, setFutureAssignments] = useState<
    Array<{
      id: string;
      jobOrderId: string;
      jobOrderName: string;
      shiftStart: Date | null;
    }>
  >([]);
  const [cancelIds, setCancelIds] = useState<Set<string>>(new Set());
  const [loadingFuture, setLoadingFuture] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingFuture(true);
      try {
        // Confirmed future assignments for this worker. We then filter down
        // to just JOs whose recruiterAccountId matches this row's accountId
        // so we don't touch cross-account shifts.
        const q = query(
          collection(db, p.assignments(tenantId)),
          where('userId', '==', row.workerId),
          where('status', '==', 'confirmed'),
        );
        const snap = await getDocs(q);
        const now = Date.now();
        const candidates: typeof futureAssignments = [];
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          const start = toDate(data.startDate);
          const end = toDate(data.endDate);
          const upper = end ?? start;
          if (!upper || upper.getTime() < now) continue;
          // Prefer the assignment's own recruiterAccountId when stamped;
          // otherwise fall back to a jobOrder lookup.
          let assignmentAccountId: string | null =
            typeof (data as any).recruiterAccountId === 'string'
              ? String((data as any).recruiterAccountId).trim() || null
              : null;
          const jobOrderId = String(data.jobOrderId || '');
          let jobOrderName = jobOrderId;
          if (!assignmentAccountId && jobOrderId) {
            try {
              const joSnap = await getDoc(doc(db, p.jobOrder(tenantId, jobOrderId)));
              if (joSnap.exists()) {
                const joData = joSnap.data() as Record<string, unknown>;
                const rid = joData?.recruiterAccountId;
                if (typeof rid === 'string' && rid.trim() !== '') {
                  assignmentAccountId = rid.trim();
                }
                jobOrderName = String(
                  joData.jobOrderName ?? joData.title ?? joData.jobTitle ?? jobOrderId,
                );
              }
            } catch {
              /* ignore — jobOrderName stays as the id */
            }
          }
          if (assignmentAccountId !== row.accountId) continue;
          candidates.push({
            id: d.id,
            jobOrderId,
            jobOrderName,
            shiftStart: start,
          });
        }
        candidates.sort(
          (a, b) =>
            (a.shiftStart?.getTime() ?? Number.POSITIVE_INFINITY) -
            (b.shiftStart?.getTime() ?? Number.POSITIVE_INFINITY),
        );
        if (!cancelled) {
          setFutureAssignments(candidates);
          // Default-on: all assignments selected.
          setCancelIds(new Set(candidates.map((c) => c.id)));
        }
      } catch {
        if (!cancelled) {
          setFutureAssignments([]);
          setCancelIds(new Set());
        }
      } finally {
        if (!cancelled) setLoadingFuture(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, row.workerId, row.accountId]);

  const requiresNotes = reason === 'other';
  const submitDisabled =
    submitting || !reason || (requiresNotes && notes.trim() === '');

  const handleSubmit = useCallback(async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await setAccountWorkforceStatusCallable({
        tenantId,
        accountId: row.accountId,
        workerId: row.workerId,
        nextStatus: 'inactive',
        deactivationReason: reason,
        deactivationNotes: notes.trim() || undefined,
        cancelFutureAssignmentIds: Array.from(cancelIds),
      });
      await onSuccess();
    } catch (err: unknown) {
      setError(formatFirebaseHttpsError(err));
    } finally {
      setSubmitting(false);
    }
  }, [tenantId, row, reason, notes, cancelIds, onSuccess]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Deactivate {row.workerName} for this account</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          This marks the worker as inactive for this account only. Other accounts they
          work at are unaffected.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Reason</InputLabel>
          <Select
            value={reason}
            label="Reason"
            onChange={(e) => setReason(e.target.value as AccountWorkforceDeactivationReason)}
          >
            {DEACTIVATION_REASONS.map((r) => (
              <MenuItem key={r.value} value={r.value}>
                {r.label}
              </MenuItem>
            ))}
          </Select>
          {requiresNotes && (
            <FormHelperText>Notes required when the reason is "Other".</FormHelperText>
          )}
        </FormControl>
        <TextField
          label="Notes (internal)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          multiline
          minRows={2}
          fullWidth
          sx={{ mb: 2 }}
        />

        {/* Future-assignment cascade — default on. */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Cancel future confirmed shifts
        </Typography>
        {loadingFuture ? (
          <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={22} />
          </Box>
        ) : futureAssignments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No confirmed future shifts for this worker at this account.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {futureAssignments.map((a) => {
              const checked = cancelIds.has(a.id);
              return (
                <FormControlLabel
                  key={a.id}
                  control={
                    <Checkbox
                      checked={checked}
                      onChange={() => {
                        setCancelIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.id)) next.delete(a.id);
                          else next.add(a.id);
                          return next;
                        });
                      }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{a.jobOrderName}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {a.shiftStart ? a.shiftStart.toLocaleString() : '—'}
                      </Typography>
                    </Box>
                  }
                />
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="warning"
          disabled={submitDisabled}
        >
          {submitting ? <CircularProgress size={22} /> : 'Deactivate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// ReactivateDialog
// ===========================================================================

function ReactivateDialog(props: {
  tenantId: string;
  row: AccountWorkforceRosterRow;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const { tenantId, row, onClose, onSuccess } = props;
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await setAccountWorkforceStatusCallable({
        tenantId,
        accountId: row.accountId,
        workerId: row.workerId,
        nextStatus: 'active',
        reactivationNotes: notes.trim() || undefined,
      });
      await onSuccess();
    } catch (err: unknown) {
      setError(formatFirebaseHttpsError(err));
    } finally {
      setSubmitting(false);
    }
  }, [tenantId, row, notes, onSuccess]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Reactivate {row.workerName}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Reactivating adds the worker back to your active roster for this account.
          Any "confirmed while inactive" flags are cleared.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <TextField
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          multiline
          minRows={2}
          fullWidth
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          {submitting ? <CircularProgress size={22} /> : 'Reactivate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === 'function') {
    try {
      return (value as any).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  if (typeof value === 'number') return new Date(value);
  return null;
}

function timestampToDate(value: unknown): Date | null {
  // The shared type uses ISO strings for Timestamp fields, but Firestore
  // returns actual `Timestamp` instances. Handle both so this component
  // doesn't care which path produced the doc.
  return toDate(value);
}

function reasonLabel(code: AccountWorkforceDeactivationReason): string {
  return DEACTIVATION_REASONS.find((r) => r.value === code)?.label || code;
}
