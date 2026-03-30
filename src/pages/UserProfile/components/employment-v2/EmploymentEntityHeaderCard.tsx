import React from 'react';
import { Card, CardContent, Typography, Stack, Chip, Box } from '@mui/material';
import type { EmploymentEntityOverview, HeaderEmploymentStatus } from './employmentV2Types';

const STATUS_COLOR: Record<HeaderEmploymentStatus, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  none: 'default',
  onboarding: 'warning',
  ready: 'success',
  active: 'success',
  inactive: 'default',
  terminated: 'error',
  blocked: 'error',
};

function statusLabel(s: HeaderEmploymentStatus): string {
  return s.replace(/_/g, ' ');
}

export interface EmploymentEntityHeaderCardProps {
  overview: EmploymentEntityOverview;
}

const EmploymentEntityHeaderCard: React.FC<EmploymentEntityHeaderCardProps> = ({ overview }) => {
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
            <Typography variant="body2" sx={{ mt: 1.25, lineHeight: 1.5 }} color="text.primary">
              {overview.headerReadinessExplanation}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`Employment: ${statusLabel(overview.headerEmploymentStatus)}`}
            color={STATUS_COLOR[overview.headerEmploymentStatus] ?? 'default'}
            sx={{ alignSelf: 'flex-start' }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
};

export default EmploymentEntityHeaderCard;
