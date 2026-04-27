/**
 * Slack Recent Messages Panel
 * 
 * Displays the most recent Slack messages for this tenant.
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
  Link,
} from '@mui/material';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { replaceSlackEmojiCodes } from '../../../utils/slackEmoji';

interface SlackMessage {
  id: string;
  text: string;
  slackUserId: string;
  channelId: string;
  channelType: string;
  createdAt: Date;
  hrxUserId?: string;
}

interface SlackRecentMessagesPanelProps {
  tenantId: string;
}

const SlackRecentMessagesPanel: React.FC<SlackRecentMessagesPanelProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<SlackMessage[]>([]);

  useEffect(() => {
    loadRecentMessages();
  }, [tenantId]);

  const loadRecentMessages = async () => {
    try {
      setLoading(true);
      const messagesRef = collection(db, 'slack_messages');
      const messagesQuery = query(
        messagesRef,
        where('tenantId', '==', tenantId),
        orderBy('createdAt', 'desc'),
        limit(25)
      );
      const snapshot = await getDocs(messagesQuery);

      const loadedMessages: SlackMessage[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        loadedMessages.push({
          id: doc.id,
          text: data.text || '',
          slackUserId: data.slackUserId || '',
          channelId: data.channelId || '',
          channelType: data.channelType || 'channel',
          createdAt: data.createdAt?.toDate() || new Date(),
          hrxUserId: data.hrxUserId,
        });
      });

      setMessages(loadedMessages);
    } catch (err: any) {
      console.error('Error loading recent Slack messages:', err);
    } finally {
      setLoading(false);
    }
  };

  const getChannelTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      im: 'DM',
      channel: 'Channel',
      group: 'Private',
      mpim: 'Group DM',
    };
    return labels[type] || type;
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
        Recent Messages
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Last 25 Slack messages for this tenant
      </Typography>

      {messages.length === 0 ? (
        <Box py={4} textAlign="center">
          <Typography variant="body2" color="text.secondary">
            No messages found
          </Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Channel</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {messages.map((message) => (
                <TableRow key={message.id} hover>
                  <TableCell>
                    <Typography variant="caption">
                      {message.createdAt.toLocaleTimeString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={getChannelTypeLabel(message.channelType)} size="small" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                      {replaceSlackEmojiCodes(message.text).substring(0, 50)}
                      {replaceSlackEmojiCodes(message.text).length > 50 ? '...' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {message.hrxUserId ? (
                      <Chip label="Mapped" size="small" color="success" />
                    ) : (
                      <Chip label="Unmapped" size="small" color="default" />
                    )}
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

export default SlackRecentMessagesPanel;

