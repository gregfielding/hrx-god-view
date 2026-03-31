/**
 * Recruiter checkbox for pipeline tasks merged into a checklist row.
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
  /** When the path row is consolidated, pass the internal pipeline_task row for task id / completion state. */
  taskRow?: EmploymentOnboardingRow | null;
  ctx: EmploymentV2ActionResolutionContext;
  onComplete?: () => void;
  suppress?: boolean;
}

const InternalPipelineTaskVerification: React.FC<InternalPipelineTaskVerificationProps> = ({
  row,
  taskRow,
  ctx,
  onComplete,
  suppress,
}) => {
  const navigate = useNavigate();
  const { completeTask, loading } = useTaskMutations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [optimisticChecked, setOptimisticChecked] = useState(false);

  const source = taskRow ?? row;
  const taskId = source.sourceRef?.taskId?.trim();
  const done = isOnboardingPathRowDone(source.status);
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

  if (source.groupId !== 'internal_readiness' || source.sourceType !== 'pipeline_task') {
    return null;
  }

  if (source.actionableBy !== 'recruiter' && source.owner !== 'recruiter') {
    return null;
  }

  const pipeId = String(source.sourceRef?.pipelineStepId || '');
  const screeningPipe =
    pipeId === 'background_check' || pipeId === 'drug_screen' || pipeId === 'drug_screening';
  const help = screeningPipe
    ? 'Check this when the screening task is finished. Same as completing it from the global Tasks list.'
    : 'Check this after you finish the work in payroll or your task list. This matches marking the task done from the global Tasks list.';
  const taskCheckboxLabel = screeningPipe
    ? source.label?.trim() || 'Complete screening task'
    : 'Confirm completed in payroll';

  if (!taskId) {
    return (
      <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Your tasks
          </Typography>
          <Tooltip title={help} placement="right">
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Stack>
        <Button size="small" variant="outlined" onClick={() => navigate('/tasks')} sx={{ textTransform: 'none', mt: 0.5 }}>
          Open Tasks
        </Button>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, maxWidth: 360 }}>
          No task link on this row — open Tasks to complete it.
        </Typography>
      </Box>
    );
  }

  if (done) {
    return (
      <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Your tasks
          </Typography>
          <Tooltip title={help} placement="right">
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Stack>
        <Typography variant="body2" color="success.main" fontWeight={600}>
          Task marked complete
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Your tasks
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
            {taskCheckboxLabel}
          </Typography>
        }
      />

      <Dialog open={dialogOpen} onClose={() => !loading && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Mark task complete</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Same as completing this task from the Tasks list.
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
