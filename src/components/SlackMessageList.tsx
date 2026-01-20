/**
 * Slack Message List Component
 * 
 * Displays a list of Slack messages in chronological order.
 */

import React from 'react';
import { Box, Typography, Avatar, CircularProgress, Skeleton, Link } from '@mui/material';
import { SlackChannelMessage } from '../hooks/useSlackChannelThread';
import { getChannelColor } from '../utils/slackChannelUtils';
import { useAuth } from '../contexts/AuthContext';
import { SlackMessageReactionsBar } from './slack/SlackMessageReactionsBar';
import { replaceSlackEmojiCodes } from '../utils/slackEmoji';

interface SlackMessageListProps {
  messages: SlackChannelMessage[];
  loading: boolean;
  channelId?: string; // Slack channel ID for reactions context
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

/**
 * Render text with mentions as blue links
 */
function renderTextWithMentions(text: string): React.ReactNode {
  // Match @mentions, #contacts, &workers, %companies, !deals, ^candidates, *locations, ~tasks
  const MENTION_REGEX = /([@#&%!^*~])([^\s.,!?]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const prefix = match[1];
    const token = match[2];
    const fullMatch = match[0];
    const matchIndex = match.index;

    // Add text before the mention
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    // Render mention as a link (for now, just style it - we can add navigation later)
    parts.push(
      <Link
        key={matchIndex}
        component="span"
        onClick={(e) => {
          e.preventDefault();
          // TODO: Navigate to user/entity page based on mention type
          // For now, just prevent default to show it's clickable
        }}
        sx={{
          color: '#1976d2',
          textDecoration: 'none',
          fontWeight: 500,
          cursor: 'pointer',
          '&:hover': {
            textDecoration: 'underline',
            color: '#1565c0',
          },
        }}
      >
        {fullMatch}
      </Link>
    );

    lastIndex = matchIndex + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

const SlackMessageList: React.FC<SlackMessageListProps> = ({ messages, loading, channelId }) => {
  const { avatarUrl, user } = useAuth();

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
        const displayText = replaceSlackEmojiCodes(message.text);

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
              <Box
                component="span"
                sx={{
                  color: 'text.primary',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  '& a': {
                    color: '#1976d2',
                    textDecoration: 'none',
                    fontWeight: 500,
                    '&:hover': {
                      textDecoration: 'underline',
                      color: '#1565c0',
                    },
                  },
                }}
              >
                {renderTextWithMentions(displayText)}
              </Box>
              
              {/* Reactions Bar */}
              {channelId && user?.uid && (
                <SlackMessageReactionsBar
                  ctx={{
                    channelId,
                    messageTs: message.ts,
                  }}
                  currentUserId={user.uid}
                  compact
                />
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default SlackMessageList;

