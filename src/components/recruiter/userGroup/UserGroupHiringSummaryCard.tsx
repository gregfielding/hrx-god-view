import React from 'react';
import { Box, Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import type { GroupHiringPipelineMetrics } from '../../../utils/userGroupHiringPipeline';

export type UserGroupHiringSummaryCardProps = {
  memberCount: number;
  metrics: GroupHiringPipelineMetrics;
  metricsLoading: boolean;
  metricsBeta: boolean;
};

function MetricLive({ label, value }: { label: string; value: string | number }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700}>
        {value}
      </Typography>
    </Box>
  );
}

const UserGroupHiringSummaryCard: React.FC<UserGroupHiringSummaryCardProps> = ({
  memberCount,
  metrics,
  metricsLoading,
  metricsBeta,
}) => {
  const interviewed = metrics.interviewed;
  const advanced = metrics.autoAdvanced;
  const onboarding = metrics.onboardingAccepted + metrics.onboardingInFlow;
  const queued = metrics.queued;

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        bgcolor: 'grey.50',
        borderColor: 'divider',
      }}
    >
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 0.75 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Group hiring summary
          </Typography>
          {metricsBeta ? (
            <Chip size="small" label="Beta metrics" color="default" variant="outlined" />
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
          Live counts from applications with this group ID plus automation decisions (approximate until all rows are
          backfilled).
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={4}>
            <MetricLive label="Total members" value={memberCount} />
          </Grid>
          <Grid item xs={6} sm={4}>
            <MetricLive label="Interviewed" value={metricsLoading ? '…' : interviewed} />
          </Grid>
          <Grid item xs={6} sm={4}>
            <MetricLive label="Advanced" value={metricsLoading ? '…' : advanced} />
          </Grid>
          <Grid item xs={6} sm={4}>
            <MetricLive label="Onboarding" value={metricsLoading ? '…' : onboarding} />
          </Grid>
          <Grid item xs={6} sm={4}>
            <MetricLive label="Queued / waiting" value={metricsLoading ? '…' : queued} />
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default UserGroupHiringSummaryCard;
