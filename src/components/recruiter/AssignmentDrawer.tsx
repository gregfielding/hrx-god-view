/**
 * AssignmentDrawer — the assignment view (Greg, 2026-07-20).
 *
 * The first dedicated "this worker, this assignment" surface. Opens from a
 * worker row on Who's Working (both tabs); a slide-out drawer rather than a
 * page so recruiters never lose their place. Shows the full picture —
 * worker, account → job order, worksite + address, schedule, rates, status —
 * and carries the ONE action this view exists for: **End assignment** as of
 * a chosen date with an optional reason.
 *
 * Ending is schedule-level cleanup, NOT separation: the server callable
 * (`endAssignment`) stamps the end on open-ended docs and hard-deletes any
 * future per-day docs, so ended workers vanish from grids and reports
 * immediately. No worker notification is sent — this exists to clean up
 * after quits/replacements that were never recorded.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../firebase';
import { todayIsoLocal } from '../../utils/timesheets/dateRange';

/** What the opener knows about the clicked row — the drawer loads the rest. */
export interface AssignmentDrawerTarget {
  workerId: string;
  workerName: string;
  jobOrderId: string | null;
  shiftId: string | null;
  /** A concrete assignment doc id when the opener has one (tab 2 rows do). */
  assignmentId?: string | null;
}

