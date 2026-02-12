import React from 'react';
import { Stack, Button } from '@mui/material';
import WorkIcon from '@mui/icons-material/Work';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { useNavigate } from 'react-router-dom';

const WorkerQuickActions: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      <Button variant="outlined" startIcon={<WorkIcon />} onClick={() => navigate('/c1/jobs-board')}>
        Browse Jobs
      </Button>
      <Button variant="outlined" startIcon={<AssignmentIcon />} onClick={() => navigate('/c1/workers/assignments')}>
        My Assignments
      </Button>
    </Stack>
  );
};

export default WorkerQuickActions;
