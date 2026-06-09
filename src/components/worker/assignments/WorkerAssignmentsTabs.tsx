/**
 * Worker Assignments view panels — Calendar / List / Archive.
 * The view switcher itself lives in the page header (icon button group);
 * this component just renders the active panel for `tabIndex`:
 *   0 = Calendar, 1 = List (upcoming), 2 = Archive (past).
 */

import React from 'react';
import { Box, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useT } from '../../../i18n';
import type { WorkerAssignmentItem } from './WorkerAssignmentCard';
import WorkerAssignmentCard from './WorkerAssignmentCard';
import WorkerAssignmentsEmptyState from './WorkerAssignmentsEmptyState';
import WorkerAssignmentsCalendar from './WorkerAssignmentsCalendar';
import UserApplications from '../../../pages/UserApplications';

export interface WorkerAssignmentsTabsProps {
  upcoming: WorkerAssignmentItem[];
  past: WorkerAssignmentItem[];
  /** Controlled view index: 0 = Calendar, 1 = List, 2 = Archive */
  tabIndex: number;
  /** When provided, upcoming cards show Cancel Shift and call this on confirm */
  onCancelShift?: (assignment: WorkerAssignmentItem) => void;
  /**
   * Calendar feed (confirmed/accepted assignments + submitted
   * applications + discoverable "available" shifts). When omitted, the
   * calendar falls back to the assignment-only upcoming+past merge.
   */
  calendarItems?: WorkerAssignmentItem[];
}

const WorkerAssignmentsTabs: React.FC<WorkerAssignmentsTabsProps> = ({
  upcoming,
  past,
  tabIndex,
  onCancelShift,
  calendarItems,
}) => {
  const t = useT();
  // Archive sub-toggle: past assignments (default) vs. all applications.
  const [archiveView, setArchiveView] = React.useState<'assignments' | 'applications'>('assignments');
  const allForCalendar = React.useMemo(() => {
    const merged = calendarItems ?? [...upcoming, ...past];
    merged.sort((a, b) => {
      const at = typeof a.startAt === 'number' ? a.startAt : new Date(a.startAt).getTime();
      const bt = typeof b.startAt === 'number' ? b.startAt : new Date(b.startAt).getTime();
      return at - bt;
    });
    return merged;
  }, [calendarItems, upcoming, past]);

  return (
    <Box>
      {/* 0 = Calendar */}
      <div role="tabpanel" id="assignments-panel-calendar" hidden={tabIndex !== 0}>
        {tabIndex === 0 && <WorkerAssignmentsCalendar assignments={allForCalendar} />}
      </div>

      {/* 1 = List (upcoming) */}
      <div role="tabpanel" id="assignments-panel-upcoming" hidden={tabIndex !== 1}>
        {tabIndex === 1 && (
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

      {/* 2 = Archive (past assignments + applications sub-toggle) */}
      <div role="tabpanel" id="assignments-panel-past" hidden={tabIndex !== 2}>
        {tabIndex === 2 && (
          <Stack spacing={2}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={archiveView}
              onChange={(_, v: 'assignments' | 'applications' | null) => {
                if (v) setArchiveView(v);
              }}
              aria-label={t('assignments.archiveToggle')}
            >
              <ToggleButton value="assignments">{t('assignments.archiveAssignments')}</ToggleButton>
              <ToggleButton value="applications">{t('assignments.archiveApplications')}</ToggleButton>
            </ToggleButtonGroup>

            {archiveView === 'applications' ? (
              <UserApplications embedded />
            ) : past.length === 0 ? (
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
