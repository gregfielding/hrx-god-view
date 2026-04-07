/**
 * Worker dashboard bottom nav — Find Work + My Profile only (mobile-first).
 */

import React from 'react';
import { Box, Link, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import WorkIcon from '@mui/icons-material/Work';
import PersonIcon from '@mui/icons-material/Person';
import { useT } from '../../../i18n';

const ACTIONS = [
  { key: 'nav.findWork', to: '/c1/jobs-board', icon: <WorkIcon fontSize="small" /> },
  { key: 'nav.myProfile', to: '/c1/workers/profile', icon: <PersonIcon fontSize="small" /> },
] as const;

const WorkerDashboardQuickActions: React.FC = () => {
  const t = useT();
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      useFlexGap
      sx={{ justifyContent: { xs: 'stretch', sm: 'center' }, alignItems: 'stretch' }}
    >
      {ACTIONS.map((a) => (
        <Link
          key={a.key}
          component={RouterLink}
          to={a.to}
          underline="none"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            color: 'text.primary',
            fontSize: '0.9375rem',
            fontWeight: 600,
            px: 2,
            py: 1.25,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            '&:hover': { bgcolor: 'action.hover', borderColor: 'action.hover' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', color: 'primary.main' }}>{a.icon}</Box>
          {t(a.key)}
        </Link>
      ))}
    </Stack>
  );
};

export default WorkerDashboardQuickActions;
