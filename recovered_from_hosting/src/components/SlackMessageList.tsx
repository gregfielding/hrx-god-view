/**
 * Slack Message List Component
 * 
 * Displays a list of Slack messages in chronological order.
 */

import React from 'react';
import { Box, Typography, Avatar, CircularProgress, Skeleton } from '@mui/material';
import { SlackChannelMessage } from '../hooks/useSlackChannelThread';
import { getChannelColor } from '../utils/slackChannelUtils';
import { useAuth } from '../contexts/AuthContext';

interface SlackMessageListProps {
  messages: SlackChannelMessage[];
  loading: boolean;
}

/**
 * Format time ago label (e.g. "3m ago", "1h ago", "Yesterday")
 */
function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Get user initials for avatar
 */
function getUserInitials(userName: string): string {
  const parts = userName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return userName.substring(0, 2).toUpperCase();
}

const SlackMessageList: React.FC<SlackMessageListProps> = ({ messages, loading }) => {
  const { avatarUrl } = useAuth();

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Box key={i} sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Skeleton variant="circular" width={40} height={40} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="40%" height={20} sx={{ mb: 1 }} />
              <Skeleton variant="text" width="100%" height={16} />
              <Skeleton variant="text" width="80%" height={16} />
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  if (messages.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 8,
          px: 2,
          textAlign: 'center',
        }}
      >
        <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
          No messages yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Say hi to kick off this channel in Slack
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {messages.map((message) => {
        const avatarColor = getChannelColor(message.userName);
        const initials = getUserInitials(message.userName);
        // Use profile picture for outbound messages (messages sent by current user)
        const isOutbound = message.direction === 'outbound';
        const avatarSrc = isOutbound && avatarUrl ? avatarUrl : undefined;

        return (
          <Box key={message.id} sx={{ display: 'flex', gap: 1.5, mb: 3 }}>
            <Avatar
              src={avatarSrc}
              sx={{
                width: 40,
                height: 40,
                bgcolor: avatarSrc ? undefined : avatarColor,
                color: avatarSrc ? undefined : 'white',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              {!avatarSrc && initials}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" fontWeight={500}>
                  {message.userName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatTimeAgo(message.sentAt)}
                </Typography>
                {message.direction === 'outbound' && (
                  <Box
                    component="span"
                    sx={{
                      fontSize: '10px',
                      px: 1,
                      py: 0.25,
                      borderRadius: '999px',
                      bgcolor: 'rgba(0, 87, 184, 0.1)',
                      color: '#0057B8',
                      fontWeight: 600,
                    }}
                  >
                    HRX
                  </Box>
                )}
              </Box>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.primary',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {message.text}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default SlackMessageList;

