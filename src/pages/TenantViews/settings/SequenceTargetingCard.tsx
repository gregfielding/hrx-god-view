/**
 * One editable targeting card per messaging-sequence doc
 * (`tenants/{t}/messagingSequences/{sequenceId}`). Extracted from
 * MessagingSequencesPage 2026-08-29 when the backend went multi-sequence:
 * every doc in the collection governs dispatch, so every doc must be
 * visible and editable here — an invisible sequence is live SMS config
 * nobody can see.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import TargetOutlinedIcon from '@mui/icons-material/CenterFocusStrong';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  OCCURRENCE_LABELS,
  SEQUENCE_TRACK_LABELS,
  WORKER_TYPE_LABELS,
  sequenceTargetingDocPath,
  type SequenceOccurrence,
  type SequenceTargeting,
  type SequenceTrack,
  type SequenceWorkerType,
} from '../../../config/messagingSequences/cortCadence';

const WORKER_TYPE_OPTIONS: SequenceWorkerType[] = ['gig', 'career'];
const OCCURRENCE_OPTIONS: SequenceOccurrence[] = ['first_shift', 'every_shift'];
const TRACK_OPTIONS: SequenceTrack[] = ['gig_standard', 'cort_gig'];

export interface AccountOption {
  id: string;
  name: string;
}

interface Props {
  tenantId: string;
  sequenceId: string;
  initialTrack: SequenceTrack;
  initialTargeting: SequenceTargeting;
  accounts: AccountOption[];
  accountsLoading: boolean;
  onSaved: (msg: string, ok: boolean) => void;
}

const SequenceTargetingCard: React.FC<Props> = ({
  tenantId,
  sequenceId,
  initialTrack,
  initialTargeting,
  accounts,
  accountsLoading,
  onSaved,
}) => {
  const [targeting, setTargeting] = useState<SequenceTargeting>(initialTargeting);
  const [track, setTrack] = useState<SequenceTrack>(initialTrack);
  const [saved, setSaved] = useState<{ targeting: SequenceTargeting; track: SequenceTrack }>({
    targeting: initialTargeting,
    track: initialTrack,
  });
  const [saving, setSaving] = useState(false);

  const accountsById = useMemo(() => {
    const map = new Map<string, AccountOption>();
    for (const a of accounts) map.set(a.id, a);
    return map;
  }, [accounts]);

  const selectedAccountOptions: AccountOption[] = useMemo(
    () =>
      targeting.accountIds.map(
        (id) => accountsById.get(id) ?? { id, name: `(unknown account: ${id})` },
      ),
    [targeting.accountIds, accountsById],
  );

  const isDirty =
    JSON.stringify(targeting) !== JSON.stringify(saved.targeting) || track !== saved.track;

  async function handleSave() {
    if (!tenantId || saving) return;
    setSaving(true);
    try {
      const ref = doc(db, sequenceTargetingDocPath(tenantId, sequenceId));
      await setDoc(
        ref,
        {
          sequenceId,
          track,
          targeting,
          updatedAt: new Date(),
        },
        { merge: true },
      );
      setSaved({ targeting, track });
      onSaved(`Saved "${targeting.label || sequenceId}".`, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      onSaved(`Save failed: ${msg}`, false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ mb: 3 }}>
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <TargetOutlinedIcon sx={{ fontSize: 20, color: 'primary.main' }} />
          <Typography variant="subtitle1" fontWeight={600}>
            {targeting.label || sequenceId}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={targeting.active ? 'success' : 'default'}
            label={targeting.active ? 'Active' : 'Inactive'}
          />
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 2, lineHeight: 1.5 }}
        >
          Saved to <code>tenants/{'{tenantId}'}/messagingSequences/{sequenceId}</code>.
        </Typography>

        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <TextField
              label="Label"
              size="small"
              value={targeting.label}
              onChange={(e) => setTargeting((prev) => ({ ...prev, label: e.target.value }))}
              helperText="Recruiter-facing name for this rule (e.g. Oakland Arena Gig Confirmations)."
              sx={{ flex: 1, maxWidth: 480 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={targeting.active}
                  onChange={(_, checked) =>
                    setTargeting((prev) => ({ ...prev, active: checked }))
                  }
                />
              }
              label={
                <Stack>
                  <Typography variant="body2" fontWeight={500}>
                    {targeting.active ? 'Active' : 'Inactive'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Master on/off. Skips this sequence when off, even if other fields match.
                  </Typography>
                </Stack>
              }
              sx={{ ml: 0, alignItems: 'flex-start' }}
            />
          </Stack>

          {/* Track */}
          <FormControl size="small" sx={{ maxWidth: 480 }}>
            <InputLabel id={`track-label-${sequenceId}`}>Reminder track</InputLabel>
            <Select
              labelId={`track-label-${sequenceId}`}
              value={track}
              label="Reminder track"
              onChange={(e) => {
                const v = e.target.value as SequenceTrack;
                if (TRACK_OPTIONS.includes(v)) setTrack(v);
              }}
            >
              {TRACK_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>
                  {SEQUENCE_TRACK_LABELS[t]}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Careers are never targeted here — they automatically get the quiet placement track
              (first-day welcome + morning-of note).
            </Typography>
          </FormControl>

          {/* Accounts */}
          <Autocomplete
            multiple
            options={accounts}
            loading={accountsLoading}
            value={selectedAccountOptions}
            onChange={(_, newValue) => {
              setTargeting((prev) => ({
                ...prev,
                accountIds: newValue.map((v) => v.id),
              }));
            }}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterSelectedOptions
            renderInput={(params) => (
              <TextField
                {...params}
                label="Accounts"
                placeholder={
                  accounts.length > 0 ? 'Select one or more accounts…' : 'No active accounts found'
                }
                helperText="Assignments at these accounts will use this sequence. Leave empty to disable it."
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {accountsLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          {/* Location filter (advanced) */}
          <Autocomplete
            multiple
            freeSolo
            options={[] as string[]}
            value={targeting.locationIds ?? []}
            onChange={(_, newValue) => {
              setTargeting((prev) => ({
                ...prev,
                locationIds: (newValue as string[]).map((v) => v.trim()).filter(Boolean),
              }));
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  variant="outlined"
                  size="small"
                  label={option}
                  {...getTagProps({ index })}
                />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Location filter (advanced)"
                placeholder="Paste a location ID and press Enter…"
                helperText="Limits the sequence to specific venues inside the accounts above (assignment locationId). Leave empty for the whole account — e.g. Oakland Arena inside Legends National."
                size="small"
              />
            )}
          />

          {/* Worker type */}
          <FormControl size="small" sx={{ maxWidth: 360 }}>
            <InputLabel id={`worker-type-label-${sequenceId}`}>Worker type</InputLabel>
            <Select
              labelId={`worker-type-label-${sequenceId}`}
              multiple
              value={targeting.workerTypes}
              label="Worker type"
              onChange={(e) => {
                const value =
                  typeof e.target.value === 'string' ? [e.target.value] : e.target.value;
                const clean = (value as string[]).filter((v): v is SequenceWorkerType =>
                  WORKER_TYPE_OPTIONS.includes(v as SequenceWorkerType),
                );
                setTargeting((prev) => ({
                  ...prev,
                  workerTypes: clean.length > 0 ? clean : ['gig'],
                }));
              }}
              renderValue={(selected) =>
                (selected as SequenceWorkerType[]).map((s) => WORKER_TYPE_LABELS[s]).join(', ')
              }
            >
              {WORKER_TYPE_OPTIONS.map((wt) => (
                <MenuItem key={wt} value={wt}>
                  {WORKER_TYPE_LABELS[wt]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Occurrence */}
          <FormControl size="small" sx={{ maxWidth: 420 }}>
            <InputLabel id={`occurrence-label-${sequenceId}`}>Occurrence</InputLabel>
            <Select
              labelId={`occurrence-label-${sequenceId}`}
              value={targeting.occurrence}
              label="Occurrence"
              onChange={(e) => {
                const v = e.target.value as SequenceOccurrence;
                if (OCCURRENCE_OPTIONS.includes(v)) {
                  setTargeting((prev) => ({ ...prev, occurrence: v }));
                }
              }}
            >
              {OCCURRENCE_OPTIONS.map((o) => (
                <MenuItem key={o} value={o}>
                  {OCCURRENCE_LABELS[o]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Save / Reset */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="contained"
              disabled={!isDirty || saving || !tenantId}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save targeting'}
            </Button>
            <Button
              variant="text"
              disabled={!isDirty || saving}
              onClick={() => {
                setTargeting(saved.targeting);
                setTrack(saved.track);
              }}
            >
              Discard changes
            </Button>
          </Stack>

          {sequenceId === 'cort_gig' && (
            <Alert severity="info" variant="outlined">
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', lineHeight: 1.5 }}
              >
                The CORT track adds the T-15m clock-in step (QR link) on top of the standard gig
                cadence. &ldquo;First shift at account&rdquo; stops the extended cadence once the
                worker has a completed assignment at the account.
              </Typography>
            </Alert>
          )}
        </Stack>
      </Box>
    </Paper>
  );
};

export default SequenceTargetingCard;
