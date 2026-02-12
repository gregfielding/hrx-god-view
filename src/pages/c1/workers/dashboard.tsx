/**
 * Worker Dashboard — /c1/workers/dashboard
 * Work Hub landing page. Answers: Do I have work? Am I missing anything? What next? Any updates?
 * Spec: HRX Worker Dashboard Layout Spec
 *
 * Fixed links (do not change): /c1/jobs-board, /c1/applications
 */

import React from 'react';
import { Box, Stack } from '@mui/material';
import { useAuth } from '../../../contexts/AuthContext';
import WorkerDashboardHero from '../../../components/worker/dashboard/WorkerDashboardHero';
import WorkerDashboardAlerts from '../../../components/worker/dashboard/WorkerDashboardAlerts';
import WorkerDashboardStatusCards from '../../../components/worker/dashboard/WorkerDashboardStatusCards';
import WorkerDashboardQuickActions from '../../../components/worker/dashboard/WorkerDashboardQuickActions';
import WorkerDashboardActivity from '../../../components/worker/dashboard/WorkerDashboardActivity';

// TODO v2: Wire upcoming shift from assignments query (by userId, next startDate)
// TODO v2: Wire readiness % from profile completeness (availability, experience, certs, bio, skills, docs)
// TODO v2: Wire documents status (missing vs complete) from user/docs
// TODO v2: Wire active applications count from applications API
// TODO v2: Alerts from real conditions (missing doc, profile incomplete, application update, shift reminder)

const WorkerDashboard: React.FC = () => {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] ?? 'there';

  // v1: placeholder. v2: fetch next assignment for user.
  const nextShift = null;

  // v1: placeholder alerts so section is present. v2: derive from missing docs, readiness, app status.
  const alerts = [
    {
      severity: 'info' as const,
      message: 'Finish your profile to unlock more roles.',
      ctaLabel: 'Job Readiness',
      ctaTo: '/c1/workers/profile',
    },
  ];

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        {/* 1. Greeting + Next Shift Hero */}
        <WorkerDashboardHero firstName={firstName} nextShift={nextShift} />

        {/* 2. Alerts (conditional) */}
        <WorkerDashboardAlerts alerts={alerts} />

        {/* 3. Status Cards Row — 4 cards, 2x2 on mobile */}
        <WorkerDashboardStatusCards
          readinessPercent="72"
          documentsStatus="All set"
          documentsSubtext="Work eligibility"
          applicationsCount="—"
          messagesUnread="—"
          messagesSubtext="Recruiter updates"
        />

        {/* 4. Quick Actions — 2x2 grid, stacked on mobile */}
        <WorkerDashboardQuickActions />

        {/* 5. Recent Activity — v1 placeholder */}
        <WorkerDashboardActivity />
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
