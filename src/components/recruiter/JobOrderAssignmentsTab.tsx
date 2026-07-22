/**
 * JobOrderAssignmentsTab — assignment history for one job order
 * (Greg, 2026-07-22).
 *
 * The Placements tab is for BUILDING a roster (drag, offer, hire); this
 * tab is for AUDITING and maintaining what exists: every assignment
 * ever created on the JO — live, ended, completed, cancelled — one row
 * per worker × shift family. Clicking a row opens the admin
 * AssignmentDrawer (view / edit / end / delete, all silent), the same
 * surface Active Assignments and User Profile use.
 *
 * Per-day gig docs (`${shiftId}__${userId}__${date}`) collapse into a
 * single family row with a day count, mirroring how the drawer itself
 * loads the family.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import AssignmentDrawer, { type AssignmentDrawerTarget } from './AssignmentDrawer';

interface FamilyRow {
  key: string;
  workerId: string;
  workerName: string;
  shiftId: string;
  assignmentId: string;
  status: string;
  isLive: boolean;
  spanStart: string;
  /** '' = ongoing */
  spanEnd: string;
  dayCount: number;
  weeklyDays: number[];
  payRate: number;
  billRate: number;
  endNote: string;
}

const LIVE_RE = /^(pending|proposed|confirmed|in_progress|active)$/;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function friendly(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusChipColor(status: string, isLive: boolean): 'success' | 'default' | 'error' {
  if (isLive) return 'success';
  if (/cancel|declined|rejected/.test(status)) return 'error';
  return 'default';
}

const JobOrderAssignmentsTab: React.FC<{ tenantId: string; jobOrderId: string }> = ({
  tenantId,
  jobOrderId,
}) => {
  const [rows, setRows] = useState<FamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<AssignmentDrawerTarget | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !jobOrderId) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'tenants', tenantId, 'assignments'),
          where('jobOrderId', '==', jobOrderId),
        ),
      );
      const families = new Map<string, FamilyRow>();
      for (const d of snap.docs) {
        const a = d.data() as Record<string, unknown>;
        const shiftId = String(a.shiftId ?? '');
        const workerId = String(a.userId ?? a.candidateId ?? '');
        if (!workerId) continue;
        const key = `${shiftId}__${workerId}`;
        const status = String(a.status ?? '').toLowerCase();
        const isLive = LIVE_RE.test(status);
        const start = typeof a.startDate === 'string' ? a.startDate.slice(0, 10) : '';
        const end = typeof a.endDate === 'string' ? a.endDate.slice(0, 10) : '';
        const ws = (a.weeklySchedule ?? null) as Record<string, { enabled?: boolean }> | null;
        const weeklyDays = ws
          ? Object.entries(ws)
              .filter(([, v]) => v && v.enabled === true)
              .map(([k]) => Number(k))
              .filter((n) => Number.isFinite(n))
              .sort((x, y) => x - y)
          : [];
        const endNote = String(
          a.endedReason ?? a.completedReason ?? a.cancellationReason ?? '',
        ).slice(0, 90);
        const workerName =
          String(a.workerName ?? '') ||
          [a.firstName, a.lastName].filter(Boolean).join(' ') ||
          workerId;

        const prev = families.get(key);
        if (!prev) {
          families.set(key, {
            key,
            workerId,
            workerName,
            shiftId,
            assignmentId: d.id,
            status,
            isLive,
            spanStart: start,
            spanEnd: end,
            dayCount: 1,
            weeklyDays,
            payRate: Number(a.payRate) > 0 ? Number(a.payRate) : 0,
            billRate: Number(a.billRate) > 0 ? Number(a.billRate) : 0,
            endNote,
          });
        } else {
          prev.dayCount += 1;
          if (start && (!prev.spanStart || start < prev.spanStart)) prev.spanStart = start;
          // Any open-ended doc makes the family ongoing; otherwise max end.
          if (prev.spanEnd !== '' ) {
            if (end === '') prev.spanEnd = '';
            else if (end > prev.spanEnd) prev.spanEnd = end;
          }
          // A live doc represents the family (status, rates, drawer anchor).
          if (isLive && !prev.isLive) {
            prev.isLive = true;
            prev.status = status;
            prev.assignmentId = d.id;
            if (Number(a.payRate) > 0) prev.payRate = Number(a.payRate);
            if (Number(a.billRate) > 0) prev.billRate = Number(a.billRate);
            prev.weeklyDays = weeklyDays.length ? weeklyDays : prev.weeklyDays;
            prev.endNote = '';
          }
        }
      }
      const list = Array.from(families.values()).sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        return (b.spanStart || '').localeCompare(a.spanStart || '');
      });
      setRows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, jobOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveCount = useMemo(() => rows.filter((r) => r.isLive).length, [rows]);

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Assignment history
        </Typography>
        {!loading && (
          <Typography variant="body2" color="text.secondary">
            {liveCount} active · {rows.length - liveCount} past
          </Typography>
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No one has ever been assigned on this job order.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {rows.map((r) => (
            <Paper
              key={r.key}
              variant="outlined"
              onClick={() =>
                setDrawerTarget({
                  workerId: r.workerId,
                  workerName: r.workerName,
                  jobOrderId,
                  shiftId: r.shiftId || null,
                  assignmentId: r.assignmentId,
                })
              }
              sx={{
                p: 1.5,
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                gap={1}
                flexWrap="wrap"
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700} noWrap>
                    {r.workerName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {friendly(r.spanStart) || '—'} → {r.spanEnd ? friendly(r.spanEnd) : 'ongoing'}
                    {r.dayCount > 1 ? ` · ${r.dayCount} days` : ''}
                    {r.weeklyDays.length > 0 && r.dayCount === 1
                      ? ` · ${r.weeklyDays.map((d) => DOW[d] ?? d).join(' ')}`
                      : ''}
                  </Typography>
                  {r.endNote && (
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {r.endNote}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={0.75} alignItems="center" flexShrink={0}>
                  {r.payRate > 0 && (
                    <Chip size="small" variant="outlined" label={`$${r.payRate}/hr`} />
                  )}
                  {r.billRate > 0 && (
                    <Chip size="small" variant="outlined" label={`Bill $${r.billRate}`} />
                  )}
                  <Chip
                    size="small"
                    label={r.status || 'unknown'}
                    color={statusChipColor(r.status, r.isLive)}
                    variant={r.isLive ? 'filled' : 'outlined'}
                  />
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      <AssignmentDrawer
        open={!!drawerTarget}
        tenantId={tenantId}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
        onEnded={() => {
          setDrawerTarget(null);
          void load();
        }}
      />
    </Box>
  );
};

export default JobOrderAssignmentsTab;
