/**
 * Recruiter Action Queue ("My Queue") — Phase 1 readiness UI.
 *
 * Shows every readiness item the current recruiter owns (`ownership.primaryRecruiterId == me`)
 * across both `employeeReadinessItems` and `assignmentReadinessItems` collections. Filters to
 * the items the recruiter can actually act on (actor === 'recruiter') by default, with a toggle
 * to include worker/vendor-actor items for visibility.
 *
 * Data flow: lives on top of the Option D scalar + per-item ownership model we just shipped.
 * One collection-group-style scan per item collection, scoped to the active tenant. No
 * joins required — items are already denormalized with `workerUid`, `hiringEntityName`, etc.
 *
 * Route: `/my-queue` (registered in App.tsx, linked from main nav in menuGenerator).
 *
 * v1 scope (this file):
 *   - Primary tab only — items where I'm `primaryRecruiterId`
 *   - Active status filter (incomplete | in_progress | blocked)
 *   - Recruiter-actor filter (default on; toggle to see worker/vendor items too)
 *   - Sort: blocking first, then oldest created → newest
 *   - Click row → navigates to the worker profile at the relevant tab
 *
 * Later phases:
 *   - v2: Visibility tab (`visibleRecruiterIds array-contains me`) + Pool tab (`primaryRecruiterId == null`)
 *   - v3: Item detail drawer with ownership history + reassign/claim/release actions
 *   - v4: Worker-level grouping + "Ready to place" strip
 *
 * @see shared/actionItemOwnership.ts
 * @see shared/employeeReadinessItemV1.ts
 * @see shared/assignmentReadinessItemV1.ts
 * @see recruiter-ownership-model.md §6 (UI spec)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Snackbar,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BlockIcon from '@mui/icons-material/Block';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import { collection, getDocs, query, where, doc, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import PageHeader from '../components/PageHeader';

import type { EmployeeReadinessItem } from '../types/employeeReadinessItemV1';
import type { AssignmentReadinessItem } from '../types/assignmentReadinessItemV1';
import type {
  ActionItemOwnershipHistoryEntry,
  ActionItemOwnershipPrimarySource,
} from '../types/actionItemOwnership';

/** What we unify both item types to for this surface. */
type QueueRow = {
  id: string;
  kind: 'employee' | 'assignment';
  tenantId: string;
  workerUid: string;
  /** For assignment items; undefined for employee items. */
  assignmentId?: string;
  /** For employee items; undefined for assignment items. */
  hiringEntityId?: string;
  hiringEntityName?: string;
  /** Shared. */
  requirementType: string;
  requirementLabel?: string;
  status: 'incomplete' | 'in_progress' | 'complete' | 'blocked' | 'not_applicable';
  actor: 'worker' | 'recruiter' | 'vendor' | 'system';
  blocking: boolean;
  /** For tier determination + claim action. */
  primaryRecruiterId: string | null;
  visibleRecruiterIds: string[];
  primarySource: ActionItemOwnershipPrimarySource;
  history: ActionItemOwnershipHistoryEntry[];
  /** Source-of-writes attribution (who/what created the item). */
  sourceKind?: string;
  sourceRef?: string;
  ctaTarget?: {
    kind: string;
    path: string;
    label?: string;
  };
  createdAtMs: number;
  updatedAtMs: number;
  /** Denormalized worker name, filled after a best-effort batch user-doc fetch. */
  workerName?: string;
  workerAvatar?: string;
};

type QueueTier = 'primary' | 'visibility' | 'pool';

const ACTIVE_STATUSES: ReadonlySet<QueueRow['status']> = new Set(['incomplete', 'in_progress', 'blocked']);

