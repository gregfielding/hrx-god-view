/**
 * Worker Assignment Card — single assignment row for My Assignments.
 * Spec: Job Title → Company → Shift Date & Time → Location → Pay Rate → Status → View Details.
 * Entire card is clickable; View Details and optional Cancel Shift as secondary actions.
 */

import React from 'react';
import { Card, CardContent, CardActions, Typography, Stack, Chip, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT, getLanguage } from '../../../i18n';
import { formatHourlyPayRateForDisplay } from '../../../utils/hourlyPayDisplay';

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
  /** Open shift = a standing-crew assignment with no fixed daily times.
   *  The worker's schedule is managed by their C1 recruiter/manager, so
   *  the card shows a date range + explainer instead of clock times. */
  isOpenShift?: boolean;
  /** Raw open-shift end date (YYYY-MM-DD), or '' for ongoing/rolling.
   *  Also serves as the raw end date for any assignment (multi-day check). */
  openEndDate?: string;
  /** Raw assignment start date (YYYY-MM-DD). Compared with the raw end
   *  date to detect a genuine multi-day (spanning) assignment without
   *  false-positiving on overnight single-day shifts that cross midnight. */
  startDateRaw?: string;
  /** Job posting id — used by the calendar to route accepted/submitted
   *  shifts back to the public jobs-board posting. */
  jobPostId?: string;
  /** Job order id — used to look up the posting display name. */
  jobOrderId?: string;
  /** Posting / job-order display name (e.g. "NASCAR - San Diego"). Shown
   *  in the calendar tooltip as "<postTitle> - <jobTitle>". */
  postTitle?: string;
  /** Worksite city + state (e.g. "San Diego, CA") for the calendar tooltip. */
  cityState?: string;
  /**
   * Calendar coloring + click-routing bucket:
   *   - 'confirmed' → blue text, opens the assignment-details page
   *   - 'accepted'  → green text, opens the jobs-board posting (worker
   *                   still needs to Confirm/Decline)
   *   - 'submitted' → goldenrod text, opens the jobs-board posting
   *   - 'available' → grey text, an OTHER shift on a job order the worker
   *                   has engaged with; opens the jobs-board posting to apply
   * Derived in the page loader; absent items fall back to status.
   */
  calendarKind?: 'confirmed' | 'accepted' | 'submitted' | 'available';
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

/** Date only (no clock time): "Fri, Mar 13". 'YYYY-MM-DD' strings are
 *  parsed as LOCAL to avoid the UTC-midnight off-by-one. */
function formatDateOnly(value: number | string | undefined, locale = 'en-US'): string {
  if (value == null || value === '') return '';
  let d: Date;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, day] = value.slice(0, 10).split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = typeof value === 'number' ? new Date(value) : new Date(value);
  }
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
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
  // `scheduled` and `confirmed` both use label statusUpcoming — keep chip styling aligned
  if (status === 'scheduled' || status === 'confirmed' || status === 'completed') return 'success';
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
  const isOpenShift = assignment.isOpenShift === true;
  // Open shift: no clock times — show a date range (or "ongoing") + an
  // explainer instead of a start/end time the worker can't rely on.
  const openDateLine = isOpenShift
    ? `${formatDateOnly(assignment.startAt, locale)} – ${
        assignment.openEndDate
          ? formatDateOnly(assignment.openEndDate, locale)
          : t('assignments.openShiftOngoing')
      }`
    : '';
  // A genuine multi-day (spanning) assignment — the end date is a later
  // calendar day than the start. `formatDateAndTime` only renders the
  // start date + times, so a 2-day assignment used to read as a single
  // day. Compare the raw date fields (not the timestamps) so overnight
  // single-day shifts that cross midnight (startDate === endDate) are NOT
  // treated as multi-day. (Mark's "2-day shift shows 1 day" report.)
  const startDateRaw = (assignment.startDateRaw || '').slice(0, 10);
  const endDateRaw = (assignment.openEndDate || '').slice(0, 10);
  const isMultiDay = !isOpenShift && !!startDateRaw && !!endDateRaw && endDateRaw > startDateRaw;
  const dateTimeStr = isOpenShift
    ? `${openDateLine} • ${t('assignments.openShiftNoTimes')}`
    : isMultiDay
      ? `${formatDateOnly(assignment.startAt, locale)} – ${formatDateOnly(endDateRaw, locale)}`
      : formatDateAndTime(assignment.startAt, assignment.endAt, locale);
  // Past-shift label fix: a confirmed/scheduled shift that lands in the
  // Past tab (isUpcoming === false) was showing the green "Upcoming"
  // chip — the worker already worked it. Relabel those as "Completed".
  // Terminal statuses (cancelled / no-show / completed) keep their own
  // label + color.
  const isPastNonTerminal =
    !isUpcoming && (assignment.status === 'scheduled' || assignment.status === 'confirmed');
  const statusKey = isPastNonTerminal ? 'assignments.statusCompleted' : getStatusKey(assignment.status);
  const chipColor: 'default' | 'success' | 'error' | 'warning' = isPastNonTerminal
    ? 'success'
    : getStatusChipColor(assignment.status);
  const payStr = formatHourlyPayRateForDisplay(assignment.payRate) ?? '';
  const locationLine = formatLocationLine(assignment);

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

  return (
    <Card
      variant="outlined"
      onClick={handleCardClick}
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
        cursor: 'pointer',
      }}
    >
      <CardContent sx={{ pb: showViewDetails ? 0 : 2 }}>
        <Stack spacing={1.25}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {assignment.jobTitle}
          </Typography>
          {/* Company/client name intentionally hidden on the worker-facing
              card — we don't expose the staffing client's business name
              (e.g. "Venue Smart, LLC") to workers. */}
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {dateTimeStr}
          </Typography>
          {isOpenShift && (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                fontStyle: 'italic',
                bgcolor: 'action.hover',
                borderRadius: 1,
                px: 1,
                py: 0.75,
              }}
            >
              {t('assignments.openShiftExplainer')}
            </Typography>
          )}
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
        // Only "View Details" — the chevron IconButton and the
        // "Cancel Shift" button were removed per product: the whole card
        // is already clickable, and cancellation should go through the
        // assignment-details page, not a quick destructive action here.
        <CardActions sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 0.5, px: 2, pt: 0, pb: 1.5 }} onClick={(e) => e.stopPropagation()}>
          <Button size="small" variant="text" onClick={handleViewDetails}>
            {t('assignments.viewDetails')} →
          </Button>
        </CardActions>
      )}
    </Card>
  );
};

export default WorkerAssignmentCard;
