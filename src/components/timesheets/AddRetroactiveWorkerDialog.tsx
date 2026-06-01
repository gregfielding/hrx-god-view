/**
 * AddRetroactiveWorkerDialog — admin-only modal for adding a worker to a
 * job order AFTER the work happened, so the recruiter can enter their
 * timesheet retroactively.
 *
 * Flow:
 *   1. Type to search the tenant's workers (debounced, hits
 *      `searchRecruiterTableUsers`). Options render with the worker's
 *      name + city/state + phone so the recruiter can disambiguate
 *      common-name workers (the Robert Smiths, the DeAndres).
 *   2. Pick a shift from the JO's available shifts.
 *   3. Submit → `addRetroactiveWorker` callable writes one assignment
 *      per day in the shift's date range with `retroactive: true`.
 *      Notification triggers short-circuit on that flag.
 *   4. On success, `onSuccess()` fires so the page can refresh the grid.
 *
 * The shift dictates pay rate + job title + bill rate (read on the
 * server from the shift doc, not passed from the client).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import {
  collection,
  documentId,
  getDocs,
  query as fdbQuery,
  where,
} from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { callSearchRecruiterTableUsers } from '../../services/searchRecruiterTableUsersCallable';
import { callAddRetroactiveWorker } from '../../services/addRetroactiveWorkerCallable';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface AddRetroactiveWorkerDialogShiftOption {
  id: string;
  /** Display label — pre-composed by the parent (e.g. "2026-05-25 · 09:00–17:00"). */
  label: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  city: string;
  state: string;
  phone: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: { assignmentsCreated: number; dates: string[] }) => void;
  tenantId: string;
  jobOrderId: string;
  /** Shifts already loaded by the page; we don't re-fetch. */
  shifts: AddRetroactiveWorkerDialogShiftOption[];
  /** Pre-selected shift id from the page's Shift filter, if any. */
  defaultShiftId?: string | null;
}

/** Format a user option for the Autocomplete dropdown row. */
function formatUserSubtitle(u: UserOption): string {
  const loc = [u.city, u.state].filter(Boolean).join(', ');
  return [loc, u.phone].filter(Boolean).join(' · ');
}

const AddRetroactiveWorkerDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  tenantId,
  jobOrderId,
  shifts,
  defaultShiftId,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [shiftId, setShiftId] = useState<string>('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog opens; pre-fill shiftId when the
  // page already has one selected.
  useEffect(() => {
    if (!open) return;
    setSearchInput('');
    setUserOptions([]);
    setSelectedUser(null);
    setShiftId(defaultShiftId && defaultShiftId !== 'all' ? defaultShiftId : '');
    setError(null);
  }, [open, defaultShiftId]);

  // Debounced user search. We use the existing `searchRecruiterTableUsers`
  // server-side full-collection search (it returns userIds), then hydrate
  // the first ~20 ids to a UserOption with city/state/phone for the
  // dropdown.
  useEffect(() => {
    if (!open) return;
    const q = searchInput.trim();
    if (q.length < 2) {
      setUserOptions([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await callSearchRecruiterTableUsers(functions, {
          tenantId,
          searchQuery: q,
        });
        if (cancelled) return;
        const ids = data.userIds.slice(0, 20);
        if (ids.length === 0) {
          setUserOptions([]);
          return;
        }
        // Hydrate via Firestore `in` query (max 30 ids per batch).
        const snap = await getDocs(
          fdbQuery(collection(db, 'users'), where(documentId(), 'in', ids)),
        );
        const byId = new Map<string, UserOption>();
        snap.docs.forEach((d) => {
          const u = d.data() as Record<string, unknown>;
          const addr = (u.addressInfo as Record<string, unknown> | undefined) ?? {};
          byId.set(d.id, {
            id: d.id,
            firstName: String(u.firstName ?? ''),
            lastName: String(u.lastName ?? ''),
            city: String(addr.city ?? u.city ?? ''),
            state: String(addr.state ?? u.state ?? ''),
            phone: String(u.phone ?? u.phoneE164 ?? u.phoneNumber ?? ''),
          });
        });
        // Preserve the server's relevance order.
        const ordered = ids
          .map((id) => byId.get(id))
          .filter((u): u is UserOption => !!u);
        if (!cancelled) setUserOptions(ordered);
      } catch (e: unknown) {
        if (!cancelled) {
          console.warn('AddRetroactiveWorkerDialog: search failed', e);
          setUserOptions([]);
          setError(formatFirebaseHttpsError(e));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, searchInput, tenantId]);

  const canSubmit = useMemo(
    () => !!selectedUser && !!shiftId && !submitting,
    [selectedUser, shiftId, submitting],
  );

  const handleSubmit = async (): Promise<void> => {
    if (!selectedUser || !shiftId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await callAddRetroactiveWorker(functions, {
        tenantId,
        jobOrderId,
        shiftId,
        userId: selectedUser.id,
      });
      onSuccess({ assignmentsCreated: data.assignmentsCreated, dates: data.dates });
      onClose();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Add worker to timesheet</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Records a worker on this job order after the fact so you can
            enter their timesheet. No SMS or notifications are sent to the
            worker — this is for back-filling a shift they already worked.
          </Typography>

          <Autocomplete<UserOption, false, false, false>
            value={selectedUser}
            onChange={(_, v) => setSelectedUser(v)}
            inputValue={searchInput}
            onInputChange={(_, v) => setSearchInput(v)}
            options={userOptions}
            getOptionLabel={(o) =>
              `${o.firstName} ${o.lastName}`.trim() || o.id
            }
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={searching}
            filterOptions={(x) => x} // server-side, no client filter
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <ListItemText
                  primary={`${option.firstName} ${option.lastName}`.trim() || option.id}
                  secondary={formatUserSubtitle(option)}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search worker"
                placeholder="Type at least 2 characters"
                autoFocus
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searching ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            noOptionsText={
              searchInput.trim().length < 2
                ? 'Type at least 2 characters'
                : searching
                  ? 'Searching…'
                  : 'No workers found'
            }
          />

          <FormControl size="small" fullWidth>
            <InputLabel>Shift</InputLabel>
            <Select
              value={shiftId}
              label="Shift"
              onChange={(e) => setShiftId(String(e.target.value))}
              disabled={shifts.length === 0}
            >
              {shifts.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
            {shifts.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5 }}>
                No shifts loaded for this job order.
              </Typography>
            )}
          </FormControl>

          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit}
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : null
          }
        >
          {submitting ? 'Adding…' : 'Add worker'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddRetroactiveWorkerDialog;
