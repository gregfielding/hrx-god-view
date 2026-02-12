/**
 * Worker Assignments Tabs — Upcoming / Past with card list or empty state.
 * Spec: HRX / C1 Worker Assignments Page Spec — Segmented Control / Tabs
 */

import React from 'react';
import { Tabs, Tab, Box, Stack } from '@mui/material';
import type { WorkerAssignmentItem } from './WorkerAssignmentCard';
import WorkerAssignmentCard from './WorkerAssignmentCard';
import WorkerAssignmentsEmptyState from './WorkerAssignmentsEmptyState';

export interface WorkerAssignmentsTabsProps {
  upcoming: WorkerAssignmentItem[];
  past: WorkerAssignmentItem[];
  /** Controlled tab index: 0 = Upcoming, 1 = Past */
  tabIndex: number;
  onTabChange: (index: number) => void;
}

const WorkerAssignmentsTabs: React.FC<WorkerAssignmentsTabsProps> = ({
  upcoming,
  past,
  tabIndex,
  onTabChange,
}) => {
  return (
    <Box>
      <Tabs
        value={tabIndex}
        onChange={(_, v: number) => onTabChange(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="Upcoming" id="assignments-tab-upcoming" aria-controls="assignments-panel-upcoming" />
        <Tab label="Past" id="assignments-tab-past" aria-controls="assignments-panel-past" />
      </Tabs>

      <div
        role="tabpanel"
        id="assignments-panel-upcoming"
        aria-labelledby="assignments-tab-upcoming"
        hidden={tabIndex !== 0}
      >
        {tabIndex === 0 && (
          <Stack spacing={2}>
            {upcoming.length === 0 ? (
              <WorkerAssignmentsEmptyState variant="upcoming" />
            ) : (
              upcoming.map((a) => (
                <WorkerAssignmentCard
                  key={a.assignmentId}
                  assignment={a}
                  showViewDetails
                />
              ))
            )}
          </Stack>
        )}
      </div>

      <div
        role="tabpanel"
        id="assignments-panel-past"
        aria-labelledby="assignments-tab-past"
        hidden={tabIndex !== 1}
      >
        {tabIndex === 1 && (
          <Stack spacing={2}>
            {past.length === 0 ? (
              <WorkerAssignmentsEmptyState variant="past" />
            ) : (
              past.map((a) => (
                <WorkerAssignmentCard
                  key={a.assignmentId}
                  assignment={a}
                  showViewDetails
                />
              ))
            )}
          </Stack>
        )}
      </div>
    </Box>
  );
};

export default WorkerAssignmentsTabs;
