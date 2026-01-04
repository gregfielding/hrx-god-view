/**
 * Message Bubble Component
 * 
 * Renders an individual message bubble in a conversation.
 */

import React, { useState } from 'react';
import { Box, Typography, Avatar, CircularProgress } from '@mui/material';
import { DMMessageView } from '../../types/directMessenger';
import ReactionBar from './ReactionBar';
import ReactionDisplay from './ReactionDisplay';

interface MessageBubbleProps {
  message: DMMessageView;
  showAvatar: boolean;
  showDisplayName: boolean;
  otherUserAvatarUrl?: string;
  otherUserDisplayName?: string;
  reactions?: Array<{ emoji: string; count: number; userReacted: boolean; userIds: string[] }>;
  onReactionClick?: (emoji: string) => void;
  onEmojiPickerOpen?: () => void;
  tenantId?: string;
  threadId?: string;
  currentUserId?: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  showAvatar,
  showDisplayName,
  otherUserAvatarUrl,
  otherUserDisplayName,
  reactions = [],
  onReactionClick,
  onEmojiPickerOpen,
}) => {
  const isMine = message.isOwn;
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isMine ? 'flex-end' : 'flex-start',
        alignItems: 'flex-end',
        gap: 1,
        mb: 1.5,
        px: 2,
        position: 'relative',
        '&:hover .reaction-bar': {
          opacity: 1,
          pointerEvents: 'auto',
        },
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Avatar (only for other user's messages, and only when showing) */}
      {!isMine && showAvatar && (
        <Avatar
          src={otherUserAvatarUrl}
          sx={{
            width: 32,
            height: 32,
            bgcolor: 'primary.main',
            flexShrink: 0,
          }}
        >
          {otherUserDisplayName?.charAt(0).toUpperCase() || 'U'}
        </Avatar>
      )}

      {/* Spacer for alignment when no avatar */}
      {!isMine && !showAvatar && <Box sx={{ width: 32, flexShrink: 0 }} />}

      {/* Message bubble */}
      <Box
        sx={{
          maxWidth: '70%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: isMine ? 'flex-end' : 'flex-start',
        }}
      >
        {/* Display name (only for other user's messages) */}
        {!isMine && showDisplayName && otherUserDisplayName && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              mb: 0.5,
              px: 1,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {otherUserDisplayName}
          </Typography>
        )}

        {/* Bubble */}
        <Box
          sx={{
            px: message.type === 'gif' ? 0 : 2,
            py: message.type === 'gif' ? 0 : 1.25,
            borderRadius: isMine
              ? '18px 18px 4px 18px' // Rounded on left, sharp on bottom-right
              : '18px 18px 18px 4px', // Rounded on right, sharp on bottom-left
            bgcolor: message.type === 'gif' ? 'transparent' : (isMine ? '#0057B8' : '#F3F4F6'),
            color: isMine ? '#FFFFFF' : '#111827',
            wordBreak: 'break-word',
            boxShadow: message.type === 'gif' ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
            opacity: message.isPending ? 0.7 : 1,
            overflow: 'hidden',
          }}
        >
          {message.type === 'gif' && message.gifUrl ? (
            <Box
              sx={{
                maxWidth: { xs: '90%', md: 420 },
                borderRadius: '12px',
                overflow: 'hidden',
                bgcolor: 'transparent',
              }}
            >
              <img
                src={message.gifUrl}
                alt={message.text || 'GIF'}
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                }}
                loading="lazy"
              />
            </Box>
          ) : (
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.9375rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {message.text}
            </Typography>
          )}
        </Box>

        {/* Timestamp and pending indicator */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            mt: 0.5,
            px: 1,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              fontSize: '0.6875rem',
            }}
          >
            {message.timeLabel}
          </Typography>
          {message.isPending && (
            <CircularProgress
              size={10}
              sx={{
                color: 'text.secondary',
                opacity: 0.6,
              }}
            />
          )}
        </Box>

        {/* Reactions Display */}
        {reactions.length > 0 && onReactionClick && (
          <ReactionDisplay
            reactions={reactions}
            onReactionClick={onReactionClick}
            currentUserDisplayName={isMine ? undefined : otherUserDisplayName}
          />
        )}

        {/* Quick Reaction Bar (on hover) */}
        {isHovered && onReactionClick && (
          <Box
            className="reaction-bar"
            sx={{
              position: 'absolute',
              top: -40,
              left: isMine ? 'auto' : 0,
              right: isMine ? 0 : 'auto',
              opacity: 0,
              pointerEvents: 'none',
              transition: 'opacity 0.2s',
              zIndex: 10,
            }}
          >
            <ReactionBar
              onReactionClick={onReactionClick}
              onEmojiPickerOpen={onEmojiPickerOpen}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default MessageBubble;

