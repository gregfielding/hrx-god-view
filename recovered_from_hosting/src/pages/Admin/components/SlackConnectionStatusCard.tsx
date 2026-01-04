/**
 * Slack Connection Status Card
 * 
 * Displays workspace connection status, bot info, and last event timestamp.
 */

import React, { useState, useEffect } from 'react';
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
import { collection, query, where, orderBy, limit, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '../../../firebase';

interface SlackConnectionStatus {
  workspaceName: string | null;
  botName: string;
  installed: boolean;
  lastEventAt: Date | null;
  teamId: string | null;
}

interface SlackConnectionStatusCardProps {
  tenantId: string;
}

const SlackConnectionStatusCard: React.FC<SlackConnectionStatusCardProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SlackConnectionStatus>({
    workspaceName: null,
    botName: 'HRX Messaging Bridge',
    installed: false,
    lastEventAt: null,
    teamId: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConnectionStatus();
  }, [tenantId]);

  const loadConnectionStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      // Query slackTeams collection for this tenant
      const slackTeamsRef = collection(db, 'slackTeams');
      const teamsQuery = query(
        slackTeamsRef,
        where('tenantId', '==', tenantId),
        limit(1)
      );
      const teamsSnapshot = await getDocs(teamsQuery);

      let workspaceName: string | null = null;
      let teamId: string | null = null;
      let installed = false;

      if (!teamsSnapshot.empty) {
        const teamData = teamsSnapshot.docs[0].data();
        workspaceName = teamData.teamName || teamData.name || null;
        teamId = teamsSnapshot.docs[0].id;
        installed = teamData.status === 'active' || !!teamData.tenantId;
      }

      // Query slack_messages for last event
      const messagesRef = collection(db, 'slack_messages');
      const messagesQuery = query(
        messagesRef,
        where('tenantId', '==', tenantId),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const messagesSnapshot = await getDocs(messagesQuery);

      let lastEventAt: Date | null = null;
      if (!messagesSnapshot.empty) {
        const messageData = messagesSnapshot.docs[0].data();
        if (messageData.createdAt) {
          lastEventAt = messageData.createdAt.toDate();
        }
      }

      setStatus({
        workspaceName,
        botName: 'HRX Messaging Bridge',
        installed,
        lastEventAt,
        teamId,
      });
    } catch (err: any) {
      console.error('Error loading Slack connection status:', err);
      setError(err.message || 'Failed to load connection status');
    } finally {
      setLoading(false);
    }
  };

  const getStatusChip = () => {
    if (!status.installed) {
      return (
        <Chip
          icon={<ErrorIcon />}
          label="Not Connected"
          color="error"
          size="small"
        />
      );
    }

    if (!status.lastEventAt) {
      return (
        <Chip
          icon={<WarningIcon />}
          label="No Recent Events"
          color="warning"
          size="small"
        />
      );
    }

    const daysSinceLastEvent = (Date.now() - status.lastEventAt.getTime()) / (1000 * 60 * 60 * 24);
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
      <Paper elevation={1} sx={{ p: 3, borderRadius: 0 }}>
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
            {status.workspaceName || 'Unknown'}
          </Typography>
        </Box>

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Bot Name
          </Typography>
          <Typography variant="body1">
            {status.botName}
          </Typography>
        </Box>

        {status.teamId && (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Team ID
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
              {status.teamId}
            </Typography>
          </Box>
        )}

        <Divider />

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Last Event
          </Typography>
          {status.lastEventAt ? (
            <Typography variant="body1">
              {status.lastEventAt.toLocaleString()}
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

