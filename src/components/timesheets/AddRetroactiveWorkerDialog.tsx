/**
 * AddRetroactiveWorkerDialog — admin-only modal for adding a worker to a
 * job order AFTER the work happened, so the recruiter can enter their
 * timesheet retroactively.
 *
 * Flow:
 *   1. Type to search — filtered against the in-memory tenant worker
 *      directory (cached in IndexedDB; see `useTenantWorkerDirectory`).
 *      Instant; no debounce, no per-keystroke server roundtrip.
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
import { functions } from '../../firebase';
import { callAddRetroactiveWorker } from '../../services/addRetroactiveWorkerCallable';
import type { TenantWorkerDirectoryEntry } from '../../services/listTenantWorkerDirectoryCallable';
import { useTenantWorkerDirectory } from '../../hooks/useTenantWorkerDirectory';
import { userMatchesSearchTerm } from '../../utils/recruiterUserSearchMatch';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface AddRetroactiveWorkerDialogShiftOption {
  id: string;
  /** Display label — pre-composed by the parent (e.g. "2026-05-25 · 09:00–17:00"). */
  label: string;
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

/** Cap the dropdown list so the Autocomplete doesn't render thousands of
 *  nodes on an empty query. 30 covers the common case (user types 2-3
 *  chars and the right worker is in the first page). */
const MAX_OPTIONS = 30;

/** Format a worker's subtitle for the dropdown row. */
function formatSubtitle(w: TenantWorkerDirectoryEntry): string {
  const loc = [w.city, w.state].filter(Boolean).join(', ');
  return [loc, w.phone].filter(Boolean).join(' · ');
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
  const directory = useTenantWorkerDirectory(open ? tenantId : null);
  const [searchInput, setSearchInput] = useState('');
  const [selectedUser, setSelectedUser] = useState<TenantWorkerDirectoryEntry | null>(null);
  const [shiftId, setShiftId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog opens; pre-fill shiftId when the
  // page already has one selected.
  useEffect(() => {
    if (!open) return;
    setSearchInput('');
    setSelectedUser(null);
    setShiftId(defaultShiftId && defaultShiftId !== 'all' ? defaultShiftId : '');
    setError(null);
  }, [open, defaultShiftId]);

  /**
   * Local filter — runs synchronously over the in-memory directory. No
   * debounce, no spinner. Reuses the existing `userMatchesSearchTerm`
   * helper so the matching semantics (name prefix, email substring,
   * digits-only phone, diacritic fold) match what /users/all uses.
   */
  const filteredWorkers = useMemo<TenantWorkerDirectoryEntry[]>(() => {
    const q = searchInput.trim();
    if (q.length < 2) return [];
    const matches: TenantWorkerDirectoryEntry[] = [];
    for (const w of directory.workers) {
      if (
        userMatchesSearchTerm(
          {
            firstName: w.firstName,
            lastName: w.lastName,
            displayName: w.displayName,
            email: w.email,
            phone: w.phone,
            skills: w.skills ?? null,
          },
          q,
        )
      ) {
        matches.push(w);
        if (matches.length >= MAX_OPTIONS) break;
      }
    }
    return matches;
  }, [searchInput, directory.workers]);

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

          <Autocomplete<TenantWorkerDirectoryEntry, false, false, false>
            value={selectedUser}
            onChange={(_, v) => setSelectedUser(v)}
            inputValue={searchInput}
            onInputChange={(_, v) => setSearchInput(v)}
            options={filteredWorkers}
            getOptionLabel={(o) =>
              `${o.firstName} ${o.lastName}`.trim() || o.displayName || o.id
            }
            isOptionEqualToValue={(a, b) => a.id === b.id}
            // Local search — Autocomplete's own filter would be redundant
            // and would re-filter our already-filtered options on every
            // keystroke. Disable it.
            filterOptions={(x) => x}
            loading={directory.loading}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <ListItemText
                  primary={
                    `${option.firstName} ${option.lastName}`.trim() ||
                    option.displayName ||
                    option.id
                  }
                  secondary={formatSubtitle(option)}
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
                helperText={
                  directory.refreshing
                    ? 'Updating worker directory…'
                    : directory.fetchedAt
                      ? `${directory.workers.length} workers indexed`
                      : ''
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {directory.loading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            noOptionsText={
              searchInput.trim().length < 2
                ? 'Type at least 2 characters'
                : directory.loading
                  ? 'Loading worker directory…'
                  : 'No workers match'
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
