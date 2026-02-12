/**
 * My Assignments — /c1/workers/assignments
 * Worker-facing upcoming and past shifts. Matches Worker Dashboard look/feel.
 * Spec: HRX / C1 Worker Assignments Page Spec (MUI)
 *
 * Fixed links: /c1/jobs-board, /c1/applications
 * Detail route (do not change): /c1/assignments/:assignmentId
 */

import React, { useState, useMemo } from 'react';
import { Box, Stack, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import WorkerAssignmentsTabs from '../../../components/worker/assignments/WorkerAssignmentsTabs';
import type { WorkerAssignmentItem } from '../../../components/worker/assignments/WorkerAssignmentCard';

// ——— v1: Mock data (local). v2: Wire real data ———
// TODO v2: Replace with shared hook e.g. useWorkerAssignments(uid) or useAssignmentsForUser(uid).
// TODO v2: Source: tenant assignments (e.g. tenants/{tenantId}/assignments, where userId/candidateId == uid).
// TODO v2: Split upcoming vs past by startAt compared to now (upcoming: startAt >= now; past: startAt < now).
// TODO v2: Fields to map: assignmentId, jobTitle, siteName/clientName, startAt, endAt, locationShort/address, status.
function useMockAssignments(): { upcoming: WorkerAssignmentItem[]; past: WorkerAssignmentItem[] } {
  return useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const upcoming: WorkerAssignmentItem[] = [
      {
        assignmentId: 'mock-up-1',
        jobTitle: 'Warehouse Associate',
        siteName: 'Riverside Distribution',
        clientName: 'Riverside Logistics',
        startAt: now + 2 * day,
        endAt: now + 2 * day + 8 * 60 * 60 * 1000,
        locationShort: '123 Industrial Blvd, Riverside',
        status: 'scheduled',
      },
      {
        assignmentId: 'mock-up-2',
        jobTitle: 'Event Staff',
        siteName: 'Convention Center',
        startAt: now + 5 * day,
        endAt: now + 5 * day + 6 * 60 * 60 * 1000,
        locationShort: 'Downtown',
        status: 'confirmed',
      },
    ];
    const past: WorkerAssignmentItem[] = [
      {
        assignmentId: 'mock-past-1',
        jobTitle: 'Retail Associate',
        siteName: 'Mall Location',
        startAt: now - 3 * day,
        endAt: now - 3 * day + 8 * 60 * 60 * 1000,
        locationShort: 'Central Mall',
        status: 'completed',
      },
      {
        assignmentId: 'mock-past-2',
        jobTitle: 'Warehouse Associate',
        siteName: 'Riverside Distribution',
        startAt: now - 7 * day,
        locationShort: '123 Industrial Blvd',
        status: 'completed',
      },
    ];
    return { upcoming, past };
  }, []);
}

const WorkerAssignments: React.FC = () => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);

  const { upcoming, past } = useMockAssignments();

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        {/* Page Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              My Assignments
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your upcoming and past shifts.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" onClick={() => navigate('/c1/jobs-board')}>
              Find Work
            </Button>
            <Button variant="outlined" onClick={() => navigate('/c1/applications')}>
              View Applications
            </Button>
          </Stack>
        </Stack>

        {/* Tabs: Upcoming (default) / Past */}
        <WorkerAssignmentsTabs
          upcoming={upcoming}
          past={past}
          tabIndex={tabIndex}
          onTabChange={setTabIndex}
        />
      </Stack>
    </Box>
  );
};

export default WorkerAssignments;
