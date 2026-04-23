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
import React from 'react';
import {
  Alert,
  Box,
  Chip,
  Divider,
  Paper,
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
import {
  CORT_REPLY_TOKENS,
  CORT_SEQUENCE_STEPS,
  CORT_SEQUENCE_SUMMARY,
  type MessagingSequenceStep,
} from '../../../config/messagingSequences/cortCadence';

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

const MessagingSequencesPage: React.FC = () => {
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
          Read-only preview
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Timing, message copy, and reply logic are currently defined in code (see the "Built in" paths
          below). Editing from this UI is a Phase 2 feature — overrides will land at{' '}
          <code>tenants/{'{tenantId}'}/messagingConfig/sequences/cort_gig</code>.
        </Typography>
      </Alert>

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
    </Box>
  );
};

export default MessagingSequencesPage;
