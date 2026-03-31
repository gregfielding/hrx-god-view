/**
 * Recruiter checkbox for pipeline tasks in the Internal verification group.
 * Completes the linked Firestore task (same id as worker_onboarding.tasks[].id) when present.
 */
import React, { useCallback, useState } from 'react';
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
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate } from 'react-router-dom';
import { useTaskMutations } from '../../../../hooks/useTaskMutations';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import { isOnboardingPathRowDone } from '../../../../utils/employmentOnboardingPath';
import type { EmploymentOnboardingRow } from './employmentV2Types';

export interface InternalPipelineTaskVerificationProps {
  row: EmploymentOnboardingRow;
  ctx: EmploymentV2ActionResolutionContext;
  onComplete?: () => void;
  suppress?: boolean;
}

const InternalPipelineTaskVerification: React.FC<InternalPipelineTaskVerificationProps> = ({
  row,
  ctx,
  onComplete,
  suppress,
}) => {
  const navigate = useNavigate();
  const { completeTask, loading } = useTaskMutations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [optimisticChecked, setOptimisticChecked] = useState(false);

  const taskId = row.sourceRef?.taskId?.trim();
  const done = isOnboardingPathRowDone(row.status);
  const checked = done || optimisticChecked;

  const submit = useCallback(async () => {
    if (!taskId) return;
    setErr(null);
    try {
      await completeTask(taskId);
      setDialogOpen(false);
      setOptimisticChecked(false);
      onComplete?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not mark task complete.');
    }
  }, [taskId, completeTask, onComplete]);

  if (suppress || ctx.viewer !== 'recruiter') {
    return null;
  }

  if (row.groupId !== 'internal_readiness' || row.sourceType !== 'pipeline_task') {
    return null;
  }

  if (row.actionableBy !== 'recruiter' && row.owner !== 'recruiter') {
    return null;
  }

  const help =
    'Check this after you confirm the work in TempWorks. This marks the linked task complete in HRX (same as the Tasks list). Optional note is stored on the task when supported.';

  if (!taskId) {
    return (
      <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Internal verification
          </Typography>
          <Tooltip title={help} placement="right">
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Stack>
        <Button size="small" variant="outlined" onClick={() => navigate('/tasks')} sx={{ textTransform: 'none', mt: 0.5 }}>
          Open Tasks
        </Button>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, maxWidth: 360 }}>
          No task id on this row — open the global task queue to complete it.
        </Typography>
      </Box>
    );
  }

  if (done) {
    return (
      <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Internal verification
          </Typography>
          <Tooltip title={help} placement="right">
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Stack>
        <Typography variant="body2" color="success.main" fontWeight={600}>
          Task marked complete in HRX
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Internal verification
        </Typography>
        <Tooltip title={help} placement="right">
          <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
        </Tooltip>
      </Stack>

      <FormControlLabel
        sx={{ alignItems: 'flex-start', mr: 0, mb: 0.5 }}
        control={
          <Checkbox
            checked={checked}
            disabled={loading}
            color="primary"
            onChange={(_, isChecked) => {
              if (loading) return;
              if (isChecked) {
                setOptimisticChecked(true);
                setDialogOpen(true);
              } else {
                setOptimisticChecked(false);
              }
            }}
          />
        }
        label={
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5, lineHeight: 1.45 }}>
            Confirm completed in TempWorks
          </Typography>
        }
      />

      <Dialog open={dialogOpen} onClose={() => !loading && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Mark task complete</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This marks the linked task complete in HRX (same outcome as completing it from the Tasks list).
          </Typography>
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
                setDialogOpen(false);
                setOptimisticChecked(false);
              }
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submit()} disabled={loading} startIcon={loading ? <CircularProgress size={16} /> : null}>
            Submit
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default InternalPipelineTaskVerification;
