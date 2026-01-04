/**
 * Slack Connection Status Card
 * 
 * Displays workspace connection status, bot info, and last event timestamp.
 */

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import { useSlackIntegration } from '../../../hooks/useSlackIntegration';

interface SlackConnectionStatusCardProps {
  tenantId: string;
}

const SlackConnectionStatusCard: React.FC<SlackConnectionStatusCardProps> = ({ tenantId }) => {
  const { loading, error, team } = useSlackIntegration();

  const isConnected = !!team && team.status === 'active';

  const getStatusChip = () => {
    if (!isConnected) {
      return (
        <Chip
          icon={<ErrorIcon />}
          label="Not Connected"
          color="error"
          size="small"
        />
      );
    }

    if (!team?.lastEventTs) {
      return (
        <Chip
          icon={<WarningIcon />}
          label="No Recent Events"
          color="warning"
          size="small"
        />
      );
    }

    // Parse lastEventTs (Slack timestamp format: "1234567890.123456")
    const lastEventTimestamp = team.lastEventTs.split('.')[0];
    const lastEventDate = new Date(Number(lastEventTimestamp) * 1000);
    const daysSinceLastEvent = (Date.now() - lastEventDate.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastEvent > 7) {
      return (
        <Chip
          icon={<WarningIcon />}
          label="No Recent Events"
          color="warning"
          size="small"
        />
      );
    }

    return (
      <Chip
        icon={<CheckCircleIcon />}
        label="Connected"
        color="success"
        size="small"
      />
    );
  };

  if (loading) {
    return (
      <Paper elevation={1} sx={{ px: 2, py: 3, borderRadius: 0 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  return (
    <Paper elevation={1} sx={{ p: 3, borderRadius: 0 }}>
      <Typography variant="h6" fontWeight={700} mb={2}>
        Connection Status
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Status
          </Typography>
          {getStatusChip()}
        </Box>

        <Divider />

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Workspace
          </Typography>
          <Typography variant="body1">
            {team?.teamName || 'Unknown'}
          </Typography>
        </Box>

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Bot Name
          </Typography>
          <Typography variant="body1">
            {team?.botDisplayName || 'HRX Messaging Bridge'}
          </Typography>
        </Box>

        {team?.teamId && (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Team ID
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
              {team.teamId}
            </Typography>
          </Box>
        )}

        <Divider />

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Last Event
          </Typography>
          {team?.lastEventTs ? (
            <Typography variant="body1">
              {(() => {
                // Parse Slack timestamp (format: "1234567890.123456")
                const timestamp = team.lastEventTs.split('.')[0];
                return new Date(Number(timestamp) * 1000).toLocaleString();
              })()}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No events received yet
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
};

export default SlackConnectionStatusCard;



