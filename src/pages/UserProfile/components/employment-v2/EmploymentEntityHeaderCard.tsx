import React from 'react';
import { Card, CardContent, Typography, Stack, Chip, Box, Tooltip } from '@mui/material';
import type { EmploymentEntityOverview, EmploymentV2HeaderState } from './employmentV2Types';
import { employmentHeaderStateLabel } from '../../../../utils/deriveEmploymentHeaderState';
import { getEmploymentStatusLabel } from '../../../../utils/employmentStatusLabel';
import { entityEmploymentStatusForDisplay } from '../../../../utils/entityEmploymentLifecycle';
import { deriveEntityEmploymentNextStepLine } from '../../../../utils/entityEmploymentNextStep';

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
  const onCallPool =
    String(overview.entityEmployment?.employmentEntryMode || '').toLowerCase() === 'on_call_pool';
  const chipLabel = employmentHeaderStateLabel(overview.employmentHeaderState);
  const baseChipColor: 'default' | 'warning' | 'success' | 'error' | 'info' =
    HEADER_STATE_COLOR[overview.employmentHeaderState] ?? 'default';
  const noOpenDemand = !overview.hasOpenOnboardingDemand;
  const terminalEmployment =
    overview.employmentHeaderState === 'terminated' || overview.employmentHeaderState === 'inactive';
  const chipColor =
    noOpenDemand && !terminalEmployment && (baseChipColor === 'success' || baseChipColor === 'info')
      ? 'default'
      : baseChipColor;
  /** Single primary status chip — record vs live framing in label only. */
  const primaryStatusLabel =
    noOpenDemand && !terminalEmployment ? `Record · ${chipLabel}` : chipLabel;
  const chipVariant = noOpenDemand && !terminalEmployment ? 'outlined' : 'filled';

  const ee = overview.entityEmployment;
  const nextStepLine = deriveEntityEmploymentNextStepLine(overview);
  const employmentRecordLabel = ee
    ? getEmploymentStatusLabel(
        entityEmploymentStatusForDisplay(ee),
        overview.workerType ?? ee.workerType
      )
    : null;

  const hasDemand = overview.hasOpenOnboardingDemand;
  const blockerCount = hasDemand ? overview.blockerCount : 0;
  const entityTitle = overview.headerEntityName;
  const workerTypeHint = `${overview.headerWorkerTypeDisplay}${employmentRecordLabel ? ` · ${employmentRecordLabel}` : ''}`;

  return (
    <Card sx={{ mb: 1.5 }} variant="outlined">
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1.5} flexWrap="wrap">
          <Tooltip title={workerTypeHint} placement="top" enterDelay={500}>
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.25, cursor: 'default' }}>
              {entityTitle}
            </Typography>
          </Tooltip>
          <Chip size="small" label={primaryStatusLabel} color={chipColor} variant={chipVariant} sx={{ flexShrink: 0 }} />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', lineHeight: 1.35 }}>
          {employmentRecordLabel ? (
            <>
              Employment record:{' '}
              <Box component="span" sx={{ color: 'text.primary' }}>
                {employmentRecordLabel}
              </Box>
            </>
          ) : (
            'No employment row yet for this tab'
          )}
          {onCallPool && hasDemand ? (
            <Box component="span" sx={{ display: 'block', mt: 0.25 }}>
              On-call pool — no assignment required yet.
            </Box>
          ) : null}
        </Typography>

        {hasDemand && blockerCount > 0 ? (
          <Typography variant="body2" fontWeight={700} color="warning.main" sx={{ mt: 1, lineHeight: 1.35 }}>
            {blockerCount} blocking item{blockerCount === 1 ? '' : 's'}
          </Typography>
        ) : null}

        {nextStepLine ? (
          <Typography variant="body2" sx={{ mt: hasDemand && blockerCount > 0 ? 0.75 : 1, lineHeight: 1.45 }}>
            <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              Next step:{' '}
            </Box>
            {nextStepLine}
          </Typography>
        ) : noOpenDemand ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            No live onboarding demand on this tab.
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.45 }}>
            {overview.headerReadinessExplanation}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentEntityHeaderCard;
