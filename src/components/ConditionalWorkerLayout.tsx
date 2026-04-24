import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import WorkerRoute from '../auth/WorkerRoute';
import C1WorkerLayout from '../layouts/C1WorkerLayout';
import { WorkerToastProvider } from '../contexts/WorkerToastContext';
import { getWorkerTheme } from '../theme/workerTheme';
import { preloadLocales } from '../i18n';

/**
 * Single layout wrapper for all /c1/* worker routes.
 * - Logged out: NO shell. The page itself (PublicJobsBoard, JobPostingDetail,
 *   ApplyWizardPage) renders standalone with its own Sign-In CTA. Previously
 *   we kept the WorkerAppBar + WorkerNav for visual parity, but it was
 *   confusing for guests on the public jobs board to see Dashboard / My
 *   Account / Pre-screen items they couldn't use.
 * - Logged in: WorkerRoute (staff redirect) + C1WorkerLayout.
 * Theme + toast provider stay mounted in both cases so the public page still
 * picks up the worker theme tokens and any toast triggered from the page
 * (e.g. apply success) renders correctly.
 *
 * Preload i18n for every /c1 visitor (signed-in or not).
 */
const ConditionalWorkerLayout: React.FC = () => {
  const { user } = useAuth();

  useEffect(() => {
    preloadLocales();
  }, []);

  if (!user) {
    const workerTheme = getWorkerTheme();
    return (
      <ThemeProvider theme={workerTheme}>
        <WorkerToastProvider>
          <Outlet />
        </WorkerToastProvider>
      </ThemeProvider>
    );
  }

  return (
    <WorkerRoute>
      <C1WorkerLayout />
    </WorkerRoute>
  );
};

export default ConditionalWorkerLayout;
