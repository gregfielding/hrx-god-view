import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Stack,
  Chip,
  Button,
  Alert,
} from '@mui/material';
import {
  CalendarMonth as CalendarIcon,
  AccessTime as TimeIcon,
  AttachMoney as AttachMoneyIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { JobBoardShift } from '../services/recruiter/jobsBoardService';
import { formatWeeklyScheduleSummary } from '../utils/weeklySchedule';
import { formatDateScheduleSummary, getDateScheduleEntriesWithHours, formatDateScheduleEntry } from '../utils/dateSchedule';
import { getShiftDisplayText } from '../utils/shiftI18n';
import { useT } from '../i18n';

interface ShiftSelectorProps {
  shifts: JobBoardShift[];
  selectedShifts?: string[]; // Deprecated - kept for backwards compatibility
  onToggleShift?: (shiftId: string) => void; // Deprecated
  onApplyToShift?: (shiftId: string, date?: string) => void; // Callback for apply; for GIG with dateSchedule, date is YYYY-MM-DD for day-by-day apply
  appliedShifts?: string[]; // Array of shift IDs the user has already applied to
  shiftStatuses?: Record<string, string>; // Map of shiftId -> application status
  onConfirmShift?: (shiftId: string) => void; // Callback for accepting a shift assignment
  onDeclineShift?: (shiftId: string) => void; // Callback for declining a shift assignment
  /** Cancel/withdraw application for this shift (or for this day when date is provided) */
  onCancelApplication?: (shiftId: string, date?: string) => void;
  disabled?: boolean;
  jobPostId?: string; // For building application URLs
  tenantId?: string; // For building application URLs
  /** When set, shift title/description use _i18n[language] for display (e.g. guest or worker language) */
  language?: 'en' | 'es';
}

const ShiftSelector: React.FC<ShiftSelectorProps> = ({
  shifts,
  selectedShifts = [],
  onToggleShift,
  onApplyToShift,
  appliedShifts = [],
  shiftStatuses = {},
  onConfirmShift,
  onDeclineShift,
  onCancelApplication,
  disabled = false,
  jobPostId,
  tenantId,
  language = 'en',
}) => {
  const t = useT();
  const formatTime = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const isOvernight = (start: string, end: string) => {
    if (!start || !end) return false;
    // Lex compare works for HH:mm
    return end < start;
  };

  const formatDate = (dateString: string) => {
    try {
      // Parse date string in local time to avoid timezone issues
      // If it's in YYYY-MM-DD format, parse it as local date
      if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day); // month is 0-indexed
        return format(date, 'EEE, MMM dd');
      }
      // Otherwise, use the original parsing
      return format(new Date(dateString), 'EEE, MMM dd');
    } catch {
      return dateString;
    }
  };

  const formatDateRange = (start: string, end: string) => {
    if (!start) return 'Date TBD';
    if (!end || end === start) return formatDate(start);
    // Slightly more compact for ranges: "Mon, Jan 08 – Fri, Jan 12"
    return `${formatDate(start)} – ${formatDate(end)}`;
  };

  /** Compute shift length in hours from start/end time strings (HH:mm). */
  const shiftLengthHours = (startTime: string, endTime: string): number | null => {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMins = (sh ?? 0) * 60 + (sm ?? 0);
    let endMins = (eh ?? 0) * 60 + (em ?? 0);
    if (endMins < startMins) endMins += 24 * 60;
    const mins = endMins - startMins;
    const hrs = mins / 60;
    return Number.isFinite(hrs) ? Math.round(hrs * 10) / 10 : null;
  };

  if (!shifts || shifts.length === 0) {
    return null;
  }

  // Today in local YYYY-MM-DD (shifts before today are disabled; today is still applicable until midnight)
  const todayISO = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();

  const handleApply = (shiftId: string, date?: string) => {
    if (onApplyToShift) {
      onApplyToShift(shiftId, date);
    } else if (jobPostId && tenantId) {
      const params = new URLSearchParams({ shiftId });
      if (date) params.set('applyDate', date);
      window.location.href = `/apply/${tenantId}/${jobPostId}?${params.toString()}`;
    }
  };

  /** For GIG shifts with dateSchedule, we render one row per day (each with its own Apply/Accept/Decline). */
  type RowItem = { type: 'shift'; shift: JobBoardShift } | { type: 'day'; shift: JobBoardShift; date: string; dayLabel: string; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number };
  const rows: RowItem[] = [];
  shifts.forEach((shift) => {
    const dateSchedule = (shift as any).dateSchedule;
    const hasDateSchedule = dateSchedule && shift.endDate && shift.endDate !== shift.shiftDate;
    const dayEntries = hasDateSchedule
      ? getDateScheduleEntriesWithHours(dateSchedule, shift.shiftDate, shift.endDate)
      : [];
    if (dayEntries.length > 0) {
      dayEntries.forEach((entry) => {
        rows.push({
          type: 'day',
          shift,
          date: entry.date,
          dayLabel: entry.dayLabel,
          startTime: entry.startTime,
          endTime: entry.endTime,
          workersNeeded: entry.workersNeeded,
          overstaff: entry.overstaff,
        });
      });
    } else {
      rows.push({ type: 'shift', shift });
    }
  });

  const renderRow = (item: RowItem) => {
    const { shift } = item;
    const rowKey = item.type === 'day' ? `${shift.shiftId}__${item.date}` : shift.shiftId;
    const shiftDateISO = item.type === 'day'
      ? item.date
      : (() => {
          const d = (shift as any).shiftDate?.toDate ? (shift as any).shiftDate.toDate() : new Date((shift as any).shiftDate);
          if (!d || isNaN(d.getTime())) return '';
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
    const isPast = shiftDateISO < todayISO;
    const hasApplied = appliedShifts.includes(shift.shiftId) || appliedShifts.includes(rowKey);
    const shiftStatus = shiftStatuses[rowKey] || shiftStatuses[shift.shiftId] || (hasApplied ? 'submitted' : null);
    const isOffered = shiftStatus === 'accepted';
    const isConfirmed = shiftStatus === 'confirmed';
    const isFull = shift.spotsRemaining <= 0;

    const dateLabel = item.type === 'day' ? item.dayLabel : null;
    const timeLabel = item.type === 'day' ? formatDateScheduleEntry(item.date, item.startTime, item.endTime) : null;

    return (
      <Card
        key={rowKey}
        variant="outlined"
        sx={{
          border: '1px solid',
          borderColor: isPast ? 'divider' : isConfirmed ? '#4CAF50' : isOffered ? '#2196F3' : hasApplied ? '#FFC700' : 'divider',
          bgcolor: isPast ? 'action.hover' : isConfirmed ? '#E8F5E9' : isOffered ? '#E3F2FD' : hasApplied ? '#FFF9E6' : 'background.paper',
          opacity: isFull && !isPast ? 0.6 : isPast ? 0.85 : 1,
          transition: 'all 0.2s ease',
          '&:hover': {
            bgcolor: disabled || isFull || isPast ? undefined : isConfirmed ? '#C8E6C9' : isOffered ? '#BBDEFB' : hasApplied ? '#FFF4CC' : 'grey.50',
            borderColor: disabled || isFull || isPast ? undefined : isConfirmed ? '#4CAF50' : isOffered ? '#2196F3' : hasApplied ? '#E6B300' : 'primary.main',
          },
        }}
      >
        <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {getShiftDisplayText(shift as unknown as Record<string, unknown>, 'shiftTitle', language) || shift.shiftTitle}
                {item.type === 'day' && (
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
                    — {dateLabel}
                  </Typography>
                )}
              </Typography>

              <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 1 }}>
                {item.type === 'day' ? (
                  <>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TimeIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        {timeLabel}
                        {item.startTime && item.endTime && (() => {
                          const hrs = shiftLengthHours(item.startTime, item.endTime);
                          return hrs != null ? ` • ${hrs} hrs` : '';
                        })()}
                      </Typography>
                    </Stack>
                    {(() => {
                      const workers = item.workersNeeded ?? 1;
                      const over = item.overstaff ?? 0;
                      const total = workers + over;
                      if (total < 1) return null;
                      return (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${total} spot${total !== 1 ? 's' : ''} left`}
                        />
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <CalendarIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        {shift.endDate && shift.endDate !== shift.shiftDate
                          ? formatDateRange(shift.shiftDate, shift.endDate)
                          : formatDate(shift.shiftDate)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TimeIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        {(shift as any).dateSchedule && shift.endDate && shift.endDate !== shift.shiftDate
                          ? formatDateScheduleSummary((shift as any).dateSchedule, shift.shiftDate, shift.endDate) || `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`
                          : shift.weeklySchedule && shift.endDate && shift.endDate !== shift.shiftDate
                            ? formatWeeklyScheduleSummary(shift.weeklySchedule) || `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`
                            : `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}${isOvernight(shift.startTime, shift.endTime) ? ' (+1 day)' : ''}`}
                        {shift.startTime && shift.endTime && (() => {
                          const hrs = shiftLengthHours(shift.startTime, shift.endTime);
                          return hrs != null ? ` • ${hrs} hrs` : '';
                        })()}
                      </Typography>
                    </Stack>
                  </>
                )}

                {shift.payRate && (
                  <Chip
                    icon={<AttachMoneyIcon />}
                    label={`$${shift.payRate}/hr`}
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                )}
                {shift.showStaffNeeded && (
                  <Chip
                    label={`${shift.spotsRemaining} spots left`}
                    size="small"
                    color={shift.spotsRemaining <= 2 ? 'warning' : 'default'}
                    variant="outlined"
                  />
                )}
              </Stack>

              {item.type === 'shift' && (getShiftDisplayText(shift as unknown as Record<string, unknown>, 'shiftDescription', language) || shift.shiftDescription) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, display: 'block', lineHeight: 1.5 }}>
                  {getShiftDisplayText(shift as unknown as Record<string, unknown>, 'shiftDescription', language) || shift.shiftDescription}
                </Typography>
              )}
            </Box>

            <Box sx={{ ml: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {isConfirmed ? (
                <Button variant="contained" disabled startIcon={<LockIcon />} sx={{ minWidth: 140, backgroundColor: '#4CAF50 !important', color: '#fff', fontWeight: 600, '&.Mui-disabled': { backgroundColor: '#4CAF50 !important', color: '#fff', opacity: 1 } }}>
                  Confirmed
                </Button>
              ) : isOffered ? (
                <>
                  <Button variant="contained" onClick={() => onConfirmShift?.(shift.shiftId)} sx={{ minWidth: 140, backgroundColor: '#4CAF50', color: '#fff', fontWeight: 600, '&:hover': { backgroundColor: '#45a049' } }}>
                    Click to Accept
                  </Button>
                  <Button variant="contained" color="error" onClick={() => onDeclineShift?.(shift.shiftId)} sx={{ minWidth: 140, fontWeight: 600 }}>
                    Decline this Job
                  </Button>
                </>
              ) : hasApplied ? (
                <Stack direction="column" alignItems="flex-start" spacing={0.75} sx={{ minWidth: 140 }}>
                  <Button variant="contained" disabled sx={{ minWidth: 140, backgroundColor: '#FFC700 !important', color: '#000', fontWeight: 600, '&.Mui-disabled': { backgroundColor: '#FFC700 !important', color: '#000', opacity: 1 }, cursor: 'default', pointerEvents: 'none' }}>
                    Application Submitted
                  </Button>
                  {onCancelApplication && (
                    <Button
                      variant="text"
                      size="small"
                      color="error"
                      onClick={() => onCancelApplication(shift.shiftId, item.type === 'day' ? item.date : undefined)}
                      sx={{ minWidth: 140, fontSize: '0.8rem', textTransform: 'none' }}
                    >
                      Cancel
                    </Button>
                  )}
                </Stack>
              ) : isPast ? (
                <Button variant="outlined" disabled sx={{ minWidth: 140, color: 'text.secondary' }}>
                  Past
                </Button>
              ) : (
                <Button variant="contained" disabled={disabled || isFull} onClick={() => handleApply(shift.shiftId, item.type === 'day' ? item.date : undefined)} sx={{ minWidth: 140 }}>
                  {isFull ? 'Full' : 'Apply'}
                </Button>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>
    );
  };

  const getShiftDateISO = (item: RowItem): string => {
    if (item.type === 'day') return item.date;
    const shift = item.shift;
    const d = (shift as any).shiftDate?.toDate ? (shift as any).shiftDate.toDate() : new Date((shift as any).shiftDate);
    if (!d || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const firstUpcomingIndex = rows.findIndex((item) => getShiftDateISO(item) >= todayISO);

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Available Shifts
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {t('apply.availableShiftsInstruction')}
      </Typography>

      <Stack spacing={1} sx={{ mt: 2 }}>
        {rows.map((item, index) => (
          <Box key={item.type === 'day' ? `${item.shift.shiftId}__${item.date}` : item.shift.shiftId}>
            {index === firstUpcomingIndex && firstUpcomingIndex >= 0 && (
              <Typography
                component="span"
                variant="caption"
                sx={{
                  display: 'block',
                  fontWeight: 600,
                  color: 'text.secondary',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  mb: 1,
                  mt: index === 0 ? 0 : 2,
                  pt: index === 0 ? 0 : 1.5,
                  borderTop: index === 0 ? 0 : 1,
                  borderColor: 'divider',
                  fontSize: '0.75rem',
                }}
              >
                Next Available Shift
              </Typography>
            )}
            {renderRow(item)}
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

export default ShiftSelector;

