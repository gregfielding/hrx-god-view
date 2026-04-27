/**
 * Worker Dashboard — SMS opt-in toggle below the hero.
 * Keeps job notifications visible so users can turn SMS back on (e.g. after STOP).
 */

import React from 'react';
import { Card, CardContent, Typography, Box, Switch } from '@mui/material';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';

export interface WorkerDashboardSmsToggleProps {
  /** SMS is on when user has not opted out and has not sent STOP */
  smsEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

const WorkerDashboardSmsToggle: React.FC<WorkerDashboardSmsToggleProps> = ({
  smsEnabled,
  onToggle,
  disabled = false,
}) => {
  // Only show the card when SMS is off (prompt to turn on); hide when already on
  if (smsEnabled) return null;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent sx={{ py: 1.5, px: 2.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
            <PhoneIphoneIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                SMS Notifications
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Receive job notifications via text message
              </Typography>
            </Box>
          </Box>
          <Switch
            checked={smsEnabled}
            onChange={(_, checked) => onToggle(checked)}
            disabled={disabled}
            color="primary"
          />
        </Box>
      </CardContent>
    </Card>
  );
};

export default WorkerDashboardSmsToggle;
