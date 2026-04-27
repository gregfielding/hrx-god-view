import React from 'react';
import { Box, Card, CardContent, Grid, Stack, Typography, LinearProgress } from '@mui/material';

export type HiringStatusSummaryProps = {
  totalApplicants: number;
  interviewed: number;
  ready: number;
  assigned: number;
  /** 0–1 fill ratio, or null if no target */
  fillProgress: number | null;
  /** e.g. ready ÷ interviewed */
  conversionRateInterviewedToReady: number | null;
  targetReadyLabel: string;
};

function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="h5" fontWeight={700}>
      {value}
    </Typography>
  </Box>
);

const JobOrderHiringStatusSummary: React.FC<HiringStatusSummaryProps> = ({
  totalApplicants,
  interviewed,
  ready,
  assigned,
  fillProgress,
  conversionRateInterviewedToReady,
  targetReadyLabel,
}) => {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ py: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Hiring status
        </Typography>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={3}>
            <Stat label="Total applicants" value={totalApplicants} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Stat label="Interviewed" value={interviewed} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Stat label="Ready" value={ready} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Stat label="Assigned" value={assigned} />
          </Grid>
        </Grid>
        <Stack spacing={1}>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Fill progress ({targetReadyLabel})
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {fillProgress == null ? '—' : pct(fillProgress)}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={fillProgress == null ? 0 : Math.min(100, fillProgress * 100)}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Conversion (ready ÷ interviewed):{' '}
            <strong>{pct(conversionRateInterviewedToReady)}</strong>
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default JobOrderHiringStatusSummary;
