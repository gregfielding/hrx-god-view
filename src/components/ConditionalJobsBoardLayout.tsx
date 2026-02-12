import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Outlet } from 'react-router-dom';
import WorkerRoute from '../auth/WorkerRoute';
import C1WorkerLayout from '../layouts/C1WorkerLayout';

/**
 * Conditional layout wrapper for C1 routes (jobs board, applications, apply wizard, etc.).
 * - If user is logged in: worker layout (WorkerNav + AppBar) with Outlet so child route (e.g. ApplyWizardPage) renders in content area.
 * - If user is not logged in: outlet only (no sidebar).
 */
const ConditionalJobsBoardLayout: React.FC = () => {
  const { user } = useAuth();

  if (user) {
    return (
      <WorkerRoute>
        <C1WorkerLayout>
          <Outlet />
        </C1WorkerLayout>
      </WorkerRoute>
    );
  }

  return <Outlet />;
};

export default ConditionalJobsBoardLayout;

