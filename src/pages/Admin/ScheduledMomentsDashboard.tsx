import React, { useEffect } from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';

import { logger } from '../../utils/logger';

const ScheduledMomentsDashboard: React.FC = () => {
  useEffect(() => {
    logger.info('ScheduledMomentsDashboard viewed while queue is disabled', {
      context: 'ScheduledMomentsDashboard',
    });
  }, []);

  return (
    <Box px={3} py={4}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Scheduled Moments Dashboard
      </Typography>
      <Typography variant="subtitle2" color="text.secondary">
        The scheduled queue previously stored millions of fan-out documents in Firestore. That queue has been
        decommissioned so the dashboard is paused while we transition to a Cloud Tasks based delivery pipeline.
      </Typography>

      <Stack spacing={3} mt={3}>
        <Alert severity="warning">
          No queued moments are being read or written right now. When the replacement queue launches, this dashboard
          will light back up automatically.
        </Alert>
      </Stack>
    </Box>
  );
};

export default ScheduledMomentsDashboard;