const RecruiterMyQueue: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id || '';
  const navigate = useNavigate();

  const [primaryRows, setPrimaryRows] = useState<QueueRow[]>([]);
  const [visibilityRows, setVisibilityRows] = useState<QueueRow[]>([]);
  const [poolRows, setPoolRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recruiterActorOnly, setRecruiterActorOnly] = useState(true);
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [tier, setTier] = useState<QueueTier>('primary');
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);
  const [drawerRow, setDrawerRow] = useState<QueueRow | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [reassignUid, setReassignUid] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const loadQueue = useCallback(async () => {
    if (!user?.uid || !tenantId) {
      setPrimaryRows([]);
      setVisibilityRows([]);
      setPoolRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const empRef = collection(db, 'tenants', tenantId, 'employeeReadinessItems');
      const asgRef = collection(db, 'tenants', tenantId, 'assignmentReadinessItems');

      // Three sets of queries in parallel — one per tier. Each hits both item
      // collections. Firestore doesn't let us combine `==` with `null` inside a
      // single where clause nicely, so the Pool query uses its own predicate.
      const [empPrimary, asgPrimary, empVisible, asgVisible, empPool, asgPool] = await Promise.all([
        // Primary: ownership.primaryRecruiterId == me
        getDocs(query(empRef, where('ownership.primaryRecruiterId', '==', user.uid))),
        getDocs(query(asgRef, where('ownership.primaryRecruiterId', '==', user.uid))),
        // Visibility: visibleRecruiterIds array-contains me.
        // The Primary set is a subset of this; we dedupe in memory.
        getDocs(query(empRef, where('ownership.visibleRecruiterIds', 'array-contains', user.uid))),
        getDocs(query(asgRef, where('ownership.visibleRecruiterIds', 'array-contains', user.uid))),
        // Pool: primaryRecruiterId == null (Firestore: where('...', '==', null)).
        // Items in the pool are scoped to the tenant; L5+ visibility enforced
        // by `visibleRecruiterIds` being populated by the resolver's pool fan-out.
        getDocs(query(empRef, where('ownership.primaryRecruiterId', '==', null))),
        getDocs(query(asgRef, where('ownership.primaryRecruiterId', '==', null))),
      ]);

      const primaryById = new Map<string, QueueRow>();
      empPrimary.docs.forEach((d) =>
        primaryById.set(`employee:${d.id}`, normalizeEmployeeItem(d.id, d.data() as EmployeeReadinessItem)),
      );
      asgPrimary.docs.forEach((d) =>
        primaryById.set(`assignment:${d.id}`, normalizeAssignmentItem(d.id, d.data() as AssignmentReadinessItem)),
      );

      const visibilityById = new Map<string, QueueRow>();
      empVisible.docs.forEach((d) => {
        const row = normalizeEmployeeItem(d.id, d.data() as EmployeeReadinessItem);
        // Visibility tab = I'm visible but NOT primary (primary is its own tab).
        if (row.primaryRecruiterId !== user.uid) visibilityById.set(`employee:${d.id}`, row);
      });
      asgVisible.docs.forEach((d) => {
        const row = normalizeAssignmentItem(d.id, d.data() as AssignmentReadinessItem);
        if (row.primaryRecruiterId !== user.uid) visibilityById.set(`assignment:${d.id}`, row);
      });

      const poolById = new Map<string, QueueRow>();
      empPool.docs.forEach((d) =>
        poolById.set(`employee:${d.id}`, normalizeEmployeeItem(d.id, d.data() as EmployeeReadinessItem)),
      );
      asgPool.docs.forEach((d) =>
        poolById.set(`assignment:${d.id}`, normalizeAssignmentItem(d.id, d.data() as AssignmentReadinessItem)),
      );

      const allRows = [
        ...primaryById.values(),
        ...visibilityById.values(),
        ...poolById.values(),
      ];

      // One batched user-name fetch across every tier.
      const uniqueUids = Array.from(new Set(allRows.map((r) => r.workerUid))).filter(Boolean);
      const nameMap = await loadWorkerNames(uniqueUids);
      for (const row of allRows) {
        const info = nameMap.get(row.workerUid);
        if (info) {
          row.workerName = info.name;
          row.workerAvatar = info.avatar;
        }
      }

      setPrimaryRows(Array.from(primaryById.values()));
      setVisibilityRows(Array.from(visibilityById.values()));
      setPoolRows(Array.from(poolById.values()));
    } catch (err) {
      console.error('RecruiterMyQueue: failed to load queue', err);
      setError((err as Error).message || 'Failed to load your queue.');
      setPrimaryRows([]);
      setVisibilityRows([]);
      setPoolRows([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, tenantId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const rowsForTier = useMemo(() => {
    switch (tier) {
      case 'visibility':
        return visibilityRows;
      case 'pool':
        return poolRows;
      case 'primary':
      default:
        return primaryRows;
    }
  }, [tier, primaryRows, visibilityRows, poolRows]);

  // Filter + sort for display. Keep logic memoized so toggles are instant.
  const visibleRows = useMemo(() => {
    const filtered = rowsForTier.filter((r) => {
      if (!ACTIVE_STATUSES.has(r.status)) return false;
      if (recruiterActorOnly && r.actor !== 'recruiter') return false;
      if (blockingOnly && !r.blocking) return false;
      return true;
    });
    // Sort: blocking first (stable), then oldest createdAt → newest.
    filtered.sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      return a.createdAtMs - b.createdAtMs;
    });
    return filtered;
  }, [rowsForTier, recruiterActorOnly, blockingOnly]);

  const blockingCount = useMemo(
    () => rowsForTier.filter((r) => r.blocking && ACTIVE_STATUSES.has(r.status)).length,
    [rowsForTier],
  );

  /**
   * Pool-tab claim: mutates ownership on the item doc to make the caller the
   * primary recruiter. The denormalization trigger picks it up from there and
   * updates `users/{workerUid}.primaryRecruiterId` if the scalar changes.
   *
   * We set `primarySource: 'manual'` so the ownership doc's audit trail shows
   * "claimed by X" rather than making it look like a hierarchy re-derivation.
   */
  const openDrawer = useCallback((row: QueueRow) => {
    setDrawerRow(row);
    setReassignUid('');
    setReassignReason('');
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerRow(null);
    setReassignUid('');
    setReassignReason('');
  }, []);

  /**
   * Reassign the drawer item to another recruiter by uid. The teammate must
   * be in the item's current `visibleRecruiterIds` for the write to be
   * honored per ownership-model rules (§6a); we don't enforce that client-side
   * because the resolver's visibility list can legitimately change server-side
   * between render and submit — server-side rules are the real gate. Here we
   * just collect the uid + reason and update the doc.
   */
  const reassignDrawerItem = useCallback(async () => {
    if (!drawerRow || !user?.uid || !tenantId) return;
    const targetUid = reassignUid.trim();
    if (!targetUid) {
      setToast({ message: 'Enter a recruiter uid to reassign to.', severity: 'info' });
      return;
    }
    setReassignBusy(true);
    try {
      const collectionName = drawerRow.kind === 'employee' ? 'employeeReadinessItems' : 'assignmentReadinessItems';
      const ref = doc(db, 'tenants', tenantId, collectionName, drawerRow.id);
      const nowIso = new Date().toISOString();
      await updateDoc(ref, {
        'ownership.primaryRecruiterId': targetUid,
        'ownership.primarySource': 'manual',
        'ownership.visibleRecruiterIds': arrayUnion(targetUid),
        'ownership.history': arrayUnion({
          at: nowIso,
          actorUid: user.uid,
          action: 'reassigned',
          from: drawerRow.primaryRecruiterId,
          to: targetUid,
          reason: reassignReason.trim() || `Reassigned by ${user.uid}`,
        }),
        updatedAt: serverTimestamp(),
      });
      setToast({ message: `Reassigned to ${targetUid}`, severity: 'success' });
      closeDrawer();
      loadQueue();
    } catch (err) {
      console.error('RecruiterMyQueue: reassign failed', err);
      setToast({ message: `Reassign failed: ${(err as Error).message || 'Unknown'}`, severity: 'error' });
    } finally {
      setReassignBusy(false);
    }
  }, [drawerRow, user?.uid, tenantId, reassignUid, reassignReason, closeDrawer, loadQueue]);

  /**
   * Release the drawer item back to the unassigned pool — clears
   * primaryRecruiterId, leaves visibleRecruiterIds alone (they still see it
   * in the Pool tab, which queries by `primaryRecruiterId == null`).
   */
  const releaseDrawerItem = useCallback(async () => {
    if (!drawerRow || !user?.uid || !tenantId) return;
    setReleaseBusy(true);
    try {
      const collectionName = drawerRow.kind === 'employee' ? 'employeeReadinessItems' : 'assignmentReadinessItems';
      const ref = doc(db, 'tenants', tenantId, collectionName, drawerRow.id);
      const nowIso = new Date().toISOString();
      await updateDoc(ref, {
        'ownership.primaryRecruiterId': null,
        'ownership.primarySource': 'unassigned',
        'ownership.history': arrayUnion({
          at: nowIso,
          actorUid: user.uid,
          action: 'released',
          from: drawerRow.primaryRecruiterId,
          to: null,
          reason: reassignReason.trim() || 'Released to pool',
        }),
        updatedAt: serverTimestamp(),
      });
      setToast({ message: 'Released to pool', severity: 'success' });
      closeDrawer();
      loadQueue();
    } catch (err) {
      console.error('RecruiterMyQueue: release failed', err);
      setToast({ message: `Release failed: ${(err as Error).message || 'Unknown'}`, severity: 'error' });
    } finally {
      setReleaseBusy(false);
    }
  }, [drawerRow, user?.uid, tenantId, reassignReason, closeDrawer, loadQueue]);

  const claimPoolItem = useCallback(
    async (row: QueueRow) => {
      if (!user?.uid || !tenantId) return;
      setClaimBusy(`${row.kind}:${row.id}`);
      try {
        const collectionName = row.kind === 'employee' ? 'employeeReadinessItems' : 'assignmentReadinessItems';
        const ref = doc(db, 'tenants', tenantId, collectionName, row.id);
        const nowIso = new Date().toISOString();
        await updateDoc(ref, {
          'ownership.primaryRecruiterId': user.uid,
          'ownership.primarySource': 'manual',
          'ownership.visibleRecruiterIds': arrayUnion(user.uid),
          'ownership.history': arrayUnion({
            at: nowIso,
            actorUid: user.uid,
            action: 'claimed',
            from: null,
            to: user.uid,
            reason: 'Claimed from unassigned pool',
          }),
          updatedAt: serverTimestamp(),
        });
        setToast({ message: 'Claimed — item moved to your queue', severity: 'success' });
        loadQueue();
      } catch (err) {
        console.error('RecruiterMyQueue: claim failed', err);
        setToast({
          message: `Claim failed: ${(err as Error).message || 'Unknown error'}`,
          severity: 'error',
        });
      } finally {
        setClaimBusy(null);
      }
    },
    [user?.uid, tenantId, loadQueue],
  );

  if (!tenantId) {
    return (
      <Box p={3}>
        <Alert severity="info">Select a tenant to see your queue.</Alert>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <PageHeader title="My Queue" />

      <Tabs
        value={tier}
        onChange={(_, v) => setTier(v as QueueTier)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
        TabIndicatorProps={{ sx: { height: 2 } }}
      >
        <Tab
          value="primary"
          label={
            <Stack direction="row" spacing={1} alignItems="center">
              <span>Primary</span>
              <Chip size="small" label={primaryRows.length} />
            </Stack>
          }
          sx={{ textTransform: 'none', minHeight: 40 }}
        />
        <Tab
          value="visibility"
          label={
            <Stack direction="row" spacing={1} alignItems="center">
              <span>Visibility</span>
              <Chip size="small" label={visibilityRows.length} />
            </Stack>
          }
          sx={{ textTransform: 'none', minHeight: 40 }}
        />
        <Tab
          value="pool"
          label={
            <Stack direction="row" spacing={1} alignItems="center">
              <span>Pool</span>
              <Chip size="small" label={poolRows.length} color={poolRows.length > 0 ? 'warning' : 'default'} />
            </Stack>
          }
          sx={{ textTransform: 'none', minHeight: 40 }}
        />
      </Tabs>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {rowsForTier.length === 0 ? 'Nothing here yet' : `${visibleRows.length} of ${rowsForTier.length} items`}
        </Typography>
        {blockingCount > 0 && (
          <Chip
            size="small"
            icon={<BlockIcon fontSize="small" />}
            color="error"
            label={`${blockingCount} blocking`}
            variant="outlined"
          />
        )}
        <Box sx={{ flex: 1 }} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={recruiterActorOnly}
              onChange={(e) => setRecruiterActorOnly(e.target.checked)}
            />
          }
          label={<Typography variant="body2">Recruiter actions only</Typography>}
        />
        <FormControlLabel
          control={
            <Switch size="small" checked={blockingOnly} onChange={(e) => setBlockingOnly(e.target.checked)} />
          }
          label={<Typography variant="body2">Blocking only</Typography>}
        />
        <Button size="small" variant="outlined" onClick={loadQueue} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress size={28} />
        </Box>
      ) : visibleRows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" gutterBottom>
            {rowsForTier.length === 0 ? emptyStateHeading(tier) : 'No items match your current filters.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {emptyStateSubtext(tier)}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Context</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell align="right">Age</TableCell>
                {tier === 'pool' && <TableCell align="right">Action</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow
                  key={`${row.kind}:${row.id}`}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => openDrawer(row)}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar src={row.workerAvatar} sx={{ width: 28, height: 28 }}>
                        {(row.workerName || row.workerUid).slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {row.workerName || row.workerUid}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">
                        {row.requirementLabel || humanizeRequirementType(row.requirementType)}
                      </Typography>
                      {row.blocking && (
                        <Tooltip title="Blocks activation / next shift confirmation">
                          <Chip label="Blocking" size="small" color="error" variant="outlined" />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {contextLabel(row)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={row.status} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
                      {row.actor}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="caption" color="text.secondary">
                      {formatAge(row.createdAtMs)}
                    </Typography>
                  </TableCell>
                  {tier === 'pool' && (
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={claimBusy === `${row.kind}:${row.id}`}
                        onClick={() => claimPoolItem(row)}
                      >
                        {claimBusy === `${row.kind}:${row.id}` ? 'Claiming…' : 'Claim'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Drawer
        anchor="right"
        open={!!drawerRow}
        onClose={closeDrawer}
        PaperProps={{ sx: { width: { xs: '100%', sm: 480 } } }}
      >
        {drawerRow && (
          <Box sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6" fontWeight={700}>
                Item details
              </Typography>
              <IconButton size="small" onClick={closeDrawer} aria-label="Close">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Worker
                </Typography>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Avatar src={drawerRow.workerAvatar} sx={{ width: 32, height: 32 }}>
                    {(drawerRow.workerName || drawerRow.workerUid).slice(0, 1).toUpperCase()}
                  </Avatar>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {drawerRow.workerName || drawerRow.workerUid}
                    </Typography>
                    <Button
                      size="small"
                      endIcon={<OpenInNewIcon fontSize="small" />}
                      onClick={() => {
                        navigate(`/users/${drawerRow.workerUid}`);
                        closeDrawer();
                      }}
                      sx={{ textTransform: 'none', pl: 0, minWidth: 'auto' }}
                    >
                      Open profile
                    </Button>
                  </Box>
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="caption" color="text.secondary">
                  Requirement
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {drawerRow.requirementLabel || humanizeRequirementType(drawerRow.requirementType)}
                </Typography>
                <Stack direction="row" spacing={1} mt={0.5} alignItems="center">
                  <StatusChip status={drawerRow.status} />
                  {drawerRow.blocking && (
                    <Chip label="Blocking" size="small" color="error" variant="outlined" />
                  )}
                  <Chip
                    label={`Actor: ${drawerRow.actor}`}
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: 'capitalize' }}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                  Context: {contextLabel(drawerRow)}
                </Typography>
                {drawerRow.ctaTarget && (
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ mt: 1, textTransform: 'none' }}
                    onClick={() => {
                      if (drawerRow.ctaTarget?.kind === 'route') navigate(drawerRow.ctaTarget.path);
                    }}
                  >
                    {drawerRow.ctaTarget.label || 'Open CTA'}
                  </Button>
                )}
              </Box>

              <Divider />

              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Ownership
                </Typography>
                <Typography variant="body2">
                  Primary:{' '}
                  <strong>
                    {drawerRow.primaryRecruiterId ? drawerRow.primaryRecruiterId : 'Unassigned (pool)'}
                  </strong>
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Source: {drawerRow.primarySource}
                </Typography>
                {drawerRow.visibleRecruiterIds.length > 0 && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Visible to: {drawerRow.visibleRecruiterIds.join(', ')}
                  </Typography>
                )}
                {drawerRow.sourceKind && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Created by: {drawerRow.sourceKind}
                    {drawerRow.sourceRef ? ` · ${drawerRow.sourceRef}` : ''}
                  </Typography>
                )}
              </Box>

              <Divider />

              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  History ({drawerRow.history.length})
                </Typography>
                {drawerRow.history.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No ownership changes yet.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {drawerRow.history
                      .slice()
                      .reverse()
                      .map((h, idx) => (
                        <Box key={idx} sx={{ borderLeft: 2, borderColor: 'divider', pl: 1.5 }}>
                          <Typography variant="caption" sx={{ textTransform: 'capitalize', fontWeight: 600 }}>
                            {h.action}
                          </Typography>{' '}
                          <Typography variant="caption" color="text.secondary">
                            by {h.actorUid}
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary">
                            {new Date(h.at).toLocaleString()}
                          </Typography>
                          {(h.from !== undefined || h.to !== undefined) && (
                            <Typography variant="caption" display="block">
                              {formatHistoryTransition(h)}
                            </Typography>
                          )}
                          {h.reason && (
                            <Typography variant="caption" display="block" color="text.secondary">
                              “{h.reason}”
                            </Typography>
                          )}
                        </Box>
                      ))}
                  </Stack>
                )}
              </Box>

              {drawerRow.primaryRecruiterId === user?.uid && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Reassign or release
                    </Typography>
                    <Stack spacing={1.5}>
                      <TextField
                        size="small"
                        label="Reassign to recruiter uid"
                        value={reassignUid}
                        onChange={(e) => setReassignUid(e.target.value)}
                        fullWidth
                        helperText="Enter the recipient recruiter's uid. They'll become primary."
                      />
                      <TextField
                        size="small"
                        label="Reason (optional)"
                        value={reassignReason}
                        onChange={(e) => setReassignReason(e.target.value)}
                        fullWidth
                      />
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          size="small"
                          disabled={reassignBusy || !reassignUid.trim()}
                          onClick={reassignDrawerItem}
                          sx={{ textTransform: 'none' }}
                        >
                          {reassignBusy ? 'Reassigning…' : 'Reassign'}
                        </Button>
                        <Button
                          variant="outlined"
                          color="warning"
                          size="small"
                          disabled={releaseBusy}
                          onClick={releaseDrawerItem}
                          sx={{ textTransform: 'none' }}
                        >
                          {releaseBusy ? 'Releasing…' : 'Release to pool'}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                </>
              )}
            </Stack>
          </Box>
        )}
      </Drawer>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
};

function formatHistoryTransition(h: ActionItemOwnershipHistoryEntry): string {
  const from = h.from === null || h.from === undefined ? '(pool)' : h.from;
  const to = h.to === null || h.to === undefined ? '(pool)' : h.to;
  return `${from} → ${to}`;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeEmployeeItem(id: string, data: EmployeeReadinessItem): QueueRow {
  return {
    id,
    kind: 'employee',
    tenantId: data.tenantId,
    workerUid: data.workerUid,
    hiringEntityId: data.hiringEntityId,
    hiringEntityName: data.hiringEntityName,
    requirementType: data.requirementType,
    requirementLabel: data.requirementLabel,
    status: data.status,
    actor: data.actor,
    blocking: data.blocking,
    primaryRecruiterId: data.ownership?.primaryRecruiterId ?? null,
    visibleRecruiterIds: Array.isArray(data.ownership?.visibleRecruiterIds)
      ? data.ownership.visibleRecruiterIds
      : [],
    primarySource: (data.ownership?.primarySource ?? 'unassigned') as ActionItemOwnershipPrimarySource,
    history: normalizeHistory(data.ownership?.history),
    sourceKind: data.source?.kind,
    sourceRef: data.source?.ref,
    ctaTarget: data.ctaTarget,
    createdAtMs: toMs(data.createdAt),
    updatedAtMs: toMs(data.updatedAt),
  };
}

function normalizeAssignmentItem(id: string, data: AssignmentReadinessItem): QueueRow {
  return {
    id,
    kind: 'assignment',
    tenantId: data.tenantId,
    workerUid: data.workerUid,
    assignmentId: data.assignmentId,
    requirementType: data.requirementType,
    requirementLabel: data.requirementLabel,
    status: data.status,
    actor: data.actor,
    blocking: data.blocking,
    primaryRecruiterId: data.ownership?.primaryRecruiterId ?? null,
    visibleRecruiterIds: Array.isArray(data.ownership?.visibleRecruiterIds)
      ? data.ownership.visibleRecruiterIds
      : [],
    primarySource: (data.ownership?.primarySource ?? 'unassigned') as ActionItemOwnershipPrimarySource,
    history: normalizeHistory(data.ownership?.history),
    sourceKind: data.source?.kind,
    sourceRef: data.source?.ref,
    ctaTarget: data.ctaTarget,
    createdAtMs: toMs(data.createdAt),
    updatedAtMs: toMs(data.updatedAt),
  };
}

function normalizeHistory(raw: unknown): ActionItemOwnershipHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h) => {
    const entry = h as Record<string, unknown>;
    const at = entry.at;
    return {
      at: typeof at === 'string' ? at : new Date(toMs(at)).toISOString(),
      actorUid: String(entry.actorUid ?? 'system'),
      action: entry.action as ActionItemOwnershipHistoryEntry['action'],
      from: (entry.from as string | null | undefined) ?? undefined,
      to: (entry.to as string | null | undefined) ?? undefined,
      reason: typeof entry.reason === 'string' ? entry.reason : undefined,
    };
  });
}

function toMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function contextLabel(row: QueueRow): string {
  if (row.kind === 'employee') {
    return row.hiringEntityName || row.hiringEntityId || 'Employee onboarding';
  }
  return row.assignmentId ? `Assignment ${row.assignmentId.slice(0, 8)}…` : 'Assignment';
}

function humanizeRequirementType(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function emptyStateHeading(tier: QueueTier): string {
  switch (tier) {
    case 'visibility':
      return 'No team items visible to you right now.';
    case 'pool':
      return 'No unclaimed pool items.';
    case 'primary':
    default:
      return "You don't own any readiness items yet.";
  }
}

function emptyStateSubtext(tier: QueueTier): string {
  switch (tier) {
    case 'visibility':
      return 'Items show up here when you are on the team (visibleRecruiterIds) but not the primary recruiter — useful for coverage while teammates are out.';
    case 'pool':
      return 'Claim an item to make yourself the primary recruiter. Pool items are visible to every L5+ recruiter at the tenant until someone picks them up.';
    case 'primary':
    default:
      return 'Items appear here as workers you own complete (or fail) onboarding steps, and as new assignments fire their readiness flows.';
  }
}

function formatAge(ms: number): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

/** Small per-status chip. Mirrors the "complete_pass / complete_fail" vocabulary from the
 *  rethink doc §6e, although for v1 we only show active statuses here. */
const StatusChip: React.FC<{ status: QueueRow['status'] }> = ({ status }) => {
  const byStatus: Record<QueueRow['status'], { label: string; color: any; icon: React.ReactElement | undefined }> = {
    incomplete: { label: 'Incomplete', color: 'default', icon: <HourglassEmptyIcon fontSize="small" /> },
    in_progress: { label: 'In progress', color: 'info', icon: <PlayCircleOutlineIcon fontSize="small" /> },
    blocked: { label: 'Blocked', color: 'error', icon: <ErrorOutlineIcon fontSize="small" /> },
    complete: { label: 'Complete', color: 'success', icon: undefined },
    not_applicable: { label: 'N/A', color: 'default', icon: undefined },
  };
  const cfg = byStatus[status] ?? byStatus.incomplete;
  return <Chip label={cfg.label} size="small" color={cfg.color} variant="outlined" icon={cfg.icon} />;
};

/** Batched best-effort worker-name fetch. Uses `in` queries against `users`. */
async function loadWorkerNames(uids: string[]): Promise<Map<string, { name: string; avatar?: string }>> {
  const out = new Map<string, { name: string; avatar?: string }>();
  if (uids.length === 0) return out;
  const CHUNK = 10;
  for (let i = 0; i < uids.length; i += CHUNK) {
    const chunk = uids.slice(i, i + CHUNK);
    try {
      const { documentId } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)));
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const name =
          (data.displayName as string) ||
          [data.firstName, data.lastName].filter(Boolean).join(' ') ||
          (data.email as string) ||
          d.id;
        const avatar = (data.avatar as string) || undefined;
        out.set(d.id, { name, avatar });
      });
    } catch {
      // Best-effort — rows fall back to uid.
    }
  }
  return out;
}

export default RecruiterMyQueue;
