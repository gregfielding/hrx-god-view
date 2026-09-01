/**
 * One editable targeting card per messaging-sequence doc
 * (`tenants/{t}/messagingSequences/{sequenceId}`). Extracted from
 * MessagingSequencesPage 2026-08-29 when the backend went multi-sequence:
 * every doc in the collection governs dispatch, so every doc must be
 * visible and editable here — an invisible sequence is live SMS config
 * nobody can see.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { collection, doc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
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

export type CopyOverrides = Record<string, { en?: string; es?: string }>;

/** SMS-bearing steps a recruiter can reword, per track. Blank = built-in
 *  copy, so editing can never silence a step. */
const EDITABLE_STEPS: Array<{ id: string; label: string; cortOnly?: boolean }> = [
  { id: 'assignment_reminder_24h', label: 'Confirmation ask (24h before)' },
  { id: 'assignment_reminder_23h_escalate', label: 'First nudge (23h, only while silent)' },
  { id: 'assignment_reminder_22h_final', label: 'Last call (22h, only while silent)' },
  { id: 'assignment_reconfirm_4h', label: 'Re-confirm (afternoon of the shift)' },
  { id: 'assignment_confirm_now', label: 'Late-fill ask (assigned inside 24h)' },
  { id: 'assignment_reminder_2h_instructions', label: 'Worksite details (2h before)' },
  { id: 'assignment_reminder_15m_clockin', label: 'Clock-in link (15 min before)', cortOnly: true },
  { id: 'assignment_checkin_0h', label: 'Check-in ask (at start)' },
];

const TOKENS_HINT =
  'Tokens: {brand} {jobTitle} {startLabel} {locationName} {address} {clockInUrl} {companyName}';

export interface AccountOption {
  id: string;
  name: string;
}

interface Props {
  tenantId: string;
  sequenceId: string;
  initialTrack: SequenceTrack;
  initialTargeting: SequenceTargeting;
  initialCopyOverrides: CopyOverrides;
  accounts: AccountOption[];
  accountsLoading: boolean;
  onSaved: (msg: string, ok: boolean) => void;
}

const SequenceTargetingCard: React.FC<Props> = ({
  tenantId,
  sequenceId,
  initialTrack,
  initialTargeting,
  initialCopyOverrides,
  accounts,
  accountsLoading,
  onSaved,
}) => {
  const [targeting, setTargeting] = useState<SequenceTargeting>(initialTargeting);
  const [track, setTrack] = useState<SequenceTrack>(initialTrack);
  const [copyOverrides, setCopyOverrides] = useState<CopyOverrides>(initialCopyOverrides);
  const [saved, setSaved] = useState<{
    targeting: SequenceTargeting;
    track: SequenceTrack;
    copyOverrides: CopyOverrides;
  }>({
    targeting: initialTargeting,
    track: initialTrack,
    copyOverrides: initialCopyOverrides,
  });
  const [saving, setSaving] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [venueOptions, setVenueOptions] = useState<AccountOption[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);

  // Venue options come from the account's own assignments — locationId +
  // worksiteName are exactly the values the dispatch filter matches, so the
  // picker can never offer a venue the targeting can't hit.
  const accountIdsKey = targeting.accountIds.join(',');
  useEffect(() => {
    if (!tenantId || targeting.accountIds.length === 0) {
      setVenueOptions([]);
      return;
    }
    let cancelled = false;
    setVenuesLoading(true);
    (async () => {
      try {
        const seen = new Map<string, string>();
        for (const accountId of targeting.accountIds.slice(0, 3)) {
          const snap = await getDocs(
            query(
              collection(db, 'tenants', tenantId, 'assignments'),
              where('accountId', '==', accountId),
              limit(300),
            ),
          );
          snap.forEach((d) => {
            const a = d.data() as Record<string, unknown>;
            const locId = String(a.locationId ?? '').trim();
            if (!locId) return;
            const name = String(a.worksiteName ?? a.worksiteDisplayName ?? '').trim();
            if (!seen.has(locId) || (name && !seen.get(locId))) seen.set(locId, name);
          });
        }
        if (cancelled) return;
        setVenueOptions(
          Array.from(seen.entries())
            .map(([id, name]) => ({ id, name: name || id }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) setVenueOptions([]);
      } finally {
        if (!cancelled) setVenuesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, accountIdsKey]);

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
    JSON.stringify(targeting) !== JSON.stringify(saved.targeting) ||
    track !== saved.track ||
    JSON.stringify(copyOverrides) !== JSON.stringify(saved.copyOverrides);

  async function handleSave() {
    if (!tenantId || saving) return;
    setSaving(true);
    try {
      // Prune blank overrides so the doc only carries real rewordings.
      const pruned: CopyOverrides = {};
      for (const [stepId, langs] of Object.entries(copyOverrides)) {
        const en = String(langs?.en ?? '').trim();
        const es = String(langs?.es ?? '').trim();
        if (en || es) pruned[stepId] = { ...(en ? { en } : {}), ...(es ? { es } : {}) };
      }
      const ref = doc(db, sequenceTargetingDocPath(tenantId, sequenceId));
      // mergeFields (not merge:true): copyOverrides must be REPLACED wholesale
      // — a deep merge would resurrect overrides the recruiter just cleared.
      await setDoc(
        ref,
        {
          sequenceId,
          track,
          targeting,
          copyOverrides: pruned,
          updatedAt: new Date(),
        },
        { mergeFields: ['sequenceId', 'track', 'targeting', 'copyOverrides', 'updatedAt'] },
      );
      setSaved({ targeting, track, copyOverrides: pruned });
      setCopyOverrides(pruned);
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

          {/* Venue filter — options derived from the account's own assignments */}
          <Autocomplete
            multiple
            options={venueOptions}
            loading={venuesLoading}
            value={(targeting.locationIds ?? []).map(
              (id) => venueOptions.find((v) => v.id === id) ?? { id, name: id },
            )}
            onChange={(_, newValue) => {
              setTargeting((prev) => ({
                ...prev,
                locationIds: newValue.map((v) => v.id),
              }));
            }}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterSelectedOptions
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip variant="outlined" size="small" label={option.name} {...getTagProps({ index })} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Venues (optional)"
                placeholder={
                  targeting.accountIds.length === 0
                    ? 'Pick accounts first…'
                    : venueOptions.length > 0
                      ? 'All venues — or pick specific ones…'
                      : 'No venues found on recent assignments'
                }
                helperText="Limits the sequence to specific venues inside the accounts above (e.g. Oakland Arena inside Legends National). Empty = the whole account."
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {venuesLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
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

          {/* Message wording — per-step SMS overrides, no deploy needed */}
          <Divider />
          <Button
            onClick={() => setMessagesOpen((v) => !v)}
            startIcon={messagesOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ alignSelf: 'flex-start' }}
          >
            {messagesOpen ? 'Hide message wording' : 'Edit message wording'}
          </Button>
          <Collapse in={messagesOpen}>
            <Stack spacing={2} sx={{ pb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Leave a box empty to use the built-in wording (shown as the placeholder). An
                English-only rewording is also used for Spanish-preference workers until a Spanish
                version is added. {TOKENS_HINT}
              </Typography>
              {EDITABLE_STEPS.filter((s) => !s.cortOnly || track === 'cort_gig').map((step) => (
                <Box key={step.id}>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
                    {step.label}
                  </Typography>
                  <Stack spacing={1}>
                    <TextField
                      size="small"
                      multiline
                      minRows={1}
                      label="English"
                      placeholder="Built-in wording"
                      value={copyOverrides[step.id]?.en ?? ''}
                      onChange={(e) =>
                        setCopyOverrides((prev) => ({
                          ...prev,
                          [step.id]: { ...prev[step.id], en: e.target.value },
                        }))
                      }
                    />
                    <TextField
                      size="small"
                      multiline
                      minRows={1}
                      label="Spanish"
                      placeholder="Built-in wording"
                      value={copyOverrides[step.id]?.es ?? ''}
                      onChange={(e) =>
                        setCopyOverrides((prev) => ({
                          ...prev,
                          [step.id]: { ...prev[step.id], es: e.target.value },
                        }))
                      }
                    />
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Collapse>

          {/* Save / Reset */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="contained"
              disabled={!isDirty || saving || !tenantId}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save sequence'}
            </Button>
            <Button
              variant="text"
              disabled={!isDirty || saving}
              onClick={() => {
                setTargeting(saved.targeting);
                setTrack(saved.track);
                setCopyOverrides(saved.copyOverrides);
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
