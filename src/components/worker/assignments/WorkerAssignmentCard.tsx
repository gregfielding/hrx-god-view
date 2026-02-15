/**
 * Worker Assignment Card — single assignment row for My Assignments.
 * Spec: HRX / C1 Worker Assignments Page Spec — Assignment Card UI
 */

import React, { useEffect } from 'react';
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
  /** Worksite / location nickname */
  siteName?: string;
  /** Company name (e.g. Parker Plastics) */
  clientName?: string;
  startAt: number | string; // timestamp or ISO string
  endAt?: number | string;
  /** Short location (e.g. city, state) */
  locationShort?: string;
  /** Full street address when available */
  address?: string;
  /** Pay rate for display (e.g. 18.5 = $18.50/hr) */
  payRate?: number;
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

function formatPayRate(payRate: number | undefined): string {
  if (payRate == null || Number.isNaN(payRate)) return '';
  return `$${Number(payRate).toFixed(2)}/hr`;
}

const WorkerAssignmentCard: React.FC<WorkerAssignmentCardProps> = ({
  assignment,
  showViewDetails = true,
}) => {
  const navigate = useNavigate();
  const dateTimeStr = formatDateAndTime(assignment.startAt, assignment.endAt);
  const chip = getStatusChip(assignment.status);
  const payStr = formatPayRate(assignment.payRate);

  useEffect(() => {
    if (typeof console !== 'undefined' && console.log) {
      console.log('[My Assignments] assignment (card prop)', assignment);
    }
  }, [assignment]);

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
        <Stack spacing={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {assignment.jobTitle}
            </Typography>
            <Chip label={chip.label} color={chip.color} size="small" />
          </Stack>
          {assignment.clientName && (
            <Typography variant="body2" color="text.secondary">
              {assignment.clientName}
            </Typography>
          )}
          {assignment.siteName && (
            <Typography variant="body2" color="text.secondary">
              {assignment.siteName}
            </Typography>
          )}
          {(assignment.address || assignment.locationShort) && (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: assignment.address ? 'normal' : undefined }}>
              {assignment.address || assignment.locationShort}
            </Typography>
          )}
          {payStr && (
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {payStr}
            </Typography>
          )}
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {dateTimeStr}
          </Typography>
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
