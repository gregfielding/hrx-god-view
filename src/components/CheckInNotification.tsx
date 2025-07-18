import React from 'react';
import { Alert, AlertTitle, Button, Box } from '@mui/material';
import { Schedule as ScheduleIcon } from '@mui/icons-material';

interface CheckInNotificationProps {
  message: string;
  onRespond: () => void;
  onDismiss: () => void;
}

const CheckInNotification: React.FC<CheckInNotificationProps> = ({
  message,
  onRespond,
  onDismiss,
}) => {
  return (
    <Alert
      severity="info"
      icon={<ScheduleIcon />}
      action={
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="inherit" size="small" onClick={onRespond}>
            Respond
          </Button>
          <Button color="inherit" size="small" onClick={onDismiss}>
            Dismiss
          </Button>
        </Box>
      }
    >
      <AlertTitle>Check-in Reminder</AlertTitle>
      {message}
    </Alert>
  );
};

export default CheckInNotification;