interface FamilyDoc {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  payRate: number;
  billRate: number;
  phone: string;
  jobTitle: string;
  worksiteName: string;
  companyName: string;
  isOpenShift: boolean;
  weeklyDays: number[];
  /** Full doc — feeds the admin edit form + audit trail. */
  raw: Record<string, unknown>;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function friendly(dateIso: string | null | undefined): string {
  if (!dateIso) return '—';
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const AssignmentDrawer: React.FC<{
  open: boolean;
  tenantId: string;
  target: AssignmentDrawerTarget | null;
  onClose: () => void;
  /** Called after a successful end so the opener can reload its data. */
  onEnded: () => void;
}> = ({ open, tenantId, target, onClose, onEnded }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [family, setFamily] = useState<FamilyDoc[]>([]);
  const [joLabel, setJoLabel] = useState<string>('');
  const [accountLabel, setAccountLabel] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [endDate, setEndDate] = useState<string>(todayIsoLocal());
  const [reason, setReason] = useState('');
  const [ending, setEnding] = useState(false);
  const [endedMsg, setEndedMsg] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Admin edit form (Greg, 2026-07-22): the drawer IS the admin
  // assignment view — recruiters edit dates / rates / schedule here.
  // All writes are silent (notificationsSuppressed) — this surface is
  // for data cleanup, never worker communication.
  const [editOpen, setEditOpen] = useState(false);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editPay, setEditPay] = useState('');
  const [editBill, setEditBill] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editDays, setEditDays] = useState<number[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!target || !tenantId) return;
    setLoading(true);
    setError(null);
    setEndedMsg(null);
    setEndDate(todayIsoLocal());
    setReason('');
    try {
      // The (worker, shift) family — covers per-day doc sets and the single
      // open-ended doc alike. Single-field query + client filter, no index.
      let docs: FamilyDoc[] = [];
      if (target.shiftId) {
        const snap = await getDocs(
          query(
            collection(db, 'tenants', tenantId, 'assignments'),
            where('shiftId', '==', target.shiftId),
          ),
        );
        docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter(
            (x) =>
              String((x as { userId?: unknown }).userId ?? (x as { candidateId?: unknown }).candidateId ?? '') ===
              target.workerId,
          )
          .map((x) => {
            const r = x as Record<string, unknown>;
            const ws = (r.weeklySchedule ?? null) as Record<string, { enabled?: boolean }> | null;
            return {
              id: String(r.id),
              startDate: typeof r.startDate === 'string' ? r.startDate.slice(0, 10) : '',
              endDate: typeof r.endDate === 'string' ? r.endDate.slice(0, 10) : '',
              status: String(r.status ?? ''),
              payRate: Number(r.payRate) > 0 ? Number(r.payRate) : 0,
              billRate: Number(r.billRate) > 0 ? Number(r.billRate) : 0,
              phone: String(r.phone ?? ''),
              jobTitle: String(r.jobTitle ?? r.shiftTitle ?? ''),
              worksiteName: String(r.worksiteName ?? r.locationNickname ?? ''),
              companyName: String(r.companyName ?? ''),
              isOpenShift: r.isOpenShift === true || r.noFixedTimes === true,
              weeklyDays: ws
                ? Object.entries(ws)
                    .filter(([, v]) => v && v.enabled === true)
                    .map(([k]) => Number(k))
                    .filter((n) => Number.isFinite(n))
                    .sort()
                : [],
              raw: r,
            };
          })
          .sort((a, b) => a.startDate.localeCompare(b.startDate));
      }
      setFamily(docs);

      if (target.jobOrderId) {
        const jo = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', target.jobOrderId));
        if (jo.exists()) {
          const j = jo.data() as Record<string, unknown>;
          setJoLabel(String(j.jobOrderName ?? j.jobTitle ?? ''));
          setAccountLabel(
            String(j.recruiterAccountName ?? j.accountName ?? j.companyName ?? ''),
          );
          const addr = (j.worksiteAddress ?? {}) as Record<string, unknown>;
          setAddress(
            [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
          );
        }
      } else {
        setJoLabel('');
        setAccountLabel('');
        setAddress('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [target, tenantId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const live = useMemo(
    () => family.filter((f) => !/cancel|declined|rejected/.test(f.status.toLowerCase())),
    [family],
  );
  const primary = live[live.length - 1] ?? family[family.length - 1] ?? null;
  const isOngoing = Boolean(primary?.isOpenShift || (primary && !primary.endDate && primary.weeklyDays.length > 0));
  useEffect(() => {
    if (!primary) return;
    const r = primary.raw;
    const ws = (r.weeklySchedule ?? null) as Record<string, { enabled?: boolean; startTime?: string; endTime?: string }> | null;
    const firstDay = ws ? Object.values(ws).find((v) => v && v.enabled === true) : null;
    setEditStart(primary.startDate);
    setEditEnd(primary.endDate);
    setEditPay(primary.payRate ? String(primary.payRate) : '');
    setEditBill(primary.billRate ? String(primary.billRate) : '');
    setEditStartTime(String(r.startTime ?? firstDay?.startTime ?? ''));
    setEditEndTime(String(r.endTime ?? firstDay?.endTime ?? ''));
    setEditDays(primary.weeklyDays);
    setSavedMsg(null);
    setEditOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.id]);

  const handleSaveEdit = async () => {
    if (!primary || !tenantId) return;
    setSavingEdit(true);
    setError(null);
    try {
      const updates: Record<string, unknown> = {
        notificationsSuppressed: true,
        updatedBy: 'assignment_drawer_edit',
        updatedAt: serverTimestamp(),
      };
      if (editStart && editStart !== primary.startDate) updates.startDate = editStart;
      if (editEnd !== primary.endDate) updates.endDate = editEnd; // '' = ongoing
      const pay = parseFloat(editPay);
      if (Number.isFinite(pay) && pay !== primary.payRate) updates.payRate = pay;
      const bill = parseFloat(editBill);
      if (Number.isFinite(bill) && bill !== primary.billRate) updates.billRate = bill;
      const hadWs = primary.weeklyDays.length > 0;
      const daysChanged =
        editDays.length !== primary.weeklyDays.length ||
        editDays.some((d) => !primary.weeklyDays.includes(d));
      const r = primary.raw;
      const ws0 = (r.weeklySchedule ?? null) as Record<string, { startTime?: string; endTime?: string }> | null;
      const first0 = ws0 ? Object.values(ws0)[0] : null;
      const timesChanged =
        editStartTime !== String(r.startTime ?? first0?.startTime ?? '') ||
        editEndTime !== String(r.endTime ?? first0?.endTime ?? '');
      if ((hadWs || editDays.length > 0) && (daysChanged || timesChanged)) {
        const ws: Record<string, { enabled: boolean; startTime: string; endTime: string }> = {};
        for (const d of editDays) ws[String(d)] = { enabled: true, startTime: editStartTime, endTime: editEndTime };
        updates.weeklySchedule = ws;
      }
      if (timesChanged) {
        updates.startTime = editStartTime;
        updates.endTime = editEndTime;
      }
      await updateDoc(doc(db, 'tenants', tenantId, 'assignments', primary.id), updates);
      setSavedMsg('Saved. No notifications were sent.');
      setEditOpen(false);
      await load();
      onEnded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const upcomingDays = useMemo(() => {
    const today = todayIsoLocal();
    return live.filter((f) => f.startDate >= today && f.startDate === (f.endDate || f.startDate));
  }, [live]);

  const handleDelete = async () => {
    if (!target || !primary) return;
    setDeleting(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'endAssignment');
      const res = await fn({
        tenantId,
        assignmentId: target.assignmentId || primary.id,
        mode: 'delete',
        reason: reason.trim() || undefined,
      });
      const data = res.data as { deleted?: number };
      setConfirmDeleteOpen(false);
      setEndedMsg(
        `Assignment deleted — ${data.deleted ?? 0} record${(data.deleted ?? 0) === 1 ? '' : 's'} removed as if it never happened. Use Open in Placements to add the correct worker.`,
      );
      onEnded();
      void load();
    } catch (err) {
      setConfirmDeleteOpen(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleEnd = async () => {
    if (!target || !primary) return;
    setEnding(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'endAssignment');
      const res = await fn({
        tenantId,
        assignmentId: target.assignmentId || primary.id,
        endDate,
        reason: reason.trim() || undefined,
      });
      const data = res.data as { ended?: number; deleted?: number };
      setEndedMsg(
        `Assignment ended as of ${friendly(endDate)}.` +
          (data.deleted ? ` ${data.deleted} future day${data.deleted === 1 ? '' : 's'} removed.` : ''),
      );
      onEnded();
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnding(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 420 }, p: 2.5 }} role="presentation">
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {target?.workerName ?? 'Assignment'}
            </Typography>
            {primary?.phone && (
              <Typography variant="body2" color="text.secondary">
                {primary.phone}
              </Typography>
            )}
          </Box>
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.75}>
              <Typography variant="body2">
                <strong>{accountLabel || primary?.companyName || 'Account'}</strong>
                {joLabel ? ` — ${joLabel}` : ''}
              </Typography>
              {primary?.jobTitle && (
                <Typography variant="body2" color="text.secondary">
                  {primary.jobTitle}
                </Typography>
              )}
              {(primary?.worksiteName || address) && (
                <Typography variant="body2" color="text.secondary">
                  {[primary?.worksiteName, address].filter(Boolean).join(' · ')}
                </Typography>
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ pt: 0.5 }}>
                {isOngoing ? (
                  <Chip size="small" color="success" label="Ongoing — no end date" />
                ) : null}
                {/* Hide the raw status on ongoing rows when it's an
                    'ended'/'completed' left by the old stale sweep — the
                    assignment is demonstrably live, and the stale flag would
                    just confuse. */}
                {primary?.status &&
                  !(isOngoing && /ended|completed/i.test(primary.status)) && (
                    <Chip size="small" variant="outlined" label={`Status: ${primary.status}`} />
                  )}
                {primary?.payRate ? (
                  <Chip size="small" variant="outlined" label={`Pay $${primary.payRate}/hr`} />
                ) : null}
                {primary?.billRate ? (
                  <Chip size="small" variant="outlined" label={`Bill $${primary.billRate}/hr`} />
                ) : null}
              </Stack>
              <Typography variant="body2" sx={{ pt: 0.5 }}>
                Started {friendly(live[0]?.startDate || primary?.startDate)}
                {primary?.endDate ? ` · ends ${friendly(primary.endDate)}` : ''}
              </Typography>
              {isOngoing && primary && primary.weeklyDays.length > 0 && (
                <Stack direction="row" spacing={0.5} sx={{ pt: 0.5 }}>
                  {primary.weeklyDays.map((d) => (
                    <Chip key={d} size="small" color="primary" label={DOW_LABELS[d] ?? d} />
                  ))}
                </Stack>
              )}
              {!isOngoing && upcomingDays.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {upcomingDays.length} upcoming day{upcomingDays.length === 1 ? '' : 's'}:{' '}
                  {upcomingDays
                    .slice(0, 6)
                    .map((f) => friendly(f.startDate).replace(/, \d{4}$/, ''))
                    .join(', ')}
                  {upcomingDays.length > 6 ? '…' : ''}
                </Typography>
              )}
            </Stack>

            {target?.jobOrderId && (
              <Button
                size="small"
                startIcon={<OpenInNewIcon />}
                sx={{ mt: 1.5 }}
                onClick={() => navigate(`/jobs/job-orders/${target.jobOrderId}?tab=placements`)}
              >
                Open in Placements
              </Button>
            )}

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight={700}>
                Assignment details
              </Typography>
              <Button size="small" onClick={() => setEditOpen((v) => !v)}>
                {editOpen ? 'Cancel' : 'Edit'}
              </Button>
            </Stack>
            {savedMsg && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {savedMsg}
              </Alert>
            )}
            {editOpen && primary && (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={1}>
                  <TextField label="Start date" type="date" size="small" fullWidth value={editStart} onChange={(e) => setEditStart(e.target.value)} InputLabelProps={{ shrink: true }} />
                  <TextField label="End date" type="date" size="small" fullWidth value={editEnd} onChange={(e) => setEditEnd(e.target.value)} InputLabelProps={{ shrink: true }} helperText="Blank = ongoing" />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField label="Pay $/hr" size="small" fullWidth value={editPay} onChange={(e) => setEditPay(e.target.value)} />
                  <TextField label="Bill $/hr" size="small" fullWidth value={editBill} onChange={(e) => setEditBill(e.target.value)} />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField label="Start time" type="time" size="small" fullWidth value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} InputLabelProps={{ shrink: true }} />
                  <TextField label="End time" type="time" size="small" fullWidth value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} InputLabelProps={{ shrink: true }} />
                </Stack>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {DOW_LABELS.map((label, d) => (
                    <Chip
                      key={label}
                      size="small"
                      label={label}
                      color={editDays.includes(d) ? 'primary' : undefined}
                      variant={editDays.includes(d) ? 'filled' : 'outlined'}
                      onClick={() =>
                        setEditDays((prev) =>
                          prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
                        )
                      }
                    />
                  ))}
                </Stack>
                <Button variant="contained" size="small" disabled={savingEdit} onClick={() => void handleSaveEdit()}>
                  {savingEdit ? 'Saving…' : 'Save changes (no notifications)'}
                </Button>
              </Stack>
            )}
            {!editOpen &&
              primary &&
              (() => {
                const r = primary.raw;
                const fmt = (v: unknown): string => {
                  const d = (v as { toDate?: () => Date } | undefined)?.toDate?.();
                  return d ? d.toLocaleString() : typeof v === 'string' ? v : '';
                };
                const lines: string[] = [];
                if (r.createdAt) lines.push(`Created ${fmt(r.createdAt)}${r.createdBy ? ` by ${String(r.createdBy).slice(0, 24)}` : ''}`);
                if (r.updatedAt) lines.push(`Updated ${fmt(r.updatedAt)}${r.updatedBy ? ` by ${String(r.updatedBy).slice(0, 32)}` : ''}`);
                if (r.endedAsOf) {
                  lines.push(`Ended as of ${String(r.endedAsOf)}${r.endedBy ? ` by ${String(r.endedBy).slice(0, 24)}` : ''}${r.endedReason ? ` — ${String(r.endedReason)}` : ''}`);
                } else if (r.completedReason) {
                  lines.push(`Auto-completed — ${String(r.completedReason)}`);
                }
                if (r.paySource) lines.push(`Pay rate source: ${String(r.paySource)}`);
                return lines.length ? (
                  <Stack sx={{ mt: 1 }} spacing={0.25}>
                    {lines.map((l) => (
                      <Typography key={l} variant="caption" color="text.secondary">
                        {l}
                      </Typography>
                    ))}
                  </Stack>
                ) : null;
              })()}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              End this assignment
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              For workers who quit or were replaced. Ends the schedule only — the worker stays
              hired and in the pool. No text goes out.
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="Last day worked"
                type="date"
                size="small"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Reason (optional)"
                size="small"
                placeholder="e.g. quit, replaced by another worker"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="contained"
                color="warning"
                startIcon={ending ? <CircularProgress size={16} color="inherit" /> : <EventBusyIcon />}
                disabled={ending || !primary || Boolean(endedMsg)}
                onClick={handleEnd}
              >
                End assignment
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Never actually worked here?
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              If this assignment was a mistake — the real hire happened elsewhere and HRX was
              never updated — delete it entirely, then add the correct worker from Placements.
            </Typography>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              disabled={deleting || !primary || Boolean(endedMsg)}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete this assignment
            </Button>

            <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
              <DialogTitle>Delete {target?.workerName}'s assignment?</DialogTitle>
              <DialogContent>
                <DialogContentText>
                  This erases every record of this assignment — as if it never happened. Use it
                  only when {target?.workerName} never actually worked here. If they have hours on
                  a timesheet, deleting is blocked and you should use End assignment instead. This
                  can't be undone, and no text goes out.
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirmDeleteOpen(false)}>Keep it</Button>
                <Button
                  color="error"
                  variant="contained"
                  startIcon={
                    deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />
                  }
                  disabled={deleting}
                  onClick={handleDelete}
                >
                  Delete forever
                </Button>
              </DialogActions>
            </Dialog>
            {endedMsg && (
              <Alert severity="success" sx={{ mt: 2 }}>
                {endedMsg}
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
};

export default AssignmentDrawer;
