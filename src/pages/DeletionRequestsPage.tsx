/**
 * Deletion Requests — /users/deletion-requests (Users hub tab).
 *
 * Worker-initiated account-deletion requests from the worker app's
 * About & Legal page (`account_deletion_requests/{uid}`, created 2026-08-23;
 * an App Store requirement for the native app). Support reviews each request
 * here and acts on the USER'S PROFILE — the actual deletion is the same
 * `deleteUserCompletely` flow used for extra/unneeded profiles (User Profile →
 * System Access → Delete). Two paths:
 *   - No payroll/tax history → hard delete (Auth + Firestore) via that flow.
 *   - Has payroll/tax history → do NOT hard-delete (retention obligations);
 *     deactivate the account and mark the request completed with a note.
 * Status writes here require HRX (rules allow update of status fields only).
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
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

type RequestStatus = 'pending' | 'completed' | 'dismissed';

interface DeletionRequestRow {
  uid: string;
  email: string | null;
  requestedAt: Date | null;
  status: RequestStatus;
  source?: string;
  processedBy?: string | null;
  processedAt?: Date | null;
  note?: string | null;
  /** Joined from users/{uid} — null when the user doc is already gone. */
  displayName: string | null;
  phone: string | null;
  userDocExists: boolean;
  /** Real Everee pay/tax linkage — drives the "has payroll history" warning. */
  hasPayrollHistory: boolean;
  /** SSN last-4 on file but NO pay records — deletable, just flag it. */
  hasSsnOnFileOnly: boolean;
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

const STATUS_CHIP: Record<RequestStatus, { label: string; color: 'warning' | 'success' | 'default' }> = {
  pending: { label: 'Pending', color: 'warning' },
  completed: { label: 'Completed', color: 'success' },
  dismissed: { label: 'Dismissed', color: 'default' },
};

const DeletionRequestsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<DeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionRow, setActionRow] = useState<{ uid: string; nextStatus: RequestStatus } | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionSaving, setActionSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(
        query(collection(db, 'account_deletion_requests'), orderBy('requestedAt', 'desc')),
      );
      const base = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          uid: d.id,
          email: (x.email as string) ?? null,
          requestedAt: toDate(x.requestedAt),
          status: ((x.status as string) || 'pending') as RequestStatus,
          source: (x.source as string) || undefined,
          processedBy: (x.processedBy as string) ?? null,
          processedAt: toDate(x.processedAt),
          note: (x.note as string) ?? null,
        };
      });
      const joined = await Promise.all(
        base.map(async (r): Promise<DeletionRequestRow> => {
          try {
            const uSnap = await getDoc(doc(db, 'users', r.uid));
            if (!uSnap.exists()) {
              return { ...r, displayName: null, phone: null, userDocExists: false, hasPayrollHistory: false, hasSsnOnFileOnly: false };
            }
            const u = uSnap.data() as Record<string, unknown>;
            const first = String(u.firstName || '').trim();
            const last = String(u.lastName || '').trim();
            const name = `${first} ${last}`.trim() || String(u.displayName || '').trim() || null;
            // Everee write-through markers — any of these means real pay/tax
            // records exist and the account must NOT be hard-deleted.
            const taxIdentity = (u.taxIdentity ?? null) as Record<string, unknown> | null;
            // Real pay/tax records (retention applies) vs merely an SSN last-4
            // typed at signup (no retention obligation) — the combined flag
            // made never-placed workers look undeletable (Grissett, 8/25).
            const hasPayrollHistory = Boolean(taxIdentity?.source === 'everee' || u.evereeWorkerId);
            const hasSsnOnFileOnly = !hasPayrollHistory && Boolean(u.last4SSN);
            return {
              ...r,
              displayName: name,
              phone: String(u.phone || '') || null,
              userDocExists: true,
              hasPayrollHistory,
              hasSsnOnFileOnly,
            };
          } catch {
            return { ...r, displayName: null, phone: null, userDocExists: true, hasPayrollHistory: false, hasSsnOnFileOnly: false };
          }
        }),
      );
      setRows(joined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAction = async () => {
    if (!actionRow || !user?.uid) return;
    setActionSaving(true);
    try {
      await updateDoc(doc(db, 'account_deletion_requests', actionRow.uid), {
        status: actionRow.nextStatus,
        processedBy: user.email ?? user.uid,
        processedAt: serverTimestamp(),
        note: actionNote.trim() || null,
      });
      setActionRow(null);
      setActionNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionSaving(false);
    }
  };

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Account deletion requests
        </Typography>
        {pendingCount > 0 && <Chip size="small" color="warning" label={`${pendingCount} pending`} />}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 860 }}>
        Workers file these from the app (Profile → About &amp; Legal). To act on one, open the
        profile: if the account has <strong>no payroll/tax history</strong>, delete it there
        (System Access → Delete — same flow as removing a duplicate/unused profile). If it{' '}
        <strong>has payroll history</strong>, do not hard-delete — retention obligations apply;
        deactivate the account instead, then mark the request completed with a note.
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
        <Alert severity="info">No deletion requests yet.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Payroll history</TableCell>
                <TableCell>Processed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.uid} hover>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.displayName || r.email || r.uid}
                        </Typography>
                        {!r.userDocExists && (
                          <Chip size="small" label="Account already deleted" variant="outlined" />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {[r.email, r.phone].filter(Boolean).join(' · ') || r.uid}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {r.requestedAt ? r.requestedAt.toLocaleDateString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={STATUS_CHIP[r.status].label}
                      color={STATUS_CHIP[r.status].color}
                    />
                  </TableCell>
                  <TableCell>
                    {r.hasPayrollHistory ? (
                      <Tooltip title="Everee pay/tax records exist — do NOT hard-delete; deactivate and retain records.">
                        <Chip size="small" color="error" variant="outlined" label="Has payroll — retain" />
                      </Tooltip>
                    ) : r.hasSsnOnFileOnly ? (
                      <Tooltip title="SSN last-4 was typed at signup but there are NO pay/tax records — safe to hard-delete.">
                        <Chip size="small" color="warning" variant="outlined" label="SSN on file — no pay history" />
                      </Tooltip>
                    ) : r.userDocExists ? (
                      <Chip size="small" variant="outlined" label="None found" />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.processedAt ? (
                      <Stack spacing={0}>
                        <Typography variant="caption">{r.processedAt.toLocaleDateString()}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {r.processedBy || ''}
                        </Typography>
                        {r.note ? (
                          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            {r.note}
                          </Typography>
                        ) : null}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {r.userDocExists && (
                        <Button
                          size="small"
                          variant="text"
                          endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                          onClick={() => navigate(`/users/${r.uid}`)}
                        >
                          Open profile
                        </Button>
                      )}
                      {r.status === 'pending' && (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              setActionNote('');
                              setActionRow({ uid: r.uid, nextStatus: 'completed' });
                            }}
                          >
                            Mark completed
                          </Button>
                          <Button
                            size="small"
                            variant="text"
                            color="inherit"
                            onClick={() => {
                              setActionNote('');
                              setActionRow({ uid: r.uid, nextStatus: 'dismissed' });
                            }}
                          >
                            Dismiss
                          </Button>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(actionRow)} onClose={() => setActionRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {actionRow?.nextStatus === 'completed' ? 'Mark request completed' : 'Dismiss request'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {actionRow?.nextStatus === 'completed'
              ? 'Confirm the account was deleted or deactivated per the retention rules. Add a note for the audit trail (e.g. "hard-deleted, no pay history" or "deactivated — Everee records retained").'
              : 'Dismiss without deleting (e.g. worker withdrew the request). Add a short note.'}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Note (optional)"
            value={actionNote}
            onChange={(e) => setActionNote(e.target.value)}
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setActionRow(null)}>Cancel</Button>
          <Button variant="contained" disabled={actionSaving} onClick={() => void saveAction()}>
            {actionSaving ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DeletionRequestsPage;
