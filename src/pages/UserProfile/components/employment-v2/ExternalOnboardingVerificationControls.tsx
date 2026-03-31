/**
 * Admin-only completion for TempWorks external onboarding steps (worker_onboarding.externalOnboardingSteps).
 * TempWorks has no API — recruiters mark milestones complete in HRX after confirming work in TempWorks.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
  formatVerifiedAtDisplayForExternalRecord,
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
  const [optimisticChecked, setOptimisticChecked] = useState(false);

  const record = useMemo(() => {
    if (!stepKey || !isExternalOnboardingStepVerificationUiKey(stepKey)) return undefined;
    const map = parseExternalOnboardingSteps(workerOnboarding?.externalOnboardingSteps);
    return map?.[stepKey];
  }, [stepKey, workerOnboarding?.externalOnboardingSteps]);

  const status: ExternalOnboardingStepStatus | undefined = record?.status;
  const verified = record != null && isExternalOnboardingStepVerifiedComplete(record);
  const verifiedAtDisplay = formatVerifiedAtDisplayForExternalRecord(record);

  useEffect(() => {
    if (verified) setOptimisticChecked(false);
  }, [verified]);

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

  const canManualOrApiVerify =
    orphanCompleted ||
    status === 'worker_completed_external' ||
    status === 'pending_admin_verification' ||
    status === 'invite_sent' ||
    status === 'not_started' ||
    status === 'error' ||
    status === undefined;

  const canVerifyAction = !verified && canManualOrApiVerify;

  const canRequestCorrection =
    status === 'worker_completed_external' || status === 'pending_admin_verification';

  const canMarkError =
    orphanCompleted ||
    status === 'not_started' ||
    status === 'error' ||
    Boolean(status && !['not_started', 'completed'].includes(status));

  const showBlock = verified || canVerifyAction || canRequestCorrection || canMarkError;

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
      setOptimisticChecked(false);
      onComplete?.();
    } catch (e: unknown) {
      setErr(friendlyExternalVerificationError(e));
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle =
    dialogMode === 'verify'
      ? 'Mark complete in HRX'
      : dialogMode === 'correction'
        ? 'Request correction'
        : dialogMode === 'error'
          ? 'Mark for review'
          : '';

  const noteRequired = dialogMode === 'correction' || dialogMode === 'error';

  const checkboxChecked = verified || optimisticChecked;

  return (
    <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.25 }}>
        TempWorks milestone (manual in HRX)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75, lineHeight: 1.45 }}>
        There is no TempWorks API in HRX. After you confirm this step in TempWorks, record it here so the worker and
        team see progress. Several checklist lines can share one TempWorks milestone — marking complete updates all of
        them.
      </Typography>

      <FormControlLabel
        sx={{ alignItems: 'flex-start', mr: 0, mb: 0.5 }}
        control={
          <Checkbox
            checked={checkboxChecked}
            disabled={verified || loading}
            color={verified ? 'success' : 'primary'}
            onChange={(_, checked) => {
              if (verified || loading) return;
              if (checked) {
                setOptimisticChecked(true);
                setDialogMode('verify');
              } else {
                setOptimisticChecked(false);
              }
            }}
          />
        }
        label={
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5, lineHeight: 1.45 }}>
            {verified ? (
              <>
                <Box component="span" sx={{ fontWeight: 600, color: 'success.main' }}>
                  Marked complete in HRX
                </Box>
                {verifiedAtDisplay ? (
                  <>
                    {' '}
                    · {verifiedAtDisplay}
                  </>
                ) : null}
              </>
            ) : (
              <>
                Mark complete in HRX (check after confirming in TempWorks)
              </>
            )}
          </Typography>
        }
      />

      <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap sx={{ mt: 0.5 }}>
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

      <Dialog
        open={dialogMode != null}
        onClose={() => {
          if (!loading) {
            setDialogMode(null);
            setOptimisticChecked(verified);
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {dialogMode === 'verify'
              ? 'Records that this TempWorks milestone is done. Optional note (e.g. what you verified in TempWorks).'
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
          <Button
            onClick={() => {
              if (!loading) {
                setDialogMode(null);
                setOptimisticChecked(verified);
              }
            }}
            disabled={loading}
          >
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
