/**
 * Slack Traffic Logs Panel
 * 
 * Phase 5: Displays audit trail of Slack ↔ HRX message traffic
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
  IconButton,
  Link,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';

interface SlackTrafficLog {
  id: string;
  direction: 'inbound' | 'outbound';
  type: 'message' | 'error' | 'warning';
  source: 'slackEvents' | 'sendMessageToSlack';
  teamId?: string;
  channelId?: string;
  slackUserId?: string;
  internalConversationId?: string;
  internalMessageId?: string;
  ts: any;
  slackTs?: string;
  slackThreadTs?: string;
  status?: 'ok' | 'skipped' | 'failed';
  reason?: string;
}

interface SlackTrafficLogsPanelProps {
  tenantId: string;
}

const SlackTrafficLogsPanel: React.FC<SlackTrafficLogsPanelProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<SlackTrafficLog[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!tenantId) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const logsRef = collection(db, 'tenants', tenantId, 'slackLogs');
    const logsQuery = query(
      logsRef,
      where('type', '==', 'message'),
      orderBy('ts', 'desc'),
      limit(25)
    );

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const loadedLogs: SlackTrafficLog[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          loadedLogs.push({
            id: doc.id,
            ...data,
          } as SlackTrafficLog);
        });
        setLogs(loadedLogs);
        setLoading(false);
      },
      (error) => {
        console.error('Error listening to Slack traffic logs:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId]);

  const getDirectionColor = (direction: string) => {
    return direction === 'inbound' ? 'primary' : 'secondary';
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'ok':
        return 'success';
      case 'skipped':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'N/A';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString();
  };

  const handleViewConversation = (conversationId?: string, conversationType?: string) => {
    if (conversationId) {
      navigate(`/messages?conversation=${conversationId}&type=${conversationType || 'dm'}`);
    }
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
    <Paper elevation={1} sx={{ px: 2, py: 3, borderRadius: 0 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" fontWeight={700}>
          Traffic Logs
        </Typography>
        <IconButton size="small" onClick={() => setLoading(true)} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Last 25 Slack ↔ HRX message events
      </Typography>

      {logs.length === 0 ? (
        <Box py={4} textAlign="center">
          <Typography variant="body2" color="text.secondary">
            No traffic logs found
          </Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Direction</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Channel</TableCell>
                <TableCell>Conversation</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id} hover>
                  <TableCell>
                    <Typography variant="caption">
                      {formatTimestamp(log.ts)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={log.direction}
                      size="small"
                      color={getDirectionColor(log.direction)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={log.status || 'unknown'}
                      size="small"
                      color={getStatusColor(log.status)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {log.channelId?.substring(0, 12) || 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {log.internalConversationId ? (
                      <Link
                        component="button"
                        variant="caption"
                        onClick={() => handleViewConversation(log.internalConversationId)}
                        sx={{ cursor: 'pointer' }}
                      >
                        View
                      </Link>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        N/A
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {log.reason || '-'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default SlackTrafficLogsPanel;



