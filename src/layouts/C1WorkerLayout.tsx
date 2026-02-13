import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Container } from '@mui/material';
import WorkerNav from '../components/worker/WorkerNav';
import WorkerAppBar from '../components/worker/WorkerAppBar';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

/**
 * Layout for worker routes: top bar, side WorkerNav, main content.
 * When used from ConditionalJobsBoardLayout (e.g. /apply/...), children is <Outlet /> so the child route renders.
 * When used from /c1 routes, no children so internal <Outlet /> renders the /c1 child.
 */
const C1WorkerLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  usePushNotifications(user?.uid);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <WorkerAppBar />
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <WorkerNav />
        <Container component="main" sx={{ flex: 1, py: 2, overflow: 'auto' }}>
          {children ?? <Outlet />}
        </Container>
      </Box>
    </Box>
  );
};

export default C1WorkerLayout;
