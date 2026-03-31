import React, { useMemo } from 'react';
import { Card, CardContent, Typography, Stack, Chip, Box } from '@mui/material';
import type { EmploymentEntityOverview, EmploymentV2HeaderState } from './employmentV2Types';
import {
  employmentBlockerItemFromPathRow,
  employmentHeaderStateLabel,
} from '../../../../utils/deriveEmploymentHeaderState';
import { isOnboardingPathRowBlocker } from '../../../../utils/employmentOnboardingPath';
import { categorizeBlockersForHeader } from '../../../../utils/employmentOnboardingPathRecruiterView';

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
  /** Avoid “all green” success when the relationship path is historical-only. */
  const chipColor =
    noOpenDemand && !terminalEmployment && (baseChipColor === 'success' || baseChipColor === 'info')
      ? 'default'
      : baseChipColor;
  const chipLabelWithFraming =
    noOpenDemand && !terminalEmployment ? `Record · ${chipLabel}` : `Status: ${chipLabel}`;
  const chipVariant = noOpenDemand && !terminalEmployment ? 'outlined' : 'filled';

  const blockerBreakdown = useMemo(() => {
    if (!overview.hasOpenOnboardingDemand) {
      return { pendingWorker: 0, pendingRecruiter: 0, pendingVendor: 0 };
    }
    const pathBlockingRows = overview.onboardingPath
      .flatMap((g) => g.rows)
      .filter(isOnboardingPathRowBlocker);
    const merged = [
      ...overview.blockers,
      ...pathBlockingRows.map(employmentBlockerItemFromPathRow),
    ];
    return categorizeBlockersForHeader(merged);
  }, [overview.blockers, overview.hasOpenOnboardingDemand, overview.onboardingPath]);

  const blockerBreakdownSegments: { label: string; count: number; color: 'info' | 'warning' | 'default' }[] = [];
  if (blockerBreakdown.pendingWorker > 0) {
    blockerBreakdownSegments.push({
      label: 'Pending worker',
      count: blockerBreakdown.pendingWorker,
      color: 'info',
    });
  }
  if (blockerBreakdown.pendingRecruiter > 0) {
    blockerBreakdownSegments.push({
      label: 'Pending recruiter',
      count: blockerBreakdown.pendingRecruiter,
      color: 'warning',
    });
  }
  if (blockerBreakdown.pendingVendor > 0) {
    blockerBreakdownSegments.push({
      label: 'Pending vendor',
      count: blockerBreakdown.pendingVendor,
      color: 'default',
    });
  }

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
            {onCallPool && overview.hasOpenOnboardingDemand ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block', lineHeight: 1.5 }}>
                On-call / labor pool hire: onboarding for this entity does not require a job assignment yet. Assignments
                will appear here when you are placed on work.
              </Typography>
            ) : null}
            {noOpenDemand ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', lineHeight: 1.5 }}>
                No open assignment onboarding for this entity — status reflects the employment record and retained
                relationship history below, not live job-package work.
              </Typography>
            ) : null}
            <Typography variant="body2" sx={{ mt: noOpenDemand ? 1 : 1.25, lineHeight: 1.5 }} color="text.primary">
              {overview.headerReadinessExplanation}
            </Typography>
            {!noOpenDemand && blockerBreakdownSegments.length > 0 ? (
              <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
                {blockerBreakdownSegments.map((seg) => (
                  <Chip
                    key={seg.label}
                    size="small"
                    variant="outlined"
                    color={seg.color}
                    label={`${seg.label}: ${seg.count}`}
                    sx={{ fontWeight: 600 }}
                  />
                ))}
              </Stack>
            ) : null}
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
