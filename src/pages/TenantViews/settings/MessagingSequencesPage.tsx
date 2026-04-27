/**
 * Messaging Sequences — read-only viewer.
 *
 * Today this renders the canonical CORT gig-shift cadence from
 * `src/config/messagingSequences/cortCadence.ts`. That module is the single UI-facing
 * source of truth; the runtime cloud-function code (cadenceMessages, shiftReminderProfile,
 * workerShiftRemindersV2, replyClassifier) must stay in sync with it.
 *
 * Phase 2 will replace the hardcoded import with a Firestore-backed loader that falls
 * back to this config when no tenant override exists.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
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
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ReplyIcon from '@mui/icons-material/Reply';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TargetOutlinedIcon from '@mui/icons-material/CenterFocusStrong';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import {
  CORT_REPLY_TOKENS,
  CORT_SEQUENCE_STEPS,
  CORT_SEQUENCE_SUMMARY,
  DEFAULT_CORT_TARGETING,
  OCCURRENCE_LABELS,
  WORKER_TYPE_LABELS,
  sequenceTargetingDocPath,
  type MessagingSequenceStep,
  type SequenceOccurrence,
  type SequenceTargeting,
  type SequenceWorkerType,
} from '../../../config/messagingSequences/cortCadence';

interface AccountOption {
  id: string;
  name: string;
}

function replyKindChipColor(
  kind: (typeof CORT_REPLY_TOKENS)[number]['kind'],
): 'success' | 'error' | 'info' | 'warning' | 'default' {
  if (kind === 'confirm') return 'success';
  if (kind === 'decline') return 'error';
  if (kind === 'check-in') return 'info';
  if (kind === 'walk-off') return 'warning';
  return 'default';
}

function StepRow({ step }: { step: MessagingSequenceStep }) {
  return (
    <TableRow hover>
      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap', width: 56 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {step.order + 1}
        </Typography>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap', minWidth: 160 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25 }}>
          <ScheduleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="body2" fontWeight={600}>
            {step.offsetLabel}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.disabled" display="block" sx={{ fontFamily: 'ui-monospace, monospace' }}>
          offsetHours: {step.offsetHours}
        </Typography>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 200 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.25 }}>
          <Typography variant="body2" fontWeight={600}>
            {step.title}
          </Typography>
          {step.silent ? (
            <Tooltip title="Worker receives no SMS. Internal dispatcher-only trigger.">
              <VisibilityOffIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            </Tooltip>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.4 }}>
          {step.purpose}
        </Typography>
        <Typography
          variant="caption"
          color="text.disabled"
          display="block"
          sx={{ mt: 0.5, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}
        >
          {step.id}
        </Typography>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 320 }}>
        {step.silent ? (
          <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
            (no SMS sent at this step)
          </Typography>
        ) : (
          <Box
            sx={{
              p: 1.25,
              bgcolor: 'action.hover',
              borderRadius: 1,
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.78rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {step.smsTemplate}
          </Box>
        )}
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
          Built in: <code>{step.sourceFile}</code>
        </Typography>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 200 }}>
        {step.expectedReplies.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
            —
          </Typography>
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
            {step.expectedReplies.map((r) => (
              <Chip key={r} size="small" label={r} variant="outlined" />
            ))}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.4 }}>
          {step.branching}
        </Typography>
      </TableCell>
    </TableRow>
  );
}

const CORT_SEQUENCE_ID = CORT_SEQUENCE_SUMMARY.id; // 'cort_gig'
const WORKER_TYPE_OPTIONS: SequenceWorkerType[] = ['gig', 'career'];
const OCCURRENCE_OPTIONS: SequenceOccurrence[] = ['first_shift', 'every_shift'];

const MessagingSequencesPage: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId || '';

  // ============================================================================
  // Targeting state. `saved` is the last persisted value (used to detect dirty).
  // `targeting` is the current edit state. Save button disables when they match.
  // ============================================================================
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState<boolean>(false);
  const [targeting, setTargeting] = useState<SequenceTargeting>(DEFAULT_CORT_TARGETING);
  const [saved, setSaved] = useState<SequenceTargeting>(DEFAULT_CORT_TARGETING);
  const [targetingLoading, setTargetingLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [snack, setSnack] = useState<{ open: boolean; msg: string; ok: boolean }>({
    open: false,
    msg: '',
    ok: true,
  });

  // Load tenant accounts for the autocomplete. Only active ones — recruiters don't want
  // to target a sequence at an archived client.
  useEffect(() => {
    if (!effectiveTenantId) return;
    let cancelled = false;
    setAccountsLoading(true);
    (async () => {
      try {
        // Match the RecruiterAccounts page's "active" semantic: `data.active !== false` —
        // meaning docs without an explicit `active` field are treated as active. A
        // Firestore `where('active', '==', true)` filter skips those, which is why the
        // autocomplete was showing "No options" even though accounts exist.
        const accountsRef = collection(db, 'tenants', effectiveTenantId, 'accounts');
        const snap = await getDocs(query(accountsRef, orderBy('name')));
        if (cancelled) return;
        setAccounts(
          snap.docs
            .map((d) => {
              const data = d.data() as { name?: string; active?: boolean };
              return {
                id: d.id,
                name: String(data.name || '').trim(),
                active: data.active !== false,
              };
            })
            .filter((a) => a.name !== '' && a.active)
            .map(({ id, name }) => ({ id, name })),
        );
      } catch (err) {
        // Don't surface — accounts autocomplete just stays empty and targeting still works by id.
        if (!cancelled) setAccounts([]);
        // eslint-disable-next-line no-console
        console.warn('MessagingSequencesPage: failed to load accounts', err);
      } finally {
        if (!cancelled) setAccountsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId]);

  // Load existing targeting config for this sequence.
  useEffect(() => {
    if (!effectiveTenantId) return;
    let cancelled = false;
    setTargetingLoading(true);
    (async () => {
      try {
        const ref = doc(db, sequenceTargetingDocPath(effectiveTenantId, CORT_SEQUENCE_ID));
        const snap = await getDoc(ref);
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as { targeting?: Partial<SequenceTargeting> };
          const loaded: SequenceTargeting = {
            label:
              typeof data?.targeting?.label === 'string' && data.targeting.label.trim() !== ''
                ? data.targeting.label.trim()
                : DEFAULT_CORT_TARGETING.label,
            active: data?.targeting?.active === true,
            accountIds: Array.isArray(data?.targeting?.accountIds) ? data.targeting.accountIds : [],
            workerTypes:
              Array.isArray(data?.targeting?.workerTypes) && data.targeting.workerTypes.length > 0
                ? (data.targeting.workerTypes as SequenceWorkerType[])
                : DEFAULT_CORT_TARGETING.workerTypes,
            occurrence:
              data?.targeting?.occurrence === 'every_shift' ? 'every_shift' : 'first_shift',
          };
          setTargeting(loaded);
          setSaved(loaded);
        } else {
          setTargeting(DEFAULT_CORT_TARGETING);
          setSaved(DEFAULT_CORT_TARGETING);
        }
      } catch (err) {
        if (!cancelled) {
          setTargeting(DEFAULT_CORT_TARGETING);
          setSaved(DEFAULT_CORT_TARGETING);
        }
        // eslint-disable-next-line no-console
        console.warn('MessagingSequencesPage: failed to load targeting', err);
      } finally {
        if (!cancelled) setTargetingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId]);

  const accountsById = useMemo(() => {
    const map = new Map<string, AccountOption>();
    for (const a of accounts) map.set(a.id, a);
    return map;
  }, [accounts]);

  const selectedAccountOptions: AccountOption[] = useMemo(
    () =>
      targeting.accountIds.map((id) => accountsById.get(id) ?? { id, name: `(unknown account: ${id})` }),
    [targeting.accountIds, accountsById],
  );

  const isDirty =
    JSON.stringify(targeting) !== JSON.stringify(saved) ||
    targeting.accountIds.length !== saved.accountIds.length;

  async function handleSave() {
    if (!effectiveTenantId || saving) return;
    setSaving(true);
    try {
      const ref = doc(db, sequenceTargetingDocPath(effectiveTenantId, CORT_SEQUENCE_ID));
      await setDoc(
        ref,
        {
          sequenceId: CORT_SEQUENCE_ID,
          targeting,
          updatedAt: new Date(),
        },
        { merge: true },
      );
      setSaved(targeting);
      setSnack({ open: true, msg: 'Targeting saved.', ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      setSnack({ open: true, msg: `Save failed: ${msg}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, maxWidth: 1280 }}>
      {/* Header */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <AutoAwesomeMotionIcon color="primary" />
        <Typography variant="h5" component="h1" fontWeight={600}>
          Messaging Sequences
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Multi-step SMS flows with a defined start, end, and purpose. Each sequence fires against a
        specific trigger (e.g. shift confirmed) and can branch on worker replies. Only the CORT
        cadence ships today; more sequences will appear here as we model them.
      </Typography>

      <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.25 }}>
          Targeting is editable — steps below are read-only (Phase 2)
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Use the targeting card below to choose which accounts, worker types, and occurrences this
          cadence applies to. The step timing and message copy are still defined in code (see the
          "Built in" paths per step) and will become editable in a follow-up.
        </Typography>
      </Alert>

      {/* Targeting card (editable) */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <TargetOutlinedIcon sx={{ fontSize: 20, color: 'primary.main' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              Targeting
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, lineHeight: 1.5 }}>
            Controls which assignments receive this sequence. Saved to{' '}
            <code>tenants/{'{tenantId}'}/messagingSequences/{CORT_SEQUENCE_ID}</code>.
          </Typography>

          {targetingLoading ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="caption" color="text.secondary">
                Loading current targeting…
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={2}>
              {/* Label + Active toggle — row at top. Label helps distinguish multiple rules
                  that share the same underlying sequence template; Active is the master
                  on/off switch. */}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                alignItems={{ xs: 'stretch', sm: 'center' }}
              >
                <TextField
                  label="Label"
                  size="small"
                  value={targeting.label}
                  onChange={(e) =>
                    setTargeting((prev) => ({ ...prev, label: e.target.value }))
                  }
                  helperText="Recruiter-facing name for this rule (e.g. CORT CSR Waitlist)."
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
                    placeholder={accounts.length > 0 ? 'Select one or more accounts…' : 'No active accounts found'}
                    helperText="Assignments at these accounts will use this sequence. Leave empty to disable the sequence tenant-wide."
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

              {/* Worker type */}
              <FormControl size="small" sx={{ maxWidth: 360 }}>
                <InputLabel id="worker-type-label">Worker type</InputLabel>
                <Select
                  labelId="worker-type-label"
                  multiple
                  value={targeting.workerTypes}
                  label="Worker type"
                  onChange={(e) => {
                    const value = typeof e.target.value === 'string' ? [e.target.value] : e.target.value;
                    const clean = (value as string[]).filter((v): v is SequenceWorkerType =>
                      WORKER_TYPE_OPTIONS.includes(v as SequenceWorkerType),
                    );
                    setTargeting((prev) => ({
                      ...prev,
                      workerTypes: clean.length > 0 ? clean : DEFAULT_CORT_TARGETING.workerTypes,
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
                <InputLabel id="occurrence-label">Occurrence</InputLabel>
                <Select
                  labelId="occurrence-label"
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
                  disabled={!isDirty || saving || !effectiveTenantId}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : 'Save targeting'}
                </Button>
                <Button
                  variant="text"
                  disabled={!isDirty || saving}
                  onClick={() => setTargeting(saved)}
                >
                  Discard changes
                </Button>
                {!effectiveTenantId ? (
                  <Typography variant="caption" color="error">
                    No active tenant — cannot save.
                  </Typography>
                ) : null}
              </Stack>

              <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
                  <strong>Phase 1 note:</strong> saving writes the targeting to Firestore, but the
                  cloud-function dispatcher doesn't read it yet — today the cadence still fires based on
                  the older <code>shiftReminderProfile</code> tenant switch. Wire-up to read this targeting
                  is the next backend task.
                </Typography>
              </Alert>
            </Stack>
          )}
        </Box>
      </Paper>

      {/* Sequence card */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={1}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                {CORT_SEQUENCE_SUMMARY.name}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                id: {CORT_SEQUENCE_SUMMARY.id}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={`${CORT_SEQUENCE_SUMMARY.totalSteps} steps`}
              color="primary"
              variant="outlined"
            />
          </Stack>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.6 }}>
            {CORT_SEQUENCE_SUMMARY.purpose}
          </Typography>

          <Divider sx={{ my: 1.75 }} />

          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
            Trigger
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.5 }}>
            {CORT_SEQUENCE_SUMMARY.trigger}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
            Profile resolution order
          </Typography>
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {CORT_SEQUENCE_SUMMARY.resolutionOrder.map((line, i) => (
              <Typography
                key={i}
                component="li"
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.5 }}
              >
                {line}
              </Typography>
            ))}
          </Box>
        </Box>

        {/* Steps table */}
        <TableContainer>
          <Table size="small" sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>When</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Step</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Message sent to worker</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <ReplyIcon sx={{ fontSize: 16 }} />
                    <span>Reply behavior</span>
                  </Stack>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CORT_SEQUENCE_STEPS.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Reply tokens reference */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Reply tokens (global)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}>
            These replies work on any inbound SMS while a cadence is active for the worker — they
            aren't step-specific. Walk-off phrase detection runs <em>before</em> check-in phrase detection
            so "NO ONE IS HERE" doesn't get classified as a check-in.
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Token / phrase</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Kind</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Effect</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CORT_REPLY_TOKENS.map((r) => (
                <TableRow key={r.token} hover>
                  <TableCell sx={{ verticalAlign: 'top', fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}>
                    {r.token}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Chip size="small" label={r.kind} color={replyKindChipColor(r.kind)} variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                      {r.effect}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', lineHeight: 1.5 }}>
        Classifier source: <code>functions/src/cadence/replyClassifier.ts</code>. Handler:{' '}
        <code>functions/src/cadence/cadenceReplyHandler.ts</code>.
      </Typography>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.ok ? 'success' : 'error'}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default MessagingSequencesPage;
