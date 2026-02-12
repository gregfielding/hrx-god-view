import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Container } from '@mui/material';
import WorkerNav from '../components/worker/WorkerNav';

/**
 * Layout for /c1/workers/* routes. Visually separate from Admin layout.
 * Uses MUI AppBar + Drawer; contains WorkerNav and renders children in Container.
 */
const C1WorkerLayout: React.FC = () => {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <WorkerNav />
      <Container component="main" sx={{ flex: 1, py: 2 }}>
        <Outlet />
      </Container>
    </Box>
  );
};

export default C1WorkerLayout;
