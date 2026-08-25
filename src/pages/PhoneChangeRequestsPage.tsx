/**
 * Phone Changes — /users/phone-changes (Users hub tab, Slice 3 2026-08-25).
 *
 * Workers whose number changed file these from the phone sign-in screen
 * ("My number changed"): the NEW number is OTP-verified on their device, the
 * account is claimed by name + DOB, and the request lands in
 * `phone_change_requests` for review here. Approving moves the phone onto the
 * chosen account (users doc + Auth) via workerSupportAssistant
 * (`phone_change_approve` / `phone_change_reject`) and texts the worker on
 * the new number. Never auto-approved — name + DOB is weak proof, so a human
 * confirms (open the profile, check work history/site) before approving.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
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
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

const TENANT_C1 = 'BCiP2bQ9CgVOCTfV6MhD';

type RequestStatus = 'pending' | 'approved' | 'rejected';

interface Candidate {
  uid: string;
  firstName: string;
  lastName: string;
  email: string | null;
  oldPhoneE164: string | null;
  oldPhone: string | null;
}

interface PhoneChangeRow {
  id: string;
  newPhoneE164: string;
  claimedFirstName: string;
  claimedLastName: string;
  claimedDob: string;
  candidates: Candidate[];
  status: RequestStatus;
  requestedAt: Date | null;
  processedBy: string | null;
  processedAt: Date | null;
  approvedUid: string | null;
  note: string | null;
}

function toDate(v: unknown): Date | null {
  const o = v as { toDate?: () => Date } | null;
  if (o && typeof o.toDate === 'function') {
    try {
      return o.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function fmtPhone(e164OrTen: string | null): string {
  const d = String(e164OrTen || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return String(e164OrTen || '—');
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const STATUS_CHIP: Record<RequestStatus, { label: string; color: 'warning' | 'success' | 'default' }> = {
  pending: { label: 'Pending', color: 'warning' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'default' },
};

const PhoneChangeRequestsPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PhoneChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'approve'; row: PhoneChangeRow; candidate: Candidate }
    | { kind: 'reject'; row: PhoneChangeRow }
    | null
  >(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Equality filter on tenantId keeps the read inside the staff rule
      // (hasSecurityLevel(resource.data.tenantId, 5)); sort client-side so no
      // composite index is needed — the queue stays small.
      const snap = await getDocs(
        query(collection(db, 'phone_change_requests'), where('tenantId', '==', TENANT_C1)),
      );
      const list = snap.docs.map((d): PhoneChangeRow => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          newPhoneE164: String(x.newPhoneE164 || ''),
          claimedFirstName: String(x.claimedFirstName || ''),
          claimedLastName: String(x.claimedLastName || ''),
          claimedDob: String(x.claimedDob || ''),
          candidates: Array.isArray(x.candidates) ? (x.candidates as Candidate[]) : [],
          status: ((x.status as string) || 'pending') as RequestStatus,
          requestedAt: toDate(x.requestedAt),
          processedBy: (x.processedBy as string) ?? null,
          processedAt: toDate(x.processedAt),
          approvedUid: (x.approvedUid as string) ?? null,
          note: (x.note as string) ?? null,
        };
      });
      list.sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0));
      setRows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async () => {
    if (!confirm) return;
    setSaving(true);
    setError(null);
    try {
      const call = httpsCallable(getFunctions(), 'workerSupportAssistant');
      if (confirm.kind === 'approve') {
        await call({ action: 'phone_change_approve', requestId: confirm.row.id, uid: confirm.candidate.uid });
      } else {
        await call({ action: 'phone_change_reject', requestId: confirm.row.id, note: note.trim() || undefined });
      }
      setConfirm(null);
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Phone change requests
        </Typography>
        {pendingCount > 0 && <Chip size="small" color="warning" label={`${pendingCount} pending`} />}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 860 }}>
        Workers file these from the sign-in screen when their phone number changed. The{' '}
        <strong>new number is already text-verified</strong>; the name and date of birth are the
        worker&apos;s claim. Open the matched profile and confirm it&apos;s really them (recent
        sites, recruiter knowledge) before approving — approval moves sign-in to the new number
        immediately and texts the worker.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Alert severity="info">No phone change requests yet.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Claimed identity</TableCell>
                <TableCell>New number</TableCell>
                <TableCell>Matched account(s)</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {r.claimedFirstName} {r.claimedLastName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        DOB {r.claimedDob || '—'}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{fmtPhone(r.newPhoneE164)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75}>
                      {r.candidates.map((c) => (
                        <Stack key={c.uid} direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                          <Typography variant="body2">
                            {c.firstName} {c.lastName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {[c.oldPhone ? `was ${fmtPhone(c.oldPhone)}` : null, c.email].filter(Boolean).join(' · ')}
                          </Typography>
                          <Button
                            size="small"
                            variant="text"
                            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                            onClick={() => navigate(`/users/${c.uid}`)}
                          >
                            Profile
                          </Button>
                          {r.status === 'pending' && (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                setNote('');
                                setConfirm({ kind: 'approve', row: r, candidate: c });
                              }}
                            >
                              Approve
                            </Button>
                          )}
                          {r.status === 'approved' && r.approvedUid === c.uid && (
                            <Chip size="small" color="success" variant="outlined" label="Moved here" />
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {r.requestedAt ? r.requestedAt.toLocaleDateString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Chip size="small" label={STATUS_CHIP[r.status].label} color={STATUS_CHIP[r.status].color} />
                      {r.processedAt && (
                        <Typography variant="caption" color="text.secondary">
                          {r.processedAt.toLocaleDateString()}
                          {r.note ? ` — ${r.note}` : ''}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    {r.status === 'pending' && (
                      <Button
                        size="small"
                        variant="text"
                        color="inherit"
                        onClick={() => {
                          setNote('');
                          setConfirm({ kind: 'reject', row: r });
                        }}
                      >
                        Reject
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm?.kind === 'approve' ? 'Approve phone change' : 'Reject request'}</DialogTitle>
        <DialogContent>
          {confirm?.kind === 'approve' ? (
            <Typography variant="body2" color="text.secondary">
              Move sign-in for{' '}
              <strong>
                {confirm.candidate.firstName} {confirm.candidate.lastName}
              </strong>{' '}
              to <strong>{fmtPhone(confirm.row.newPhoneE164)}</strong>? The old number stops
              working for sign-in and the worker gets a confirmation text on the new one.
            </Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Reject without changing anything (e.g. identity not confirmed). Add a short note
                for the audit trail.
              </Typography>
              <TextField
                fullWidth
                size="small"
                label="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                multiline
                minRows={2}
              />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="contained" disabled={saving} onClick={() => void act()}>
            {saving ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PhoneChangeRequestsPage;
