/**
 * Worker Dashboard Quick Actions — compact links to main worker areas.
 * Spec: HRX Worker Dashboard Layout Spec — Section 4
 */

import React from 'react';
import { Box, Link, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import WorkIcon from '@mui/icons-material/Work';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FolderIcon from '@mui/icons-material/Folder';

const ACTIONS = [
  { label: 'Find Work', to: '/c1/jobs-board', icon: <WorkIcon fontSize="small" /> },
  { label: 'My Assignments', to: '/c1/workers/assignments', icon: <AssignmentIcon fontSize="small" /> },
  { label: 'My Applications', to: '/c1/workers/applications', icon: <ListAltIcon fontSize="small" /> },
  { label: 'My Documents', to: '/c1/workers/documents', icon: <FolderIcon fontSize="small" /> },
] as const;

const WorkerDashboardQuickActions: React.FC = () => {
  return (
    <Stack direction="row" flexWrap="wrap" gap={2} useFlexGap>
      {ACTIONS.map((a) => (
        <Link
          key={a.label}
          component={RouterLink}
          to={a.to}
          underline="hover"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            color: 'primary.main',
            fontSize: '0.9375rem',
            textDecoration: 'none',
            '&:hover': { color: 'primary.dark' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', color: 'inherit' }}>{a.icon}</Box>
          {a.label}
        </Link>
      ))}
    </Stack>
  );
};

export default WorkerDashboardQuickActions;
