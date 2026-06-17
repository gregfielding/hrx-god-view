/**
 * ImportRowWorkerPicker — re-pick the HRX worker for a CSV-import row, from
 * the Timesheet Grid's worker-edit pencil.
 *
 * The auto-match can bind a row to the wrong same-name person (two "Marquis
 * Dennis", only one onboarded to Everee). This dialog lets the recruiter search
 * HRX by name / email / phone, pick the right worker, and re-point the entry
 * via the `reassignImportEntryWorker` callable — which moves the synthetic doc,
 * recomputes Everee linkage + block reason, and carries pay/WC/worksite over.
 *
 * Mirrors the search UX of the Import tab's worker-lookup pencil.
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

interface WorkerHit {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  inTenant: boolean;
}

export interface ReassignResult {
  ok: boolean;
  oldEntryId: string;
  newEntryId: string;
  matchStatus: string;
  evereeLinked: boolean;
  blockReason: string | null;
  displayName: string;
}

export interface ImportRowWorkerPickerProps {
  open: boolean;
  onClose: () => void;
  /** Fires after a successful reassign — the parent should reload the grid
   *  (the entry's doc id changes, so a single-entry refresh won't find it). */
  onReassigned: (result: ReassignResult) => void;
  tenantId: string;
  hiringEntityId: string;
  entryId: string;
  /** What the CSV called this person + the currently-bound HRX name, for the
   *  dialog header so the recruiter knows which row they're fixing. */
  csvWorkerName?: string | null;
  currentWorkerName?: string | null;
}

const ImportRowWorkerPicker: React.FC<ImportRowWorkerPickerProps> = ({
  open,
  onClose,
  onReassigned,
  tenantId,
  hiringEntityId,
  entryId,
  csvWorkerName,
  currentWorkerName,
}) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<WorkerHit[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const reset = () => {
    setQuery('');
    setHits([]);
    setPick(null);
    setError(null);
    setSearched(false);
  };

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { tenantId: string; query: string },
        { candidates: WorkerHit[] }
      >(functions, 'searchTimesheetWorkers', { timeout: 30000 });
      const res = await fn({ tenantId, query: q });
      setHits(res.data?.candidates ?? []);
      setSearched(true);
    } catch (err: any) {
      console.error('searchTimesheetWorkers failed:', err);
      setError(err?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const confirm = async () => {
    if (!pick) return;
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { tenantId: string; hiringEntityId: string; entryId: string; newUserId: string },
        ReassignResult
      >(functions, 'reassignImportEntryWorker', { timeout: 60000 });
      const res = await fn({ tenantId, hiringEntityId, entryId, newUserId: pick });
      onReassigned(res.data);
      reset();
      onClose();
    } catch (err: any) {
      console.error('reassignImportEntryWorker failed:', err);
      setError(err?.message || 'Failed to reassign the worker.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) {
          reset();
          onClose();
        }
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Reassign worker</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Typography variant="body2">
              CSV name: <strong>{csvWorkerName || '(unknown)'}</strong>
            </Typography>
            {currentWorkerName && (
              <Typography variant="caption" color="text.secondary">
                Currently linked to: {currentWorkerName}
              </Typography>
            )}
          </Box>

          <TextField
            size="small"
            fullWidth
            autoFocus
            label="Search HRX by name, email, or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            disabled={saving}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={runSearch}
                    disabled={searching || query.trim().length < 2}
                  >
                    {searching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          {hits.length > 0 ? (
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 260, overflow: 'auto' }}>
              <List dense disablePadding>
                {hits.map((h) => (
                  <ListItemButton
                    key={h.userId}
                    selected={pick === h.userId}
                    onClick={() => setPick(h.userId)}
                    dense
                  >
                    <Radio
                      edge="start"
                      size="small"
                      checked={pick === h.userId}
                      tabIndex={-1}
                      disableRipple
                    />
                    <ListItemText
                      primary={`${h.displayName || '(no name)'}${h.inTenant ? '' : ' · other tenant'}`}
                      secondary={[h.email, h.phone].filter(Boolean).join(' · ') || '—'}
                      primaryTypographyProps={{ variant: 'body2' }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {searched ? 'No matches — try a different spelling.' : 'Search above to find the right HRX worker.'}
            </Typography>
          )}

          {error && (
            <Typography variant="caption" color="error.main">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            reset();
            onClose();
          }}
          disabled={saving}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={confirm}
          disabled={!pick || saving}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Reassigning…' : 'Reassign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImportRowWorkerPicker;
