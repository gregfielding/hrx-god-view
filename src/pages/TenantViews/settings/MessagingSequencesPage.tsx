/**
 * Messaging Sequences — one editable targeting card per sequence doc.
 *
 * 2026-08-29: the backend scans EVERY doc in
 * `tenants/{t}/messagingSequences` (each with its own track, accounts,
 * locations, occurrence), so this page loads the whole collection and
 * renders a SequenceTargetingCard per doc — an invisible sequence would be
 * live SMS config nobody can see. The step table below documents the CORT
 * track; step timing/copy still live in code (cadenceMessages,
 * shiftReminderProfile, workerShiftRemindersV2, replyClassifier).
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ReplyIcon from '@mui/icons-material/Reply';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { collection, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import {
  CORT_REPLY_TOKENS,
  CORT_SEQUENCE_STEPS,
  CORT_SEQUENCE_SUMMARY,
  DEFAULT_CORT_TARGETING,
  sequenceTargetingDocPath,
  type MessagingSequenceStep,
  type SequenceTargeting,
  type SequenceTrack,
  type SequenceWorkerType,
} from '../../../config/messagingSequences/cortCadence';
import SequenceTargetingCard from './SequenceTargetingCard';

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

interface SequenceDocRow {
  id: string;
  track: SequenceTrack;
  targeting: SequenceTargeting;
}

function coerceTargeting(raw: Partial<SequenceTargeting> | undefined, fallbackLabel: string): SequenceTargeting {
  return {
    label:
      typeof raw?.label === 'string' && raw.label.trim() !== '' ? raw.label.trim() : fallbackLabel,
    active: raw?.active === true,
    accountIds: Array.isArray(raw?.accountIds) ? raw.accountIds.map(String) : [],
    workerTypes:
      Array.isArray(raw?.workerTypes) && raw.workerTypes.length > 0
        ? (raw.workerTypes as SequenceWorkerType[])
        : ['gig'],
    occurrence: raw?.occurrence === 'every_shift' ? 'every_shift' : 'first_shift',
    locationIds: Array.isArray(raw?.locationIds) ? raw.locationIds.map(String) : [],
  };
}

const MessagingSequencesPage: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId || '';

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState<boolean>(false);
  const [sequences, setSequences] = useState<SequenceDocRow[]>([]);
  const [sequencesLoading, setSequencesLoading] = useState<boolean>(false);
  const [addingSequence, setAddingSequence] = useState<boolean>(false);
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

  // Load EVERY sequence doc — each one governs live dispatch, so each must be
  // visible here. The CORT card renders even before its doc exists.
  useEffect(() => {
    if (!effectiveTenantId) return;
    let cancelled = false;
    setSequencesLoading(true);
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, 'tenants', effectiveTenantId, 'messagingSequences'),
        );
        if (cancelled) return;
        const rows: SequenceDocRow[] = snap.docs.map((d) => {
          const data = d.data() as { track?: string; targeting?: Partial<SequenceTargeting> };
          const track: SequenceTrack = data.track === 'gig_standard' ? 'gig_standard' : 'cort_gig';
          return { id: d.id, track, targeting: coerceTargeting(data.targeting, d.id) };
        });
        if (!rows.some((r) => r.id === CORT_SEQUENCE_ID)) {
          rows.unshift({
            id: CORT_SEQUENCE_ID,
            track: 'cort_gig',
            targeting: { ...DEFAULT_CORT_TARGETING, locationIds: [] },
          });
        }
        rows.sort((a, b) => a.id.localeCompare(b.id));
        setSequences(rows);
      } catch (err) {
        if (!cancelled) setSequences([]);
        // eslint-disable-next-line no-console
        console.warn('MessagingSequencesPage: failed to load sequences', err);
      } finally {
        if (!cancelled) setSequencesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId]);

  async function handleAddSequence() {
    if (!effectiveTenantId || addingSequence) return;
    setAddingSequence(true);
    try {
      const id = `seq_${Date.now().toString(36)}`;
      const targeting: SequenceTargeting = {
        label: 'New sequence',
        active: false,
        accountIds: [],
        workerTypes: ['gig'],
        occurrence: 'every_shift',
        locationIds: [],
      };
      await setDoc(doc(db, sequenceTargetingDocPath(effectiveTenantId, id)), {
        sequenceId: id,
        track: 'gig_standard',
        targeting,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setSequences((prev) =>
        [...prev, { id, track: 'gig_standard' as SequenceTrack, targeting }].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      );
      setSnack({ open: true, msg: 'Sequence created — set its accounts and turn it on.', ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Create failed.';
      setSnack({ open: true, msg: `Create failed: ${msg}`, ok: false });
    } finally {
      setAddingSequence(false);
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
        Multi-step SMS flows with a defined start, end, and purpose. Each sequence below targets
        its own accounts (and optionally specific venues) with a reminder track — the standard gig
        confirm cadence, or the CORT variant with the QR clock-in link. Careers automatically get
        a quiet placement track and are never targeted here.
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

      {/* One editable card per sequence doc — every doc governs live dispatch. */}
      {sequencesLoading ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="caption" color="text.secondary">
            Loading sequences…
          </Typography>
        </Stack>
      ) : (
        sequences.map((row) => (
          <SequenceTargetingCard
            key={`${row.id}`}
            tenantId={effectiveTenantId}
            sequenceId={row.id}
            initialTrack={row.track}
            initialTargeting={row.targeting}
            accounts={accounts}
            accountsLoading={accountsLoading}
            onSaved={(msg, ok) => setSnack({ open: true, msg, ok })}
          />
        ))
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Button
          variant="outlined"
          disabled={addingSequence || !effectiveTenantId}
          onClick={handleAddSequence}
        >
          {addingSequence ? 'Creating…' : 'Add sequence'}
        </Button>
      </Stack>

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
