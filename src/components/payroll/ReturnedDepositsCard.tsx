/**
 * Returned deposits — "worker still owed $X" (2026-09-11).
 *
 * After ~30–45 days of bounced deposits Everee sends the money back to C1's
 * funding account. The payroll payment-issue sweep records those in
 * `tenants/{t}/payroll_payment_issues` as `funds_returned`, or
 * `deposit_unconfirmed` when it can't prove where the money went. This card
 * is where ops sees the debt and repays it via off-cycle (the dialog links the
 * payment back to the issue, and the server marks it repaid). Hidden when
 * nothing is owed.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
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
import { getAuth } from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { db } from '../../firebase';

export interface ReturnedDepositIssue {
  id: string;
  status: 'funds_returned' | 'deposit_unconfirmed';
  /** HRX uid, or null when Everee's externalWorkerId isn't one (legacy
   *  profiles sometimes carry the worker's name). */
  uid: string | null;
  workerName: string;
  entityId: string;
  paymentId: string;
  payDate: string;
  owed: number;
  returnedAtMs: number | null;
  linkedEntryIds: string[];
  linkedWorkDates: string[];
  entryLinkStatus: string | null;
  unconfirmedReason: string | null;
  possibleRepayment: { offcycleId: string; total: number } | null;
}

const usd = (n: number): string => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const UNCONFIRMED_COPY: Record<string, string> = {
  no_funding_account_configured:
    "HRX doesn't know this company's funding account, so it can't tell a re-sent deposit from a returned one.",
  no_worker_deposit: 'Everee says it was deposited, but shows no deposit to the worker’s bank.',
  no_deposit_records: 'Everee says it was deposited, but shows no deposit to the worker’s bank.',
  deposit_in_flight: 'Everee’s retry has been processing for more than 10 days.',
  payment_not_found: 'This payment no longer exists in Everee.',
};

const looksLikeUid = (v: string): boolean => /^[A-Za-z0-9]{20,40}$/.test(v);

function toIssue(id: string, x: Record<string, any>): ReturnedDepositIssue {
  const uid = String(x.uid ?? '').trim();
  const possible = x.possibleRepayment;
  return {
    id,
    status: x.status,
    uid: looksLikeUid(uid) ? uid : null,
    workerName: String(x.workerName ?? '').trim() || '(no name on file)',
    entityId: String(x.entityId ?? ''),
    paymentId: String(x.paymentId ?? ''),
    payDate: String(x.payDate ?? ''),
    owed: Number(x.fundsReturnedAmount ?? x.grossAmount ?? 0) || 0,
    returnedAtMs: x.fundsReturnedAt?.toMillis?.() ?? null,
    linkedEntryIds: Array.isArray(x.linkedEntryIds) ? x.linkedEntryIds : [],
    linkedWorkDates: Array.isArray(x.linkedWorkDates) ? x.linkedWorkDates : [],
    entryLinkStatus: x.entryLinkStatus ?? null,
    unconfirmedReason: x.unconfirmedReason ?? null,
    possibleRepayment:
      possible && typeof possible === 'object'
        ? { offcycleId: String(possible.offcycleId ?? ''), total: Number(possible.total ?? 0) }
        : null,
  };
}

interface Props {
  tenantId: string;
  /** '' = all entities. */
  entityId: string;
  entityNames: Record<string, string>;
  /** Bump to reload (e.g. after an off-cycle repay). */
  refreshKey: number;
  onRepay: (issue: ReturnedDepositIssue) => void;
}

