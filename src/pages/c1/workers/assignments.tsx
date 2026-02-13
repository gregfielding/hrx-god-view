/**
 * My Assignments — /c1/workers/assignments
 * Worker-facing upcoming and past shifts. No placeholder data; empty state until real data is wired.
 * Detail route: /c1/assignments/:assignmentId
 */

import React, { useState } from 'react';
import { Box, Stack, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import WorkerAssignmentsTabs from '../../../components/worker/assignments/WorkerAssignmentsTabs';
import type { WorkerAssignmentItem } from '../../../components/worker/assignments/WorkerAssignmentCard';

const WorkerAssignments: React.FC = () => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);

  const upcoming: WorkerAssignmentItem[] = [];
  const past: WorkerAssignmentItem[] = [];

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        {/* Page Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              My Assignments
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your upcoming and past shifts.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" onClick={() => navigate('/c1/jobs-board')}>
              Find Work
            </Button>
            <Button variant="outlined" onClick={() => navigate('/c1/workers/applications')}>
              View Applications
            </Button>
          </Stack>
        </Stack>

        {/* Tabs: Upcoming (default) / Past */}
        <WorkerAssignmentsTabs
          upcoming={upcoming}
          past={past}
          tabIndex={tabIndex}
          onTabChange={setTabIndex}
        />
      </Stack>
    </Box>
  );
};

export default WorkerAssignments;
