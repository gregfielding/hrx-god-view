import React, { useEffect, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Container, ThemeProvider } from '@mui/material';
import WorkerNav from '../components/worker/WorkerNav';
import WorkerAppBar from '../components/worker/WorkerAppBar';
import WorkerPageTransition from '../components/worker/WorkerPageTransition';
import { useAuth } from '../contexts/AuthContext';
import { WorkerToastProvider } from '../contexts/WorkerToastContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useWorkerPreferredLanguage } from '../hooks/useWorkerPreferredLanguage';
import { setLanguage, preloadLocales } from '../i18n';
import { getWorkerTheme } from '../theme/workerTheme';

/**
 * Layout for worker routes: top bar, side WorkerNav, main content.
 * Uses worker-only theme (design system) for modern, mobile-friendly look.
 * When used from ConditionalJobsBoardLayout (e.g. /apply/...), children is <Outlet /> so the child route renders.
 * When used from /c1 routes, no children so internal <Outlet /> renders the /c1 child.
 */
const C1WorkerLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const preferredLanguage = useWorkerPreferredLanguage();
  const workerTheme = useMemo(() => getWorkerTheme(), []);
  usePushNotifications(user?.uid);

  useEffect(() => {
    setLanguage(preferredLanguage);
  }, [preferredLanguage]);

  useEffect(() => {
    if (user?.uid) preloadLocales();
  }, [user?.uid]);

  return (
    <ThemeProvider theme={workerTheme}>
      <WorkerToastProvider>
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: '#F7F9FC' }}>
          <WorkerAppBar />
          <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <WorkerNav />
            <Container
              component="main"
              sx={{
                flex: 1,
                py: 3,
                px: { xs: 2, sm: 3 },
                overflow: 'auto',
                maxWidth: { sm: 880 },
                borderRadius: 0,
                /** Keep main (incl. page transition transforms) below WorkerNav drawer stacking (z-index). */
                position: 'relative',
                zIndex: 0,
                isolation: 'isolate',
              }}
            >
              <WorkerPageTransition>{children ?? <Outlet />}</WorkerPageTransition>
            </Container>
          </Box>
        </Box>
      </WorkerToastProvider>
    </ThemeProvider>
  );
};

export default C1WorkerLayout;
