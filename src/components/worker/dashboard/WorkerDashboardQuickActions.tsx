/**
 * Worker Dashboard Quick Actions — compact quick-nav row.
 * Find Work | Assignments | Applications | Messages | Profile
 */

import React from 'react';
import { Box, Link, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import WorkIcon from '@mui/icons-material/Work';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ListAltIcon from '@mui/icons-material/ListAlt';
import MessageIcon from '@mui/icons-material/Message';
import PersonIcon from '@mui/icons-material/Person';
import { useT } from '../../../i18n';

const ACTIONS = [
  { key: 'nav.findWork', to: '/c1/jobs-board', icon: <WorkIcon fontSize="small" /> },
  { key: 'nav.myAssignments', to: '/c1/workers/assignments', icon: <AssignmentIcon fontSize="small" /> },
  { key: 'nav.myApplications', to: '/c1/workers/applications', icon: <ListAltIcon fontSize="small" /> },
  { key: 'nav.inbox', to: '/c1/workers/inbox', icon: <MessageIcon fontSize="small" /> },
  { key: 'nav.myProfile', to: '/c1/workers/profile', icon: <PersonIcon fontSize="small" /> },
] as const;

const WorkerDashboardQuickActions: React.FC = () => {
  const t = useT();
  return (
    <Stack direction="row" flexWrap="wrap" gap={2} useFlexGap>
      {ACTIONS.map((a) => (
        <Link
          key={a.key}
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
          {t(a.key)}
        </Link>
      ))}
    </Stack>
  );
};

export default WorkerDashboardQuickActions;
