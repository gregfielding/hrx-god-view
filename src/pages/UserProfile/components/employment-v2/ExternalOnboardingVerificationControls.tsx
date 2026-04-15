/**
 * Admin-only completion for payroll-system onboarding milestones stored on the worker onboarding record.
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
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../../../firebase';
import type { EmploymentEntityKey, WorkerOnboardingPipeline } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import type {
  ExternalOnboardingStepKey,
  ExternalOnboardingStepRecord,
  ExternalOnboardingStepStatus,
} from '../../../../types/externalOnboardingSteps';
import { formatFirebaseHttpsError } from '../../../../utils/firebaseHttpsErrors';
import {
  formatVerifiedAtDisplayForExternalRecord,
  isExternalOnboardingStepVerificationUiKey,
  isExternalOnboardingStepVerifiedComplete,
  parseExternalOnboardingSteps,
} from '../../../../utils/externalOnboardingSteps';

const updateExternalOnboardingStepVerification = httpsCallable(functions, 'updateExternalOnboardingStepVerification');

/** Payroll milestone progress + coarse pipeline fallback when the milestone row is missing. */
const PAYROLL_MICRO_UI: Partial<
  Record<ExternalOnboardingStepKey, { title: string; step1: string; step2: string; pipelineStepId?: string }>
> = {
  i9_employee_section: {
    title: 'I-9 payroll',
    step1: 'Sent to worker',
    step2: 'Worker completed',
    pipelineStepId: 'i9',
  },
  handbook_acknowledgment: {
    title: 'Handbook',
    step1: 'Sent to worker',
    step2: 'Signed by worker',
    pipelineStepId: 'onboarding_forms',
  },
  tax_withholding_forms: {
    title: 'Tax forms (W-4)',
    step1: 'W-4 sent to worker',
    step2: 'W-4 completed',
    pipelineStepId: 'onboarding_forms',
  },
  policies_acknowledgment: {
    title: 'Company policies',
    step1: 'Sent to worker',
    step2: 'Signed by worker',
    pipelineStepId: 'onboarding_forms',
  },
  payroll_onboarding: {
    title: 'Payroll setup',
    step1: 'Invite sent to worker',
    step2: 'Worker completed payroll setup',
    pipelineStepId: 'everee',
  },
  direct_deposit: {
    title: 'Direct deposit',
    step1: 'Sent to worker',
    step2: 'Worker completed',
    pipelineStepId: 'onboarding_forms',
  },
  contractor_tax_form_w9: {
    title: 'W-9',
    step1: 'W-9 sent to worker',
    step2: 'W-9 completed',
    pipelineStepId: 'onboarding_forms',
  },
  independent_contractor_agreement: {
    title: 'Contractor agreement',
    step1: 'Sent to worker',
    step2: 'Signed by worker',
    pipelineStepId: 'onboarding_forms',
  },
};

function pipelineStepById(workerOnboarding: WorkerOnboardingPipeline | null | undefined, id: string) {
  return (workerOnboarding?.steps || []).find((s) => String(s.id || '') === id);
}

function payrollMilestoneSentDone(
  record: ExternalOnboardingStepRecord | undefined,
  workerOnboarding: WorkerOnboardingPipeline | null | undefined,
  pipelineStepId: string | undefined
): boolean {
  if (record && record.status !== 'not_started') return true;
  if (!pipelineStepId) return false;
  const pipe = pipelineStepById(workerOnboarding, pipelineStepId);
  const st = String(pipe?.status || '').toLowerCase();
  if (!pipe || !st || st === 'not_started') return false;
  return true;
}

function payrollMilestoneWorkerDone(
  record: ExternalOnboardingStepRecord | undefined,
  workerOnboarding: WorkerOnboardingPipeline | null | undefined,
  pipelineStepId: string | undefined
): boolean {
  if (record) {
    return (
      record.status === 'worker_completed_external' ||
      record.status === 'pending_admin_verification' ||
      record.status === 'completed'
    );
  }
  if (!pipelineStepId) return false;
  const pipe = pipelineStepById(workerOnboarding, pipelineStepId);
  const st = String(pipe?.status || '').toLowerCase();
  return st === 'complete' || st === 'completed';
}

function PayrollMicroSubsteps({
  step1,
  step2,
  record,
  workerOnboarding,
  pipelineStepId,
}: {
  step1: string;
  step2: string;
  record: ExternalOnboardingStepRecord | undefined;
  workerOnboarding: WorkerOnboardingPipeline | null | undefined;
  pipelineStepId: string | undefined;
}) {
  const sent = payrollMilestoneSentDone(record, workerOnboarding, pipelineStepId);
  const workerDone = payrollMilestoneWorkerDone(record, workerOnboarding, pipelineStepId);
  return (
    <Stack spacing={0.75} sx={{ mb: 1.25 }}>
      <Stack direction="row" alignItems="center" gap={1}>
        {sent ? (
          <CheckCircleIcon color="success" sx={{ fontSize: 20 }} />
        ) : (
          <RadioButtonUncheckedIcon sx={{ fontSize: 20, color: 'action.disabled' }} />
        )}
        <Typography variant="body2" color={sent ? 'text.primary' : 'text.secondary'}>
          {step1}
        </Typography>
      </Stack>
      <Stack direction="row" alignItems="center" gap={1}>
        {workerDone ? (
          <CheckCircleIcon color="success" sx={{ fontSize: 20 }} />
        ) : (
          <RadioButtonUncheckedIcon sx={{ fontSize: 20, color: 'action.disabled' }} />
        )}
        <Typography variant="body2" color={workerDone ? 'text.primary' : 'text.secondary'}>
          {step2}
        </Typography>
      </Stack>
    </Stack>
  );
}

