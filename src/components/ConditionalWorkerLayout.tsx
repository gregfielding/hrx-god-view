import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import WorkerRoute from '../auth/WorkerRoute';
import C1WorkerLayout from '../layouts/C1WorkerLayout';
import { preloadLocales } from '../i18n';

/**
 * Single layout wrapper for all /c1/* worker routes.
 * - Logged out: same worker shell (C1WorkerLayout: app bar, drawer, theme) so prescreen/profile
 *   match the signed-in experience; guests get Sign in in the app bar and a reduced nav.
 * - Logged in: WorkerRoute (staff redirect) + C1WorkerLayout.
 * Using one layout for all /c1/* prevents remounting when navigating between
 * /c1/workers/*, /c1/jobs-board, etc.
 *
 * Preload i18n for every /c1 visitor (signed-in or not).
 */
const ConditionalWorkerLayout: React.FC = () => {
  const { user } = useAuth();

  useEffect(() => {
    preloadLocales();
  }, []);

  if (!user) {
    return <C1WorkerLayout />;
  }

  return (
    <WorkerRoute>
      <C1WorkerLayout />
    </WorkerRoute>
  );
};

export default ConditionalWorkerLayout;
