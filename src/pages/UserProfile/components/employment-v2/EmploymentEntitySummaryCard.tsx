import React from 'react';
import { Card, CardContent, Typography, Stack, Chip, LinearProgress, Box } from '@mui/material';
import type { EmploymentEntityOverview, EmploymentV2HeaderState } from './employmentV2Types';
import { employmentHeaderStateLabel } from '../../../../utils/deriveEmploymentHeaderState';

const HEADER_STATE_COLOR: Record<
  EmploymentV2HeaderState,
  'default' | 'warning' | 'success' | 'error' | 'info'
> = {
  not_started: 'default',
  in_progress: 'warning',
  action_required: 'error',
  waiting_on_company: 'warning',
  ready: 'success',
  on_assignment: 'success',
  inactive: 'default',
  terminated: 'error',
};

const READINESS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  not_started: 'default',
  in_progress: 'warning',
  ready: 'success',
  blocked: 'error',
};

export interface EmploymentEntitySummaryCardProps {
  overview: EmploymentEntityOverview;
}

const EmploymentEntitySummaryCard: React.FC<EmploymentEntitySummaryCardProps> = ({ overview }) => {
  const wt = overview.workerType ? (overview.workerType === '1099' ? '1099' : 'W-2') : '—';

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {overview.entityLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Worker type: {wt}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={`Status: ${employmentHeaderStateLabel(overview.employmentHeaderState)}`}
              color={HEADER_STATE_COLOR[overview.employmentHeaderState] ?? 'default'}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Readiness: ${overview.readinessChip.replace(/_/g, ' ')}`}
              color={READINESS_COLOR[overview.readinessChip] ?? 'default'}
            />
          </Stack>
        </Stack>
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Required onboarding steps
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {overview.completedCount} of {overview.requiredCount} complete
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={overview.requiredCount > 0 ? overview.percentComplete : 0}
            sx={{ height: 8, borderRadius: 1 }}
          />
        </Box>
      </CardContent>
    </Card>
  );
};

export default EmploymentEntitySummaryCard;
