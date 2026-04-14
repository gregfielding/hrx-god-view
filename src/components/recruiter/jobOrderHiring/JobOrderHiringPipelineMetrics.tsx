import React from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';

export type JobOrderHiringPipelineMetricsProps = {
  totalApplicants: number;
  interviewed: number;
  ready: number;
  onboardingPipeline: number;
  assigned: number;
  loading: boolean;
};

function ratio(num: number, den: number): string {
  if (!den) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

const JobOrderHiringPipelineMetrics: React.FC<JobOrderHiringPipelineMetricsProps> = ({
  totalApplicants,
  interviewed,
  ready,
  onboardingPipeline,
  assigned,
  loading,
}) => {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Pipeline metrics
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Live counts from applications and placements for this job order (read-only).
        </Typography>
        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Stack spacing={1.25} divider={<Divider flexItem />}>
            <Row label="In onboarding / mid-funnel" value={onboardingPipeline} hint="interview + offer_pending" />
            <Row
              label="Interviewed share of pool"
              value={ratio(interviewed, totalApplicants)}
              hint={`${interviewed} / ${totalApplicants} applicants`}
            />
            <Row
              label="Ready share of interviewed"
              value={ratio(ready, Math.max(1, interviewed))}
              hint={`${ready} ready of ${interviewed} interviewed`}
            />
            <Row
              label="Assigned vs applicants"
              value={ratio(assigned, Math.max(1, totalApplicants))}
              hint={`${assigned} placements`}
            />
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

function Row({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Box>
      <Typography variant="body2" fontWeight={600}>
        {label}
      </Typography>
      <Typography variant="h6">{value}</Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

export default JobOrderHiringPipelineMetrics;
