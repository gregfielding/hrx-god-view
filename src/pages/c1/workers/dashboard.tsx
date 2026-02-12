/**
 * Worker Dashboard — /c1/workers/dashboard
 * Work Hub landing page. Truthful metrics only; no fake data (Go-Live spec §3).
 * Fixed links (do not change): /c1/jobs-board, /c1/applications
 */

import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Box, Stack } from '@mui/material';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getUserScore } from '../../../utils/scoreSummary';
import { useOnboarding } from '../../../hooks/useOnboarding';
import WorkerDashboardHero from '../../../components/worker/dashboard/WorkerDashboardHero';
import WorkerDashboardAlerts from '../../../components/worker/dashboard/WorkerDashboardAlerts';
import WorkerDashboardStatusCards from '../../../components/worker/dashboard/WorkerDashboardStatusCards';
import WorkerDashboardQuickActions from '../../../components/worker/dashboard/WorkerDashboardQuickActions';
import WorkerDashboardActivity from '../../../components/worker/dashboard/WorkerDashboardActivity';

const WorkerDashboard: React.FC = () => {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] ?? 'there';

  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const { checklist, summary: complianceSummary, hasOnboarding } = useOnboarding(user?.uid);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = () => {};
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
    return unsub;
  }, [user?.uid]);

  const score = userDoc ? getUserScore(userDoc) : undefined;
  const applicationIds = Array.isArray(userDoc?.applicationIds) ? (userDoc.applicationIds as string[]) : [];
  const applicationsCount = userDoc != null ? String(applicationIds.length) : null;

  const readinessPercent =
    userDoc != null && typeof score === 'number' && Number.isFinite(score)
      ? String(Math.round(score))
      : null;
  const hasChecklist = hasOnboarding && Object.keys(checklist).length > 0;
  const documentsStatus = !hasChecklist
    ? 'Not started'
    : complianceSummary.compliancePercent === 100
      ? 'All set'
      : 'Incomplete';
  const documentsSubtext =
    documentsStatus === 'All set'
      ? 'Compliance complete'
      : documentsStatus === 'Not started'
        ? 'Your recruiter will request anything needed'
        : 'Complete required items';

  const nextShift = null;
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
        <WorkerDashboardHero firstName={firstName} nextShift={nextShift} />

        <WorkerDashboardAlerts alerts={alerts} />

        <WorkerDashboardStatusCards
          readinessPercent={readinessPercent}
          documentsStatus={documentsStatus}
          documentsSubtext={documentsSubtext}
          applicationsCount={applicationsCount}
          supportCardOnly
          supportSubtext="Contact support"
        />

        <WorkerDashboardQuickActions />

        <WorkerDashboardActivity />
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
