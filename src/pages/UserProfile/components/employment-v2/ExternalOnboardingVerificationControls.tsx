/**
 * Admin-only verification for TempWorks external onboarding steps (worker_onboarding.externalOnboardingSteps).
 */
import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../../../firebase';
import type { EmploymentEntityKey, WorkerOnboardingPipeline } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import type { ExternalOnboardingStepStatus } from '../../../../types/externalOnboardingSteps';
import {
  isExternalOnboardingStepVerificationUiKey,
  isExternalOnboardingStepVerifiedComplete,
  parseExternalOnboardingSteps,
} from '../../../../utils/externalOnboardingSteps';

const updateExternalOnboardingStepVerification = httpsCallable(functions, 'updateExternalOnboardingStepVerification');

function friendlyExternalVerificationError(err: unknown): string {
  const o = err as { code?: string; message?: string } | undefined;
  const code = String(o?.code ?? '');
  if (code.includes('permission-denied')) {
    return "You don't have permission to update this step. Ask a tenant admin if you need access.";
  }
  if (code.includes('failed-precondition')) {
    return 'That action is not available for this step right now. Refresh the page and try again.';
  }
  if (code.includes('invalid-argument')) {
    return 'Something was invalid. Refresh the page and try again.';
  }
  if (code.includes('not-found')) {
    return 'No onboarding record found for this worker and entity.';
  }
  return 'Update failed. Please try again.';
}

export interface ExternalOnboardingVerificationControlsProps {
  ctx: EmploymentV2ActionResolutionContext;
  entityKey: EmploymentEntityKey;
  stepKey: string | undefined;
  workerOnboarding: WorkerOnboardingPipeline | null | undefined;
  onComplete?: () => void;
  /** When true (no open assignment demand), hide controls — verification is for current onboarding context. */
  suppress?: boolean;
}

type DialogMode = 'verify' | 'correction' | 'error' | null;

const ExternalOnboardingVerificationControls: React.FC<ExternalOnboardingVerificationControlsProps> = ({
  ctx,
  entityKey,
  stepKey,
  workerOnboarding,
  onComplete,
  suppress,
}) => {
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const record = useMemo(() => {
    if (!stepKey || !isExternalOnboardingStepVerificationUiKey(stepKey)) return undefined;
    const map = parseExternalOnboardingSteps(workerOnboarding?.externalOnboardingSteps);
    return map?.[stepKey];
  }, [stepKey, workerOnboarding?.externalOnboardingSteps]);

  const status: ExternalOnboardingStepStatus | undefined = record?.status;

  if (suppress || ctx.viewer !== 'recruiter') {
    return null;
  }

  if (!stepKey || !isExternalOnboardingStepVerificationUiKey(stepKey)) {
    return null;
  }

  const orphanCompleted =
    record != null &&
    record.status === 'completed' &&
    !isExternalOnboardingStepVerifiedComplete(record);

  const canVerify =
    orphanCompleted ||
    status === 'worker_completed_external' ||
    status === 'pending_admin_verification' ||
    status === 'invite_sent';

  const canRequestCorrection =
    status === 'worker_completed_external' || status === 'pending_admin_verification';

  const canMarkError =
    orphanCompleted ||
    Boolean(status && !['not_started', 'completed'].includes(status));

  const showBlock = canVerify || canRequestCorrection || canMarkError;

  if (!showBlock) {
    return null;
  }

  const submit = async (action: 'verify_complete' | 'request_correction' | 'mark_error') => {
    setErr(null);
    const trimmed = note.trim();
    if ((action === 'request_correction' || action === 'mark_error') && !trimmed) {
      setErr('A note is required.');
      return;
    }
    setLoading(true);
    try {
      await updateExternalOnboardingStepVerification({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityKey,
        stepKey,
        action,
        note: trimmed || undefined,
      });
      setDialogMode(null);
      setNote('');
      onComplete?.();
    } catch (e: unknown) {
      setErr(friendlyExternalVerificationError(e));
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle =
    dialogMode === 'verify'
      ? 'Verify & complete'
      : dialogMode === 'correction'
        ? 'Request correction'
        : dialogMode === 'error'
          ? 'Mark for review'
          : '';

  const noteRequired = dialogMode === 'correction' || dialogMode === 'error';

  return (
    <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.25 }}>
        C1 verification (TempWorks)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75, lineHeight: 1.4 }}>
        This confirms completion in TempWorks.
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
        {canVerify ? (
          <Button size="small" variant="contained" color="primary" onClick={() => setDialogMode('verify')}>
            Verify & complete
          </Button>
        ) : null}
        {canRequestCorrection ? (
          <Button size="small" variant="outlined" color="warning" onClick={() => setDialogMode('correction')}>
            Request correction
          </Button>
        ) : null}
        {canMarkError ? (
          <Button size="small" variant="outlined" color="error" onClick={() => setDialogMode('error')}>
            Mark for review
          </Button>
        ) : null}
      </Stack>

      <Dialog open={dialogMode != null} onClose={() => !loading && setDialogMode(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {dialogMode === 'verify'
              ? 'Confirms completion in TempWorks. Optional note (e.g. “Confirmed in TempWorks”).'
              : dialogMode === 'correction'
                ? 'Sends the step back to the worker flow. A short note is required.'
                : 'Flags the step for internal review. A note is required.'}
          </Typography>
          <TextField
            label={noteRequired ? 'Note (required)' : 'Note (optional)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            disabled={loading}
          />
          {err ? (
            <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
              {err}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogMode(null)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={loading}
            onClick={() => {
              if (dialogMode === 'verify') void submit('verify_complete');
              if (dialogMode === 'correction') void submit('request_correction');
              if (dialogMode === 'error') void submit('mark_error');
            }}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            Submit
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ExternalOnboardingVerificationControls;