function externalVerificationErrorMessage(err: unknown): string {
  const base = formatFirebaseHttpsError(err);
  if (base && base !== 'Request failed') return base;
  const o = err as { code?: string } | undefined;
  const code = String(o?.code ?? '');
  if (code.includes('permission-denied')) {
    return "You don't have permission to update this step. Ask a tenant admin if you need access.";
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

type DialogMode = 'verify' | 'correction' | 'error' | 'clear_verification' | null;

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

  const submit = async (action: 'verify_complete' | 'request_correction' | 'mark_error' | 'clear_verification') => {
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
      setErr(externalVerificationErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle =
    dialogMode === 'verify'
      ? 'Mark complete'
      : dialogMode === 'clear_verification'
        ? 'Clear C1 verification'
        : dialogMode === 'correction'
          ? 'Request correction'
          : dialogMode === 'error'
            ? 'Mark for review'
            : '';

  const noteRequired = dialogMode === 'correction' || dialogMode === 'error';
  const clearMode = dialogMode === 'clear_verification';

  const checkboxChecked = verified || optimisticChecked;

  const payrollHelp =
    'HRX does not receive live updates from every payroll system. After you confirm the step there, record it here. Related checklist lines may update together.';

  const micro =
    stepKey && isExternalOnboardingStepVerificationUiKey(stepKey)
      ? PAYROLL_MICRO_UI[stepKey as ExternalOnboardingStepKey]
      : undefined;

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          {micro?.title ?? 'Confirm in payroll'}
        </Typography>
        <Tooltip title={payrollHelp} placement="right">
          <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
        </Tooltip>
      </Stack>

      {micro ? (
        <PayrollMicroSubsteps
          step1={micro.step1}
          step2={micro.step2}
          record={record}
          workerOnboarding={workerOnboarding}
          pipelineStepId={micro.pipelineStepId}
        />
      ) : null}

      <FormControlLabel
        sx={{ alignItems: 'flex-start', mr: 0, mb: 0.5 }}
        control={
          verified ? (
            <Tooltip title="Click to clear the C1 verification stamp" placement="top">
              <span>
                <Checkbox
                  checked={checkboxChecked}
                  disabled={loading}
                  color="success"
                  onChange={(_, checked) => {
                    if (loading) return;
                    if (!checked) setDialogMode('clear_verification');
                  }}
                />
              </span>
            </Tooltip>
          ) : (
            <Checkbox
              checked={checkboxChecked}
              disabled={loading}
              color="primary"
              onChange={(_, checked) => {
                if (loading) return;
                if (checked) {
                  setOptimisticChecked(true);
                  setDialogMode('verify');
                } else {
                  setOptimisticChecked(false);
                }
              }}
            />
          )
        }
        label={
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5, lineHeight: 1.45 }}>
            {verified ? (
              <>
                <Box component="span" sx={{ fontWeight: 600, color: 'success.main' }}>
                  {micro ? 'C1 completed' : 'Marked complete here'}
                </Box>
                {verifiedAtDisplay ? (
                  <>
                    {' '}
                    · {verifiedAtDisplay}
                  </>
                ) : null}
              </>
            ) : (
              <>{micro ? 'C1 completed' : 'Confirm completed in payroll'}</>
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
              ? 'Records that this payroll step is done. Add an optional note if helpful.'
              : dialogMode === 'clear_verification'
                ? 'Removes the “C1 completed” stamp in HRX. Use this if you marked a step complete by mistake. The worker’s status in your payroll system is unchanged.'
                : dialogMode === 'correction'
                  ? 'Sends the step back to the worker flow. A short note is required.'
                  : 'Flags the step for internal review. A note is required.'}
          </Typography>
          {clearMode ? null : (
            <TextField
              label={noteRequired ? 'Note (required)' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              disabled={loading}
            />
          )}
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
            color={clearMode ? 'warning' : 'primary'}
            disabled={loading}
            onClick={() => {
              if (dialogMode === 'verify') void submit('verify_complete');
              if (dialogMode === 'clear_verification') void submit('clear_verification');
              if (dialogMode === 'correction') void submit('request_correction');
              if (dialogMode === 'error') void submit('mark_error');
            }}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {clearMode ? 'Clear verification' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ExternalOnboardingVerificationControls;
