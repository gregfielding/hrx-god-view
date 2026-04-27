import React from 'react';
import { Stack, Typography } from '@mui/material';
import WorkerDashboardCardRail from '../dashboard/WorkerDashboardCardRail';
import type { DashboardCardPayload } from '../dashboard/cards';

interface RecommendedJobsSectionProps {
  cards: DashboardCardPayload[];
  sectionHeader: string;
  showNavArrows: boolean;
}

const RecommendedJobsSection: React.FC<RecommendedJobsSectionProps> = ({
  cards,
  sectionHeader,
  showNavArrows,
}) => (
  <Stack spacing={1.5}>
    <Typography
      variant="subtitle2"
      sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}
    >
      Recommended jobs
    </Typography>
    <WorkerDashboardCardRail cards={cards} sectionHeader={sectionHeader} showNavArrows={showNavArrows} />
  </Stack>
);

export default RecommendedJobsSection;
