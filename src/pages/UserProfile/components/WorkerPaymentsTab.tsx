/**
 * Payments tab on User Details (Greg 2026-07-28, extending Mark's
 * off-cycle payment feature): send an off-cycle payment to THIS worker
 * from their profile — job order pre-recommended from their recent
 * assignments — with their off-cycle payment history underneath.
 *
 * The send form calls the same `createOffCyclePayment` callable as the
 * Payroll Costs dialog (Everee payable + attribution tag + audit doc);
 * history comes from `listOffCyclePayments` (books-gated server read —
 * the offcycle_payments collection has no client read rules by design).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
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
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { db, functions } from '../../../firebase';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface JoOption {
  id: string;
  label: string;
  group: 'Recent assignments' | 'All job orders';
}

interface HistoryRow {
  id: string;
  workDate: string;
  createdAtIso: string | null;
  reasonLabel: string;
  hiringEntityId: string;
  hours: number | null;
  total: number;
  jobOrderName: string | null;
  accountName: string | null;
  notes: string | null;
  status: string;
  errorMessage: string | null;
}

interface Props {
  uid: string;
  tenantId: string | null;
  workerDisplayName: string | null;
  viewerSecurityLevel: number;
}

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'missed_hours', label: 'Missed hours' },
  { value: 'late_timesheet', label: 'Late timesheet' },
  { value: 'forgot_bank_account', label: 'Forgot bank account' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'expense_reimbursement', label: 'Expense reimbursement' },
  { value: 'payroll_correction', label: 'Payroll correction' },
  { value: 'other', label: 'Other' },
];

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const WorkerPaymentsTab: React.FC<Props> = ({ uid, tenantId, workerDisplayName, viewerSecurityLevel }) => {
  const [entities, setEntities] = useState<Array<{ id: string; name: string; evereeTenantId: string | null }>>([]);
  const [evereeWorkerIds, setEvereeWorkerIds] = useState<Record<string, string>>({});
  const [joOptions, setJoOptions] = useState<JoOption[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  const [entityId, setEntityId] = useState('');
  const [reason, setReason] = useState('missed_hours');
  const [workDate, setWorkDate] = useState(todayIso());
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [gross, setGross] = useState('');
  const [grossTouched, setGrossTouched] = useState(false);
  const [perDiem, setPerDiem] = useState('');
  const [jo, setJo] = useState<JoOption | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSend = viewerSecurityLevel >= 6;

  // Worker's Everee linkage (users/{uid}.evereeWorkerIds keyed by Everee
  // tenant id) + entities — determines which entities can actually pay.
  useEffect(() => {
    if (!tenantId || !uid) return;
    void (async () => {
      try {
        const [userSnap, entSnap] = await Promise.all([
          getDoc(doc(db, 'users', uid)),
          getDocs(collection(db, 'tenants', tenantId, 'entities')),
        ]);
        const ids = (userSnap.data()?.evereeWorkerIds ?? {}) as Record<string, unknown>;
        const cleanIds: Record<string, string> = {};
        Object.entries(ids).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim()) cleanIds[k] = v.trim();
        });
        setEvereeWorkerIds(cleanIds);
        const ents = entSnap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.id),
            evereeTenantId: d.data().evereeTenantId != null ? String(d.data().evereeTenantId).trim() : null,
          }))
          .filter((e) => !/sandbox/i.test(e.id) && !/sandbox/i.test(e.name));
        setEntities(ents);
        // Default to the first entity where the worker has an Everee account.
        const linked = ents.find((e) => e.evereeTenantId && cleanIds[e.evereeTenantId]);
        setEntityId((prev) => prev || linked?.id || ents[0]?.id || '');
      } catch {
        setEntities([]);
      }
    })();
  }, [tenantId, uid]);

  // Job orders: worker's recent assignments first, then everything.
  useEffect(() => {
    if (!tenantId || !uid) return;
    void (async () => {
      try {
        const [byUser, byCand] = await Promise.all([
          getDocs(query(collection(db, 'tenants', tenantId, 'assignments'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'tenants', tenantId, 'assignments'), where('candidateId', '==', uid))),
        ]);
        const recentJoIds: string[] = [];
        const assignmentDates = new Map<string, string>();
        [...byUser.docs, ...byCand.docs].forEach((d) => {
          const a = d.data();
          const joId = String(a.jobOrderId ?? '').trim();
          if (!joId) return;
          const dt = String(a.workDate ?? a.startDate ?? '');
          if (!assignmentDates.has(joId) || dt > (assignmentDates.get(joId) ?? '')) {
            assignmentDates.set(joId, dt);
          }
        });
        recentJoIds.push(
          ...[...assignmentDates.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([id]) => id).slice(0, 6),
        );

        const opts: JoOption[] = [];
        const seen = new Set<string>();
        for (const coll of ['job_orders', 'recruiter_jobOrders']) {
          // eslint-disable-next-line no-await-in-loop
          const snap = await getDocs(collection(db, 'tenants', tenantId, coll)).catch(() => null);
          snap?.docs.forEach((d) => {
            if (seen.has(d.id)) return;
            seen.add(d.id);
            const v = d.data();
            const name = String(v.jobOrderName ?? '').trim();
            if (!name) return;
            const numPart = String(v.jobOrderNumber ?? '').trim();
            const sitePart = String(v.worksiteName ?? '').trim();
            opts.push({
              id: d.id,
              label: `${numPart ? `#${numPart} ` : ''}${name}${sitePart && sitePart !== name ? ` — ${sitePart}` : ''}`,
              group: recentJoIds.includes(d.id) ? 'Recent assignments' : 'All job orders',
            });
          });
        }
        opts.sort((a, b) =>
          a.group === b.group ? a.label.localeCompare(b.label) : a.group === 'Recent assignments' ? -1 : 1,
        );
        setJoOptions(opts);
        // Pre-select the most recent assignment's job order.
        const recommended = recentJoIds[0] ? opts.find((o) => o.id === recentJoIds[0]) : null;
        if (recommended) setJo((prev) => prev ?? recommended);
      } catch {
        setJoOptions([]);
      }
    })();
  }, [tenantId, uid]);

  const loadHistory = useCallback(async () => {
    if (!tenantId || !uid) return;
    try {
      const fn = httpsCallable(functions, 'listOffCyclePayments');
      const res = await fn({ tenantId, workerId: uid });
      setHistory((res.data as { payments?: HistoryRow[] }).payments ?? []);
    } catch {
      setHistory([]);
    }
  }, [tenantId, uid]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Gross auto-computes from hours × rate until edited directly.
  useEffect(() => {
    if (grossTouched) return;
    const h = Number(hours);
    const r = Number(rate);
    if (h > 0 && r > 0) setGross((Math.round(h * r * 100) / 100).toFixed(2));
  }, [hours, rate, grossTouched]);

  const selectedEntity = entities.find((e) => e.id === entityId);
  const entityLinked = Boolean(selectedEntity?.evereeTenantId && evereeWorkerIds[selectedEntity.evereeTenantId]);
  const total = (Number(gross) || 0) + (Number(perDiem) || 0);

  const submit = async () => {
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'createOffCyclePayment');
      await fn({
        tenantId,
        hiringEntityId: entityId,
        workerId: uid,
        reason,
        workDate,
        hours: Number(hours) || 0,
        hourlyRate: Number(rate) || 0,
        grossAmount: Number(gross) || 0,
        perDiemAmount: Number(perDiem) || 0,
        ...(jo ? { jobOrderId: jo.id } : {}),
        notes,
      });
      setSuccess(`Payment of ${usd(total)} sent to Everee for ${workerDisplayName ?? 'this worker'}.`);
      setHours('');
      setRate('');
      setGross('');
      setGrossTouched(false);
      setPerDiem('');
      setNotes('');
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!tenantId) return null;

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Send payment
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Sends an off-cycle payment to Everee right away and records it against the job order for
            cost tracking.
          </Typography>

          {!canSend && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Sending payments requires admin (level 6+) access.
            </Alert>
          )}
          {canSend && Object.keys(evereeWorkerIds).length === 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              No Everee account is linked to this worker yet — the payment will be rejected until
              they finish Everee onboarding.
            </Alert>
          )}
          {canSend && Object.keys(evereeWorkerIds).length > 0 && !entityLinked && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This worker doesn&apos;t have an Everee account under the selected entity — pick the
              entity they onboarded with.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          <Stack spacing={2} sx={{ maxWidth: 640 }}>
            <Stack direction="row" spacing={2}>
              <FormControl size="small" fullWidth>
                <InputLabel>Hiring entity</InputLabel>
                <Select value={entityId} label="Hiring entity" onChange={(e) => setEntityId(e.target.value)}>
                  {entities.map((e) => (
                    <MenuItem key={e.id} value={e.id}>
                      {e.name}
                      {e.evereeTenantId && evereeWorkerIds[e.evereeTenantId] ? ' ✓' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Payment reason</InputLabel>
                <Select value={reason} label="Payment reason" onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => (
                    <MenuItem key={r.value} value={r.value}>
                      {r.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                label="Work date"
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 160 }}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField size="small" label="Hours" type="number" value={hours} onChange={(e) => setHours(e.target.value)} />
              <TextField size="small" label="Hourly rate" type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
              <TextField
                size="small"
                label="Gross amount"
                type="number"
                value={gross}
                onChange={(e) => {
                  setGross(e.target.value);
                  setGrossTouched(true);
                }}
                helperText="Auto-fills from hours × rate"
              />
              <TextField
                size="small"
                label="Per diem (optional)"
                type="number"
                value={perDiem}
                onChange={(e) => setPerDiem(e.target.value)}
              />
            </Stack>
            <Autocomplete
              options={joOptions ?? []}
              loading={joOptions === null}
              groupBy={(o) => o.group}
              value={jo}
              onChange={(_e, v) => setJo(v)}
              renderInput={(params) => (
                <TextField {...params} size="small" label="Job order (for cost attribution)" />
              )}
            />
            <TextField
              size="small"
              label="Notes"
              multiline
              minRows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Box>
              <Button
                variant="contained"
                disabled={!canSend || saving || !entityId || total <= 0}
                onClick={() => void submit()}
              >
                {saving ? 'Sending…' : `Send ${usd(total)} to Everee`}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Off-cycle payment history
          </Typography>
          {history === null ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={22} />
            </Box>
          ) : history.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No off-cycle payments yet. Payments sent from this form (or the Payroll Costs page)
              show here; regular payroll history lives in Employment &amp; Payroll.
            </Typography>
          ) : (
            <TableContainer sx={{ maxHeight: 380 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Sent</TableCell>
                    <TableCell>Work date</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Job order</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id} hover>
                      <TableCell>{h.createdAtIso ? h.createdAtIso.slice(0, 10) : '—'}</TableCell>
                      <TableCell>{h.workDate}</TableCell>
                      <TableCell>{h.reasonLabel}</TableCell>
                      <TableCell>{h.jobOrderName ?? '—'}</TableCell>
                      <TableCell align="right">{h.hours ?? '—'}</TableCell>
                      <TableCell align="right">{usd(h.total)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={h.status === 'sent_to_everee' ? 'Sent' : h.status}
                          color={h.status === 'sent_to_everee' || h.status === 'paid' ? 'success' : h.status === 'error' ? 'error' : 'default'}
                          title={h.errorMessage ?? undefined}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default WorkerPaymentsTab;
