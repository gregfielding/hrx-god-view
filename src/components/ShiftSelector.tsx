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
} from '@mui/icons-material';
import { format } from 'date-fns';
import { JobBoardShift } from '../services/recruiter/jobsBoardService';

interface ShiftSelectorProps {
  shifts: JobBoardShift[];
  selectedShifts?: string[]; // Deprecated - kept for backwards compatibility
  onToggleShift?: (shiftId: string) => void; // Deprecated
  onApplyToShift?: (shiftId: string) => void; // New callback for individual shift applications
  appliedShifts?: string[]; // Array of shift IDs the user has already applied to
  disabled?: boolean;
  jobPostId?: string; // For building application URLs
  tenantId?: string; // For building application URLs
}

const ShiftSelector: React.FC<ShiftSelectorProps> = ({
  shifts,
  selectedShifts = [],
  onToggleShift,
  onApplyToShift,
  appliedShifts = [],
  disabled = false,
  jobPostId,
  tenantId,
}) => {
  const formatTime = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
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

  if (!shifts || shifts.length === 0) {
    return null;
  }

  const handleApply = (shiftId: string) => {
    if (onApplyToShift) {
      onApplyToShift(shiftId);
    } else if (jobPostId && tenantId) {
      // Fallback: navigate to application page with shiftId
      window.location.href = `/apply/${tenantId}/${jobPostId}?shiftId=${shiftId}`;
    }
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Available Shifts
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Each shift is a separate application. Click "Apply" on the shifts you want to apply for.
      </Typography>

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {shifts.map((shift) => {
          const hasApplied = appliedShifts.includes(shift.shiftId);
          const isFull = shift.spotsRemaining <= 0;
          const isLowAvailability = shift.spotsRemaining > 0 && shift.spotsRemaining <= 2;

          return (
            <Card
              key={shift.shiftId}
              variant="outlined"
              sx={{
                border: '1px solid',
                borderColor: hasApplied ? '#FFC700' : 'divider',
                bgcolor: hasApplied ? '#FFF9E6' : 'background.paper', // Light yellow background
                opacity: isFull ? 0.6 : 1,
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: disabled || isFull ? undefined : hasApplied ? '#FFF4CC' : 'grey.50', // Slightly darker yellow on hover
                  borderColor: disabled || isFull ? undefined : hasApplied ? '#E6B300' : 'primary.main',
                },
              }}
            >
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box sx={{ flex: 1 }}>
                    {/* Shift Title */}
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      {shift.shiftTitle}
                    </Typography>

                    {/* Shift Details */}
                    <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 1 }}>
                      {/* Date */}
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <CalendarIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                          {formatDate(shift.shiftDate)}
                        </Typography>
                      </Stack>

                      {/* Time */}
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <TimeIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                          {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                        </Typography>
                      </Stack>

                      {/* Pay Rate (if available) */}
                      {shift.payRate && (
                        <Chip
                          icon={<AttachMoneyIcon />}
                          label={`$${shift.payRate}/hr`}
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}

                      {/* Staff Needed (conditional) */}
                      {shift.showStaffNeeded && (
                        <Chip
                          label={`${shift.spotsRemaining} of ${shift.staffNeeded} spots available`}
                          size="small"
                          color={shift.spotsRemaining <= 2 ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      )}
                    </Stack>

                    {/* Shift Description (if available) */}
                    {shift.shiftDescription && (
                      <Typography 
                        variant="body2" 
                        color="text.secondary" 
                        sx={{ 
                          mt: 1.5, 
                          display: 'block',
                          lineHeight: 1.5
                        }}
                      >
                        {shift.shiftDescription}
                      </Typography>
                    )}
                  </Box>

                  {/* Apply Button */}
                  <Box sx={{ ml: 2 }}>
                    {hasApplied ? (
                      <Button
                        variant="contained"
                        disabled={false}
                        sx={{
                          minWidth: 120,
                          backgroundColor: '#FFC700 !important',
                          color: '#000',
                          fontWeight: 600,
                          '&:hover': {
                            backgroundColor: '#E6B300 !important',
                          },
                          '&.Mui-disabled': {
                            backgroundColor: '#FFC700 !important',
                            color: '#000',
                            opacity: 1,
                          },
                          cursor: 'default',
                          pointerEvents: 'none',
                        }}
                      >
                        Application Submitted
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        disabled={disabled || isFull}
                        onClick={() => handleApply(shift.shiftId)}
                        sx={{
                          minWidth: 120,
                        }}
                      >
                        {isFull ? 'Full' : 'Apply'}
                      </Button>
                    )}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
};

export default ShiftSelector;