const ReturnedDepositsCard: React.FC<Props> = ({ tenantId, entityId, entityNames, refreshKey, onRepay }) => {
  const [issues, setIssues] = useState<ReturnedDepositIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ issue: ReturnedDepositIssue; kind: 'already_repaid' | 'worker_paid' } | null>(null);
  const [closeNote, setCloseNote] = useState('');
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'tenants', tenantId, 'payroll_payment_issues'),
        where('status', 'in', ['funds_returned', 'deposit_unconfirmed']),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        setError(null);
        setIssues(
          snap.docs
            // funds_returned stays listed until someone says the worker isn't owed.
            .filter((d) => d.data().stillOwed !== false)
            .map((d) => toIssue(d.id, d.data()))
            .sort(
              (a, b) =>
                Number(a.status !== 'funds_returned') - Number(b.status !== 'funds_returned') ||
                (b.returnedAtMs ?? 0) - (a.returnedAtMs ?? 0) ||
                b.payDate.localeCompare(a.payDate),
            ),
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, refreshKey, localRefresh]);

  const visible = useMemo(
    () => (entityId ? issues.filter((i) => i.entityId === entityId) : issues),
    [issues, entityId],
  );
  const totalOwed = visible.reduce((sum, i) => sum + i.owed, 0);

  const closeIssue = useCallback(async () => {
    if (!closing) return;
    setCloseSaving(true);
    setCloseError(null);
    const uid = getAuth().currentUser?.uid ?? null;
    const ref = doc(db, 'tenants', tenantId, 'payroll_payment_issues', closing.issue.id);
    try {
      if (closing.kind === 'already_repaid') {
        await updateDoc(ref, {
          status: 'funds_returned_already_repaid',
          stillOwed: false,
          repaidVia: closeNote.trim() || 'Marked already repaid on Payroll Costs',
          repaidAt: serverTimestamp(),
          repaidByUid: uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          status: 'resolved',
          resolvedAt: serverTimestamp(),
          resolvedByUid: uid,
          resolutionNote: closeNote.trim() || 'Confirmed paid in Everee (Payroll Costs)',
          unconfirmedReason: deleteField(),
          unconfirmedAt: deleteField(),
          updatedAt: serverTimestamp(),
        });
      }
      setClosing(null);
      setLocalRefresh((n) => n + 1);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloseSaving(false);
    }
  }, [closing, closeNote, tenantId]);

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        Couldn&apos;t load returned deposits: {error}
      </Alert>
    );
  }
  if (visible.length === 0) return null;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          Returned deposits — workers still owed
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {visible.length === 1 ? '1 worker is' : `${visible.length} workers are`} owed {usd(totalOwed)} from
          deposits that never reached them. Everee sends a bounced deposit back to C1 after about 30–45
          days. Repay each one with an off-cycle payment once the worker has fixed their bank info — never
          resubmit the timesheet.
        </Alert>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell>Entity</TableCell>
                <TableCell>Everee payment</TableCell>
                <TableCell>What happened</TableCell>
                <TableCell align="right">Owed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell>
                    {i.uid ? (
                      <Link component={RouterLink} to={`/users/${i.uid}`}>
                        {i.workerName}
                      </Link>
                    ) : (
                      <>
                        {i.workerName}
                        <Typography variant="caption" color="text.secondary" display="block">
                          Not linked to an HRX profile
                        </Typography>
                      </>
                    )}
                  </TableCell>
                  <TableCell>{entityNames[i.entityId] ?? i.entityId}</TableCell>
                  <TableCell>
                    #{i.paymentId}
                    <Typography variant="caption" color="text.secondary" display="block">
                      Paid {i.payDate || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    <Stack spacing={0.5} alignItems="flex-start">
                      {i.status === 'funds_returned' ? (
                        <Chip
                          size="small"
                          color="error"
                          label={`Returned to C1${
                            i.returnedAtMs ? ` ${new Date(i.returnedAtMs).toLocaleDateString('en-US')}` : ''
                          }`}
                        />
                      ) : (
                        <>
                          <Chip size="small" color="warning" label="Can't confirm the worker was paid" />
                          <Typography variant="caption" color="text.secondary">
                            {UNCONFIRMED_COPY[i.unconfirmedReason ?? ''] ?? 'Check this payment in Everee.'}
                          </Typography>
                        </>
                      )}
                      {i.linkedEntryIds.length > 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          {i.linkedEntryIds.length} timesheet {i.linkedEntryIds.length === 1 ? 'row' : 'rows'} flagged
                          {i.linkedWorkDates.length ? ` (${i.linkedWorkDates.join(', ')})` : ''}
                        </Typography>
                      ) : i.entryLinkStatus === 'no_hrx_entries' ? (
                        <Typography variant="caption" color="text.secondary">
                          No HRX timesheet rows — this was paid directly in Everee.
                        </Typography>
                      ) : (
                        i.status === 'funds_returned' && (
                          <Typography variant="caption" color="warning.main">
                            Timesheet rows not linked — mark them “error” by hand so nobody resubmits.
                          </Typography>
                        )
                      )}
                      {i.possibleRepayment && (
                        <Typography variant="caption" color="warning.main">
                          An off-cycle payment of {usd(i.possibleRepayment.total)} already went to this worker after
                          the pay date — check it wasn&apos;t this money before repaying.
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={700}>{usd(i.owed)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button size="small" variant="contained" onClick={() => onRepay(i)}>
                        Repay via off-cycle
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setCloseNote('');
                          setCloseError(null);
                          setClosing({
                            issue: i,
                            kind: i.status === 'funds_returned' ? 'already_repaid' : 'worker_paid',
                          });
                        }}
                      >
                        {i.status === 'funds_returned' ? 'Already repaid' : 'Worker was paid'}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      <Dialog open={closing !== null} onClose={() => !closeSaving && setClosing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {closing?.kind === 'already_repaid' ? 'Mark as already repaid' : 'Mark worker as paid'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {closing?.kind === 'already_repaid'
              ? `${closing.issue.workerName} will drop off this list and C1 keeps the returned ${usd(closing.issue.owed)}. Say how they were repaid.`
              : `Only do this if Everee shows the ${usd(closing?.issue.owed ?? 0)} reached ${closing?.issue.workerName}'s bank.`}
          </Typography>
          {closeError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {closeError}
            </Alert>
          )}
          <TextField
            label={closing?.kind === 'already_repaid' ? 'How were they repaid?' : 'Note (optional)'}
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClosing(null)} disabled={closeSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void closeIssue()}
            disabled={closeSaving || (closing?.kind === 'already_repaid' && !closeNote.trim())}
          >
            {closeSaving ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

export default ReturnedDepositsCard;
