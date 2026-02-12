import React from 'react';
import { Typography, Stack } from '@mui/material';
import MissingDocsBanner from '../../../components/worker/cards/MissingDocsBanner';
import NextShiftCard from '../../../components/worker/cards/NextShiftCard';
import WorkerQuickActions from '../../../components/worker/WorkerQuickActions';

const WorkerDashboard: React.FC = () => {
  return (
    <>
      <Typography variant="h5" sx={{ mb: 2 }}>Worker Dashboard</Typography>
      <MissingDocsBanner />
      <Stack spacing={2} sx={{ mb: 2 }}>
        <NextShiftCard />
      </Stack>
      <WorkerQuickActions />
    </>
  );
};

export default WorkerDashboard;
