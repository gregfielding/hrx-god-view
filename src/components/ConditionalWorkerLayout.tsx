import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import WorkerRoute from '../auth/WorkerRoute';
import C1WorkerLayout from '../layouts/C1WorkerLayout';

/**
 * Single layout wrapper for all /c1/* worker routes.
 * - Logged out: render only the outlet (e.g. public jobs board, no nav).
 * - Logged in as worker: render WorkerRoute + C1WorkerLayout so nav and top bar persist.
 * Using one layout for all /c1/* prevents remounting when navigating between
 * /c1/workers/*, /c1/applications, /c1/jobs-board, etc.
 */
const ConditionalWorkerLayout: React.FC = () => {
  const { user } = useAuth();

  if (!user) {
    return <Outlet />;
  }

  return (
    <WorkerRoute>
      <C1WorkerLayout />
    </WorkerRoute>
  );
};

export default ConditionalWorkerLayout;
