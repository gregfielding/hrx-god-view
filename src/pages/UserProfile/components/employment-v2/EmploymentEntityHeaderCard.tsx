import React from 'react';
import { Card, CardContent, Typography, Stack, Chip, Box } from '@mui/material';
import type { EmploymentEntityOverview, EmploymentV2HeaderState } from './employmentV2Types';
import { employmentHeaderStateLabel } from '../../../../utils/deriveEmploymentHeaderState';

const HEADER_STATE_COLOR: Record<
  EmploymentV2HeaderState,
  'default' | 'warning' | 'success' | 'error' | 'info'
> = {
  not_started: 'default',
  in_progress: 'warning',
  action_required: 'warning',
  waiting_on_company: 'info',
  ready: 'success',
  on_assignment: 'success',
  terminated: 'error',
  inactive: 'default',
};

export interface EmploymentEntityHeaderCardProps {
  overview: EmploymentEntityOverview;
}

const EmploymentEntityHeaderCard: React.FC<EmploymentEntityHeaderCardProps> = ({ overview }) => {
  const chipLabel = employmentHeaderStateLabel(overview.employmentHeaderState);
  const baseChipColor: 'default' | 'warning' | 'success' | 'error' | 'info' =
    HEADER_STATE_COLOR[overview.employmentHeaderState] ?? 'default';
  const noOpenDemand = !overview.hasOpenOnboardingDemand;
  const terminalEmployment =
    overview.employmentHeaderState === 'terminated' || overview.employmentHeaderState === 'inactive';
  /** Avoid “all green” success when the relationship path is historical-only. */
  const chipColor =
    noOpenDemand && !terminalEmployment && (baseChipColor === 'success' || baseChipColor === 'info')
      ? 'default'
      : baseChipColor;
  const chipLabelWithFraming =
    noOpenDemand && !terminalEmployment ? `Record · ${chipLabel}` : `Status: ${chipLabel}`;
  const chipVariant = noOpenDemand && !terminalEmployment ? 'outlined' : 'filled';

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1.5}>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="h6" fontWeight={700}>
              {overview.headerEntityName}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Worker type: {overview.headerWorkerTypeDisplay}
            </Typography>
            {noOpenDemand ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', lineHeight: 1.5 }}>
                No open assignment onboarding for this entity — status reflects the employment record and retained
                relationship history below, not live job-package work.
              </Typography>
            ) : null}
            <Typography variant="body2" sx={{ mt: noOpenDemand ? 1 : 1.25, lineHeight: 1.5 }} color="text.primary">
              {overview.headerReadinessExplanation}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={chipLabelWithFraming}
            color={chipColor}
            variant={chipVariant}
            sx={{ alignSelf: 'flex-start' }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
};

export default EmploymentEntityHeaderCard;
