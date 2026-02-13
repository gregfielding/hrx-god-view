/**
 * Worker Assignment Card — single assignment row for My Assignments.
 * Spec: HRX / C1 Worker Assignments Page Spec — Assignment Card UI
 */

import React from 'react';
import { Card, CardContent, CardActions, Typography, Stack, Chip, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export type AssignmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show';

export interface WorkerAssignmentItem {
  assignmentId: string;
  jobTitle: string;
  siteName?: string;
  clientName?: string;
  startAt: number | string; // timestamp or ISO string
  endAt?: number | string;
  locationShort?: string;
  address?: string;
  status: AssignmentStatus;
}

function formatDateAndTime(startAt: number | string, endAt?: number | string): string {
  const start = typeof startAt === 'number' ? new Date(startAt) : new Date(startAt);
  const day = start.toLocaleDateString('en-US', { weekday: 'short' });
  const date = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (endAt) {
    const end = typeof endAt === 'number' ? new Date(endAt) : new Date(endAt);
    const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${day}, ${date} · ${time} – ${endTime}`;
  }
  return `${day}, ${date} at ${time}`;
}

function getStatusChip(status: AssignmentStatus): { label: string; color: 'default' | 'primary' | 'success' | 'error' | 'warning' } {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', color: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', color: 'error' };
    case 'completed':
      return { label: 'Completed', color: 'success' };
    case 'no-show':
      return { label: 'No-show', color: 'error' };
    case 'scheduled':
    default:
      return { label: 'Scheduled', color: 'default' };
  }
}

export interface WorkerAssignmentCardProps {
  assignment: WorkerAssignmentItem;
  /** Show primary "View details" CTA. When false (e.g. past tab without detail), hide or omit. */
  showViewDetails?: boolean;
}

const WorkerAssignmentCard: React.FC<WorkerAssignmentCardProps> = ({
  assignment,
  showViewDetails = true,
}) => {
  const navigate = useNavigate();
  const clientSite = assignment.siteName || assignment.clientName || '';
  const location = assignment.locationShort || assignment.address || '';
  const dateTimeStr = formatDateAndTime(assignment.startAt, assignment.endAt);
  const chip = getStatusChip(assignment.status);

  const handleViewDetails = () => {
    navigate(`/c1/workers/assignments/${assignment.assignmentId}`);
  };

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ pb: showViewDetails ? 0 : 2 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {assignment.jobTitle}
            </Typography>
            <Chip label={chip.label} color={chip.color} size="small" />
          </Stack>
          {clientSite && (
            <Typography variant="body2" color="text.secondary">
              {clientSite}
            </Typography>
          )}
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {dateTimeStr}
          </Typography>
          {location && (
            <Typography variant="body2" color="text.secondary">
              {location}
            </Typography>
          )}
        </Stack>
      </CardContent>
      {showViewDetails && (
        <CardActions sx={{ justifyContent: 'flex-end', px: 2, pt: 0, pb: 1.5 }}>
          <Button size="small" variant="text" onClick={handleViewDetails}>
            View details
          </Button>
        </CardActions>
      )}
    </Card>
  );
};

export default WorkerAssignmentCard;
