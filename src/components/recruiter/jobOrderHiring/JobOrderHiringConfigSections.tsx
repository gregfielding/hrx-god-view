import React, { useMemo, useState } from 'react';
import {
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { JobOrderAiHiringForm } from '../../../types/jobOrderHiringControl';
import {
  HIRING_QUALITY_PRESETS,
  presetIndexFromThresholds,
} from '../../../types/jobOrderHiringControl';

export type JobOrderHiringConfigSectionsProps = {
  workerAiPrescreenRequired: boolean;
  onWorkerAiPrescreenRequiredChange: (v: boolean) => void;
  form: JobOrderAiHiringForm;
  onFormChange: (next: JobOrderAiHiringForm) => void;
  /** When true, automation toggles are disabled (pre-launch pause). */
  automationLocked?: boolean;
};

function numField(
  label: string,
  value: number | undefined,
  onChange: (n: number | undefined) => void,
  helper?: string,
) {
  return (
    <TextField
      size="small"
      label={label}
      type="number"
      value={value === undefined ? '' : value}
      onChange={(e) => {
        const t = e.target.value.trim();
        if (t === '') {
          onChange(undefined);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n);
      }}
      helperText={helper}
      fullWidth
      inputProps={{ step: 1 }}
    />
  );
}

const JobOrderHiringConfigSections: React.FC<JobOrderHiringConfigSectionsProps> = ({
  workerAiPrescreenRequired,
  onWorkerAiPrescreenRequiredChange,
  form,
  onFormChange,
  automationLocked = false,
}) => {
  const [presetIdx, setPresetIdx] = useState(() => presetIndexFromThresholds(form));

  const presetMarks = useMemo(
    () => HIRING_QUALITY_PRESETS.map((p, i) => ({ value: i, label: p.label })),
    [],
  );

  const applyPreset = (idx: number) => {
    const i = Math.max(0, Math.min(HIRING_QUALITY_PRESETS.length - 1, idx));
    const p = HIRING_QUALITY_PRESETS[i];
    setPresetIdx(i);
    onFormChange({
      ...form,
      minimumScoreToAdvance: p.minimumScoreToAdvance,
      topPercentToAdvance: p.topPercentToAdvance,
      minimumJobScoreToAdvance: p.minimumJobScoreToAdvance,
    });
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Employment defaults
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Stored on <code>hiringConfig.interview</code> and <code>aiHiring.default*</code> for this job order.
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={workerAiPrescreenRequired}
              onChange={(_, v) => onWorkerAiPrescreenRequiredChange(v)}
            />
          }
          label="Worker AI pre-screen required"
        />
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            label="Default company label (automation hints)"
            value={form.defaultCompany ?? ''}
            onChange={(e) => onFormChange({ ...form, defaultCompany: e.target.value || undefined })}
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              label="Default worksite city"
              value={form.defaultWorksiteCity ?? ''}
              onChange={(e) => onFormChange({ ...form, defaultWorksiteCity: e.target.value || undefined })}
              fullWidth
            />
            <TextField
              size="small"
              label="Default worksite state"
              value={form.defaultWorksiteState ?? ''}
              onChange={(e) => onFormChange({ ...form, defaultWorksiteState: e.target.value || undefined })}
              fullWidth
            />
          </Stack>
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Requirements & job fit
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={Boolean(form.minimumJobScoreGateEnabled)}
              onChange={(_, v) => onFormChange({ ...form, minimumJobScoreGateEnabled: v })}
            />
          }
          label="Enforce minimum job-fit score gate"
        />
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {numField('Minimum job-fit score (0–100)', form.minimumJobScoreToAdvance, (n) =>
            onFormChange({ ...form, minimumJobScoreToAdvance: n }),
          )}
          <FormControl size="small" fullWidth>
            <InputLabel id="job-fit-fail-action-label">If below job-fit threshold</InputLabel>
            <Select
              labelId="job-fit-fail-action-label"
              label="If below job-fit threshold"
              value={form.jobFitFailAction ?? ''}
              onChange={(e) =>
                onFormChange({
                  ...form,
                  jobFitFailAction: e.target.value === '' ? undefined : (e.target.value as 'review' | 'hold'),
                })
              }
            >
              <MenuItem value="">
                <em>Default (review)</em>
              </MenuItem>
              <MenuItem value="review">Send to review</MenuItem>
              <MenuItem value="hold">Hold</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Targets & caps
        </Typography>
        <Stack spacing={1.5}>
          {numField('Target ready count', form.targetReadyCount, (n) => onFormChange({ ...form, targetReadyCount: n }))}
          {numField('Target onboarding count', form.targetOnboardingCount, (n) =>
            onFormChange({ ...form, targetOnboardingCount: n }),
          )}
          {numField('Maximum auto-advances', form.maximumAutoAdvances, (n) =>
            onFormChange({ ...form, maximumAutoAdvances: n }),
          )}
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(form.stopWhenTargetReached)}
                onChange={(_, v) => onFormChange({ ...form, stopWhenTargetReached: v })}
              />
            }
            label="Stop automation when targets are reached"
          />
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Quality preset
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Adjusts interview score, top-percent, and job-fit floor together. You can still fine-tune numbers below.
        </Typography>
        <Slider
          value={presetIdx}
          onChange={(_, v) => applyPreset(v as number)}
          step={1}
          marks={presetMarks}
          min={0}
          max={HIRING_QUALITY_PRESETS.length - 1}
          valueLabelDisplay="auto"
          valueLabelFormat={(i) => HIRING_QUALITY_PRESETS[i]?.label ?? ''}
        />
        <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            Current thresholds
          </Typography>
          <Typography variant="body2">
            Min interview score to advance: <strong>{form.minimumScoreToAdvance ?? '—'}</strong>
          </Typography>
          <Typography variant="body2">
            Top % of pool to advance: <strong>{form.topPercentToAdvance ?? '—'}</strong>
          </Typography>
          <Typography variant="body2">
            Min job-fit score: <strong>{form.minimumJobScoreToAdvance ?? '—'}</strong>
          </Typography>
        </Box>
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {numField('Minimum interview score to advance', form.minimumScoreToAdvance, (n) =>
            onFormChange({ ...form, minimumScoreToAdvance: n }),
          )}
          {numField('Top percent of pool to advance', form.topPercentToAdvance, (n) =>
            onFormChange({ ...form, topPercentToAdvance: n }),
            'e.g. 35 = top 35% by score',
          )}
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Automation
        </Typography>
        {automationLocked ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Toggles are locked until hiring automation launch — nothing is enqueued or messaged from automation.
          </Typography>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={form.autoAdvanceEnabled}
              disabled={automationLocked}
              onChange={(_, v) => onFormChange({ ...form, autoAdvanceEnabled: v })}
            />
          }
          label="Auto-advance enabled"
        />
        <FormControlLabel
          control={
            <Switch
              checked={Boolean(form.allowGigFallback)}
              disabled={automationLocked}
              onChange={(_, v) => onFormChange({ ...form, allowGigFallback: v })}
            />
          }
          label="Allow gig fallback path (when policy permits)"
        />
      </Box>
    </Stack>
  );
};

export default JobOrderHiringConfigSections;
