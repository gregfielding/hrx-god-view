import React from 'react';
import WorkerDashboardQuickActions from './dashboard/WorkerDashboardQuickActions';

/**
 * WorkerQuickNav — canonical quick navigation links for worker surfaces.
 * Alias wrapper to preserve existing dashboard implementation.
 */
const WorkerQuickNav: React.FC = () => <WorkerDashboardQuickActions />;

export default WorkerQuickNav;
