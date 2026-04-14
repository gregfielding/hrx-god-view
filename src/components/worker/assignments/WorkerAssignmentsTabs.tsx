/**
 * Worker Assignments Tabs — Upcoming / Calendar / Past with card list or empty state.
 * Spec: HRX / C1 Worker Assignments Page Spec — Segmented Control / Tabs
 */

import React from 'react';
import { Tabs, Tab, Box, Stack } from '@mui/material';
import { useT } from '../../../i18n';
import type { WorkerAssignmentItem } from './WorkerAssignmentCard';
import WorkerAssignmentCard from './WorkerAssignmentCard';
import WorkerAssignmentsEmptyState from './WorkerAssignmentsEmptyState';
import WorkerAssignmentsCalendar from './WorkerAssignmentsCalendar';

export interface WorkerAssignmentsTabsProps {
  upcoming: WorkerAssignmentItem[];
  past: WorkerAssignmentItem[];
  /** Controlled tab index: 0 = Upcoming, 1 = Calendar, 2 = Past */
  tabIndex: number;
  onTabChange: (index: number) => void;
  /** When provided, upcoming cards show Cancel Shift and call this on confirm */
  onCancelShift?: (assignment: WorkerAssignmentItem) => void;
}

const WorkerAssignmentsTabs: React.FC<WorkerAssignmentsTabsProps> = ({
  upcoming,
  past,
  tabIndex,
  onTabChange,
  onCancelShift,
}) => {
  const t = useT();
  const allForCalendar = React.useMemo(() => {
    const merged = [...upcoming, ...past];
    merged.sort((a, b) => {
      const at = typeof a.startAt === 'number' ? a.startAt : new Date(a.startAt).getTime();
      const bt = typeof b.startAt === 'number' ? b.startAt : new Date(b.startAt).getTime();
      return at - bt;
    });
    return merged;
  }, [upcoming, past]);

  return (
    <Box>
      <Tabs
        value={tabIndex}
        onChange={(_, v: number) => onTabChange(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label={t('assignments.tabUpcoming')} id="assignments-tab-upcoming" aria-controls="assignments-panel-upcoming" />
        <Tab label={t('assignments.tabCalendar')} id="assignments-tab-calendar" aria-controls="assignments-panel-calendar" />
        <Tab label={t('assignments.tabPast')} id="assignments-tab-past" aria-controls="assignments-panel-past" />
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
                  isUpcoming
                  onCancelShift={onCancelShift}
                />
              ))
            )}
          </Stack>
        )}
      </div>

      <div
        role="tabpanel"
        id="assignments-panel-calendar"
        aria-labelledby="assignments-tab-calendar"
        hidden={tabIndex !== 1}
      >
        {tabIndex === 1 && <WorkerAssignmentsCalendar assignments={allForCalendar} />}
      </div>

      <div
        role="tabpanel"
        id="assignments-panel-past"
        aria-labelledby="assignments-tab-past"
        hidden={tabIndex !== 2}
      >
        {tabIndex === 2 && (
          <Stack spacing={2}>
            {past.length === 0 ? (
              <WorkerAssignmentsEmptyState variant="past" />
            ) : (
              past.map((a) => (
                <WorkerAssignmentCard
                  key={a.assignmentId}
                  assignment={a}
                  showViewDetails
                  isUpcoming={false}
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
