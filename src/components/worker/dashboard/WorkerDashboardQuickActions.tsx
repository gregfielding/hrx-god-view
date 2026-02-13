/**
 * Worker Dashboard Quick Actions — 2x2 primary task grid.
 * Spec: HRX Worker Dashboard Layout Spec — Section 4
 */

import React from 'react';
import { Grid, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import WorkIcon from '@mui/icons-material/Work';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FolderIcon from '@mui/icons-material/Folder';

const ACTIONS = [
  { label: 'Find Work', to: '/c1/jobs-board', icon: <WorkIcon /> },
  { label: 'My Assignments', to: '/c1/workers/assignments', icon: <AssignmentIcon /> },
  { label: 'My Applications', to: '/c1/workers/applications', icon: <ListAltIcon /> },
  { label: 'My Documents', to: '/c1/workers/documents', icon: <FolderIcon /> },
] as const;

const WorkerDashboardQuickActions: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Grid container spacing={2}>
      {ACTIONS.map((a) => (
        <Grid item xs={12} sm={6} key={a.label}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={a.icon}
            onClick={() => navigate(a.to)}
            sx={{ minHeight: 56, py: 1.5, justifyContent: 'flex-start', textTransform: 'none' }}
          >
            {a.label}
          </Button>
        </Grid>
      ))}
    </Grid>
  );
};

export default WorkerDashboardQuickActions;
