/**
 * Scheduling Health — the recruiter's daily checklist (Phase 1c).
 *
 * Design contract (Greg, 2026-07-17): recruiters are not tech-savvy. This
 * page therefore reads as plain-English to-dos, each with exactly ONE
 * obvious button — never a report to interpret. Three checks:
 *
 *   1. "Still marked as working" — live assignments whose shift already
 *      ended. One bulk "Mark all finished" button (server re-verifies
 *      each one before completing, so a stale list can't close out
 *      someone actually working).
 *   2. "Shifts that need people" — upcoming shifts where needed > have.
 *      Button jumps straight to that job order's Placements tab.
 *   3. "Portal updates to review" — pending Indeed Flex / Fieldglass
 *      changes. Button jumps to the Shifts Log inbox.
 *
 * Data comes from the getScheduleDivergence callable (the nightly sweep's
 * snapshot; computed fresh on first visit of the day), so this page never
 * requires the recruiter to remember to run anything.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface StaleRow {
  assignmentId: string;
  workerName: string;
  worksiteName: string;
  effectiveEndDate: string | null;
  reason: string;
}
interface GapRow {
  jobOrderId: string;
  jobTitle: string;
  accountName: string;
  date: string;
  needed: number;
  filled: number;
  gap: number;
}
interface Snapshot {
  runDate: string;
  staleLiveAssignments: StaleRow[];
  coverageGaps: GapRow[];
  counts: { staleLive: number; coverageGaps: number; totalGapSeats: number };
  /** Written by the nightly AI triage after it auto-handles the
   *  unambiguous items — the "Handled overnight" card renders from this. */
  triage?: {
    autoCompletedStale: number;
    autoAppliedCancels: number;
    autoCancelledAssignments: number;
    /** PI-2: exact new Flex bookings turned into open shifts overnight. */
    autoCreatedShifts?: number;
    brief: string;
  };
}

function friendlyDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function friendlyTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm || '';
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Assignments on the confirmation cadence, next few days. Built from a
 *  direct query (startDate range) + client-side filter on cortConfirmation —
 *  keeps us off composite indexes. */
interface ConfirmRow {
  assignmentId: string;
  workerName: string;
  phone: string;
  worksiteName: string;
  jobTitle: string;
  jobOrderId: string;
  date: string;
  startTime: string;
  state: string;
}

const CANCELLED_ASSIGNMENT_STATUSES = new Set([
  'cancelled',
  'canceled',
  'worker-cancelled',
  'client-cancelled',
  'completed',
  'ended',
]);

const SchedulingHealthPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [portalCount, setPortalCount] = useState<number>(0);
  const [confirmPending, setConfirmPending] = useState<ConfirmRow[]>([]);
  const [confirmDeclined, setConfirmDeclined] = useState<ConfirmRow[]>([]);
  const [confirmedCount, setConfirmedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishedMsg, setFinishedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getScheduleDivergence');
      const res = await fn({ tenantId });
      setSnapshot((res.data as { snapshot: Snapshot }).snapshot);
      const pending = await getDocs(
        query(
          collection(db, 'tenants', tenantId, 'external_shift_requests'),
          where('status', '==', 'needs_review'),
          limit(100),
        ),
      );
      setPortalCount(pending.size);

      // Shift confirmations: workers on the YES/CANCEL cadence, today + 3 days.
      const todayIso = new Date().toLocaleDateString('en-CA');
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 3);
      const horizonIso = horizon.toLocaleDateString('en-CA');
      const upcoming = await getDocs(
        query(
          collection(db, 'tenants', tenantId, 'assignments'),
          where('startDate', '>=', todayIso),
          where('startDate', '<=', horizonIso),
          limit(1000),
        ),
      );
      const pendingRows: ConfirmRow[] = [];
      const declinedRows: ConfirmRow[] = [];
      let confirmed = 0;
      upcoming.forEach((docSnap) => {
        const a = docSnap.data() as Record<string, any>;
        const cort = a.cortConfirmation as { state?: string } | undefined;
        if (!cort?.state) return;
        const row: ConfirmRow = {
          assignmentId: docSnap.id,
          workerName:
            String(a.workerDisplayName || '').trim() ||
            `${String(a.firstName || '').trim()} ${String(a.lastName || '').trim()}`.trim() ||
            'Worker',
          phone: String(a.phone || '').trim(),
          worksiteName: String(a.worksiteName || a.worksiteDisplayName || a.companyName || '').trim(),
          jobTitle: String(a.jobTitle || '').trim(),
          jobOrderId: String(a.jobOrderId || '').trim(),
          date: String(a.startDate || '').trim(),
          startTime: String(a.startTime || '').trim(),
          state: String(cort.state || '').trim().toLowerCase(),
        };
        const status = String(a.status || '').trim().toLowerCase();
        if (row.state === 'cancelled' || row.state === 'no_show') {
          declinedRows.push(row);
        } else if (CANCELLED_ASSIGNMENT_STATUSES.has(status)) {
          // Recruiter already handled it (assignment closed) — not actionable.
        } else if (row.state === 'pending') {
          pendingRows.push(row);
        } else {
          confirmed += 1;
        }
      });
      const byStart = (x: ConfirmRow, y: ConfirmRow): number =>
        `${x.date} ${x.startTime}`.localeCompare(`${y.date} ${y.startTime}`);
      setConfirmPending(pendingRows.sort(byStart));
      setConfirmDeclined(declinedRows.sort(byStart));
      setConfirmedCount(confirmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stale = snapshot?.staleLiveAssignments ?? [];
  const gaps = (snapshot?.coverageGaps ?? []).slice(0, 25);

  const handleMarkAllFinished = async (): Promise<void> => {
    if (!tenantId || stale.length === 0) return;
    setFinishing(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'completeStaleAssignments');
      const res = await fn({ tenantId, assignmentIds: stale.map((s) => s.assignmentId) });
      const data = res.data as { completed: number; skipped: Array<{ reason: string }> };
      setFinishedMsg(
        data.skipped.length === 0
          ? `Done — ${data.completed} worker${data.completed === 1 ? '' : 's'} marked finished.`
          : `Done — ${data.completed} marked finished, ${data.skipped.length} left alone (${data.skipped[0].reason}).`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishing(false);
    }
  };

  const allClear =
    !loading &&
    stale.length === 0 &&
    gaps.length === 0 &&
    portalCount === 0 &&
    confirmPending.length === 0 &&
    confirmDeclined.length === 0;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Stack direction="row" alignItems="baseline" spacing={2} mb={0.5}>
        <Typography variant="h5" fontWeight={700}>
          Scheduling Health
        </Typography>
        {snapshot && (
          <Typography variant="body2" color="text.secondary">
            checked {friendlyDate(snapshot.runDate)}
          </Typography>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Your daily checkup — fix what&apos;s here and schedules stay accurate everywhere.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {finishedMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setFinishedMsg(null)}>
          {finishedMsg}
        </Alert>
      )}

      {loading && (
        <Stack alignItems="center" py={8}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary" mt={2}>
            Checking today&apos;s schedules…
          </Typography>
        </Stack>
      )}

      {!loading && snapshot?.triage?.brief && (
        <Paper
          variant="outlined"
          sx={{ p: 2.5, mb: 2.5, borderColor: 'success.light', bgcolor: 'success.50' }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
            <CheckCircleOutlineIcon color="success" />
            <Typography variant="subtitle1" fontWeight={700} flex={1}>
              Handled overnight
            </Typography>
            {snapshot.triage.autoCompletedStale > 0 && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`${snapshot.triage.autoCompletedStale} closed out`}
              />
            )}
            {snapshot.triage.autoAppliedCancels > 0 && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`${snapshot.triage.autoAppliedCancels} cancellation${snapshot.triage.autoAppliedCancels === 1 ? '' : 's'} applied`}
              />
            )}
            {(snapshot.triage.autoCreatedShifts ?? 0) > 0 && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`${snapshot.triage.autoCreatedShifts} new shift${snapshot.triage.autoCreatedShifts === 1 ? '' : 's'} created`}
              />
            )}
          </Stack>
          <Typography variant="body2">{snapshot.triage.brief}</Typography>
        </Paper>
      )}

      {allClear && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
          <Typography variant="h6" mt={1}>
            Everything looks good today
          </Typography>
          <Typography variant="body2" color="text.secondary">
            No cleanup needed, no unstaffed shifts, nothing waiting from the portals.
          </Typography>
        </Paper>
      )}

      {!loading && stale.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
            <EventBusyIcon color="warning" />
            <Typography variant="subtitle1" fontWeight={700} flex={1}>
              Still marked as working after their shift ended
            </Typography>
            <Chip label={stale.length} color="warning" size="small" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1.5}>
            These workers&apos; shifts are over but they still show as active. One click tidies
            them all up — nobody gets a text, and anyone whose shift hasn&apos;t really ended is
            left alone automatically.
          </Typography>
          <Button
            variant="contained"
            disabled={finishing}
            onClick={handleMarkAllFinished}
            startIcon={finishing ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {finishing ? 'Finishing…' : `Mark all ${stale.length} finished`}
          </Button>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={0.5}>
            {stale.slice(0, 15).map((s) => (
              <Typography key={s.assignmentId} variant="body2">
                <b>{s.workerName || 'Worker'}</b>
                {s.worksiteName ? ` at ${s.worksiteName}` : ''} — shift ended{' '}
                {friendlyDate(s.effectiveEndDate)}
              </Typography>
            ))}
            {stale.length > 15 && (
              <Typography variant="caption" color="text.secondary">
                …and {stale.length - 15} more (the button covers everyone)
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {!loading && gaps.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
            <GroupAddIcon color="error" />
            <Typography variant="subtitle1" fontWeight={700} flex={1}>
              Upcoming shifts that still need people
            </Typography>
            <Chip label={`${snapshot?.counts?.totalGapSeats ?? 0} spots`} color="error" size="small" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1.5}>
            Soonest first. If a shift is already covered in Indeed Flex or Fieldglass, add those
            workers here too so HRX stays accurate.
          </Typography>
          <Stack spacing={1}>
            {gaps.map((g) => (
              <Stack
                key={`${g.jobOrderId}-${g.date}-${g.jobTitle}`}
                direction="row"
                alignItems="center"
                spacing={1.5}
              >
                <Typography variant="body2" flex={1}>
                  <b>{friendlyDate(g.date)}</b> — {g.accountName || 'Client'}, {g.jobTitle || 'shift'}:
                  {' '}needs {g.needed}, has {g.filled}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/jobs/job-orders/${g.jobOrderId}?tab=placements`)}
                >
                  Add people
                </Button>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {!loading && confirmDeclined.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
            <EventBusyIcon color="error" />
            <Typography variant="subtitle1" fontWeight={700} flex={1}>
              Workers who declined their shift
            </Typography>
            <Chip label={confirmDeclined.length} color="error" size="small" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1.5}>
            They replied CANCEL (or were marked a no-show) — these spots likely need someone
            else. The button opens the job order so you can add a replacement.
          </Typography>
          <Stack spacing={1}>
            {confirmDeclined.slice(0, 20).map((r) => (
              <Stack key={r.assignmentId} direction="row" alignItems="center" spacing={1.5}>
                <Typography variant="body2" flex={1}>
                  <b>{r.workerName}</b> — {friendlyDate(r.date)}
                  {r.startTime ? ` at ${friendlyTime(r.startTime)}` : ''}
                  {r.worksiteName ? `, ${r.worksiteName}` : ''}
                  {r.jobTitle ? ` (${r.jobTitle})` : ''}
                </Typography>
                {r.jobOrderId && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => navigate(`/jobs/job-orders/${r.jobOrderId}?tab=placements`)}
                  >
                    Add a replacement
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {!loading && confirmPending.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
            <QuestionAnswerIcon color="warning" />
            <Typography variant="subtitle1" fontWeight={700} flex={1}>
              Haven&apos;t confirmed their shift yet
            </Typography>
            {confirmedCount > 0 && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`${confirmedCount} confirmed`}
              />
            )}
            <Chip label={confirmPending.length} color="warning" size="small" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1.5}>
            We asked these workers to reply YES to confirm and they haven&apos;t answered.
            Automatic reminders keep nudging them — a quick call works even better if the shift
            is soon.
          </Typography>
          <Stack spacing={1}>
            {confirmPending.slice(0, 25).map((r) => (
              <Stack key={r.assignmentId} direction="row" alignItems="center" spacing={1.5}>
                <Typography variant="body2" flex={1}>
                  <b>{r.workerName}</b> — {friendlyDate(r.date)}
                  {r.startTime ? ` at ${friendlyTime(r.startTime)}` : ''}
                  {r.worksiteName ? `, ${r.worksiteName}` : ''}
                </Typography>
                {r.phone && (
                  <Button size="small" variant="outlined" href={`tel:${r.phone}`}>
                    Call
                  </Button>
                )}
              </Stack>
            ))}
            {confirmPending.length > 25 && (
              <Typography variant="caption" color="text.secondary">
                …and {confirmPending.length - 25} more
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {!loading && portalCount > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
            <MoveToInboxIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700} flex={1}>
              Updates from Indeed Flex &amp; Fieldglass
            </Typography>
            <Chip label={portalCount === 100 ? '100+' : portalCount} color="primary" size="small" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1.5}>
            New orders, changes, and cancellations from the portals are waiting. Each one has a
            button that applies it to HRX for you.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/shifts/log')}>
            Review portal updates
          </Button>
        </Paper>
      )}
    </Box>
  );
};

export default SchedulingHealthPage;
