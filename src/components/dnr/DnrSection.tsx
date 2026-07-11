/**
 * DNR (Do Not Return) — header section for the recruiter User Details view.
 *
 * Renders red `DNR — <Account>` chips from the worker's user doc (live
 * subscription) plus an "Add DNR" action. Adding opens a dialog with an
 * account autocomplete (child + national/standalone CRM accounts), a notes
 * field, and a warning listing the worker's upcoming assignments at that
 * account (nothing is auto-cancelled — the recruiter acts deliberately).
 * All writes go through the `setWorkerDnr` callable (recruiter-gated,
 * audit-stamped); the client never writes `dnr`/`dnrAccountIds` directly.
 *
 * Enforcement wired elsewhere: placement creation rejects, auto-messaging
 * filters recipients, the signed-in jobs board hides the account's postings,
 * and the apply flow blocks with a generic message.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../firebase';

interface DnrEntry {
  accountId: string;
  accountName: string;
  accountType?: string | null;
  parentAccountId?: string | null;
  notes?: string;
  status: 'active' | 'removed';
  addedByName?: string | null;
  addedAt?: string;
}

interface AccountOption {
  id: string;
  name: string;
  accountType?: string;
  parentAccountId?: string | null;
  parentAccountName?: string;
}

const setWorkerDnrCallable = () => httpsCallable(getFunctions(), 'setWorkerDnr');

const DnrSection: React.FC<{ tenantId: string; userId: string }> = ({ tenantId, userId }) => {
  const [entries, setEntries] = useState<DnrEntry[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DnrEntry | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [selected, setSelected] = useState<AccountOption | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', userId), (snap) => {
      const dnr = (snap.data()?.dnr ?? []) as DnrEntry[];
      setEntries(dnr.filter((e) => e?.status === 'active'));
    });
    return unsub;
  }, [userId]);

  // Accounts load once per dialog open (child + national + standalone).
  useEffect(() => {
    if (!dialogOpen || accounts !== null) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, 'accounts'));
        const raw = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        const nameById = new Map(raw.map((a) => [a.id, String((a as any).name || '')]));
        const opts: AccountOption[] = raw
          .filter((a) => (a as any).active !== false && String((a as any).name || '').trim())
          .map((a) => ({
            id: a.id,
            name: String((a as any).name),
            accountType: String((a as any).accountType || '') || undefined,
            parentAccountId: ((a as any).parentAccountId as string) || null,
            parentAccountName: (a as any).parentAccountId
              ? nameById.get((a as any).parentAccountId as string)
              : undefined,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAccounts(opts);
      } catch {
        setAccounts([]);
        setError('Could not load accounts.');
      }
    })();
  }, [dialogOpen, accounts, tenantId]);

  // Upcoming-work warning for the selected account: worker's live
  // assignments whose JO belongs to the account (or its national parent).
  useEffect(() => {
    setUpcoming([]);
    if (!selected) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'assignments'), where('userId', '==', userId)),
        );
        const live = snap.docs
          .map((d) => d.data() as Record<string, unknown>)
          .filter((a) => !['canceled', 'cancelled', 'completed', 'ended'].includes(String(a.status || '').toLowerCase()));
        const names: string[] = [];
        const joCache = new Map<string, Record<string, unknown> | null>();
        for (const a of live.slice(0, 25)) {
          const joId = String(a.jobOrderId || '');
          if (!joId) continue;
          let jo = joCache.get(joId);
          if (jo === undefined) {
            const joSnap = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', joId));
            jo = joSnap.exists() ? (joSnap.data() as Record<string, unknown>) : null;
            joCache.set(joId, jo);
          }
          const ids = [jo?.accountId, (jo as any)?.recruiterAccountId, jo?.companyId, jo?.parentAccountId]
            .map((v) => String(v || ''))
            .filter(Boolean);
          if (ids.includes(selected.id)) {
            names.push(String(jo?.jobOrderName || jo?.jobTitle || joId));
          }
        }
        setUpcoming([...new Set(names)]);
      } catch {
        /* warning is best-effort */
      }
    })();
  }, [selected, tenantId, userId]);

  const closeDialog = () => {
    setDialogOpen(false);
    setSelected(null);
    setNotes('');
    setError(null);
    setUpcoming([]);
  };

  const submit = async (action: 'add' | 'remove', entry?: DnrEntry) => {
    const target = action === 'add' ? selected : entry;
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      await setWorkerDnrCallable()({
        tenantId,
        userId,
        action,
        accountId: action === 'add' ? (target as AccountOption).id : (target as DnrEntry).accountId,
        accountName: (target as AccountOption | DnrEntry & { name?: string }) && action === 'add'
          ? (target as AccountOption).name
          : (target as DnrEntry).accountName,
        ...(action === 'add'
          ? {
              accountType: (target as AccountOption).accountType ?? null,
              parentAccountId: (target as AccountOption).parentAccountId ?? null,
              parentAccountName: (target as AccountOption).parentAccountName ?? null,
            }
          : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (action === 'add') closeDialog();
      else setRemoveTarget(null);
      setNotes('');
    } catch (e: any) {
      setError(String(e?.message || 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  };

  const optionLabel = useMemo(
    () => (o: AccountOption) =>
      o.parentAccountName ? `${o.name} (${o.parentAccountName})` : o.name,
    [],
  );

  return (
    <Box sx={{ mt: 0.25 }}>
      <Stack direction="row" flexWrap="wrap" gap={0.5} alignItems="center">
        {entries.map((e) => (
          <Chip
            key={e.accountId}
            size="small"
            icon={<BlockIcon sx={{ fontSize: 14 }} />}
            label={`DNR — ${e.accountName}`}
            color="error"
            title={[e.notes, e.addedByName ? `Added by ${e.addedByName}` : null]
              .filter(Boolean)
              .join(' · ')}
            onDelete={() => {
              setNotes('');
              setRemoveTarget(e);
            }}
            sx={{ height: 24, '& .MuiChip-label': { px: 0.75, fontSize: '0.74rem' } }}
          />
        ))}
        {/* Text-height action: kill the small-Button min-height/padding so the
            row sits flush in the header column (Greg 2026-07-11). */}
        <Button
          size="small"
          onClick={() => setDialogOpen(true)}
          sx={{
            minWidth: 0,
            minHeight: 0,
            px: 0.75,
            py: 0,
            lineHeight: 1.5,
            fontSize: '0.72rem',
            color: 'text.secondary',
          }}
        >
          + DNR
        </Button>
      </Stack>

      {/* Add dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Add DNR (Do Not Return)</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The worker will stop seeing this account's job postings, can't be assigned its
            shifts, and won't receive messages promoting its jobs. Choosing a national
            account covers all of its child accounts.
          </Typography>
          <Autocomplete
            options={accounts ?? []}
            loading={accounts === null}
            value={selected}
            onChange={(_, v) => setSelected(v)}
            getOptionLabel={optionLabel}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Account or child account"
                placeholder="Search accounts…"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {accounts === null ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
          {upcoming.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This worker has upcoming work at this account: {upcoming.join(', ')}. Adding the
              DNR does NOT cancel it — cancel those placements separately if needed.
            </Alert>
          )}
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Notes (reason)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            sx={{ mt: 2 }}
          />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!selected || saving}
            onClick={() => submit('add')}
          >
            {saving ? 'Saving…' : 'Add DNR'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remove confirm */}
      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove DNR — {removeTarget?.accountName}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The worker becomes eligible for this account again. The original entry stays in
            the audit history.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={saving}
            onClick={() => removeTarget && submit('remove', removeTarget)}
          >
            {saving ? 'Removing…' : 'Remove DNR'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DnrSection;
