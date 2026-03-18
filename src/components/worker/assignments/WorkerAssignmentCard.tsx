/**
 * Worker Assignment Card — single assignment row for My Assignments.
 * Spec: Job Title → Company → Shift Date & Time → Location → Pay Rate → Status → View Details.
 * Entire card is clickable; View Details and optional Cancel Shift as secondary actions.
 */

import React from 'react';
import { Card, CardContent, CardActions, Typography, Stack, Chip, Button, IconButton } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { useT, getLanguage } from '../../../i18n';

export type AssignmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show';

export interface WorkerAssignmentItem {
  assignmentId: string;
  jobTitle: string;
  /** Worksite / location nickname (venue name) */
  siteName?: string;
  /** Company name (e.g. Parker Plastics) */
  clientName?: string;
  startAt: number | string; // timestamp or ISO string
  endAt?: number | string;
  /** Short location (e.g. city, state) */
  locationShort?: string;
  /** Full street address when available (venue address) */
  address?: string;
  /** Pay rate for display (e.g. 18.5 = $18.50/hr) */
  payRate?: number;
  status: AssignmentStatus;
}

/** Format: Fri, Mar 13 • 1:00 PM – 9:00 PM */
function formatDateAndTime(startAt: number | string, endAt?: number | string, locale = 'en-US'): string {
  const start = typeof startAt === 'number' ? new Date(startAt) : new Date(startAt);
  const dayDate = start.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (endAt) {
    const end = typeof endAt === 'number' ? new Date(endAt) : new Date(endAt);
    const endTime = end.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dayDate} • ${time} – ${endTime}`;
  }
  return `${dayDate} • ${time}`;
}

/** Single location line: if both venue name and address exist, combine; otherwise show whichever exists. */
function formatLocationLine(item: WorkerAssignmentItem): string | undefined {
  const venueName = item.siteName;
  const venueAddress = item.address || item.locationShort;
  if (venueName && venueAddress) return `${venueName}, ${venueAddress}`;
  return venueName || venueAddress;
}

function getStatusKey(status: AssignmentStatus): string {
  switch (status) {
    case 'confirmed':
    case 'scheduled':
      return 'assignments.statusUpcoming';
    case 'cancelled':
      return 'assignments.statusCancelled';
    case 'completed':
      return 'assignments.statusCompleted';
    case 'no-show':
      return 'assignments.statusMissed';
    default:
      return 'assignments.statusUpcoming';
  }
}

function getStatusChipColor(status: AssignmentStatus): 'default' | 'success' | 'error' | 'warning' {
  if (status === 'confirmed' || status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'no-show') return 'error';
  return 'default';
}

export interface WorkerAssignmentCardProps {
  assignment: WorkerAssignmentItem;
  /** Show View details and optional Cancel shift. When false, hide actions. */
  showViewDetails?: boolean;
  /** When true (upcoming tab), show Cancel Shift when status allows. */
  isUpcoming?: boolean;
  /** Called when worker cancels shift; card does not navigate. */
  onCancelShift?: (assignment: WorkerAssignmentItem) => void;
}

function formatPayRate(payRate: number | undefined): string {
  if (payRate == null || Number.isNaN(payRate)) return '';
  return `$${Number(payRate).toFixed(2)}/hr`;
}

const localeForLang = (lang: string) => (lang === 'es' ? 'es' : 'en-US');

const WorkerAssignmentCard: React.FC<WorkerAssignmentCardProps> = ({
  assignment,
  showViewDetails = true,
  isUpcoming = false,
  onCancelShift,
}) => {
  const navigate = useNavigate();
  const t = useT();
  const locale = localeForLang(getLanguage());
  const dateTimeStr = formatDateAndTime(assignment.startAt, assignment.endAt, locale);
  const statusKey = getStatusKey(assignment.status);
  const chipColor = getStatusChipColor(assignment.status);
  const payStr = formatPayRate(assignment.payRate);
  const locationLine = formatLocationLine(assignment);

  const canCancelShift = isUpcoming && (assignment.status === 'scheduled' || assignment.status === 'confirmed') && !!onCancelShift;

  const openAssignmentDetails = (source: 'card' | 'view_details' | 'chevron') => {
    const route = `/c1/workers/assignments/${assignment.assignmentId}`;
    console.debug('[WorkerAssignmentsNav] navigate', {
      source,
      route,
      params: { assignmentId: assignment.assignmentId },
    });
    navigate(route);
  };

  const handleCardClick = () => {
    openAssignmentDetails('card');
  };

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    openAssignmentDetails('view_details');
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openAssignmentDetails('chevron');
  };

  const handleCancelShift = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancelShift?.(assignment);
  };

  return (
    <Card
      variant="outlined"
      onClick={handleCardClick}
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
        cursor: 'pointer',
        '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' },
      }}
    >
      <CardContent sx={{ pb: showViewDetails ? 0 : 2 }}>
        <Stack spacing={1.25}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {assignment.jobTitle}
          </Typography>
          {assignment.clientName && (
            <Typography variant="body2" color="text.secondary">
              {assignment.clientName}
            </Typography>
          )}
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {dateTimeStr}
          </Typography>
          {locationLine && (
            <Typography variant="body2" color="text.secondary">
              {locationLine}
            </Typography>
          )}
          {payStr && (
            <Typography variant="body1" sx={{ fontWeight: 600, color: 'primary.main' }}>
              {payStr}
            </Typography>
          )}
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <Chip label={t(statusKey)} color={chipColor} size="small" onClick={(e) => e.stopPropagation()} />
          </Stack>
        </Stack>
      </CardContent>
      {showViewDetails && (
        <CardActions sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 0.5, px: 2, pt: 0, pb: 1.5 }} onClick={(e) => e.stopPropagation()}>
          <IconButton
            size="small"
            aria-label="Open assignment details"
            onClick={handleChevronClick}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
          <Button size="small" variant="text" onClick={handleViewDetails}>
            {t('assignments.viewDetails')} →
          </Button>
          {canCancelShift && (
            <Button size="small" variant="text" color="error" onClick={handleCancelShift}>
              {t('assignments.cancelShift')}
            </Button>
          )}
        </CardActions>
      )}
    </Card>
  );
};

export default WorkerAssignmentCard;
