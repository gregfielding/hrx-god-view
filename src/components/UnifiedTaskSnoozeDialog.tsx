/**
 * UnifiedTaskSnoozeDialog Component
 * 
 * Dialog for snoozing tasks with quick options: Later today, Tomorrow, Next week, Custom date.
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  ButtonGroup,
  TextField,
  Box,
  Typography,
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  CalendarToday as CalendarTodayIcon,
  Event as EventIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { TaskSnoozeOptions } from '../types/UnifiedTask';
import { endOfDay, startOfTomorrow, addWeeks, startOfDay } from 'date-fns';

interface UnifiedTaskSnoozeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: TaskSnoozeOptions) => void;
  taskTitle?: string;
}

const UnifiedTaskSnoozeDialog: React.FC<UnifiedTaskSnoozeDialogProps> = ({
  open,
  onClose,
  onConfirm,
  taskTitle,
}) => {
  const [selectedOption, setSelectedOption] = useState<TaskSnoozeOptions['until'] | null>(null);
  const [customDate, setCustomDate] = useState<string>('');

  const handleQuickOption = (option: TaskSnoozeOptions['until']) => {
    setSelectedOption(option);
    if (option !== 'custom') {
      onConfirm({ until: option });
      handleClose();
    }
  };

  const handleCustomConfirm = () => {
    if (customDate) {
      onConfirm({ until: 'custom', customDate });
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedOption(null);
    setCustomDate('');
    onClose();
  };

  const getQuickOptionLabel = (option: TaskSnoozeOptions['until']) => {
    switch (option) {
      case 'later_today':
        return 'Later Today';
      case 'tomorrow':
        return 'Tomorrow';
      case 'next_week':
        return 'Next Week';
      case 'custom':
        return 'Custom Date';
      default:
        return option;
    }
  };

  const getQuickOptionTime = (option: TaskSnoozeOptions['until']) => {
    const now = new Date();
    switch (option) {
      case 'later_today':
        return endOfDay(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'tomorrow':
        return startOfTomorrow().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      case 'next_week':
        return addWeeks(startOfDay(now), 1).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      default:
        return '';
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScheduleIcon />
          Snooze Task
        </Box>
        {taskTitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontWeight: 500 }}>
            {taskTitle}
          </Typography>
        )}
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Quick Options */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
              Quick Options
            </Typography>
            <ButtonGroup
              orientation="vertical"
              fullWidth
              variant="outlined"
              sx={{ gap: 1, '& > button': { justifyContent: 'flex-start', textTransform: 'none' } }}
            >
              <Button
                onClick={() => handleQuickOption('later_today')}
                startIcon={<AccessTimeIcon />}
                sx={{ py: 1.5 }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                  <Typography variant="body1">{getQuickOptionLabel('later_today')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Until {getQuickOptionTime('later_today')}
                  </Typography>
                </Box>
              </Button>

              <Button
                onClick={() => handleQuickOption('tomorrow')}
                startIcon={<CalendarTodayIcon />}
                sx={{ py: 1.5 }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                  <Typography variant="body1">{getQuickOptionLabel('tomorrow')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {getQuickOptionTime('tomorrow')}
                  </Typography>
                </Box>
              </Button>

              <Button
                onClick={() => handleQuickOption('next_week')}
                startIcon={<EventIcon />}
                sx={{ py: 1.5 }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                  <Typography variant="body1">{getQuickOptionLabel('next_week')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {getQuickOptionTime('next_week')}
                  </Typography>
                </Box>
              </Button>
            </ButtonGroup>
          </Box>

          {/* Custom Date Option */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
              Or Choose a Custom Date
            </Typography>
            <TextField
              fullWidth
              type="datetime-local"
              label="Snooze Until"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setSelectedOption('custom');
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        {selectedOption === 'custom' && (
          <Button
            variant="contained"
            onClick={handleCustomConfirm}
            disabled={!customDate}
          >
            Snooze
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedTaskSnoozeDialog;

